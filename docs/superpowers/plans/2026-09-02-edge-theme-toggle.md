# Edge 浏览器浅色/深色主题一键切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建、安装并验证一个可固定在 Edge 工具栏的单击控制扩展，让 Edge 浏览器 chrome 在浅色与深色主题间立即切换。

**Architecture:** 一个 Manifest V3 控制扩展监听 action 单击并调用 `chrome.management.setEnabled()`，在两个已安装、无界面的静态主题包间切换。两个主题用固定公钥得到稳定 ID；控制扩展只操作这两个 ID，并从管理事件刷新自己的图标和下一步提示。

**Tech Stack:** 原生 ES 模块、Node.js 内置 `node:test`、Manifest V3 控制扩展、Manifest V2 静态主题、PowerShell/System.Drawing 图标生成、Microsoft Edge 139 自动化验收。

**Spec:** `docs/superpowers/specs/2026-09-02-edge-theme-toggle-design.md`

## Global Constraints

- 目标浏览器固定为 Windows 上的 Microsoft Edge 139.0.3405.111。
- 控制扩展无 `default_popup`、无 options page、无 side panel、无 content script。
- 仅请求 `management` 权限；不得使用 Native Messaging、注册表、策略或 Windows 主题写入。
- 两个主题不得包含 JavaScript、HTML、后台页或 action。
- 控制扩展只能启用由 `THEME_IDS` 定义的两个主题 ID。
- 每项生产逻辑先由可运行的 Node 测试证实失败，再写最小实现。
- 临时 Edge 用户数据仅在系统临时 GUID 目录中创建，并在本轮测试结束后清理。

---

## 文件结构

| 路径 | 责任 |
| --- | --- |
| `package.json` | 固定测试与图标生成命令，不引入第三方依赖。 |
| `packages/controller/manifest.json` | 唯一带 action 的 MV3 控制包。 |
| `packages/controller/src/constants.mjs` | 两个稳定主题 ID、图标路径与标题文案。 |
| `packages/controller/src/theme-state.mjs` | 纯状态识别与下一主题选择。 |
| `packages/controller/src/service-worker.mjs` | action/management 事件桥接。 |
| `packages/controller/icons/*.png` | 16、32、48、128 像素太阳/月亮线性图标。 |
| `packages/theme-light/manifest.json` | 无界面的浅色 Edge 静态主题。 |
| `packages/theme-dark/manifest.json` | 无界面的深色 Edge 静态主题。 |
| `scripts/generate-icons.ps1` | 可重复生成 PNG 图标。 |
| `scripts/verify-isolated-edge.mjs` | 启动隔离 Edge、读取 CDP 状态并保存验收截图。 |
| `tests/manifest-contract.test.mjs` | 清单、稳定 ID、无 popup 与主题纯静态性契约。 |
| `tests/theme-state.test.mjs` | 状态机的浅色、深色、默认和第三方主题用例。 |
| `tests/icon-contract.test.mjs` | PNG 签名、尺寸与四种图标资源契约。 |
| `README.md` | 安装、工具栏固定、卸载与已验证行为。 |

## Task 1: 建立可失败的契约测试与包边界

**Files:**
- Create: `package.json`
- Create: `tests/manifest-contract.test.mjs`
- Create: `tests/theme-state.test.mjs`

**Interfaces:**
- Consumes: Node.js 的 `node:test`、`node:assert/strict`、`node:fs/promises`。
- Produces: `npm test`，以及对 `classifyActiveTheme(items, ids)` 和 `chooseNextThemeId(items, ids)` 的精确期望。

- [ ] **Step 1: 写入会失败的状态机测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyActiveTheme, chooseNextThemeId } from '../packages/controller/src/theme-state.mjs';

const ids = { light: 'light-theme-id', dark: 'dark-theme-id' };

test('深色主题已启用时下一次选择浅色主题', () => {
  const items = [{ id: ids.dark, type: 'theme', enabled: true }];
  assert.equal(classifyActiveTheme(items, ids), 'dark');
  assert.equal(chooseNextThemeId(items, ids), ids.light);
});

