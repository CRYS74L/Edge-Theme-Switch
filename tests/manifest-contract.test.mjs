import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

async function readManifest(relativePath) {
  const text = await readFile(path.join(projectRoot, relativePath), 'utf8');
  return JSON.parse(text);
}

async function findForbiddenThemeFiles(relativeFolder) {
  const folder = path.join(projectRoot, relativeFolder);
  const entries = await readdir(folder, { withFileTypes: true });
  const forbidden = [];

  for (const entry of entries) {
    if (entry.isFile() && /\.(?:html?|m?js)$/i.test(entry.name)) {
      forbidden.push(entry.name);
    }
  }

  return forbidden;
}

function extensionIdFromPublicKey(publicKey) {
  const digest = createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex').slice(0, 32);
  return [...digest].map((digit) => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(digit, 16))).join('');
}

test('控制扩展提供无弹窗 action，并且只请求管理已安装主题所需的权限', async () => {
  const manifest = await readManifest('packages/controller/manifest.json');

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['management']);
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
});

test('浅色和深色主题均是无脚本、无工具栏入口的静态 theme 包', async () => {
  for (const folder of ['packages/theme-light', 'packages/theme-dark']) {
    const manifest = await readManifest(`${folder}/manifest.json`);

    assert.equal(manifest.manifest_version, 2);
    assert.equal(typeof manifest.theme, 'object');
    assert.equal(manifest.background, undefined);
    assert.equal(manifest.action, undefined);
    assert.equal(manifest.browser_action, undefined);
    assert.deepEqual(await findForbiddenThemeFiles(folder), []);
  }
});

test('控制扩展只定位到两个主题包的实际稳定 ID', async () => {
  const constants = await import('../packages/controller/src/constants.mjs');
  const lightManifest = await readManifest('packages/theme-light/manifest.json');
  const darkManifest = await readManifest('packages/theme-dark/manifest.json');

  assert.equal(constants.THEME_IDS.light, extensionIdFromPublicKey(lightManifest.key));
  assert.equal(constants.THEME_IDS.dark, extensionIdFromPublicKey(darkManifest.key));
  assert.notEqual(constants.THEME_IDS.light, constants.THEME_IDS.dark);
});
