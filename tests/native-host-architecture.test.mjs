import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

async function readProjectFile(relativePath) {
  return readFile(path.join(projectRoot, relativePath), 'utf8');
}

test('控制器使用一次性 Native Messaging，不再依赖可被 Edge 删除的主题包', async () => {
  const [manifest, worker] = await Promise.all([
    readProjectFile('packages/controller/manifest.json'),
    readProjectFile('packages/controller/src/service-worker.mjs'),
  ]);

  const parsedManifest = JSON.parse(manifest);
  assert.deepEqual(parsedManifest.permissions, ['nativeMessaging', 'storage']);
  assert.doesNotMatch(worker, /chrome\.management|setEnabled|getAll/);
  assert.match(worker, /sendNativeMessage/);
  assert.doesNotMatch(worker, /about:blank/);
  assert.doesNotMatch(worker, /edge:\/\/settings\/appearance/);
  assert.doesNotMatch(worker, /chrome\.tabs\.(create|remove|update)/);
  assert.match(worker, /chrome\.storage\.local/);
});

test('本机宿主在屏外临时 Edge 窗口中操作外观，不导航当前标签页', async () => {
  const source = await readProjectFile('packages/native-host/EdgeAppearanceAutomator.cs');

  assert.match(source, /appearance-mode-radio-group/);
  assert.match(source, /SelectionItemPattern/);
  assert.match(source, /TryOpenAppearancePage/);
  assert.match(source, /AppearanceUrl/);
  assert.match(source, /TemporaryEdgeWindow/);
  assert.match(source, /SetWindowPos/);
  assert.match(source, /SendInput/);
  assert.match(source, /VkN/);
  assert.match(source, /GetForegroundWindow/);
  assert.doesNotMatch(source, /TcpClient|Socket|HttpClient/);
  assert.doesNotMatch(source, /Process\.Kill|Process\.Start/);
});

test('宿主源码包含 stdio 协议与当前扩展的固定允许来源', async () => {
  const [project, installer] = await Promise.all([
    readProjectFile('packages/native-host/EdgeBrowserThemeToggle.NativeHost.csproj'),
    readProjectFile('scripts/install-native-host.ps1'),
  ]);

  assert.match(project, /TargetFramework>net7\.0-windows/);
  assert.match(project, /UseWPF>true/);
  assert.match(installer, /NativeMessagingHosts/);
  assert.match(installer, /Google\\Chrome\\NativeMessagingHosts/);
  assert.match(installer, /Microsoft\\Edge\\NativeMessagingHosts/);
  assert.match(installer, /legacyRegistryPath/);
  assert.match(installer, /cfcjmbhncpefmmhmpakmkigljppponpm/);
  assert.match(installer, /PersistentBackgroundProcess\s*=\s*\$false/);
  assert.doesNotMatch(installer, /bridge-server|127\.0\.0\.1|TcpListener|Startup/);
});

test('项目不再把临时主题测试文件纳入源码', async () => {
  await assert.rejects(stat(path.join(projectRoot, 'packages/theme-hybrid')));
});
