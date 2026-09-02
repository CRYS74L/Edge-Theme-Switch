# Edge 浏览器整体外观一键切换

单击固定在 Microsoft Edge 工具栏上的扩展图标，即可在当前 Edge 的浅色与深色整体外观之间往返。切换对象是浏览器顶栏、标签栏、地址栏和 Edge 内置页面；不会把网页内容强行反色，也不会更改 Windows 系统主题。

Edge 没有向普通 MV3 扩展公开“写入浏览器整体外观”的 API。本项目因此使用一次性 Native Messaging 本机组件：每次单击时由 Edge 启动组件，组件在同一 Edge 进程的屏幕外临时窗口中操作 Edge 自己的“外观”设置，确认后关闭临时窗口并立即退出。

## 已验证的实际结果

2026-09-02 已在当前 Edge 的真实工具栏按钮上完成 4 次连续切换，其中包括此前容易失效的第二次点击：

- 顶栏采样从深色 RGB 32,32,32 变为浅色 RGB 243,243,243，并可反向切回。
- 当前 Edge 窗口边界没有变化，没有截图遮罩或非等比拉伸。
- Windows 的 AppsUseLightTheme 和 SystemUsesLightTheme 值在前后保持不变。
- 每次操作约 2 秒完成；本机组件完成后没有残留进程。

## 工作方式

1. packages/controller 是唯一需要加载到 Edge 的 MV3 工具栏扩展。
2. 点击图标后，扩展通过 chrome.runtime.sendNativeMessage 向固定名称 com.crys74l.edge_browser_theme_toggle 发送一次 toggle 请求。
3. Edge 只为这一次请求启动 packages/native-host。它使用 stdin/stdout 的 Native Messaging 管道读取请求、返回结果并退出；不监听端口，不访问网络，不注册登录自启。
4. 本机组件优先使用 Edge 传入的父窗口句柄，在同一 Edge 进程创建一个单标签临时窗口并移到屏幕外。它在该窗口打开 edge://settings/appearance，选择相反的 light 或 dark 控件，确认结果后关闭临时窗口并恢复原窗口焦点。
5. 只有收到 ok 和实际 mode 后，扩展才更新工具栏悬停标题。快速连续点击会串行执行，避免多个临时窗口互相干扰。

可见的当前 Edge 页面不会被导航到设置页，不会被替换成截图，也不会被拉伸。若组件无法安全确认临时窗口或外观结果，扩展会显示失败状态，而不会谎称已经切换。

## 安装到当前 Edge

先在项目根目录安装一次本机组件：

~~~powershell
Set-Location -LiteralPath 'D:\【主文件夹】\下载\【Codex 工作空间】\Edge 颜色主题切换插件'
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-native-host.ps1
~~~

脚本只会发布到：

%LOCALAPPDATA%\CRYS74L\EdgeBrowserThemeToggle\NativeHost

并创建这一条当前用户 Native Messaging 注册项：

HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.crys74l.edge_browser_theme_toggle

然后在当前 Edge 中：

1. 打开 edge://extensions 并启用“开发人员模式”。
2. 选择“加载解压缩的扩展”，选择 packages/controller。
3. 将“Edge 浏览器外观切换”固定到工具栏。
4. 单击图标即可切换。悬停标题会显示当前 Edge 外观和下一次点击的方向。

如果之前加载过旧的 theme-light、theme-dark 或网页 CSS 方案，应先移除它们，避免它们覆盖浏览器外观。安装本机组件后，已加载的 controller 可在 edge://extensions 中点“重新加载”一次。

## 卸载

先在 Edge 中移除 controller，然后执行：

~~~powershell
Set-Location -LiteralPath 'D:\【主文件夹】\下载\【Codex 工作空间】\Edge 颜色主题切换插件'
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-native-host.ps1 -Uninstall
~~~

卸载只会删除默认值仍指向本项目清单的精确 Native Messaging 注册项，以及脚本生成的运行文件。它不会修改 Windows 主题、Edge Preferences、代理、策略、其他扩展、当前 Edge 窗口或用户标签页；旧方案留下且值完全匹配的登录启动项只会被安全清理，不会创建新的登录启动项。

## 验证

~~~powershell
npm test
dotnet build .\packages\native-host\EdgeBrowserThemeToggle.NativeHost.csproj --nologo
dotnet run --project .\tests\native-host-contract\NativeHostContract.csproj --nologo
git diff --check
~~~

端到端验收时，应确认顶栏和标签栏本身改变，而非仅网页内容改变；还应确认 Windows 主题值、Edge 窗口尺寸和原窗口都没有被改动。

## 项目结构

| 路径 | 作用 |
| --- | --- |
| packages/controller | 唯一加载到 Edge 的 MV3 工具栏 action。 |
| packages/native-host | 一次性 Native Messaging 宿主与 Edge UI Automation。 |
| scripts/install-native-host.ps1 | 可逆发布、注册和卸载脚本。 |
| tests | Controller、清单、Native Messaging 协议与本机组件契约测试。 |
