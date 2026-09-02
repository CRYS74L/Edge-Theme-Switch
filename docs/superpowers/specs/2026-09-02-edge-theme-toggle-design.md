# Edge 浏览器整体外观一键切换设计

## 目标

在用户当前已经打开的 Microsoft Edge 中，单击固定工具栏图标，在浏览器自身的深色与内置浅色外观之间往返。验收对象是 Edge 顶栏、标签栏、工具栏、地址栏和 Edge 内置页面；网页内容与 Windows 系统主题不属于切换对象。

## 关键结论

Edge 的普通扩展没有公开 API 可以直接写入设置页里的内置 browser.theme.color_scheme2 选项。chrome.debugger 对 edge://settings/appearance 也会被 Edge 拒绝，因此“无界面地模拟设置页点击”不是可依赖的扩展入口。

公开的 chrome.management API 可以枚举并启用/停用主题。单个静态主题包在 Edge 中就是浏览器 chrome 的真实主题；停用这个主题后，Edge 会回到自己的内置外观。实验还证明同时加载两个主题并不能提供稳定的双主题切换：Edge 会回收先前的自定义主题。因此最终方案只保留一个深色主题，把“停用深色主题”定义为浅色状态。

## 交付架构

1. packages/controller 是 Manifest V3 的唯一工具栏控制器，只申请 management 权限，不申请 nativeMessaging、host 权限或内容脚本权限。
2. packages/theme-dark 是 Manifest V2 无脚本深色主题，仅声明静态 theme.colors。
3. 每次 action 点击都调用 chrome.management.getAll()，按固定显示名称 Edge 外观切换 - 深色主题 找到主题，因此不依赖安装时变化的扩展 ID。
4. 若主题当前启用，调用 chrome.management.setEnabled(id, false)；若当前停用，调用 setEnabled(id, true)，随后用 chrome.management.get(id) 验证状态，再更新工具栏悬停标题。
5. 点击操作通过 Promise 队列串行化，快速连续点击不会重叠或丢失状态。
6. controller 在 Edge 启动、扩展安装和每次切换后同步 action 图标：两个状态都使用太阳线性图形，浅色状态为深色线条，深色状态为浅色线条。

## 明确排除的方案

- Native Messaging、本机宿主、注册表清单与安装脚本；
- 回环 TCP、代理、端口监听、后台常驻进程、登录自启；
- 截图、窗口遮罩、临时窗口、屏幕外窗口与非等比拉伸；
- 网页 CSS 注入、网页导航、打开或显示设置页；
- 修改 Windows 主题、Edge Preferences、策略或用户标签页。

## 可见行为与错误语义

- 深色主题启用：工具栏标题为“Edge 当前为深色，单击切换为浅色”。
- 深色主题停用：工具栏标题为“Edge 当前为浅色，单击切换为深色”。
- 找不到主题：标题为“主题组件未加载：请加载深色主题包”，不伪报成功。
- 管理 API 或状态确认失败：标题为“未更改 Edge 外观：请查看扩展错误详情”。

该设计的浅色基准是 Edge 当前的内置外观。若用户另行安装并启用了其他自定义主题，停用本项目主题后的颜色由 Edge 自身决定；项目不承诺覆盖其他主题。

## 真实 Edge 证据

在当前 Edge 139 中已经完成以下验证：

- 真实工具栏点击停用深色主题后，顶栏/标签栏回到浅色；再次点击启用后恢复深色。
- 连续点击与服务工作进程重载后仍能往返。
- 窗口边界没有变化，没有截图遮罩、设置页导航或拉伸。
- Windows 主题值保持不变。
- 新控制器不再调用 Native Messaging；缺少主题时只显示主题缺失提示。

这些证据证明的是当前 Edge 版本和本项目主题包上的可行性，不把内部 API 推断成对任意第三方主题的保证。
