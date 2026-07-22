# PixelView

轻量级像素图片查看器。当前版本号统一配置在 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json`。

## 打包与升级

双击桌面的 `PixelView-一键打包.ps1` 会生成 NSIS 安装包及 `.sig` 更新签名。签名私钥位于当前用户的 `%USERPROFILE%\.pixelview\pixelview-updater.key`，不能上传或丢失；应用仅内置公钥。

生成在线更新清单：

```powershell
& "$env:USERPROFILE\Desktop\PixelView-一键打包.ps1" -ReleaseBaseUrl "https://你的下载域名/releases"
```

项目发布在 [NetTimber/PixelView](https://github.com/NetTimber/PixelView)。应用默认从最新 GitHub Release 的 `latest.json` 检查、验签并覆盖升级。

推送与 `package.json` 版本一致的标签即可自动发布：

```powershell
git tag v0.2.1
git push origin v0.2.1
```

GitHub Actions 会在 Windows 上运行测试、生成签名安装包、创建 `latest.json` 并发布 Release。仓库需要配置 `TAURI_SIGNING_PRIVATE_KEY` Actions Secret。

桌面脚本也可以生成用于其他 HTTPS 下载服务器的更新清单：

```powershell
& "$env:USERPROFILE\Desktop\PixelView-一键打包.ps1" -ReleaseBaseUrl "https://你的下载域名/releases"
```

Windows 安装器使用当前用户安装模式。安装新版本会替换旧版本，卸载入口会调用安装目录中的官方 `uninstall.exe`，不会删除用户的图片文件。