test('默认、浅色或第三方主题时下一次选择深色主题', () => {
  assert.equal(chooseNextThemeId([], ids), ids.dark);
  assert.equal(chooseNextThemeId([{ id: ids.light, type: 'theme', enabled: true }], ids), ids.dark);
  assert.equal(chooseNextThemeId([{ id: 'third-party', type: 'theme', enabled: true }], ids), ids.dark);
});
```

- [ ] **Step 2: 运行状态机测试并确认其因模块不存在失败**

Run: `node --test tests/theme-state.test.mjs`

Expected: FAIL，错误明确指出 `packages/controller/src/theme-state.mjs` 尚不存在。

- [ ] **Step 3: 写入会失败的清单契约测试**

```js
test('控制扩展仅有 action 和 management 权限且没有 popup', async () => {
  const manifest = await readManifest('packages/controller/manifest.json');
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['management']);
  assert.equal(manifest.action.default_popup, undefined);
});

test('两个主题是纯静态 Manifest V2 theme 包', async () => {
  for (const folder of ['packages/theme-light', 'packages/theme-dark']) {
    const manifest = await readManifest(`${folder}/manifest.json`);
    assert.equal(manifest.manifest_version, 2);
    assert.equal(typeof manifest.theme, 'object');
    assert.equal(manifest.background, undefined);
    assert.equal(manifest.action, undefined);
  }
});
```

- [ ] **Step 4: 运行清单契约测试并确认其因清单缺失失败**

Run: `node --test tests/manifest-contract.test.mjs`

Expected: FAIL，错误明确指出 `packages/controller/manifest.json` 尚不存在。

- [ ] **Step 5: 创建最小测试运行配置**

```json
{
  "name": "edge-browser-theme-toggle",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "test:state": "node --test tests/theme-state.test.mjs",
    "test:manifests": "node --test tests/manifest-contract.test.mjs",
    "icons": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1"
  }
}
```

- [ ] **Step 6: 再次运行两组测试，保留生产模块缺失的红色状态**

Run: `npm test`

Expected: FAIL；失败只能由尚未实现的状态模块和清单文件引起。

## Task 2: 实现稳定主题 ID、静态主题与控制状态机

**Files:**
- Create: `packages/controller/manifest.json`
- Create: `packages/controller/src/constants.mjs`
- Create: `packages/controller/src/theme-state.mjs`
- Create: `packages/theme-light/manifest.json`
- Create: `packages/theme-dark/manifest.json`
- Modify: `tests/manifest-contract.test.mjs`

**Interfaces:**
- Consumes: `chrome.management.ExtensionInfo[]`，每个项目至少有 `id`、`type`、`enabled`。
- Produces: `classifyActiveTheme(items, ids): 'light' | 'dark' | 'other'` 与 `chooseNextThemeId(items, ids): string`。

- [ ] **Step 1: 在测试中加入稳定 ID 与常量契约**

```js
const constants = await import('../packages/controller/src/constants.mjs');
assert.match(constants.THEME_IDS.light, /^[a-p]{32}$/);
assert.match(constants.THEME_IDS.dark, /^[a-p]{32}$/);
assert.notEqual(constants.THEME_IDS.light, constants.THEME_IDS.dark);
assert.equal(constants.ACTION_TITLES.dark, '当前为深色模式，单击切换为浅色模式');
```

- [ ] **Step 2: 运行测试并确认其因常量模块不存在失败**

Run: `node --test tests/manifest-contract.test.mjs`

Expected: FAIL，错误明确指出 `constants.mjs` 尚不存在。

- [ ] **Step 3: 生成三个 RSA 公钥、计算 Chrome 扩展 ID，并只把公钥写入清单**

Run a local Node script that exports each public key as SPKI DER base64 and maps the first 16 SHA-256 bytes to `a`–`p`. Do not retain or commit private keys. Insert each public key in its package `manifest.json` and insert the two resulting theme IDs in `THEME_IDS`.

- [ ] **Step 4: 实现清单与纯状态函数**

```js
export function classifyActiveTheme(items, ids) {
  if (items.some((item) => item.id === ids.dark && item.type === 'theme' && item.enabled)) return 'dark';
  if (items.some((item) => item.id === ids.light && item.type === 'theme' && item.enabled)) return 'light';
  return 'other';
}

