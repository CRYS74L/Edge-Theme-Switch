import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

async function readPng(relativePath) {
  return readFile(path.join(projectRoot, relativePath));
}

function pngDimensions(bytes) {
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

test('太阳和月亮 action 图标以正确尺寸输出为可用 PNG', async () => {
  for (const size of [16, 32, 48, 128]) {
    for (const mode of ['light', 'dark']) {
      const relativePath = `packages/controller/icons/icon-${mode}-${size}.png`;
      const bytes = await readPng(relativePath);

      assert.deepEqual([...bytes.subarray(0, 8)], pngSignature, `${relativePath} 必须是 PNG`);
      assert.deepEqual(pngDimensions(bytes), { width: size, height: size }, `${relativePath} 必须是 ${size}px 正方形`);
      assert.ok(bytes.length > 100, `${relativePath} 不得是空白占位资源`);
    }
  }
});
