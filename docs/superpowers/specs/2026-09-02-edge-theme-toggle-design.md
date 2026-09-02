# Edge 浏览器整体外观一键切换设计

## 目标

在已经打开的当前 Microsoft Edge 中，单击固定工具栏图标，在 Edge 自身浅色与深色整体外观之间往返。验收对象是浏览器顶栏、标签栏、地址栏和内置页面；网页内容与 Windows 系统主题不属于切换对象。

## 已验证边界

- Edge 139 的公开 MV3 API 没有向普通扩展开放写入整体外观的能力。私有 settingsPrivate 接口不适用于普通扩展。
- 静态 theme 包能着色 browser chrome，但临时加载的另一个主题会被 Edge 回收，不能稳定往返。网页 CSS 只能改变网页内容。
- edge://settings/appearance 的 light 与 dark UI Automation 标识会真实改变 Edge 整体外观，不会写入 Windows 系统主题。
- 该环境的 .NET socket 创建曾报 SocketException 10106，因此回环 TCP bridge 既不必要也不可靠。

## 交付架构

1. packages/controller 是唯一需要固定到 Edge 工具栏的 MV3 扩展。点击 action 会通过 chrome.runtime.sendNativeMessage 向 com.crys74l.edge_browser_theme_toggle 发送一次 toggle 请求。
2. Edge 按 Native Messaging 协议只为本次点击启动 packages/native-host。宿主从 stdin 读取一帧请求，向 stdout 写一帧结果，然后退出；没有端口、网络请求、Run 项或常驻进程。
3. 宿主优先使用 Edge 传入的 parent-window 句柄锁定发起单击的窗口。它在同一 Edge 进程中创建一个单标签临时窗口，立即移到屏幕外；当前可见窗口的标签不会导航、替换、截图或拉伸。
4. 临时窗口打开 edge://settings/appearance，读取已选 light 或 dark，选择相反模式并确认结果，然后关闭自身并把焦点还给原窗口。
5. controller 只在 Native Messaging 返回 ok 加真实 mode 后更新 action 标题。快速连续点击被串行化，避免重叠的临时窗口。

## 安全与副作用边界

- 不使用截图、覆盖层、透明窗、网页 CSS、静态 theme 包、回环 HTTP、代理、Windows 服务、计划任务或登录自启。
- 常规成功和可安全清理失败都会关闭临时窗口。若无法确认它仍是同一进程的单标签窗口，宿主拒绝关闭不确定目标并报告失败，而不关闭用户窗口。
- 宿主不结束或重启用户可见 Edge，也不更改 Windows 主题、Edge Preferences、代理或政策。
- Native Messaging 的 stdin/stdout 是 Edge 与本机进程之间的一次性管道，不是网络连接。

## 本机集成与可逆性

安装脚本只管理以下精确对象：

- 运行文件：%LOCALAPPDATA%\CRYS74L\EdgeBrowserThemeToggle\NativeHost
- Native Messaging 清单：%LOCALAPPDATA%\CRYS74L\EdgeBrowserThemeToggle\NativeHost\com.crys74l.edge_browser_theme_toggle.json
- 用户级注册表项：HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.crys74l.edge_browser_theme_toggle，默认值为上述清单完整路径。

卸载只在默认值仍等于本项目清单路径时移除这一项，并仅删除安装脚本允许列表中的运行文件。它不触碰 Windows 主题、Edge Preferences、政策、代理、其他扩展、当前 Edge 窗口或用户标签页。

## 验收证据

当前 Edge 上已经完成四次真实工具栏点击：

- 深色顶栏 RGB 32,32,32 与浅色顶栏 RGB 243,243,243 双向切换。
- 第二次、第三次、第四次点击都在约两秒内完成，最终回到深色。
- 目标 Edge 窗口边界始终不变，本机组件每次完成后都没有残留进程。
- Windows AppsUseLightTheme 和 SystemUsesLightTheme 在前后完全相同。
