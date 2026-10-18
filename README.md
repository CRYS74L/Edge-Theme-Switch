# Edge 浏览器整体外观一键切换

当前项目版本：v1.0.1-dev.4（灰阶配色预览，待当前 Edge 界面验收）；点击行为基线：v0.3.0-dev.11。

这是一个只针对当前 Microsoft Edge 浏览器界面的开发者模式扩展。固定扩展图标后，单击一次即可在 Edge 的深色和内置浅色外观之间切换；本版配色针对顶栏、标签栏、工具栏和地址栏，不会反色网页内容，也不会修改 Windows 系统主题。

## 当前灰阶配色

顶栏使用 `#202020`，工具栏和非活动标签区域使用 `#3B3B3B`，地址栏使用 `#292929`。这三个基准色取自用户提供的 Edge 139 原生深色截图；活动标签与悬停颜色继续由 Edge 派生。

工具栏使用独立的 `toolbar-gray.png`，顶栏使用 `frame-dark.png`。Edge 139 会从工具栏图片生成垂直标签栏背景，不能只改清单色号却保留旧的深黑工具栏图片。运行 `npm run theme:images` 可按主题清单重新生成这两张纯色 PNG。

更新时需要把 `packages/theme-dark.crx` 拖入当前 Edge 的扩展页面，再重新加载“Edge 浏览器外观切换”。本版显示为 `1.0.1-dev.4-preview`；只重新加载控制器不会更新已经安装的主题图片。

## 最终实现

项目由一个解压缩控制器和一个主题包组成：

1. `packages/controller`：Manifest V3 工具栏控制器，只申请 `management` 权限。
2. `packages/theme-dark`：无脚本的 Manifest V2 深色主题源目录；`packages/theme-dark.crx` 是使用固定签名密钥生成的安装包。

控制器每次点击都通过 `chrome.management.getAll()` 按名称找到深色主题，再调用 `chrome.management.setEnabled(themeId, enabled)`。启用主题就是深色外观，停用主题会回到 Edge 的内置浅色外观。主题 ID 不写死，因此 Edge 重启、服务工作进程回收或扩展重新加载后都能重新发现它。

控制器同时同步工具栏图标：浅色外观使用深色太阳线性图标 `icon-light-*`，深色外观使用浅色太阳线性图标 `icon-dark-*`；两个状态的图形都是太阳，只改变线条颜色。Edge 启动、扩展安装、服务工作进程重载和每次切换都会按当前主题状态同步，不会在深色浏览器中继续显示深色图标。

太阳素材使用纯黑 `[0, 0, 0]` 与中性亮灰 `[245, 245, 245]`，所有尺寸按统一的 `max(1.15px, size / 14)` 笔宽生成；圆圈进一步放大至 `size × 0.225`，射线端点收短至 `size × 0.415`，保持与 Edge 线性工具栏图标一致的重量与比例。

深色主题包在 `theme.colors.toolbar_button_icon` 统一声明高对比工具栏图标色 `[245, 245, 245]`。这是 Edge 主题级颜色映射，会同时作用于返回、刷新、扩展、分屏、收藏夹、历史记录、下载等工具栏按钮及其悬停/按下状态，不通过脚本逐个改按钮，也不修改网页内容。

控制器运行时不包含 Native Messaging、本机组件、代理、回环端口、截图遮罩、后台常驻进程或设置页导航。项目有意只安装一个深色主题：停用它会恢复 Edge 的内置浅色状态。Edge 139 对普通安装的非当前主题有约 30 秒的回收机制；为保持 dev11 的点击链并解决这个浏览器级回收问题，主题清单声明 Edge 商店更新基地址，部署时先手动安装同一个签名 CRX，再用一次性 `normal_installed` 策略登记它。Edge 会把已安装的同 ID 主题提升为策略安装，控制器代码和点击时的可见行为都不变。

## 安装到当前 Edge

只在你正在使用的 Edge 中操作：

