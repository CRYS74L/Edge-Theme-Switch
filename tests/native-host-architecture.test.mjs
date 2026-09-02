import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

async function readProjectFile(relativePath) {
  return readFile(path.join(projectRoot, relativePath), 'utf8');
}

test('控制器只使用管理 API，不保留 Native Messaging 或网络桥接入口', async () => {
  const [manifest, worker] = await Promise.all([
    readProjectFile('packages/controller/manifest.json'),
    readProjectFile('packages/controller/src/service-worker.mjs'),
  ]);

  assert.doesNotMatch(manifest, /nativeMessaging/);
  assert.doesNotMatch(worker, /sendNativeMessage|fetch\(|127\.0\.0\.1|NativeHost|TcpClient|Socket/);
  assert.match(worker, /chrome\.management\.getAll/);
  assert.match(worker, /chrome\.management\.setEnabled/);
  assert.match(worker, /chrome\.management\.get/);
});

test('深色主题包是唯一的无脚本主题组件', async () => {
  const theme = JSON.parse(await readProjectFile('packages/theme-dark/manifest.json'));

  assert.equal(theme.manifest_version, 2);
  assert.equal(theme.name, 'Edge 外观切换 - 深色主题');
  assert.equal(theme.background, undefined);
  assert.equal(theme.permissions, undefined);
  assert.ok(theme.theme?.colors);
});

test('项目源码不再包含旧本机宿主实现或安装器', async () => {
  for (const relativePath of [
    'packages/native-host',
    'scripts/install-native-host.ps1',
    'tests/native-host-contract',
  ]) {
    await assert.rejects(
      readProjectFile(relativePath),
      (error) => error?.code === 'ENOENT' || error?.code === 'EISDIR',
      `${relativePath} should not be part of the final architecture`,
    );
  }
});
