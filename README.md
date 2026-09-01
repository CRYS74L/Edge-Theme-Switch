# Edge 浏览器整体外观一键切换

单击已固定在 Edge 工具栏上的扩展图标，即可在当前 Edge 窗口的**浅色**与**深色**整体外观之间往返。切换的是浏览器顶栏、标签栏、地址栏和 Edge 内置页面，不是网页内容的反色模式。

此项目不会修改 Windows 系统主题，也不会结束、重启或另开 Edge 窗口。

## 使用体验

- 没有 popup、选项页、侧边栏或网页 CSS 注入。
- 单击一次工具栏图标即可切换；工具栏悬停标题会显示当前外观和下一次切换方向。
- 实现会在当前 Edge 内部短暂使用 `edge://settings/appearance` 的稳定 UI Automation 控件，但整个过程由当前窗口截图遮罩覆盖。用户看到的是原页面短暂保持，然后直接出现新的浏览器 chrome；不会露出空白页、临时标签页或设置页。
- 每次完成后都会恢复原标签数量与原活动页面。

## 安装到当前 Edge

在项目根目录执行一次本机桥接安装：

```powershell
Set-Location -LiteralPath 'D:\【主文件夹】\下载\【Codex 工作空间】\Edge 颜色主题切换插件'
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-native-host.ps1
```

脚本会将桥接程序发布到：

`%LOCALAPPDATA%\CRYS74L\EdgeBrowserThemeToggle\NativeHost`

并创建唯一的当前用户登录启动项：

`HKCU\Software\Microsoft\Windows\CurrentVersion\Run\CRYS74L.EdgeBrowserThemeToggle`

该后台助手只监听 `127.0.0.1:42761`，不监听局域网地址；它只负责接收此扩展的本机切换请求。

接着在**当前已经打开的 Edge** 中：

1. 打开 `edge://extensions`，启用“开发人员模式”。
2. 移除旧的 `theme-light`、`theme-dark`、网页深浅色切换扩展，避免旧方案干扰。
3. 选择“加载解压缩的扩展”，目录选择：

   `D:\【主文件夹】\下载\【Codex 工作空间】\Edge 颜色主题切换插件\packages\controller`

4. 将“Edge 浏览器外观切换”固定到工具栏。
5. 单击该图标即可在浅色和深色 Edge 整体外观之间切换。

## 卸载与恢复

先移除 Edge 中加载的控制扩展，再执行：

```powershell
Set-Location -LiteralPath 'D:\【主文件夹】\下载\【Codex 工作空间】\Edge 颜色主题切换插件'
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-native-host.ps1 -Uninstall
```

卸载会停止本项目的本机桥接、删除上述精确 Run 值和本项目生成的运行文件，并清理旧 Native Messaging 注册项；不会修改 Windows 主题、Edge Preferences、策略或其他扩展。

## 项目结构

| 路径 | 作用 |
| --- | --- |
| `packages/controller` | 唯一需要加载到 Edge 的 MV3 工具栏 action。 |
| `packages/native-host` | 只绑定本机回环地址的 .NET 7 桥接与 Edge UI Automation。 |
| `scripts/install-native-host.ps1` | 可逆安装、启动和卸载本机桥接。 |
| `tests` | MV3 请求、回环协议、Native host 和清单契约测试。 |

## 验证

```powershell
npm test
dotnet build .\packages\native-host\EdgeBrowserThemeToggle.NativeHost.csproj --nologo
dotnet run --project .\tests\native-host-contract\NativeHostContract.csproj --nologo
dotnet run --project .\tests\loopback-bridge-contract\LoopbackBridgeContract.csproj --nologo
```

当前版本已在现有 Edge 窗口上真实验证两次连续单击：浅→深、深→浅均保留 6 个原有标签，且 Windows 系统主题未变。
