## 选择版本

两个版本二选一安装。自动版包含手动太阳按钮；手动版只根据点击切换，不访问视频网站，不自动判断网页状态。

两版使用同一个控制器身份。要更换版本，先移除旧的“Edge 浏览器外观切换”控制器，再加载所选版本的 `packages/controller`。不需要移除深色主题，也不要同时加载两版。

## 首次安装

1. 将整个 ZIP 解压到准备长期保留的目录。
2. 在当前 Edge 打开 `edge://extensions`，开启开发人员模式，点击“加载解压缩的扩展”，选择解压包中的 `packages/controller`。
3. 将包中的 `packages/theme-dark.crx` 拖入 Edge 扩展页安装。两版使用相同的深色主题；已经安装该主题则跳过此步。
4. 将控制器的太阳图标固定到工具栏，单击即可切换深浅外观。
5. 自动版需要允许包内声明的 B站／YouTube 网站权限；手动版仅需要管理主题的权限。

网页内容和 Windows 系统主题保持原样；深色配色用于浏览器顶栏、工具栏、地址栏和标签栏。

## Edge 139 主题保留策略

Edge 139 会回收普通安装但处于停用状态的非当前主题。若此前已经为本项目设置主题保留策略，不需要重复设置。

首次使用时，以管理员身份打开 PowerShell，切换到解压目录并执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\install-theme-policy.ps1"
```

然后在 `edge://policy` 重新加载策略。若没有立即提升为管理员安装，可自行重启 Edge 一次。此脚本只登记本项目主题，并拒绝覆盖其他策略内容；它不作为运行时组件，不改 Cookie、账号或浏览器配置目录。

撤销这项策略可在同一位置的管理员 PowerShell 执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\install-theme-policy.ps1" -Remove
```

## 自动版行为

只判断前台 Edge 窗口当前选中的标签：B站视频网页全屏、B站直播间、YouTube 影院模式会自动开启深色。退出对应模式或切到普通标签，只撤销自动开启的深色。手动开启的深色保持；自动深色时手动关闭，本段观看期间不会自动重开。

手动版不包含以上检测和自动切换功能。

主题对同一浏览器配置中的窗口共同生效。标签很多时，切换可能有约半秒延迟。

## 许可

本软件采用 MIT 许可证，完整条款见包内 `LICENSE`。
