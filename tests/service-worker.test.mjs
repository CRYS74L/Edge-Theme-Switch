import assert from 'node:assert/strict';
import test from 'node:test';

const serviceWorkerUrl = new URL('../packages/controller/src/service-worker.mjs', import.meta.url).href;

function createExtension(id, type, enabled) {
  return {
    id,
    type,
    enabled,
    name: id,
    shortName: id,
    description: '',
    version: '0.1.0',
    versionName: '0.1.0',
    mayDisable: true,
    mayEnable: true,
    installType: 'development',
    permissions: [],
    hostPermissions: [],
    icons: [],
  };
}

function createFakeChrome(extensions) {
  const clickListeners = [];
  const action = {
    icon: undefined,
    title: undefined,
    async setIcon({ path }) {
      this.icon = path;
    },
    async setTitle({ title }) {
      this.title = title;
    },
    onClicked: {
      addListener(listener) {
        clickListeners.push(listener);
      },
    },
  };
  const idleEvent = { addListener() {} };
  const management = {
    async getAll() {
      return structuredClone(extensions);
    },
    async setEnabled(id, enabled) {
      const extension = extensions.find((candidate) => candidate.id === id);
      if (!extension) {
        throw new Error(`Unknown extension: ${id}`);
      }

      extension.enabled = enabled;
    },
    onEnabled: idleEvent,
    onDisabled: idleEvent,
    onInstalled: idleEvent,
    onUninstalled: idleEvent,
  };

  return {
    chrome: { action, management },
    action,
    clickListeners,
  };
}

test('单击 action 会修复两个项目主题同时启用的状态，只保留目标浅色主题', async () => {
  const ids = {
    light: 'bnjfdnfniodanacgghheekbjfiambjoo',
    dark: 'dmaheoepkamplelijejmedigfgmmlgom',
  };
  const extensions = [
    createExtension(ids.dark, 'theme', true),
    createExtension(ids.light, 'theme', true),
  ];
  const fake = createFakeChrome(extensions);
  const originalChrome = globalThis.chrome;
  globalThis.chrome = fake.chrome;

  try {
    await import(`${serviceWorkerUrl}?dual-theme=${Date.now()}`);
    await fake.clickListeners[0]();

    assert.deepEqual(
      extensions.filter((extension) => extension.type === 'theme' && extension.enabled).map((extension) => extension.id),
      [ids.light],
    );
    assert.equal(fake.action.title, '当前为浅色模式，单击切换为深色模式');
  }
  finally {
    if (originalChrome === undefined) {
      delete globalThis.chrome;
    }
    else {
      globalThis.chrome = originalChrome;
    }
  }
});

test('缺少任一个主题包时，action 保持现有主题并显示明确的加载提示', async () => {
  const ids = {
    light: 'bnjfdnfniodanacgghheekbjfiambjoo',
    dark: 'dmaheoepkamplelijejmedigfgmmlgom',
  };
  const extensions = [createExtension(ids.dark, 'theme', true)];
  const fake = createFakeChrome(extensions);
  const originalChrome = globalThis.chrome;
  globalThis.chrome = fake.chrome;

  try {
    await import(`${serviceWorkerUrl}?missing-theme=${Date.now()}`);
    await fake.clickListeners[0]();

    assert.deepEqual(
      extensions.filter((extension) => extension.type === 'theme' && extension.enabled).map((extension) => extension.id),
      [ids.dark],
      '缺少组件时不能先关闭当前主题再失败',
    );
    assert.equal(fake.action.title, '主题组件未完整加载，请重新加载浅色和深色主题包');
  }
  finally {
    if (originalChrome === undefined) {
      delete globalThis.chrome;
    }
    else {
      globalThis.chrome = originalChrome;
    }
  }
});

test('快速连续单击两次 action 会按两次切换顺序回到浅色主题', async () => {
  const ids = {
    light: 'bnjfdnfniodanacgghheekbjfiambjoo',
    dark: 'dmaheoepkamplelijejmedigfgmmlgom',
  };
  const extensions = [
    createExtension(ids.dark, 'theme', false),
    createExtension(ids.light, 'theme', true),
  ];
  const fake = createFakeChrome(extensions);
  const originalChrome = globalThis.chrome;
  globalThis.chrome = fake.chrome;

  try {
    await import(`${serviceWorkerUrl}?double-click=${Date.now()}`);
    await Promise.all([fake.clickListeners[0](), fake.clickListeners[0]()]);

    assert.deepEqual(
      extensions.filter((extension) => extension.type === 'theme' && extension.enabled).map((extension) => extension.id),
      [ids.light],
      '两次单击必须是深色后再浅色，不能读取同一份旧状态而丢失一次切换',
    );
    assert.equal(fake.action.title, '当前为浅色模式，单击切换为深色模式');
  }
  finally {
    if (originalChrome === undefined) {
      delete globalThis.chrome;
    }
    else {
      globalThis.chrome = originalChrome;
    }
  }
});
