import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const autoModules = ['service-worker.mjs', 'constants.mjs', 'action-presentation.mjs',
  'auto-mode.mjs', 'watch-context.mjs', 'watch-state.js'];
const manualModules = ['manual-worker.mjs', 'constants.mjs', 'action-presentation.mjs'];

export async function buildReleasePackages({ outputRoot = path.join(root, '.artifacts/releases') } = {}) {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const baseManifest = JSON.parse(await readFile(path.join(root, 'packages/controller/manifest.json'), 'utf8'));
  const instructions = await readFile(path.join(root, 'docs/RELEASE_INSTALL.zh-CN.md'), 'utf8');
  await mkdir(outputRoot, { recursive: true });
  const buildRoot = await mkdtemp(path.join(outputRoot, `${pkg.version}-`));
  const packages = [];
  for (const variant of ['auto', 'manual']) {
    const name = `edge-browser-theme-toggle-v${pkg.version}-${variant}`;
    const directory = path.join(buildRoot, name);
    const controller = path.join(directory, 'packages/controller');
    await mkdir(path.join(controller, 'src'), { recursive: true });
    await mkdir(path.join(controller, 'icons'));
    await mkdir(path.join(directory, 'scripts'));
    const manifest = structuredClone(baseManifest);
    manifest.version_name = `${pkg.version}-${variant}`;
    if (variant === 'manual') {
      manifest.name = 'Edge 浏览器外观切换（手动版）';
      manifest.description = '单击太阳按钮切换 Edge 深色和浅色外观；不检测网页、不自动切换。';
      manifest.permissions = ['management'];
      manifest.background.service_worker = 'src/manual-worker.mjs';
      delete manifest.host_permissions;
      delete manifest.content_scripts;
    }
    await writeFile(path.join(controller, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    // Explicit file lists keep signing keys, browser data and diagnostics out.
    for (const file of variant === 'auto' ? autoModules : manualModules) {
      await copyFile(path.join(root, 'packages/controller/src', file), path.join(controller, 'src', file));
    }
    for (const mode of ['light', 'dark']) {
      for (const size of [16, 32, 48, 128]) {
        const file = `icon-${mode}-${size}.png`;
        await copyFile(path.join(root, 'packages/controller/icons', file), path.join(controller, 'icons', file));
      }
    }
    await copyFile(path.join(root, 'packages/theme-dark.crx'), path.join(directory, 'packages/theme-dark.crx'));
    await copyFile(path.join(root, 'LICENSE'), path.join(directory, 'LICENSE'));
    await copyFile(path.join(root, 'scripts/install-theme-policy.ps1'), path.join(directory, 'scripts/install-theme-policy.ps1'));
    const label = variant === 'auto' ? '自动切换版：手动按钮 + B站／YouTube 当前标签自动切换。'
      : '纯手动版：仅太阳按钮切换，不申请网站访问权限，不包含页面检测脚本。';
    await writeFile(path.join(directory, '安装说明.md'), `# Edge 浏览器外观切换 ${pkg.version}\n\n${label}\n\n${instructions}`);
    const archive = path.join(buildRoot, `${name}.zip`);
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(root, 'scripts/compress-release.ps1'), '-SourceDirectory', directory, '-DestinationZip', archive]);
    packages.push({ variant, directory, archive });
  }
  const checksums = [];
  for (const item of packages) {
    checksums.push(`${createHash('sha256').update(await readFile(item.archive)).digest('hex')}  ${path.basename(item.archive)}`);
  }
  await writeFile(path.join(buildRoot, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`);
  return packages;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await buildReleasePackages(), null, 2));
}
