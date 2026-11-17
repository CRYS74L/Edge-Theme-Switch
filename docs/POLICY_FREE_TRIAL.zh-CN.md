# 无策略主题保留试验

这项试验让 Edge 的主题切换不再依赖 `ExtensionSettings` 管理策略。原有控制扩展继续负责按钮和视频模式自动切换；本地辅助程序只保留本项目的深色主题。

当前适用范围是 **Windows x64、Edge 139.0.3405.111**。辅助程序核对完整 DLL 哈希、函数入口和调用位置；版本不符时拒绝修改。它调整运行中进程的内存，Edge 安装文件保持原样，关闭 Edge 后这次内存调整随进程消失。

对于主动禁止更新的本机配置，还可启用 `suppress_outdated_notification`，跳过这个构建的旧版本提醒检测。更新服务、更新配置和正常启动命令保持原样。该选项只适合已决定保留此构建的用户。

辅助程序使用本机 Python 3.14，每次登录由 `CRYS74L.EdgeThemeRetention` 计划任务启动，以当前用户的普通权限运行。其配置和日志保存在项目的 `.native-host` 中。请保留项目路径和 Python 安装位置。更新 Edge 前应先恢复原方案；新构建需要重新适配和验证。

## 迁移和验证

迁移前必须制作 Edge 关闭状态下的浏览器配置副本、插件文件副本和策略备份，并验证每个文件的哈希。恢复程序应在独立的测试配置中完成恢复和主题切换验证。

准备通过后，管理员操作只负责登记上述普通权限计划任务，以及移除本项目原有的主题保留策略。普通主题通过 Edge 自身的扩展安装接口加载，主题身份和颜色保持一致。

验证需要覆盖手动切换、视频模式自动切换、手动优先、浅色闲置超过 30 秒，以及关闭并重新打开 Edge。策略页应为空，原来带管理标志的设置应恢复可选。计划任务启动可以独立测试；电脑重启后的验收需要实际重启后另行确认。

## 回到迁移前的可用状态

本机恢复目录中的“恢复修改前的插件.cmd”是独立恢复入口。关闭 Edge 后运行它，并在 Windows 提示时允许恢复原系统策略。它会：

1. 完整验证恢复资料。
2. 恢复原主题保留策略，并移除本次新增的计划任务。
3. 保留恢复前的新浏览器配置副本，然后还原原浏览器配置和插件文件。
4. 校验还原结果。

恢复会回到备份时的浏览器配置。恢复前的较新配置会保存在 Edge 用户数据目录下的 `Default.before-restore-时间` 文件夹中，便于找回迁移后的数据。所有这些资料只保存在本机，不进入 Git 或发行包。

## 实现依据

- [Windows 可执行内存保护](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-virtualprotectex)：改变可执行内存后需要保持指令缓存一致。
- [刷新指令缓存](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-flushinstructioncache)：内存修改后显式刷新目标进程的指令缓存。
- [Edge ExtensionSettings 策略](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/extensionsettings)：旧方案使用的扩展管理策略。

选择性保留主题的具体调用位置来自当前 Edge 构建的本机核查和隔离验证，属于本项目的版本限定适配。
