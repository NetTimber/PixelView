[CmdletBinding()]
param(
    [switch]$NoPause,
    [switch]$NoOpen,
    [switch]$SkipDependencyInstall,
    [string]$SigningKeyPath = "",
    [string]$ReleaseBaseUrl = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$packageJsonPath = Join-Path $projectRoot "package.json"
$installerDirectory = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis"

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "命令执行失败：$Command $($Arguments -join ' ')（退出码：$LASTEXITCODE）"
    }
}

try {
    if (-not (Test-Path -LiteralPath $packageJsonPath)) {
        throw "脚本必须放在 PixelView 项目根目录中运行。"
    }

    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "找不到 npm，请先安装 Node.js LTS。"
    }

    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw "找不到 Cargo，请先安装 Rust stable-msvc 工具链。"
    }

    if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
        if (-not $SigningKeyPath) {
            $defaultKeyPath = Join-Path $env:USERPROFILE ".pixelview\pixelview-updater.key"
            if (Test-Path -LiteralPath $defaultKeyPath) {
                $SigningKeyPath = $defaultKeyPath
            }
        }

        if (-not $SigningKeyPath -or -not (Test-Path -LiteralPath $SigningKeyPath)) {
            throw "未找到更新签名私钥。请设置 TAURI_SIGNING_PRIVATE_KEY，或使用 -SigningKeyPath 指定私钥文件。"
        }

        $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -LiteralPath $SigningKeyPath -Raw).Trim()
    }

    if ($null -eq $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
    }

    Push-Location $projectRoot
    try {
        if (-not $SkipDependencyInstall -and -not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules"))) {
            Write-Host "正在安装前端依赖……" -ForegroundColor Cyan
            Invoke-CheckedCommand npm "ci" "--no-audit" "--no-fund"
        }

        Write-Host "正在检查前端代码……" -ForegroundColor Cyan
        Invoke-CheckedCommand npm "run" "build"

        Write-Host "正在运行 Rust 测试……" -ForegroundColor Cyan
        Invoke-CheckedCommand cargo "test" "--manifest-path" "src-tauri\Cargo.toml" "--locked"

        Write-Host "正在构建 PixelView Release 安装包……" -ForegroundColor Cyan
        Invoke-CheckedCommand npm "run" "tauri" "build"
    }
    finally {
        Pop-Location
    }

    $installer = Get-ChildItem -LiteralPath $installerDirectory -Filter "*-setup.exe" -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $installer) {
        throw "构建完成，但没有找到 NSIS 安装包。"
    }

    $signaturePath = "$($installer.FullName).sig"
    if (-not (Test-Path -LiteralPath $signaturePath)) {
        throw "安装包已生成，但没有找到更新签名文件。"
    }

    $version = (Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json).version

    if ($ReleaseBaseUrl) {
        $baseUrl = $ReleaseBaseUrl.TrimEnd("/")
        $manifest = [ordered]@{
            version = $version
            notes = "PixelView $version"
            pub_date = (Get-Date).ToUniversalTime().ToString("o")
            platforms = [ordered]@{
                "windows-x86_64" = [ordered]@{
                    signature = (Get-Content -LiteralPath $signaturePath -Raw).Trim()
                    url = "$baseUrl/$($installer.Name)"
                }
            }
        }

        $manifestPath = Join-Path $installerDirectory "latest.json"
        $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8
        Write-Host "更新清单：$manifestPath" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "PixelView v$version 构建成功。" -ForegroundColor Green
    Write-Host "安装包：$($installer.FullName)"
    Write-Host "更新签名：$signaturePath"

    if (-not $ReleaseBaseUrl) {
        Write-Host "如需生成 latest.json，请传入 -ReleaseBaseUrl。" -ForegroundColor Yellow
    }

    if (-not $NoOpen) {
        Start-Process explorer.exe -ArgumentList "/select,`"$($installer.FullName)`""
    }
}
catch {
    Write-Host ""
    Write-Host "构建失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    if (-not $NoPause) {
        Read-Host "按 Enter 键关闭窗口"
    }
}
