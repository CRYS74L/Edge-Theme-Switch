# Edge 浏览器整体外观一键切换

当前版本：`v0.3.0-dev.15`

这是一个只操作当前 Microsoft Edge 窗口的开发者模式扩展。单击固定到工具栏的图标，即可在 Edge 自身的浅色和深色整体外观之间往返；网页内容、Windows 系统主题和其他应用不受影响。

## 为什么改为本机消息方案

旧版通过 `chrome.management` 停用唯一的深色主题包来回到浅色。实测 Edge 139 在停用这个解压缩主题后会把主题从管理列表中移除，因此下一次点击找不到主题，形成“深色可以切到浅色、浅色无法切回深色”的故障。

当前版本直接操作 Edge 设置页中的“外观”单选项，不再依赖任何颜色主题包。扩展本身不创建或激活临时标签；本机宿主在同一 Edge 进程中创建一个只有一个标签的临时窗口，立即移到屏幕外，在屏外打开设置并确认 UI 状态，完成后安全关闭临时窗口并恢复原 Edge 窗口焦点。

## 项目组成

1. `packages/controller`：Manifest V3 工具栏控制器，申请 `nativeMessaging` 和 `storage` 权限。
2. `packages/native-host`：.NET 7 WPF Native Messaging 宿主，使用 Windows UI Automation 在屏外临时 Edge 窗口中操作设置。
3. `scripts/install-native-host.ps1`：发布宿主、生成清单并注册当前用户级 Native Messaging 主机。
4. `packages/theme-dark`：旧版静态主题源码，仅保留作历史兼容参考，不是当前版本的安装依赖。

宿主不创建新的 Edge 进程，不导航当前用户标签，不修改现有用户窗口尺寸，不注入网页 CSS、不监听网络、不运行回环端口，也不常驻后台。临时窗口只允许单标签、屏外运行，完成后关闭；扩展连续点击通过 Promise 队列串行化。

## 安装到当前 Edge

1. 打开 `edge://extensions`，开启“开发人员模式”。
2. 点击“加载解压缩的扩展”，选择项目中的 `packages/controller` 文件夹。
3. 在项目根目录运行：

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-native-host.ps1 -Configuration Release
   ```

4. 将“Edge 浏览器外观切换”固定到工具栏。
5. 单击图标测试浅色→深色→浅色往返。

脚本只写入当前用户注册表的以下宿主键：

`HKCU\Software\Google\Chrome\NativeMessagingHosts\com.crys74l.edge_browser_theme_toggle`

这是当前本机 Edge 139 实测能识别的 Chromium/Chrome 兼容回退根；清单中的 `allowed_origins` 固定为当前解压缩控制器 ID。脚本不会写入 `HKLM`，也不会覆盖其他 Native Messaging 主机。

当前版本不需要加载 `packages/theme-dark`。如果 Edge 中仍显示旧版“Edge 外观切换 - 深色主题”，可在 `edge://extensions` 中只移除这个旧主题；不要为本扩展重复安装多个颜色主题。

## 状态提示

- `Edge 当前为浅色，单击切换为深色`：本次切换已确认进入浅色外观。
- `Edge 当前为深色，单击切换为浅色`：本次切换已确认进入深色外观。
- `本机切换组件不可用：请运行一次安装脚本`：宿主未注册或无法启动。
- `未更改 Edge 外观：请查看扩展错误详情`：Edge 外观控件没有确认目标状态。

## 卸载

在 `edge://extensions` 中移除控制器。随后如需移除本机宿主，运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-native-host.ps1 -Uninstall
```

该开关只移除本项目当前用户宿主键和脚本生成的 `.native-host` 文件，不触碰其他主机、主题或 Edge 数据。

## 验证

在项目根目录执行：

```powershell
npm test
dotnet build .\packages\native-host\EdgeBrowserThemeToggle.NativeHost.csproj --configuration Release --runtime win-x64 --self-contained false --nologo
git diff --check
```

真实 Edge 验收应确认：

- 工具栏 action 可以完成浅色→深色→浅色往返；
- 点击过程中当前活动文档和活动标签保持不变，用户窗口不显示设置页；
- 屏外临时窗口在切换后关闭，不留下额外 Edge 窗口或标签；
- Edge 设置页的 `light`/`dark` 控件确认了目标状态；
- `edge://extensions` 不新增错误记录；
- Windows 主题、窗口尺寸和网页内容不变。
