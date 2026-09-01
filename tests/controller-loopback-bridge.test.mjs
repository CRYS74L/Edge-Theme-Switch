import assert from 'node:assert/strict';
import test from 'node:test';

const serviceWorkerUrl = new URL('../packages/controller/src/service-worker.mjs', import.meta.url).href;

function createFakeChrome({ setIconFailure = false } = {}) {
  const clickListeners = [];
  const titleCalls = [];
  const iconCalls = [];

  return {
    chrome: {
      action: {
        async setIcon(details) {
          iconCalls.push(details);
          if (setIconFailure) {
            throw new Error('Failed to fetch icon');
          }
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

test('工具栏单击会把 toggle 请求发给本机回环桥接，并以桥接确认的深色结果更新标题', async () => {
  const fake = createFakeChrome();
  const requests = [];
  const fetchImplementation = async (url, init) => {
    requests.push({ url, init });
    return {
      ok: true,
      async json() {
        return { ok: true, mode: 'dark' };
      },
    };
  };

  await withWorker(fake, fetchImplementation, 'loopback-success', async () => {
    await fake.clickListeners[0]();

    assert.deepEqual(requests, [{
      url: 'http://127.0.0.1:42761/toggle',
      init: {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
          'x-edge-browser-theme-toggle': 'REDACTED_LOCAL_BRIDGE_TOKEN',
        },
        body: '{"command":"toggle","protocolVersion":1}',
      },
    }]);
    assert.equal(fake.iconCalls.length, 0);
    assert.deepEqual(fake.titleCalls.at(-1), {
      title: 'Edge 当前为深色，单击切换为浅色',
    });
  });
});

test('已确认的桥接切换不依赖 Edge 的动态图标加载', async () => {
  const fake = createFakeChrome({ setIconFailure: true });
  const fetchImplementation = async () => ({
    ok: true,
    async json() {
      return { ok: true, mode: 'dark' };
    },
  });

  await withWorker(fake, fetchImplementation, 'icon-independent', async () => {
    await fake.clickListeners[0]();

    assert.equal(fake.iconCalls.length, 0);
    assert.deepEqual(fake.titleCalls.at(-1), {
      title: 'Edge 当前为深色，单击切换为浅色',
    });
  });
});
