# Edge 浏览器整体外观一键切换

这是一个只针对当前 Microsoft Edge 浏览器界面的开发者模式扩展。固定扩展图标后，单击一次即可在 Edge 的深色和内置浅色外观之间切换；变化包括顶栏、标签栏、工具栏、地址栏以及 Edge 自己的内置页面，不会反色网页内容，也不会修改 Windows 系统主题。

## 最终实现

项目由两个解压缩扩展组成：

1. `packages/controller`：Manifest V3 工具栏控制器，只申请 `management` 权限。
2. `packages/theme-dark`：一个无脚本的 Manifest V2 深色主题包。

控制器每次点击都通过 `chrome.management.getAll()` 按名称找到深色主题，再调用 `chrome.management.setEnabled(themeId, enabled)`。启用主题就是深色外观，停用主题会回到 Edge 的内置浅色外观。主题 ID 不写死，因此 Edge 重启、服务工作进程回收或扩展重新加载后都能重新发现它。

这条实现路径不包含 Native Messaging、本机组件、注册表、代理、回环端口、截图遮罩、后台常驻进程或设置页导航。因此重启 Edge 后不会再查找“本机组件”，也不需要再次输入任何指令。项目有意只安装一个深色主题：Edge 同时只保留一个自定义主题，停用它正好恢复内置浅色状态。

## 安装到当前 Edge

只在你正在使用的 Edge 中操作：

1. 打开 `edge://extensions`，开启“开发人员模式”。
2. 点击“加载解压缩的扩展”，选择项目中的 `packages/controller` 文件夹。
3. 再次点击“加载解压缩的扩展”，选择项目中的 `packages/theme-dark` 文件夹。
4. 将“Edge 浏览器外观切换”固定到工具栏。
5. 单击工具栏图标测试深色和浅色往返切换。

不要加载 `theme-light`，也不要运行旧版 `install-native-host.ps1`；最终版本已经不需要这些文件。若 Edge 中还留有旧版控制器或旧主题，先在 `edge://extensions` 移除，再按上面两个目录重新加载一次。

开发者模式扩展和主题会随 Edge 配置保留。以后重启 Edge 后直接点击图标即可，不需要 `edge://restart`、命令行、本机服务或设置页。

## 状态提示

- `Edge 当前为深色，单击切换为浅色`：深色主题已启用。
- `Edge 当前为浅色，单击切换为深色`：深色主题已停用。
- `主题组件未加载：请加载深色主题包`：仅表示 `packages/theme-dark` 未安装或已被移除。
- `未更改 Edge 外观：请查看扩展错误详情`：Edge 管理 API 返回了异常；不会伪报成功，也不会回退到本机组件。

如果用户自行安装了其他自定义主题，Edge 的浅色基准可能由该主题决定；本项目的契约是“启用本项目深色主题 / 停用后回到 Edge 当前的内置外观”。

## 卸载

在当前 Edge 的 `edge://extensions` 中移除“Edge 浏览器外观切换”和“Edge 外观切换 - 深色主题”即可。最终版本没有注册表项、安装器或后台进程，不需要额外清理。

## 验证

在项目根目录执行：

```powershell
npm test
git diff --check
```

端到端验收应确认：

- 顶栏、标签栏和地址栏本身发生深浅变化，而不是网页 CSS 变化；
- 连续点击多次都能往返；
- 重新加载控制器服务工作进程后仍能往返；
- 重启 Edge 后无需重新注册或输入指令；
- Windows 主题设置、当前 Edge 窗口尺寸和已有标签页不被修改；
- 没有 `EdgeBrowserThemeToggle.NativeHost.exe` 或其他桥接进程。

## 项目结构

| 路径 | 作用 |
| --- | --- |
| `packages/controller` | 唯一的 MV3 工具栏控制器。 |
| `packages/theme-dark` | 唯一的无脚本深色浏览器主题。 |
| `tests` | 管理 API、清单、架构和图标契约测试。 |
| `scripts/generate-icons.ps1` | 重新生成控制器图标的开发脚本。 |