export function chooseNextThemeId(items, ids) {
  return classifyActiveTheme(items, ids) === 'dark' ? ids.light : ids.dark;
}
```

The light theme must use neutral light `frame`, `toolbar`, `tab_background_text`, `ntp_background`, and `ntp_text` colors. The dark theme must use neutral dark values for the same colors. Both manifests contain only required metadata, `key`, and `theme`.

- [ ] **Step 5: 运行全部单元测试并确认转绿**

Run: `npm test`

Expected: PASS，所有状态和清单断言通过。

## Task 3: 实现 action 服务工作线程与线性图标

**Files:**
- Create: `tests/icon-contract.test.mjs`
- Create: `scripts/generate-icons.ps1`
- Create: `packages/controller/icons/icon-light-16.png`
- Create: `packages/controller/icons/icon-light-32.png`
- Create: `packages/controller/icons/icon-dark-16.png`
- Create: `packages/controller/icons/icon-dark-32.png`
- Create: `packages/controller/icons/icon-light-48.png`
- Create: `packages/controller/icons/icon-dark-48.png`
- Create: `packages/controller/icons/icon-light-128.png`
- Create: `packages/controller/icons/icon-dark-128.png`
- Create: `packages/controller/src/service-worker.mjs`
- Modify: `packages/controller/manifest.json`
- Modify: `tests/manifest-contract.test.mjs`

**Interfaces:**
- Consumes: `THEME_IDS`、`ACTION_TITLES`、`ACTION_ICONS`、`chrome.action` 与 `chrome.management`。
- Produces: 单击 action 后的 `chrome.management.setEnabled(targetThemeId, true)` 调用，以及随后同步的图标/标题。

- [ ] **Step 1: 写入 PNG 资源会失败的测试**

```js
for (const name of ['icon-light-16.png', 'icon-dark-16.png', 'icon-light-32.png', 'icon-dark-32.png']) {
  const bytes = await readFile(`packages/controller/icons/${name}`);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
}
```

- [ ] **Step 2: 运行图标测试并确认其因文件缺失失败**

Run: `node --test tests/icon-contract.test.mjs`

Expected: FAIL，错误明确指出第一个 PNG 图标文件尚不存在。

- [ ] **Step 3: 创建确定性的 PowerShell 图标生成器并生成资源**

The script must draw a line sun and a line crescent moon with `System.Drawing`, use transparent canvases, write each 16/32/48/128 PNG under `packages/controller/icons`, and dispose every bitmap, graphics object, pen, and brush in `finally` blocks.

Run: `npm run icons`

Expected: eight files exist, all PNG outputs have the requested square dimensions.

- [ ] **Step 4: 完成图标契约测试并确认转绿**

Run: `node --test tests/icon-contract.test.mjs`

Expected: PASS；签名、宽高与太阳/月亮文件均符合预期。

- [ ] **Step 5: 在清单测试中加入 service worker/action 断言，并先观察红色失败**

```js
assert.equal(manifest.background.service_worker, 'src/service-worker.mjs');
assert.equal(manifest.background.type, 'module');
assert.equal(manifest.action.default_popup, undefined);
```

Run: `node --test tests/manifest-contract.test.mjs`

Expected: FAIL；service worker 尚未被声明。

- [ ] **Step 6: 实现最小 action 服务工作线程**

```js
chrome.action.onClicked.addListener(async () => {
  const items = await chrome.management.getAll();
  const targetId = chooseNextThemeId(items, THEME_IDS);
  await chrome.management.setEnabled(targetId, true);
  await refreshActionPresentation();
});

