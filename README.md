# PixelView

[![Release](https://img.shields.io/github/v/release/NetTimber/PixelView?display_name=tag&sort=semver)](https://github.com/NetTimber/PixelView/releases/latest)
[![Release PixelView](https://github.com/NetTimber/PixelView/actions/workflows/release.yml/badge.svg)](https://github.com/NetTimber/PixelView/actions/workflows/release.yml)
[![License](https://img.shields.io/github/license/NetTimber/PixelView)](LICENSE)

面向像素图片的轻量级 Windows 查看器。启动迅速、界面简洁，使用最近邻缩放保持像素边缘清晰，不包含图片编辑功能。

## 下载

从 [最新 Release](https://github.com/NetTimber/PixelView/releases/latest) 下载 `PixelView_*_x64-setup.exe` 并运行。

- 支持 Windows 10/11 x64。
- 使用当前用户安装模式，不需要管理员权限。
- 安装后可以在 Windows“默认应用”中将 PixelView 设为常用图片格式的默认查看器。
- 新版本可在应用内检查、验签并覆盖升级。

## 功能

- 支持 PNG、JPG/JPEG、WebP、BMP 和 GIF。
- 像素级清晰缩放，放大时不进行平滑插值。
- 智能适应窗口、原始尺寸、分级缩放和拖动画布。
- 左右旋转、全屏查看、复制图片和复制文件路径。
- 右侧显示当前文件夹图片，支持滚轮、方向键和点击切换。
- 浅色、深色和跟随系统三种主题模式。
- 记忆窗口位置、大小和侧栏状态。
- 单实例运行，双击新图片时复用当前窗口。
- 支持在线更新、本地安装包升级和标准卸载。

PixelView 只读取图片，不会修改原文件。

## 常用操作

| 操作 | 快捷键或方式 |
| --- | --- |
| 打开图片 | `Ctrl + O` |
| 上一张 / 下一张 | `↑` / `↓`，或滚轮 |
| 放大 / 缩小 | `+` / `-`，或 `Ctrl + 滚轮` |
| 智能适应 | `0` |
| 原始尺寸 | `1` |
| 向右 / 向左旋转 | `R` / `Shift + R` |
| 复制图片 | `Ctrl + C` |
| 复制文件路径 | `Ctrl + Shift + C` |
| 全屏 | `F11` |
| 移动画布 | 按住图片区域拖动 |

## 本地开发

需要以下环境：

- Node.js 22 或更新的 LTS 版本
- Rust stable MSVC 工具链
- Visual Studio Build Tools，包含“使用 C++ 的桌面开发”
- Windows WebView2 Runtime

```powershell
git clone https://github.com/NetTimber/PixelView.git
cd PixelView
npm install
npm run tauri dev
```

运行检查：

```powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

构建 NSIS 安装包：

```powershell
npm run tauri build
```

## 发布

项目通过 GitHub Actions 发布。维护者需要同步更新以下三个文件中的版本号：

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

提交后推送同版本标签：

```powershell
git tag -a v0.2.1 -m "PixelView v0.2.1"
git push origin main
git push origin v0.2.1
```

流水线会在 Windows Runner 上执行测试、构建签名安装包、生成 `latest.json`，并创建 GitHub Release。更新签名私钥仅保存在仓库的 `TAURI_SIGNING_PRIVATE_KEY` Actions Secret 中，不应提交到 Git。

## 许可证

[MIT](LICENSE)
