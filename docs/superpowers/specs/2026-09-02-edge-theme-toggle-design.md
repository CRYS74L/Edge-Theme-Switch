# Edge 浏览器整体外观一键切换设计

## 目标

在用户当前已经打开的 Microsoft Edge 中，单击固定工具栏图标，在浏览器自身的浅色和深色整体外观之间往返。验收对象是 Edge 顶栏、标签栏、工具栏、地址栏和 Edge 内置页面；网页内容与 Windows 系统主题不属于切换对象。

## 根因与方案选择

Edge 的普通扩展没有公开 API 可以直接写入设置页中的 browser.theme.color_scheme2。旧方案通过 `chrome.management` 停用唯一的解压缩深色主题包来模拟浅色，但当前 Edge 139 在停用该主题后会把它从管理列表移除；下一次 `getAll()` 无法再找到主题，所以往返切换失败。

扩展不创建或激活临时标签，由本机宿主在同一 Edge 进程中创建一个只有一个标签的临时窗口。宿主立即把该窗口移到屏幕外，再通过地址栏打开“设置”→“外观”，读取 `light`/`dark` 单选项，选择相反状态并等待 Edge UI 确认。完成后宿主只在单标签安全条件满足时关闭临时窗口，并恢复原 Edge 窗口焦点。

扩展不能直接创建 `edge://settings/appearance` 标签；Edge 会返回“Cannot access chrome:// and edge:// URLs”。因此设置页导航必须由宿主在现有 Edge 窗口中完成。

## 交付架构

1. `packages/controller` 是 Manifest V3 工具栏控制器，只申请 `nativeMessaging` 和 `storage` 权限。
2. 每次点击只调用一次性 `sendNativeMessage`，不调用 `chrome.tabs`，因此不会激活或导航用户当前标签页。
3. 宿主 `packages/native-host` 使用 .NET 7 WPF 和 Windows UI Automation：识别发起点击的 Edge 窗口，通过 `Ctrl+N` 在同一 Edge 进程创建单标签临时窗口，将它移到屏外，通过地址栏打开 `edge://settings/appearance`，选择目标 `SelectionItemPattern`，然后重新读取选择状态确认成功。
4. 成功模式写入 `chrome.storage.local`，服务工作进程启动或重载时恢复 action 图标和标题；快速点击由 Promise 队列串行化。
5. Native Messaging 清单使用 `stdio` 和固定允许来源 `chrome-extension://cfcjmbhncpefmmhmpakmkigljppponpm/`。
6. 安装脚本将清单发布到项目的 `.native-host` 生成目录，并注册当前用户的 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.crys74l.edge_browser_theme_toggle`。这是本机 Edge 139 已实测可识别的 Chromium/Chrome 回退根；不写入 `HKLM`。

## 明确排除的方案

- `chrome.management.setEnabled` 主题包往返切换；
- 扩展直接导航或访问 `edge://settings/appearance`；
- `chrome.debugger`、网页 CSS 注入、截图遮罩和颜色覆盖；
- 回环 TCP、代理、端口监听、后台常驻进程、登录自启；
- 创建新的 Edge 进程、独立于 Edge 的临时原生窗口、改变用户现有窗口尺寸或修改 Windows 主题；
- 修改 Edge Preferences、策略或用户已有标签内容。

## 错误语义

- 宿主未注册、清单不可读或宿主无法启动：`本机切换组件不可用：请运行一次安装脚本`；
- 宿主未确认新的 UI 状态：`未更改 Edge 外观：请查看扩展错误详情`；
- 无论失败原因是什么，都只在单标签安全条件满足时清理屏外临时窗口并尝试恢复原 Edge 窗口焦点，不伪报成功。

## 当前证据

在本机 Edge 139 中已观察到：

- 直接使用 `chrome.tabs.create({url: 'edge://settings/appearance'})` 会失败；
- `HKCU\Software\Microsoft\Edge\NativeMessagingHosts` 中的项目键无法被当前运行 Edge 识别；
- 同一清单移到 Edge 文档列出的 `HKCU\Software\Google\Chrome\NativeMessagingHosts` 回退根后，宿主立即被识别；
- 当前工具栏 action 已完成浅色→深色→浅色真实往返；两次点击期间活动文档、活动标签和标签数量保持不变，用户窗口未显示设置页；
- 当前工作未关闭或重启 Edge，因此“重启后的真实点击”仍应由用户在需要时补做；注册表安装是持久的。
