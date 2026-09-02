# Edge Native Messaging 无界面切换实施记录

**目标：** 以单击 controller 工具栏 action 的方式可靠切换当前 Edge 的整体浅深色外观，不使用截图遮罩、回环网络或常驻助手。

**最终架构：** controller 通过 Native Messaging 一次性启动宿主；宿主在同一 Edge 进程的屏幕外临时窗口中操作 Edge 外观设置，确认、清理并退出。controller 只接受协议结果并更新标题。

## 约束

- 不写入 Windows 主题、Edge Preferences、代理或 Edge policy。
- 不创建截图、覆盖层、监听端口、Windows 服务、计划任务或 Run 项。
- 安装脚本只管理项目的 LocalAppData 运行目录和一个精确 Native Messaging HKCU 键。
- 只在获得实际 mode 确认后显示切换成功。

## 已完成工作

### Controller 改为 Native Messaging

- [x] controller 清单只保留 nativeMessaging 权限；没有 host permissions、网页注入、popup 或选项页。
- [x] 固定 host 名与 protocolVersion，使用 chrome.runtime.sendNativeMessage。
- [x] 快速连续点击串行执行；宿主不可用和协议失败时不会伪造成功标题。
- [x] Node 契约测试覆盖成功、串行与宿主不可用三种结果。

### 宿主与安装器去常驻化

- [x] 删除 LoopbackBridgeProtocol、LoopbackBridgeServer、WindowSnapshotOverlay 和回环契约项目。
- [x] 添加一次性 NativeHostApplication 和 parent-window 参数解析。
- [x] 安装脚本发布 stdio Native Messaging 宿主，写入精确 Edge HKCU 注册项，并只清理匹配的旧 Run 值。
- [x] 删除无用的 Windows Forms 依赖。

### 屏幕外临时窗口自动化

- [x] 临时窗口限定为同一 Edge PID、创建后单标签，关闭前再次验证。
- [x] 临时窗口移动到物理屏幕外，在其中操作 edge://settings/appearance；原窗口不导航、不截图、不拉伸。
- [x] 成功、定位失败和标签验证失败路径都尝试清理已创建的临时窗口；不确定窗口不会被盲目关闭。
- [x] 切换结果、清理失败和焦点恢复都有稳定错误码，不报告未确认的成功。

### 当前 Edge 实际验收

- [x] 安装 Native Messaging 宿主，并核验清单、注册表和 controller 固定扩展 ID。
- [x] 真实工具栏点击完成深色到浅色，再完成三次连续反向切换。
- [x] 每次约两秒完成；顶栏像素双向变化，窗口边界不变，Windows 主题不变，宿主进程不残留。
- [x] 清理仅用于诊断的 Chromium 与 Google Chrome 回退注册项，最终只保留 Edge 注册项。

## 收尾验证

- [ ] 运行完整 Node 和 .NET 测试、安装器重装检查、git diff --check 与敏感文件扫描。
- [ ] 创建唯一 annotated 版本标签并推送。
