# Edge 浏览器整体外观一键切换实施记录

**目标：** 在不改变 Windows 主题、不结束当前 Edge 的前提下，用一个固定工具栏 action 在当前 Edge 的浅色和深色整体外观之间往返。

**交付架构：** MV3 action → 仅绑定 `127.0.0.1:42761` 的本机回环 bridge → 当前 Edge `edge://settings/appearance` UI Automation。bridge 使用当前窗口截图遮罩隔离内部临时标签，并以当前 Edge DPI 校正遮罩几何。

## 已完成

- [x] 取消静态 theme 包与网页 CSS 注入路线：前者在 Edge 生命周期中只能可靠切换一次，后者不能改变 browser chrome。
- [x] 建立唯一 MV3 controller：无 popup、无内容脚本、无网页权限，仅允许本机回环 bridge。
- [x] 建立 .NET 7 回环 bridge：支持 `/health`、受令牌保护的 `/toggle` 与仅供安装脚本使用的 `/shutdown`。
- [x] 建立 Edge UI Automation：读取 `light`/`dark`，选择相反外观，确认后关闭临时标签。
- [x] 建立可逆安装脚本：发布到 `%LOCALAPPDATA%\CRYS74L\EdgeBrowserThemeToggle\NativeHost`，维护唯一 Run 值，精确清理旧 Native Messaging 兼容项。
- [x] 修复 Edge 动态 action 图标加载异常：改为只更新 action 标题，不把无关图标失败误报为 bridge 未运行。
- [x] 修复视觉隔离：所属当前 Edge 的顶级不激活遮罩、持续置顶、原页稳定后撤除。
- [x] 修复 125% DPI 漏画：按目标 Edge 的 `GetDpiForWindow` 换算遮罩窗坐标，真实测得遮罩与 Edge 同为 `2578×1398`。
- [x] 真实当前 Edge 双向验收：浅→深、深→浅均保留 6 个原标签，50–4000ms 连续截图不显示空白页、临时标签或设置页。

## 最终核验清单

- [x] 运行完整 Node 与 .NET 契约测试。
- [x] 运行 `git diff --check`、敏感文件扫描与 Git 远程核验。
- [x] 提交、创建唯一 annotated 版本标签并推送。
