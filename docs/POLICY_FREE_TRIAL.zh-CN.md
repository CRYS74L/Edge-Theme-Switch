# 无策略主题保留试验

这项试验让 Edge 的主题切换不再依赖 `ExtensionSettings` 管理策略。原有控制扩展继续负责按钮和视频模式自动切换；本地辅助程序只保留本项目的深色主题。

适用范围是 Windows x64。当前适配 Edge `139.0.3405.111`、`156.0.4314.84`、`157.0.4341.60`。用户安装、升级和卸载步骤见[安装说明](RELEASE_INSTALL.zh-CN.md)。

辅助程序在当前用户会话查找正在运行的 Edge，按实际载入的 DLL 选择构建配置。每个构建都核对完整 SHA-256、主题回收代码和原调用目标。它只在进程内保留本项目的主题。遇到未适配构建时保持等待状态并记录原因。辅助程序随仓库或安装包分发，安装时的本机配置和日志存放在 `.native-host`。

原 139 试验版的配置仍可使用。旧版本提醒处理仅适用于原先显式启用此选项的 139 构建。156 和 157 的支持范围仅包括主题保留。

## 验证与恢复

更新前保存当前工作版本与浏览器配置的恢复副本。对每个新增构建，用官方 x64 二进制验证启动、停用主题后闲置、重开后切回、自动切换和策略状态。添加新构建时以完整哈希和行为验收为准。

旧试验版生成的本机备份、恢复入口和计划任务可以继续使用。配置和恢复副本由安装者保存在本机。升级系统 Edge 后应使用适合该版本的浏览器资料，避免把旧版配置整目录覆盖到新版上。

## 实现依据

- [Windows 可执行内存保护](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-virtualprotectex)：改变可执行内存后需要保持指令缓存一致。
- [刷新指令缓存](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-flushinstructioncache)：内存修改后显式刷新目标进程的指令缓存。
- [Edge ExtensionSettings 策略](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/extensionsettings)：旧方案使用的扩展管理策略。

选择性保留主题的具体调用位置来自当前 Edge 构建的本机核查和隔离验证，属于本项目的版本限定适配。