1. 打开 `edge://extensions`，开启“开发人员模式”。
2. 点击“加载解压缩的扩展”，选择项目中的 `packages/controller` 文件夹。
3. 把项目中的 `packages/theme-dark.crx` 拖入 `edge://extensions`，安装“Edge 外观切换 - 深色主题”。不要只加载 `packages/theme-dark` 解压缩目录。
4. 以管理员身份打开 PowerShell，运行一次：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\install-theme-policy.ps1"
   ```

   脚本只写入 `HKLM\SOFTWARE\Policies\Microsoft\Edge` 下的 `ExtensionSettings` 一个值，默认使用 Edge 商店更新基地址，目标仅为本项目深色主题。出现 UAC 时由用户确认；若计算机组织策略禁止写入，需由管理员执行，不能由扩展权限代替。已有本项目策略时，脚本会安全地原位更新 URL；遇到其他策略内容仍会拒绝覆盖。
5. 打开 `edge://policy`，点击“重新加载策略”；若主题没有立即变成管理员安装，由用户自行重启 Edge 一次。
6. 将“Edge 浏览器外观切换”固定到工具栏，单击图标测试深色和浅色往返切换。

不要加载 `theme-light`，也不要运行旧版 `install-native-host.ps1`；最终版本已经不需要这些文件。若 Edge 中还留有旧版控制器或旧主题，先在 `edge://extensions` 移除，再按上面的控制器目录和 CRX 重新安装一次。

控制器重载后可以继续发现已存在的主题包。完成上面的策略登记后，即使浅色状态闲置超过 Edge 139 的主题回收窗口，主题包仍会保留；“系统”外观本身不提供这项保护。直接使用 `file://`、回环 HTTP 地址或其他自托管地址可能在未加入组织管理的 Edge 上显示 `[BLOCKED]`，不要使用这些地址。

## 状态提示

- `浅色模式`：当前 Edge 为深色，单击后回到浅色外观。
- `深色模式`：当前 Edge 为浅色，单击后启用深色主题。
- `主题组件未加载：请加载深色主题包`：仅表示 `packages/theme-dark` 未安装或已被移除。
- `未更改 Edge 外观：请查看扩展错误详情`：Edge 管理 API 返回了异常；不会伪报成功，也不会回退到本机组件。

如果用户自行安装了其他自定义主题，Edge 的浅色基准可能由该主题决定；本项目的契约是“启用本项目深色主题 / 停用后回到 Edge 当前的内置外观”。

## 卸载

如需完全移除，先在管理员 PowerShell 中运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\install-theme-policy.ps1" -Remove
```

随后在当前 Edge 的 `edge://extensions` 中移除“Edge 浏览器外观切换”和“Edge 外观切换 - 深色主题”。回滚脚本只会删除它自己登记的 `ExtensionSettings` 值，不会删除其他 Edge 策略。

## 验证

在项目根目录执行：

```powershell
npm test
git diff --check
```

端到端验收应确认：

- 顶栏、标签栏和地址栏本身发生深浅变化，而不是网页 CSS 变化；
- 深色主题下工具栏和标签栏出现 `#3B3B3B` 灰色背景，地址栏有单独的 `#292929` 层次，工具栏图标保持高对比亮色；
- 连续点击多次都能往返；
- 重新加载控制器服务工作进程后仍能往返；
- 策略安装后浅色状态闲置超过 35 秒仍能再次点击切回深色；当前会话验证通过；
- 用户已手动重启 Edge，并确认重启后无需重新加载主题包或再次输入指令即可使用；
- Windows 主题设置、当前 Edge 窗口尺寸和已有标签页不被修改；
- 没有 `EdgeBrowserThemeToggle.NativeHost.exe` 或其他桥接进程。

## 项目结构

| 路径 | 作用 |
| --- | --- |
| `packages/controller` | 唯一的 MV3 工具栏控制器。 |
| `packages/theme-dark` | 无脚本深色浏览器主题源目录。 |
| `packages/theme-dark.crx` | 使用固定签名密钥生成的主题安装包，需手动拖入 Edge。 |
| `tests` | 管理 API、清单、架构和图标契约测试。 |
| `scripts/generate-icons.ps1` | 重新生成控制器图标的开发脚本。 |
| `scripts/install-theme-policy.ps1` | 一次性登记/回滚 Edge 139 的主题保留策略，默认使用 Edge 商店更新基地址。 |
