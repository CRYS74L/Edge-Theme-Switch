import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

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

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodeRgbaPng(bytes) {
  const idat = [];
  let offset = 8;
  let width;
  let height;
  let colorType;
  let interlaceMethod;

  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, '图标必须使用 8-bit 色深');
      colorType = data[9];
      interlaceMethod = data[12];
    }
    if (type === 'IDAT') {
      idat.push(data);
    }
    offset += length + 12;
  }

  assert.equal(colorType, 6, '图标必须是 RGBA PNG');
  assert.equal(interlaceMethod, 0, '图标不得使用交错扫描');

  const stride = width * 4;
  const decoded = inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(height * stride);
  let inputOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = decoded[inputOffset];
    inputOffset += 1;
    const source = decoded.subarray(inputOffset, inputOffset + stride);
    inputOffset += stride;

    for (let index = 0; index < stride; index += 1) {
      const left = index >= 4 ? rgba[y * stride + index - 4] : 0;
      const above = y > 0 ? rgba[(y - 1) * stride + index] : 0;
      const upperLeft = y > 0 && index >= 4 ? rgba[(y - 1) * stride + index - 4] : 0;
      let value = source[index];
      if (filter === 1) value += left;
      if (filter === 2) value += above;
      if (filter === 3) value += Math.floor((left + above) / 2);
      if (filter === 4) value += paethPredictor(left, above, upperLeft);
      assert.ok(filter >= 0 && filter <= 4, `未知 PNG filter ${filter}`);
      rgba[y * stride + index] = value & 0xff;
    }
  }

  return { width, height, rgba };
}

test('浅色和深色 action 图标都是太阳且以正确尺寸输出为可用 PNG', async () => {
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

test('浅色和深色太阳素材保持相同几何形状，只改变线条颜色', async () => {
  for (const size of [16, 32, 48, 128]) {
    const [light, dark] = await Promise.all([
      readPng(`packages/controller/icons/icon-light-${size}.png`),
      readPng(`packages/controller/icons/icon-dark-${size}.png`),
    ]);
    const lightImage = decodeRgbaPng(light);
    const darkImage = decodeRgbaPng(dark);

    assert.deepEqual(
      [lightImage.width, lightImage.height],
      [darkImage.width, darkImage.height],
      `${size}px 浅色和深色图标尺寸必须一致`,
    );
    for (let index = 3; index < lightImage.rgba.length; index += 4) {
      assert.equal(
        lightImage.rgba[index],
        darkImage.rgba[index],
        `${size}px 浅色和深色图标的透明度轮廓必须一致`,
      );
      if (lightImage.rgba[index] >= 128) {
        assert.equal(
          lightImage.rgba[index - 3],
          lightImage.rgba[index - 2],
          `${size}px 浅色太阳线条必须使用中性色，不得带色偏`,
        );
        assert.equal(
          lightImage.rgba[index - 2],
          lightImage.rgba[index - 1],
          `${size}px 浅色太阳线条必须使用中性色，不得带色偏`,
        );
        assert.equal(
          darkImage.rgba[index - 3],
          darkImage.rgba[index - 2],
          `${size}px 深色太阳线条必须使用中性色，不得带色偏`,
        );
        assert.equal(
          darkImage.rgba[index - 2],
          darkImage.rgba[index - 1],
          `${size}px 深色太阳线条必须使用中性色，不得带色偏`,
        );
        if (lightImage.rgba[index] === 255) {
          assert.equal(lightImage.rgba[index - 3], 0, `${size}px 浅色太阳不透明核心必须是纯黑`);
          assert.equal(darkImage.rgba[index - 3], 245, `${size}px 深色太阳不透明核心必须是亮灰 #f5f5f5`);
        }
        const lightLuma = lightImage.rgba[index - 3] + lightImage.rgba[index - 2] + lightImage.rgba[index - 1];
        const darkLuma = darkImage.rgba[index - 3] + darkImage.rgba[index - 2] + darkImage.rgba[index - 1];
        assert.ok(lightLuma < 300, `${size}px 浅色状态应使用深色线条`);
        assert.ok(darkLuma > 450, `${size}px 深色状态应使用浅色线条`);
      }
    }
  }
});
