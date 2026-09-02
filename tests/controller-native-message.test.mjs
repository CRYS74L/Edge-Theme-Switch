import assert from 'node:assert/strict';
import test from 'node:test';

const serviceWorkerUrl = new URL('../packages/controller/src/service-worker.mjs', import.meta.url).href;

function createFakeChrome(sendNativeMessage) {
  const clickListeners = [];
  const titleCalls = [];

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
      runtime: {
        sendNativeMessage,
      },
    },
    clickListeners,
    titleCalls,
  };
}

async function withWorker(fake, marker, operation) {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  globalThis.chrome = fake.chrome;
  globalThis.fetch = () => {
    throw new Error('Controller must not use fetch for a native theme toggle.');
  };

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

test('工具栏单击通过 Edge Native Messaging 请求一次真实整体外观切换', async () => {
  const calls = [];
  const fake = createFakeChrome(async (hostName, message) => {
    calls.push({ hostName, message });
    return { ok: true, mode: 'dark' };
  });

  await withWorker(fake, 'native-success', async () => {
    await fake.clickListeners[0]();

    assert.deepEqual(calls, [{
      hostName: 'com.crys74l.edge_browser_theme_toggle',
      message: { command: 'toggle', protocolVersion: 1 },
    }]);
    assert.deepEqual(fake.titleCalls.at(-1), {
      title: 'Edge 当前为深色，单击切换为浅色',
    });
  });
});

test('快速连续两次单击会串行完成两个 Native Messaging 切换', async () => {
  const responses = [
    { ok: true, mode: 'dark' },
    { ok: true, mode: 'light' },
  ];
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  const fake = createFakeChrome(async () => {
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 5));
    activeRequests -= 1;
    return responses.shift();
  });

  await withWorker(fake, 'native-serialized', async () => {
    await Promise.all([
      fake.clickListeners[0](),
      fake.clickListeners[0](),
    ]);

    assert.equal(maximumActiveRequests, 1);
    assert.deepEqual(fake.titleCalls.at(-1), {
      title: 'Edge 当前为浅色，单击切换为深色',
    });
  });
});

test('Native Messaging host 不可用时不会谎称主题已切换', async () => {
  const fake = createFakeChrome(async () => {
    throw new Error('Specified native messaging host not found.');
  });
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withWorker(fake, 'native-unavailable', async () => {
      await fake.clickListeners[0]();

      assert.deepEqual(fake.titleCalls.at(-1), {
        title: '本机组件不可用：运行 scripts/install-native-host.ps1',
      });
    });
  }
  finally {
    console.error = originalConsoleError;
  }
});
