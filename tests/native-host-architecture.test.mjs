import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

async function readProjectFile(relativePath) {
  return readFile(path.join(projectRoot, relativePath), 'utf8');
}

test('本机宿主不再包含回环网络、截图遮罩或持久化桥接实现', async () => {
  const [automator, installer] = await Promise.all([
    readProjectFile('packages/native-host/EdgeAppearanceAutomator.cs'),
    readProjectFile('scripts/install-native-host.ps1'),
  ]);

  assert.doesNotMatch(automator, /\b(TcpListener|TcpClient|Socket|WindowSnapshotOverlay|BitBlt|CopyFromScreen)\b/);
  assert.match(automator, /new TemporaryEdgeWindow\(candidate, parentWindow, parentProcessId, originalBounds\)/);
  assert.match(automator, /-32000/);
  assert.match(automator, /_ = created\.Close\(\);/);
  assert.doesNotMatch(installer, /\b(TcpListener|TcpClient|Socket|127\.0\.0\.1|Start-Process)\b/);
});

test('安装器仅注册一次性 Edge Native Messaging 宿主，不创建新的登录自启', async () => {
  const installer = await readProjectFile('scripts/install-native-host.ps1');

  assert.match(installer, /Software\\Microsoft\\Edge\\NativeMessagingHosts\\\$nativeHostName/);
  assert.match(installer, /type = 'stdio'/);
  assert.match(installer, /allowed_origins = @\("chrome-extension:\/\/\$controllerExtensionId\/"\)/);
  assert.match(installer, /\$key\.SetValue\('', \$nativeHostManifestPath, \[Microsoft\.Win32\.RegistryValueKind\]::String\)/);
  assert.match(installer, /function Remove-LegacyStartup/);
  assert.doesNotMatch(installer, /SetValue\(\s*\$legacyStartupValueName/);
});
