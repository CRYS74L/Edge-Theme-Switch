import assert from 'node:assert/strict';
import test from 'node:test';

const serviceWorkerUrl = new URL('../packages/controller/src/service-worker.mjs', import.meta.url).href;

function createFakeChrome(initialThemes) {
  const clickListeners = [];
  const titleCalls = [];
  const enabledCalls = [];
  const themes = initialThemes.map((theme) => ({ ...theme }));

  return {
    chrome: {
      action: {
        async setTitle(details) {
          titleCalls.push(details);
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
    },
    clickListeners,
    titleCalls,
    enabledCalls,
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
      title: 'Edge 当前为浅色，单击切换为深色',
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
      title: 'Edge 当前为浅色，单击切换为深色',
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
