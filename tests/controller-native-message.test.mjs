import assert from 'node:assert/strict';
import test from 'node:test';

const serviceWorkerUrl = new URL('../packages/controller/src/service-worker.mjs', import.meta.url).href;

function createFakeChrome({
  mode = undefined,
  responses = [],
  sendError = undefined,
  originalTab = { id: 42, windowId: 7 },
} = {}) {
  const clickListeners = [];
  const startupListeners = [];
  const installedListeners = [];
  const titleCalls = [];
  const iconCalls = [];
  const nativeCalls = [];
  const tabQueries = [];
  const createdTabs = [];
  const removedTabIds = [];
  const updatedTabs = [];
  const storage = mode ? { mode } : {};
  let nextTabId = 100;

  const chrome = {
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
    runtime: {
      getURL(path) {
        return path;
      },
      async sendNativeMessage(name, request) {
        nativeCalls.push({ name, request });
        if (sendError) {
          throw sendError;
        }

        return responses.shift() ?? { ok: true, mode: 'dark' };
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
    tabs: {
      async query(query) {
        tabQueries.push(query);
        return originalTab ? [{ ...originalTab }] : [];
      },
      async create(details) {
        const tab = { id: nextTabId++, windowId: originalTab?.windowId ?? 7, ...details };
        createdTabs.push({ details, tab });
        return { ...tab };
      },
      async remove(id) {
        removedTabIds.push(id);
      },
      async update(id, changes) {
        updatedTabs.push({ id, changes });
        return { id, ...changes };
      },
    },
    management: {
      async getAll() {
        return [];
      },
    },
    storage: {
      local: {
        async get() {
          return { ...storage };
        },
        async set(values) {
          Object.assign(storage, values);
        },
      },
    },
  };

  return {
    chrome,
    clickListeners,
    startupListeners,
    installedListeners,
    titleCalls,
    iconCalls,
    nativeCalls,
    tabQueries,
    createdTabs,
    removedTabIds,
    updatedTabs,
    storage,
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

async function withExpectedConsoleError(operation) {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await operation();
  }
  finally {
    console.error = originalConsoleError;
  }
}

test('单击只调用一次性宿主，不导航或激活用户标签页', async () => {
  const fake = createFakeChrome({ responses: [{ ok: true, mode: 'dark' }] });

  await withWorker(fake, 'native-toggle-success', async () => {
    await fake.clickListeners[0]();

    assert.deepEqual(fake.tabQueries, []);
    assert.deepEqual(fake.createdTabs, []);
    assert.deepEqual(fake.nativeCalls, [{
      name: 'com.crys74l.edge_browser_theme_toggle',
      request: { command: 'toggle', protocolVersion: 1 },
    }]);
    assert.deepEqual(fake.removedTabIds, []);
    assert.deepEqual(fake.updatedTabs, []);
    assert.equal(fake.storage.mode, 'dark');
    assert.deepEqual(fake.iconCalls.at(-1), {
      path: {
        16: 'icons/icon-dark-16.png',
        32: 'icons/icon-dark-32.png',
        48: 'icons/icon-dark-48.png',
        128: 'icons/icon-dark-128.png',
      },
    });
    assert.deepEqual(fake.titleCalls.at(-1), {
      title: 'Edge 当前为深色，单击切换为浅色',
    });
  });
});

test('本机宿主失败时不创建临时标签并报告失败', async () => {
  const fake = createFakeChrome({
    sendError: new Error('Specified native messaging host not found.'),
  });

  await withExpectedConsoleError(async () => {
    await withWorker(fake, 'native-toggle-failure', async () => {
      await fake.clickListeners[0]();

      assert.deepEqual(fake.createdTabs, []);
      assert.deepEqual(fake.removedTabIds, []);
      assert.deepEqual(fake.updatedTabs, []);
      assert.deepEqual(fake.titleCalls.at(-1), {
        title: '本机切换组件不可用：请运行一次安装脚本',
      });
    });
  });
});

test('快速连续单击会串行执行宿主调用且不触碰标签页', async () => {
  const fake = createFakeChrome({
    responses: [
      { ok: true, mode: 'dark' },
      { ok: true, mode: 'light' },
    ],
  });
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  const originalSend = fake.chrome.runtime.sendNativeMessage;
  fake.chrome.runtime.sendNativeMessage = async (...args) => {
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const result = await originalSend(...args);
    activeRequests -= 1;
    return result;
  };

  await withWorker(fake, 'native-toggle-serialized', async () => {
    await Promise.all([
      fake.clickListeners[0](),
      fake.clickListeners[0](),
    ]);

    assert.equal(maximumActiveRequests, 1);
    assert.deepEqual(fake.nativeCalls.map(({ request }) => request), [
      { command: 'toggle', protocolVersion: 1 },
      { command: 'toggle', protocolVersion: 1 },
    ]);
    assert.deepEqual(fake.createdTabs, []);
    assert.deepEqual(fake.removedTabIds, []);
    assert.deepEqual(fake.updatedTabs, []);
    assert.equal(fake.storage.mode, 'light');
    assert.deepEqual(fake.titleCalls.at(-1), {
      title: 'Edge 当前为浅色，单击切换为深色',
    });
  });
});

test('服务工作进程重启后从持久化状态恢复太阳图标', async () => {
  const fake = createFakeChrome({ mode: 'dark' });

  await withWorker(fake, 'native-startup-presentation', async () => {
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
      title: 'Edge 当前为深色，单击切换为浅色',
    });
  });
});

test('宿主返回不支持的模式时报告失败且不触碰标签页', async () => {
  const fake = createFakeChrome({ responses: [{ ok: true, mode: 'sepia' }] });

  await withExpectedConsoleError(async () => {
    await withWorker(fake, 'native-invalid-response', async () => {
      await fake.clickListeners[0]();

      assert.deepEqual(fake.createdTabs, []);
      assert.deepEqual(fake.removedTabIds, []);
      assert.deepEqual(fake.updatedTabs, []);
      assert.deepEqual(fake.titleCalls.at(-1), {
        title: '未更改 Edge 外观：请查看扩展错误详情',
      });
    });
  });
});
