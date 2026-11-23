## 适用版本

Windows x64 版 Microsoft Edge Stable。辅助程序支持以下具体构建：`139.0.3405.111`、`156.0.4314.84`、`157.0.4341.60`。使用 64 位 Python 3.11 或更新版本，确保 PowerShell 能找到 `python.exe`。

辅助程序在 Edge 启动时为本项目的深色主题保留一个例外。它会校验浏览器构建和安装文件，遇到未知构建时会记录原因并等待适配。请在升级 Edge 前查看目标构建是否在支持列表中。

## 安装

两个版本二选一。自动版包含手动太阳按钮，并在指定视频模式下自动切换。手动版只响应太阳按钮。两版使用同一个扩展身份。

1. 解压到准备长期保留的位置。GitHub 标签的源码压缩包可直接安装自动版。
2. 在解压目录打开 PowerShell，运行下面的检查。检查通过后，将最后一个参数改成 `Install` 再运行一次。计划任务会在登录时以当前用户权限启动辅助程序。

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\configure-theme-retention.ps1" -Action Check
   ```

3. 关闭 Edge 的所有窗口后重新打开，访问 `edge://extensions`，开启开发人员模式。分别用“加载解压缩的扩展”选择 `packages/controller` 和 `packages/theme-dark`。深色主题安装后会立即应用。
4. 将太阳图标固定到工具栏。验证来回切换，以及关闭 Edge 再打开后仍能切换。

开发人员模式下的加载步骤参见 [Microsoft Edge 官方说明](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading#locally-installing-and-running-an-extension)。

## 从旧版升级

如果原来已经安装了无策略试验版，在原目录更新文件，运行上面的检查，再以 `Install` 重新运行脚本。脚本会更新并重启现有保留任务。辅助程序可以接上已经打开的 Edge，原来的深色主题可以继续使用。之后重开 Edge，核对浅色闲置后仍能切回深色。

如果 `edge://policy` 还显示由本项目创建的 `ExtensionSettings`，先完成辅助程序安装并准备好旧版恢复资料。在管理员 PowerShell 中执行一次旧策略撤销脚本。其他管理策略由其配置者处理。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\install-theme-policy.ps1" -Remove
```

关闭再打开 Edge，按首次安装步骤加载普通深色主题。若原来的主题和按钮已能正常工作，可以沿用现有安装。

## 自动版行为

B站视频网页全屏、B站直播间和 YouTube 影院模式会自动开启深色。退出对应模式或切到普通标签，只撤销自动开启的深色。手动开启的深色会保留。自动深色时手动切回浅色，本段观看期间会保持浅色。

## 停用和卸载

在安装目录运行配置脚本，把 `-Action Check` 改成 `-Action Remove`，即可移除辅助程序的启动任务。关闭并重新打开 Edge，移除控制扩展并在“设置 → 外观”恢复默认主题。

本项目采用 MIT 许可证，完整条款见 `LICENSE`。
