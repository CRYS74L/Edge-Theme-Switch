import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

async function readManifest(relativePath) {
  const text = await readFile(path.join(projectRoot, relativePath), 'utf8');
  return JSON.parse(text);
}

test('控制扩展仅对指定视频网站检测状态，并保留无弹窗 action', async () => {
  const manifest = await readManifest('packages/controller/manifest.json');

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'Edge 外观一键切换');
  assert.deepEqual(manifest.permissions, ['management', 'storage', 'scripting']);
  assert.deepEqual(manifest.host_permissions, ['https://www.bilibili.com/*', 'https://live.bilibili.com/*', 'https://www.youtube.com/*', 'https://youtube.com/*']);
  assert.deepEqual(manifest.content_scripts[0].js, ['src/watch-state.js']);
  assert.equal(manifest.content_scripts[0].run_at, 'document_idle');
  assert.equal(manifest.content_scripts[0].all_frames, undefined);
  assert.equal(manifest.content_scripts[0].matches.length, 4);
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.options_page, undefined);
  assert.equal(manifest.options_ui, undefined);
  assert.equal(manifest.side_panel, undefined);
  assert.equal(manifest.action.default_title, '切换模式');
});

test('控制扩展使用事件驱动模块 worker，且不需要本机组件', async () => {
  const manifest = await readManifest('packages/controller/manifest.json');

  assert.deepEqual(manifest.background, {
    service_worker: 'src/service-worker.mjs',
    type: 'module',
  });
  assert.match(manifest.key, /^[A-Za-z0-9+/=]+$/);
  assert.deepEqual(manifest.action.default_icon, {
    16: 'icons/icon-light-16.png',
    32: 'icons/icon-light-32.png',
    48: 'icons/icon-light-48.png',
    128: 'icons/icon-light-128.png',
  });
});

test('深色主题包是无脚本的浏览器主题', async () => {
  const manifest = await readManifest('packages/theme-dark/manifest.json');

  assert.equal(manifest.manifest_version, 2);
  assert.equal(manifest.name, 'Edge 外观一键切换 - 深色主题');
  assert.equal(
    manifest.update_url,
    'https://edge.microsoft.com/extensionwebstorebase/v1/crx',
  );
  assert.equal(manifest.type, undefined);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.permissions, undefined);
  assert.ok(manifest.theme?.colors);
  assert.deepEqual(manifest.theme.colors.toolbar_button_icon, [245, 245, 245]);
});

test('项目不再保留网页 CSS 注入实现', async () => {
  const cssPath = path.join(projectRoot, 'packages/controller/src/page-dark.css');

  await assert.rejects(readFile(cssPath, 'utf8'), /ENOENT/);
});
