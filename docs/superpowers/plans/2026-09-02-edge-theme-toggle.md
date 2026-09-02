# Edge 浏览器整体外观一键切换实施计划

目标：交付一个不依赖本机组件的 Edge 开发者模式扩展，点击一次工具栏图标即可切换真实浏览器 chrome 的深浅外观，并且 Edge 重启后无需重新注册或输入指令。

## 约束

- 不改变 Windows 系统主题、网页内容、代理、Edge Preferences 或当前标签页。
- 不关闭或重启用户当前 Edge。
- 不使用 Native Messaging、socket、截图遮罩、临时窗口、设置页或后台助手。
- 只把当前 Edge 中的两个解压缩目录作为安装入口：packages/controller 和 packages/theme-dark。

## 已完成工作

### 单主题管理切换

- [x] controller 改为 Manifest V3 management 权限，彻底删除 Native Messaging 调用。
- [x] 主题包改为唯一的无脚本深色 MV2 主题。
- [x] 通过主题名称动态发现 ID，避免重启或重新加载后因 ID 变化失效。
- [x] 使用 setEnabled 切换，并用 management.get 验证实际状态。
- [x] 使用 Promise 队列串行化快速连续点击。
- [x] 在 Edge 启动、安装、重载和点击后同步同一太阳图形的浅/深色线性 action 图标；使用纯黑/中性亮灰和统一尺寸笔宽，贴合 Edge 邻近工具栏图标；当前圆圈为 `size × 0.225` 半径、射线端点为 `size × 0.415`，在线宽不变的前提下进一步放大圆圈并收短射线。
- [x] 在深色主题清单中通过 `toolbar_button_icon` 统一声明高对比亮色，覆盖工具栏按钮及交互状态。
- [x] 缺失主题与 API 异常都有准确标题，不显示“本机组件不可用”。

### 旧方案清理

- [x] 删除 packages/native-host、Native Messaging 安装器和旧宿主契约测试。
- [x] 清除本次开发产生的旧 Native Messaging 注册项与临时宿主文件。
- [x] README、设计说明和测试全部改为单深色主题架构。

### 验证

- [x] Node 契约测试覆盖成功切换、快速连续点击和主题缺失。
- [x] 清单测试确认无 Native Messaging、无 host 权限、无脚本主题。
- [x] 当前 Edge 真实工具栏完成深色→浅色→深色往返，并在服务工作进程重载后复测。
- [x] 当前 Edge 实测深色主题的返回/刷新、扩展、分屏、收藏夹、历史记录、下载和窗口控件图标与深色背景保持高对比。
- [x] 确认没有 Native Host 进程，窗口尺寸与 Windows 主题值不变。

## 收尾验收

- [x] 运行 npm test 与 git diff --check。
- [x] 在当前 Edge 保持主题包和控制器可用，连续点击多轮并恢复到深色状态。
- [x] 执行一次版本提交、annotated 标签和 GitHub 推送，确认工作区干净。
