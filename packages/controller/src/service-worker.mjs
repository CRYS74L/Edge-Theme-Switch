import {
  ACTION_ICON_PATHS,
  ACTION_TITLES,
  DARK_THEME_NAME,
} from './constants.mjs';

let operationTail = Promise.resolve();
const actionIconImageDataCache = new Map();

class ThemeAvailabilityError extends Error {
  constructor() {
    super(`The dark theme package "${DARK_THEME_NAME}" is not installed.`);
    this.name = 'ThemeAvailabilityError';
    this.code = 'theme-packages-unavailable';
  }
}

function enqueue(operation) {
  const result = operationTail.then(operation, operation);
  operationTail = result.catch(() => {});
  return result;
}

function findDarkTheme(themes) {
  return themes.find((theme) => (
    theme.type === 'theme' && theme.name === DARK_THEME_NAME
  ));
}

function resolveActionIconPaths(mode) {
  return Object.fromEntries(
    Object.entries(ACTION_ICON_PATHS[mode]).map(([size, path]) => (
      [size, chrome.runtime.getURL(path)]
    )),
  );
}

function canUseActionIconImageData() {
  return (
    typeof globalThis.fetch === 'function'
    && typeof globalThis.createImageBitmap === 'function'
    && typeof globalThis.OffscreenCanvas === 'function'
  );
}

async function resolveActionIconImageData(mode) {
  const cached = actionIconImageDataCache.get(mode);
  if (cached) {
    return cached;
  }

  if (!canUseActionIconImageData()) {
    throw new Error('当前 Edge 不支持在服务工作进程中读取 action 图标像素。');
  }

  const imageData = {};
  const fetchResource = globalThis.fetch;
  for (const [sizeText, path] of Object.entries(ACTION_ICON_PATHS[mode])) {
    const size = Number(sizeText);
    const response = await fetchResource(chrome.runtime.getURL(path));
    if (!response.ok) {
      throw new Error(`读取 action 图标失败：${path}（HTTP ${response.status}）。`);
    }

    const bitmap = await globalThis.createImageBitmap(await response.blob());
    try {
      const canvas = new globalThis.OffscreenCanvas(size, size);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        throw new Error('当前 Edge 无法创建 action 图标画布。');
      }
      context.clearRect(0, 0, size, size);
      context.drawImage(bitmap, 0, 0, size, size);
      imageData[sizeText] = context.getImageData(0, 0, size, size);
    }
    finally {
      bitmap.close?.();
    }
  }

  actionIconImageDataCache.set(mode, imageData);
  return imageData;
}

async function setActionIcon(mode) {
  if (!canUseActionIconImageData()) {
    await chrome.action.setIcon({ path: resolveActionIconPaths(mode) });
    return;
  }

  try {
    // Edge 的扩展菜单在部分版本不会刷新 path 图标，但会消费 imageData
    // 更新通知；优先走像素数据，同时保留 path 作为兼容回退。
    await chrome.action.setIcon({
      imageData: await resolveActionIconImageData(mode),
    });
  }
  catch (error) {
    console.warn('Edge 未接受 action 图标像素数据，回退到静态路径。', error);
    await chrome.action.setIcon({ path: resolveActionIconPaths(mode) });
  }
}

async function setActionPresentation(mode) {
  await Promise.all([
    chrome.action.setTitle({ title: ACTION_TITLES[mode] }),
    setActionIcon(mode),
  ]);
}

async function setActionFailure(error) {
  const title = error instanceof ThemeAvailabilityError
    ? ACTION_TITLES.themesUnavailable
    : ACTION_TITLES.failed;
  await chrome.action.setTitle({ title });
}

async function getDarkTheme() {
  const themes = await chrome.management.getAll();
  const dark = findDarkTheme(themes);
  if (!dark) {
    throw new ThemeAvailabilityError();
  }
  return dark;
}

async function synchronizeActionPresentation() {
  try {
    const dark = await getDarkTheme();
    await setActionPresentation(dark.enabled ? 'dark' : 'light');
  }
  catch (error) {
    console.error('Edge 外观状态同步失败。', error);
    await setActionFailure(error);
  }
}

async function setDarkThemeEnabled(theme, enabled) {
  await chrome.management.setEnabled(theme.id, enabled);
  const current = await chrome.management.get(theme.id);
  if (current?.enabled !== enabled) {
    throw new Error(`Edge did not ${enabled ? 'enable' : 'disable'} theme ${theme.id}.`);
  }
}

async function performToggle() {
  await chrome.action.setTitle({ title: ACTION_TITLES.busy });

  try {
    const dark = await getDarkTheme();
    const nextEnabled = !dark.enabled;
    await setDarkThemeEnabled(dark, nextEnabled);
    await setActionPresentation(nextEnabled ? 'dark' : 'light');
  }
  catch (error) {
    console.error('Edge 整体外观切换失败。', error);
    await setActionFailure(error);
  }
}

chrome.runtime?.onStartup?.addListener(() => enqueue(synchronizeActionPresentation));
chrome.runtime?.onInstalled?.addListener(() => enqueue(synchronizeActionPresentation));
chrome.action.onClicked.addListener(() => enqueue(performToggle));
