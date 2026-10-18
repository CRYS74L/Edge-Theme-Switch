import assert from 'node:assert/strict';
import test from 'node:test';

const serviceWorkerUrl = new URL('../packages/controller/src/service-worker.mjs', import.meta.url).href;

function createFakeChrome(initialThemes) {
  const clickListeners = [];
  const titleCalls = [];
  const iconCalls = [];
  const enabledCalls = [];
  const startupListeners = [];
  const installedListeners = [];
  const themes = initialThemes.map((theme) => ({ version: '1.0.0.5', ...theme }));

  return {
    chrome: {
      action: {
        async setTitle(details) {
          titleCalls.push(details);
        },
        async setIcon(details) {
          iconCalls.push(details);
        },
        onClicked: {
          addListener(listener) {
            clickListeners.push(listener);
          },
        },
      },
      management: {
        async getAll() {
          return themes.map((theme) => ({ ...theme }));
        },
        async get(id) {
          const theme = themes.find((candidate) => candidate.id === id);
          return theme ? { ...theme } : undefined;
        },
        async setEnabled(id, enabled) {
          enabledCalls.push({ id, enabled });
          const target = themes.find((theme) => theme.id === id);
          if (!target) {
            throw new Error(`Unknown theme ${id}`);
          }
          target.enabled = enabled;
          if (enabled) {
            for (const theme of themes) {
              if (theme.type === 'theme' && theme.id !== id) {
                theme.enabled = false;
              }
            }
          }
        },
      },
      runtime: {
        getManifest() {
          return { version: '1.0.0.5' };
        },
        getURL(path) {
          return path;
        },
        onStartup: {
          addListener(listener) {
            startupListeners.push(listener);
          },
        },
        onInstalled: {
          addListener(listener) {
            installedListeners.push(listener);
          },
        },
      },
    },
    clickListeners,
    titleCalls,
    iconCalls,
    enabledCalls,
    startupListeners,
    installedListeners,
  };
}

async function withWorker(fake, marker, operation) {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = fake.chrome;

  try {
    await import(`${serviceWorkerUrl}?${marker}=${Date.now()}`);
    await operation();
  }
  finally {
    if (originalChrome === undefined) {
      delete globalThis.chrome;
    }
    else {
      globalThis.chrome = originalChrome;
    }
  }
}

test('工具栏单击停用深色主题即可回到 Edge 内置浅色外观', async () => {
  const fake = createFakeChrome([
    { id: 'edge-dark-theme', name: 'Edge 外观切换 - 深色主题', type: 'theme', enabled: true },
  ]);

  await withWorker(fake, 'management-success', async () => {
    await fake.clickListeners[0]();

    assert.deepEqual(fake.enabledCalls, [{ id: 'edge-dark-theme', enabled: false }]);
    assert.deepEqual(fake.titleCalls.at(-1), {
      title: '深色模式',
    });
    assert.deepEqual(fake.iconCalls.at(-1), {
      path: {
        16: 'icons/icon-light-16.png',
        32: 'icons/icon-light-32.png',
        48: 'icons/icon-light-48.png',
        128: 'icons/icon-light-128.png',
      },
    });
  });
});

test('快速连续两次单击会串行启用和停用深色主题', async () => {
  const fake = createFakeChrome([
    { id: 'edge-dark-theme', name: 'Edge 外观切换 - 深色主题', type: 'theme', enabled: false },
  ]);
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  const originalSetEnabled = fake.chrome.management.setEnabled;
  fake.chrome.management.setEnabled = async (...args) => {
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const result = await originalSetEnabled(...args);
    activeRequests -= 1;
    return result;
  };

  await withWorker(fake, 'management-serialized', async () => {
    await Promise.all([
      fake.clickListeners[0](),
      fake.clickListeners[0](),
    ]);

    assert.equal(maximumActiveRequests, 1);
    assert.deepEqual(fake.enabledCalls, [
      { id: 'edge-dark-theme', enabled: true },
      { id: 'edge-dark-theme', enabled: false },
    ]);
    assert.deepEqual(fake.titleCalls.at(-1), {
      title: '深色模式',
    });
    assert.deepEqual(fake.iconCalls.at(-1), {
      path: {
        16: 'icons/icon-light-16.png',
        32: 'icons/icon-light-32.png',
        48: 'icons/icon-light-48.png',
        128: 'icons/icon-light-128.png',
      },
    });
  });
});

test('Edge 启动时会按已启用的深色主题同步浅色线性图标', async () => {
  const fake = createFakeChrome([
    { id: 'edge-dark-theme', name: 'Edge 外观切换 - 深色主题', type: 'theme', enabled: true },
  ]);

  await withWorker(fake, 'startup-presentation', async () => {
    await fake.startupListeners[0]();

    assert.deepEqual(fake.iconCalls.at(-1), {
      path: {
        16: 'icons/icon-dark-16.png',
        32: 'icons/icon-dark-32.png',
        48: 'icons/icon-dark-48.png',
        128: 'icons/icon-dark-128.png',
      },
    });
    assert.deepEqual(fake.titleCalls.at(-1), {
      title: '浅色模式',
    });
  });
});

test('深色主题包未加载时不会谎称 Edge 已切换', async () => {
  const fake = createFakeChrome([
    { id: 'some-other-extension', name: 'Other', type: 'extension', enabled: true },
  ]);
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withWorker(fake, 'theme-missing', async () => {
      await fake.clickListeners[0]();

      assert.deepEqual(fake.enabledCalls, []);
      assert.deepEqual(fake.titleCalls.at(-1), {
        title: '主题组件未加载：请加载深色主题包',
      });
    });
  }
  finally {
    console.error = originalConsoleError;
  }
});

test('重载控制器后仍会识别旧主题版本，并保留正常切换能力', async () => {
  const fake = createFakeChrome([
    { id: 'edge-dark-theme', name: 'Edge 外观切换 - 深色主题', type: 'theme',
      enabled: false, version: '1.0.0.1' },
  ]);

  await withWorker(fake, 'theme-version-mismatch', async () => {
    await fake.installedListeners[0]();
    assert.equal(fake.titleCalls.at(-1).title,
      '主题未更新：当前 1.0.0.1，需要 1.0.0.5');
    assert.deepEqual(fake.enabledCalls, []);

    await fake.clickListeners[0]();
    assert.deepEqual(fake.enabledCalls, [{ id: 'edge-dark-theme', enabled: true }]);
    assert.equal(fake.titleCalls.at(-1).title,
      '主题未更新：当前 1.0.0.1，需要 1.0.0.5');
  });
});

test('管理 API 失败时仍显示完整错误提示', async () => {
  const fake = createFakeChrome([
    { id: 'edge-dark-theme', name: 'Edge 外观切换 - 深色主题', type: 'theme', enabled: true },
  ]);
  fake.chrome.management.setEnabled = async () => {
    throw new Error('management failure');
  };
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withWorker(fake, 'management-failure', async () => {
      await fake.clickListeners[0]();

      assert.deepEqual(fake.titleCalls.at(-1), {
        title: '未更改 Edge 外观：请查看扩展错误详情',
      });
    });
  }
  finally {
    console.error = originalConsoleError;
  }
});
