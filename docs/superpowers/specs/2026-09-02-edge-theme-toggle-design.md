# Edge 浏览器整体外观一键切换设计

## 目标

在当前 Windows 上已打开的 Microsoft Edge 中，单击一个固定到工具栏的扩展图标，在 Edge 自身的“浅色”和“深色”整体外观之间往返。验收对象是浏览器顶栏、标签栏、地址栏和内置页面；网页内容和 Windows 系统主题不属于切换对象。

## 已验证事实

- MV3 的公开 API 不能直接写入 Edge 的“整体外观”。
- 静态 theme 包不能可靠往返：Chromium 会回收非当前主题包；网页 CSS 注入则只能改变网页内容，都不能满足目标。
- 当前 Edge 的 `edge://settings/appearance` 暴露稳定 UI Automation 标识：`appearance-mode-radio-group`、`light`、`dark`。
- 选中 `dark` 或 `light` 会立即改变 Edge browser chrome，且不会改变 Windows 主题。
- Edge 139 当前环境无法可靠动态加载 `chrome.action.setIcon()` 的扩展文件；控制扩展只更新 action 标题，不让图标加载异常掩盖已确认的切换结果。

## 架构

1. `packages/controller` 是唯一需要在 Edge 中加载和固定的 MV3 扩展。action 向 `http://127.0.0.1:42761/toggle` 发送受本机桥接令牌保护的 `toggle` 请求。
2. `packages/native-host` 是用户级常驻的 .NET 7 回环桥接。它只绑定 `127.0.0.1`，由安装脚本隐式启动并通过唯一 Run 项在登录后恢复；不创建 Windows 服务、计划任务或 Edge 政策。
3. bridge 只查找当前前台 Edge 窗口；若没有 Edge 或检测到多个候选窗口，则明确失败，绝不启动新 Edge 或猜测目标。
4. bridge 用 UI Automation 在目标 Edge 内短暂创建 `edge://settings/appearance` 标签，读取当前 `dark` 状态并选择相反的 `light`/`dark` 控件，然后关闭临时标签。
5. 在临时导航前，bridge 截取目标 Edge 窗口，创建所属当前 Edge 的顶级遮罩窗。遮罩保持在 Edge 之上，直到临时标签已关闭、原活动页已恢复且浏览器 compositor 已稳定；因此内部设置页不会暴露给用户。
6. 遮罩按目标 Edge 窗口 DPI 换算坐标，避免 125% 等显示缩放下出现右侧或底部漏画。

## 本机集成边界

安装脚本只管理以下精确目标：

- 运行文件：`%LOCALAPPDATA%\CRYS74L\EdgeBrowserThemeToggle\NativeHost`
- 启动项：`HKCU\Software\Microsoft\Windows\CurrentVersion\Run\CRYS74L.EdgeBrowserThemeToggle`
- 仅为兼容旧版本而清理的 Native Messaging 项：
  - `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.crys74l.edge_browser_theme_toggle`
  - `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.crys74l.edgethemetoggle`

卸载只停止本项目的回环 bridge、移除上述精确启动项和脚本生成文件；不修改 Windows 主题、Edge Preferences、策略或第三方扩展。

## 交互约束

- 无 popup、选项页、侧边栏、内容脚本、网页 CSS 注入、静态 theme 包或 Edge Preferences 写入。
- “系统”不是目标状态：首次点击从系统/浅色切到深色，之后在显式浅色与深色之间往返。
- 成功后 action 标题反映已确认的 Edge 外观和下一次切换方向；失败时不谎称成功。
- 不结束、重启或另开 Edge 窗口。
- 切换期间原窗口画面会短暂冻结，避免暴露内部临时页面；完成后直接显示新 chrome。

## 验证标准

1. 静态测试：manifest 没有 `scripting`、`activeTab`、内容脚本或网页 CSS；只允许回环 bridge host permission。
2. bridge 测试：请求令牌、HTTP 协议、错误路径和开关响应可重复验证。
3. Native host 测试：协议长度帧、请求校验、深色/浅色决定逻辑和异常结果可重复验证。
4. 构建测试：.NET host 与 Node 测试均通过。
5. 真实当前 Edge 验收：工具栏 action 连续两次触发，浅→深、深→浅均改变 browser chrome，标签数不变，过渡期间不显示空白页、临时标签或设置页，Windows 主题保持不变。
