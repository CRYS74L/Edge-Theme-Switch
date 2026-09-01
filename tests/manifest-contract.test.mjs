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

test('控制扩展提供无弹窗 action，并且只请求当前网页切换所需的最小权限', async () => {
  const manifest = await readManifest('packages/controller/manifest.json');

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting']);
  assert.equal(manifest.host_permissions, undefined, '不得索取常驻的全站读取权限');
  assert.ok(manifest.action, '控制入口必须是 Edge action');
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.options_page, undefined);
  assert.equal(manifest.options_ui, undefined);
  assert.equal(manifest.side_panel, undefined);
});

test('控制扩展以事件驱动模块服务工作线程处理工具栏单击', async () => {
  const manifest = await readManifest('packages/controller/manifest.json');

  assert.deepEqual(manifest.background, {
    service_worker: 'src/service-worker.mjs',
    type: 'module',
  });
  assert.deepEqual(manifest.action.default_icon, {
    16: 'icons/icon-light-16.png',
    32: 'icons/icon-light-32.png',
    48: 'icons/icon-light-48.png',
    128: 'icons/icon-light-128.png',
  });
  assert.equal(manifest.action.default_title, '单击切换当前网页深浅色');
});

test('深色样式明确只作用于页面根节点和网页媒体，而非 Windows 或 Edge 配置', async () => {
  const css = await readFile(path.join(projectRoot, 'packages/controller/src/page-dark.css'), 'utf8');

  assert.match(css, /data-edge-page-color-mode="dark"/);
  assert.match(css, /filter:\s*invert\(1\)\s+hue-rotate\(180deg\)/);
  assert.match(css, /img/);
  assert.doesNotMatch(css, /registry|Windows|edge:\/\//i);
});
