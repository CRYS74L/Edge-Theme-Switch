import {
  ACTION_ICONS,
  ACTION_TITLES,
} from './constants.mjs';

let operationTail = Promise.resolve();

function enqueue(operation) {
  const result = operationTail.then(operation, operation);
  operationTail = result.catch(() => {});
  return result;
}

function recordDiagnostic(stage, error) {
  globalThis.__edgeThemeToggleDiagnostics = {
    stage,
    at: new Date().toISOString(),
    error: error
      ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
      : null,
  };
}

async function setActionPresentation(tabId, mode) {
  await Promise.all([
    chrome.action.setIcon({ tabId, path: ACTION_ICONS[mode] }),
    chrome.action.setTitle({ tabId, title: ACTION_TITLES[mode] }),
  ]);
}

function toggleDocumentColorModeMarker() {
  const root = document.documentElement;
  if (!root) {
    throw new Error('The page does not expose a document element.');
  }

  const attribute = 'data-edge-page-color-mode';
  if (root.getAttribute(attribute) === 'dark') {
    root.removeAttribute(attribute);
    return 'light';
  }

  root.setAttribute(attribute, 'dark');
  return 'dark';
}

function setDocumentColorModeMarker(mode) {
  const root = document.documentElement;
  if (!root) {
    return;
  }

  const attribute = 'data-edge-page-color-mode';
  if (mode === 'dark') {
    root.setAttribute(attribute, 'dark');
  }
  else {
    root.removeAttribute(attribute);
  }
}

async function restoreDocumentColorModeMarker(tabId, mode) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: setDocumentColorModeMarker,
      args: [mode],
    });
  }
  catch (rollbackError) {
    recordDiagnostic('rollback-page-marker', rollbackError);
  }
}

function isUnsupportedPageError(error) {
  const message = String(error?.message ?? '');
  return /Cannot access contents of url|Cannot access a chrome:|Missing host permission/i.test(message);
}

async function performPageModeSwitch(tab) {
  if (!Number.isInteger(tab?.id)) {
    await chrome.action.setTitle({ title: ACTION_TITLES.noTab });
    return;
  }

  const tabId = tab.id;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: toggleDocumentColorModeMarker,
    });
    const mode = results[0]?.result;
    if (mode !== 'dark' && mode !== 'light') {
      throw new Error('The page color-mode injection returned no supported mode.');
    }

    try {
      if (mode === 'dark') {
        await chrome.scripting.insertCSS({
          target: { tabId },
          files: ['src/page-dark.css'],
          origin: 'USER',
        });
      }
      else {
        await chrome.scripting.removeCSS({
          target: { tabId },
          files: ['src/page-dark.css'],
          origin: 'USER',
        });
      }
    }
    catch (styleError) {
      await restoreDocumentColorModeMarker(tabId, mode === 'dark' ? 'light' : 'dark');
      throw styleError;
    }

    await setActionPresentation(tabId, mode);
  }
  catch (error) {
    recordDiagnostic('switch-page-mode', error);
    console.error('网页深浅色切换失败。', error);
    await chrome.action.setTitle({
      tabId,
      title: isUnsupportedPageError(error) ? ACTION_TITLES.unsupported : ACTION_TITLES.error,
    });
  }
}

function switchPageMode(tab) {
  return enqueue(() => performPageModeSwitch(tab));
}

function resetActionOnNavigation(tabId, changeInfo) {
  if (changeInfo.status !== 'loading') {
    return undefined;
  }

  return enqueue(() => setActionPresentation(tabId, 'light')).catch((error) => {
    recordDiagnostic('reset-action-on-navigation', error);
    console.error('网页导航后重置工具栏状态失败。', error);
  });
}

chrome.action.onClicked.addListener(switchPageMode);
chrome.tabs.onUpdated.addListener(resetActionOnNavigation);