for (const event of [chrome.management.onEnabled, chrome.management.onDisabled]) {
  event.addListener(() => refreshActionPresentation());
}
```

`refreshActionPresentation()` must read current items, choose the current light/dark icon path and set the matching Chinese next-action title. It must catch API errors, log the actual error, and leave the existing browser theme untouched on failure.

- [ ] **Step 7: 运行完整单元套件并确认转绿**

Run: `npm test`

Expected: PASS，且 `git diff --check` 无空白错误。

## Task 4: 隔离 Edge 的真实点击验收

**Files:**
- Create: `scripts/verify-isolated-edge.mjs`
- Create: `.artifacts/` at runtime only
- Test: `scripts/verify-isolated-edge.mjs`

**Interfaces:**
- Consumes: Edge 可执行文件、三个包绝对路径、系统临时目录和随机 GUID。
- Produces: 隔离 Edge 会话、CDP `chrome.management` 状态记录、点击前后截图和受限清理记录。

- [ ] **Step 1: 写入会失败的隔离启动前检查**

The verification script must reject before starting Edge when any of these are false: `msedge.exe` exists, each package contains `manifest.json`, and controller theme IDs match the two theme manifest public-key IDs.

Run: `node scripts/verify-isolated-edge.mjs --check-only`

Expected: FAIL before the script exists.

- [ ] **Step 2: 实现安全的 Edge 启动与清理**

Use `spawn(edgeExe, args, { shell: false, windowsHide: true })` with a unique directory under `os.tmpdir()`, a free CDP port, and `--load-extension=<controller>,<light>,<dark>`. Record exact created temporary path. Never use the real user profile for this isolated test.

- [ ] **Step 3: 运行 check-only 并确认启动前检查转绿**

Run: `node scripts/verify-isolated-edge.mjs --check-only`

Expected: PASS；输出三个确定 ID、绝对包路径与 Edge 版本。

- [ ] **Step 4: 使用 Computer Use 在隔离 Edge 窗口真实单击 action 两次**

Capture screenshot A, click the visible controller toolbar action once, wait for management state to report enabled dark theme, capture screenshot B, click it again, and wait for light theme. Save only screenshots and JSON state under `.artifacts/`.

- [ ] **Step 5: 验证真实外观变化与清理临时 profile**

Assert dark/light management transitions, action title/icon change, and significant top-chrome pixel color difference between A/B. Close only the isolated Edge process spawned by this script, then delete only its recorded GUID temp directory.

## Task 5: 安装到用户 Edge、固定入口、文档与交付

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/specs/2026-09-02-edge-theme-toggle-design.md` only if integration evidence changes a statement.
- Modify: `docs/superpowers/plans/2026-09-02-edge-theme-toggle.md` to mark completed steps.

**Interfaces:**
- Consumes: 已通过隔离验收的三个包与当前用户 Edge。
- Produces: 用户 Edge 中已加载的控制扩展、工具栏可见图标、可重复的安装/卸载说明。

- [ ] **Step 1: 在真实 Edge 的 `edge://extensions` 开发者界面加载三个目录**

Use Computer Use only for the required GUI sequence: enable Developer mode, select `Load unpacked`, choose each of `packages/controller`, `packages/theme-light`, and `packages/theme-dark`, and verify all three IDs against the manifests. Do not modify registry, policies, Windows theme, or unrelated extensions.

- [ ] **Step 2: 将唯一控制扩展固定到工具栏**

Use the Edge Extensions menu to set the controller's “Show in toolbar” state. Verify a single sun/moon control icon is visible in the actual Edge toolbar; the two themes must have no toolbar action.

- [ ] **Step 3: 在真实 Edge 完成两次真实单击验收**

Click the pinned icon once and verify dark browser chrome plus dark action title/icon; click it again and verify light browser chrome plus light action title/icon. Record exact visible evidence and `chrome.management` state; do not label a process launch or a registry row as acceptance.

- [ ] **Step 4: 写入 README**

README must state: one visible entry point, actual scope (Edge browser chrome only), requirements, three-package developer installation, pinning confirmation, behavior of the first click, known interaction with a pre-existing third-party theme, and uninstall steps that contain no registry cleanup.

- [ ] **Step 5: 完成项目核验、提交、标签与推送**

Run `npm test`, `git diff --check`, clean temporary artifacts, inspect staged files for credentials, commit the completed project, create the next annotated version tag, push `main` and tag, and verify `origin/main` and the tag reference the expected commits.

## Plan Self-Review

- Spec coverage: Tasks 1–3 implement the one-action/no-popup contract and static-theme architecture; Task 4 proves the public API and visible colors; Task 5 proves the real pinned entry point and durable local installation.
- Placeholder scan: no undecided values, generic testing steps, or incomplete implementation markers remain.
- Type consistency: `ExtensionInfo[]`, `THEME_IDS`, `classifyActiveTheme`, `chooseNextThemeId`, `refreshActionPresentation`, and controller paths use the same names throughout.
