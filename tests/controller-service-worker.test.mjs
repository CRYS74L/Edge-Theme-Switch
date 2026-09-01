import assert from 'node:assert/strict';
import test from 'node:test';

const serviceWorkerUrl = new URL('../packages/controller/src/service-worker.mjs', import.meta.url).href;

function createFakeChrome() {
  const clickListeners = [];
  const titleCalls = [];
  const iconCalls = [];

  return {
    chrome: {
      action: {
        async setIcon(details) {
          iconCalls.push(details);
        },
        async setTitle(details) {
          titleCalls.push(details);
        },
        onClicked: {
          addListener(listener) {
            clickListeners.push(listener);
          },
        },
      },
      runtime: {},
    },
    clickListeners,
    titleCalls,
    iconCalls,
  };
}

async function withWorker(fake, fetchImplementation, marker, operation) {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fetchImplementation;

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

    if (originalFetch === undefined) {
      delete globalThis.fetch;
    }
    else {
      globalThis.fetch = originalFetch;
    }
  }
}

test('快速连续两次单击会串行请求本地桥接，并在深色和浅色间往返', async () => {
  const fake = createFakeChrome();
  const responses = [
    { ok: true, mode: 'dark' },
    { ok: true, mode: 'light' },
  ];
  const requests = [];
  const fetchImplementation = async (url, init) => {
    requests.push({ url, init });
    const result = responses.shift();
    return {
      ok: true,
      async json() {
        return result;
      },
    };
  };

  await withWorker(fake, fetchImplementation, 'rapid-toggle', async () => {
    await Promise.all([
      fake.clickListeners[0](),
      fake.clickListeners[0](),
    ]);

    assert.equal(requests.length, 2);
    assert.equal(fake.titleCalls.at(-1).title, 'Edge 当前为浅色，单击切换为深色');
    assert.equal(fake.iconCalls.length, 0);
  });
});

test('本地桥接不可达时不谎称切换成功，并显示精确的启动提示', async () => {
  const fake = createFakeChrome();
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withWorker(fake, async () => {
      throw new TypeError('Failed to fetch');
    }, 'bridge-unavailable', async () => {
      await fake.clickListeners[0]();

      assert.equal(fake.iconCalls.length, 0);
      assert.deepEqual(fake.titleCalls.at(-1), {
        title: '本地桥接未运行：运行 scripts/install-native-host.ps1',
      });
    });
  }
  finally {
    console.error = originalConsoleError;
  }
});
