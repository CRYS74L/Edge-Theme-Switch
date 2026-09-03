import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

test('深色主题策略部署只登记当前 CRX，并保留可回滚入口', async () => {
  const script = await readFile(
    path.join(projectRoot, 'scripts/install-theme-policy.ps1'),
    'utf8',
  );

  assert.match(script, /HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge/);
  assert.match(script, /ExtensionSettings/);
  assert.match(script, /pijpfibjabpbkjfnodppeipagbhableg/);
  assert.match(script, /theme-dark\.crx/);
  assert.match(script, /edge\.microsoft\.com\/extensionwebstorebase\/v1\/crx/);
  assert.match(script, /normal_installed/);
  assert.match(script, /Set-ItemProperty/);
  assert.match(script, /Remove/);
  assert.doesNotMatch(script, /force_installed/);
  assert.doesNotMatch(script, /NativeHost|nativeMessaging|edge:\/\/settings/);
});
