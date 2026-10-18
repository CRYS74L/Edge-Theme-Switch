import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { buildReleasePackages } from '../scripts/build-release.mjs';
import { createHash } from 'node:crypto';

test('Release 自动和手动包具有独立入口、最小权限、同一主题及完整安装文件', async () => {
  const outputRoot = await mkdtemp(new URL('../.artifacts/release-test-', import.meta.url));
  const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
  const packages = await buildReleasePackages({ outputRoot });
  assert.deepEqual(packages.map(item => item.variant), ['auto', 'manual']);
  const checksums = await readFile(path.join(path.dirname(packages[0].archive), 'SHA256SUMS.txt'), 'utf8');
  for (const item of packages) {
    const controller = path.join(item.directory, 'packages/controller');
    const manifest = JSON.parse(await readFile(path.join(controller, 'manifest.json'), 'utf8'));
    assert.equal(manifest.version_name, `${version}-${item.variant}`);
    const modules = await readdir(path.join(controller, 'src'));
    if (item.variant === 'manual') {
      assert.deepEqual(manifest.permissions, ['management']);
      assert.equal(manifest.host_permissions, undefined);
      assert.equal(manifest.content_scripts, undefined);
      assert.equal(manifest.background.service_worker, 'src/manual-worker.mjs');
      assert.deepEqual(modules.sort(), ['action-presentation.mjs', 'constants.mjs', 'manual-worker.mjs']);
    }
    else {
      assert.deepEqual(manifest.permissions, ['management', 'storage', 'scripting']);
      assert.ok(manifest.content_scripts[0].js.includes('src/watch-state.js'));
      assert.ok(!modules.includes('manual-worker.mjs'));
    }
    assert.deepEqual(await readFile(path.join(item.directory, 'packages/theme-dark.crx')),
      await readFile(new URL('../packages/theme-dark.crx', import.meta.url)));
    assert.ok((await readFile(path.join(item.directory, '安装说明.md'), 'utf8')).includes('二选一'));
    assert.ok((await readFile(path.join(item.directory, 'scripts/install-theme-policy.ps1'), 'utf8')).includes('normal_installed'));
    assert.equal((await readFile(item.archive)).readUInt32LE(), 0x04034b50);
    const digest = createHash('sha256').update(await readFile(item.archive)).digest('hex');
    assert.ok(checksums.includes(`${digest}  ${path.basename(item.archive)}`));
    const files = await readdir(item.directory, { recursive: true });
    assert.ok(!files.some(name => /\.pem$|LOCAL_PRIVACY|\.artifacts|native-profile|\.log$|\.reg$/i.test(name)));
  }
});
