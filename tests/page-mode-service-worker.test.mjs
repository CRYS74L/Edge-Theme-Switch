import assert from 'node:assert/strict';
import test from 'node:test';

const serviceWorkerUrl = new URL('../packages/controller/src/service-worker.mjs', import.meta.url).href;

function createFakeDocument() {
  const elements = new Map();
  const attributes = new Map();
  const parent = {
    append(style) {
      style.remove = () => {
        elements.delete(style.id);
      };
      elements.set(style.id, style);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
  };

  return {
    documentElement: parent,
    head: parent,
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    createElement() {
      return { id: '', textContent: '', remove() {} };
    },
  };
}

function createFakeChrome({
  tab = { id: 73, url: 'https://example.test/' },
  scriptingError,
  insertCssError,
} = {}) {
  const clickListeners = [];
  const tabUpdateListeners = [];
  const insertedCss = new Set();
  const cssRequests = [];
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

  return {
    chrome: {
      action,
      tabs: {
        onUpdated: {
          addListener(listener) {
            tabUpdateListeners.push(listener);
          },
        },
      },
      scripting: {
        async executeScript({ target, func, args = [] }) {
          assert.equal(target.tabId, tab.id);
          if (scriptingError) {
            throw scriptingError;
          }

          return [{ result: func(...args) }];
        },
        async insertCSS({ target, files, origin }) {
          assert.equal(target.tabId, tab.id);
          if (insertCssError) {
            throw insertCssError;
          }
          insertedCss.add(files.join(','));
          cssRequests.push({ operation: 'insert', files, origin });
        },
        async removeCSS({ target, files, origin }) {
          assert.equal(target.tabId, tab.id);
          insertedCss.delete(files.join(','));
          cssRequests.push({ operation: 'remove', files, origin });
        },
      },
    },
    action,
    clickListeners,
    tabUpdateListeners,
    insertedCss,
    cssRequests,
  };
}

test('单击 action 在当前普通网页中启用深色视觉模式，再次单击恢复原色', async () => {
  const fakeDocument = createFakeDocument();
  const fake = createFakeChrome();
  const originalChrome = globalThis.chrome;
  const originalDocument = globalThis.document;
  globalThis.chrome = fake.chrome;
  globalThis.document = fakeDocument;

  try {
    await import(`${serviceWorkerUrl}?page-mode=${Date.now()}`);

    await fake.clickListeners[0]({ id: 73 });
    assert.equal(fakeDocument.documentElement.getAttribute('data-edge-page-color-mode'), 'dark');
    assert.deepEqual([...fake.insertedCss], ['src/page-dark.css']);
    assert.deepEqual(fake.cssRequests, [{
      operation: 'insert',
      files: ['src/page-dark.css'],
      origin: 'USER',
    }]);
    assert.equal(fake.action.title, '当前网页为深色模式，单击恢复原色');

    await fake.clickListeners[0]({ id: 73 });
    assert.equal(fakeDocument.documentElement.getAttribute('data-edge-page-color-mode'), null);
    assert.deepEqual([...fake.insertedCss], []);
    assert.deepEqual(fake.cssRequests.at(-1), {
      operation: 'remove',
      files: ['src/page-dark.css'],
      origin: 'USER',
    });
    assert.equal(fake.action.title, '当前网页为原色，单击启用深色模式');
  }
  finally {
    if (originalChrome === undefined) {
      delete globalThis.chrome;
    }
    else {
      globalThis.chrome = originalChrome;
    }

    if (originalDocument === undefined) {
      delete globalThis.document;
    }
    else {
      globalThis.document = originalDocument;
    }
  }
});

test('快速连续单击两次 action 会按顺序启用再恢复，不能丢失第二次单击', async () => {
  const fakeDocument = createFakeDocument();
  const fake = createFakeChrome({ tab: { id: 75, url: 'https://example.test/' } });
  const originalChrome = globalThis.chrome;
  const originalDocument = globalThis.document;
  globalThis.chrome = fake.chrome;
  globalThis.document = fakeDocument;

  try {
    await import(`${serviceWorkerUrl}?rapid-click=${Date.now()}`);
    await Promise.all([
      fake.clickListeners[0]({ id: 75 }),
      fake.clickListeners[0]({ id: 75 }),
    ]);

    assert.equal(fakeDocument.documentElement.getAttribute('data-edge-page-color-mode'), null);
    assert.deepEqual([...fake.insertedCss], []);
    assert.equal(fake.action.title, '当前网页为原色，单击启用深色模式');
  }
  finally {
    if (originalChrome === undefined) {
      delete globalThis.chrome;
    }
    else {
      globalThis.chrome = originalChrome;
    }

    if (originalDocument === undefined) {
      delete globalThis.document;
    }
    else {
      globalThis.document = originalDocument;
    }
  }
});

test('网页开始导航时，action 状态会回到原色，不能遗留上一个页面的深色提示', async () => {
  const fakeDocument = createFakeDocument();
  const fake = createFakeChrome({ tab: { id: 77, url: 'https://example.test/' } });
  const originalChrome = globalThis.chrome;
  const originalDocument = globalThis.document;
  globalThis.chrome = fake.chrome;
  globalThis.document = fakeDocument;

  try {
    await import(`${serviceWorkerUrl}?navigation-reset=${Date.now()}`);
    await fake.clickListeners[0]({ id: 77 });
    assert.equal(fake.action.title, '当前网页为深色模式，单击恢复原色');

    await fake.tabUpdateListeners[0](77, { status: 'loading' });
    assert.equal(fake.action.title, '当前网页为原色，单击启用深色模式');
  }
  finally {
    if (originalChrome === undefined) {
      delete globalThis.chrome;
    }
    else {
      globalThis.chrome = originalChrome;
    }

    if (originalDocument === undefined) {
      delete globalThis.document;
    }
    else {
      globalThis.document = originalDocument;
    }
  }
});

test('样式注入失败时会回滚页面标记，并显示实际失败而不是内部页提示', async () => {
  const fakeDocument = createFakeDocument();
  const fake = createFakeChrome({
    tab: { id: 76, url: 'https://example.test/' },
    insertCssError: new Error('CSS insertion failed.'),
  });
  const originalChrome = globalThis.chrome;
  const originalDocument = globalThis.document;
  const originalConsoleError = console.error;
  globalThis.chrome = fake.chrome;
  globalThis.document = fakeDocument;
  console.error = () => {};

  try {
    await import(`${serviceWorkerUrl}?style-error=${Date.now()}`);
    await fake.clickListeners[0]({ id: 76 });

    assert.equal(fakeDocument.documentElement.getAttribute('data-edge-page-color-mode'), null);
    assert.equal(fake.action.title, '网页色彩切换失败，请在扩展错误详情中查看原因');
  }
  finally {
    if (originalChrome === undefined) {
      delete globalThis.chrome;
    }
    else {
      globalThis.chrome = originalChrome;
    }

    if (originalDocument === undefined) {
      delete globalThis.document;
    }
    else {
      globalThis.document = originalDocument;
    }
    console.error = originalConsoleError;
  }
});

test('Edge 内部页等不可注入页面不会改变任何状态，并给出可见错误提示', async () => {
  const fakeDocument = createFakeDocument();
  const fake = createFakeChrome({
    tab: { id: 74, url: 'edge://extensions/' },
    scriptingError: new Error('Cannot access contents of url "edge://extensions/".'),
  });
  const originalChrome = globalThis.chrome;
  const originalDocument = globalThis.document;
  const originalConsoleError = console.error;
  globalThis.chrome = fake.chrome;
  globalThis.document = fakeDocument;
  console.error = () => {};

  try {
    await import(`${serviceWorkerUrl}?blocked-page=${Date.now()}`);
    await fake.clickListeners[0]({ id: 74 });

    assert.equal(fakeDocument.documentElement.getAttribute('data-edge-page-color-mode'), null);
    assert.equal(fake.action.title, '当前页面不支持切换，请在普通网页中使用');
  }
  finally {
    if (originalChrome === undefined) {
      delete globalThis.chrome;
    }
    else {
      globalThis.chrome = originalChrome;
    }

    if (originalDocument === undefined) {
      delete globalThis.document;
    }
    else {
      globalThis.document = originalDocument;
    }
    console.error = originalConsoleError;
  }
});
