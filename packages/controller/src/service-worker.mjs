import {
  ACTION_ICON_PATHS,
  ACTION_TITLES,
  DARK_THEME_NAME,
} from './constants.mjs';
import { createAutoMode } from './auto-mode.mjs';
import { activeWatchContext, isWatchSite } from './watch-context.mjs';

let operationTail = Promise.resolve();
const expectedThemeEvents = [];
const AUTO_STATE_KEY = 'watchAutoMode';
const autoMode = createAutoMode({
  async load() { return (await chrome.storage?.session?.get(AUTO_STATE_KEY))?.[AUTO_STATE_KEY] || {}; },
  async save(value) { await chrome.storage?.session?.set({ [AUTO_STATE_KEY]: value }); },
  async context() {
    const context = await activeWatchContext(chrome);
    await chrome.storage?.local?.set({ watchStatus: { context, checkedAt: Date.now() } });
    return context;
  },
  theme: getDarkTheme,
  async setTheme(theme, enabled) {
    const current = await setDarkThemeEnabled(theme, enabled);
    await setActionPresentation(enabled ? 'dark' : 'light', current.version);
  },
});

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

async function setActionPresentation(mode, themeVersion) {
  const expectedVersion = '1.0.0.5'; // Appearance package stays at the user-accepted dev.5.
  const title = themeVersion === expectedVersion
    ? ACTION_TITLES[mode]
    : `主题未更新：当前 ${themeVersion}，需要 ${expectedVersion}`;
  await Promise.all([
    chrome.action.setTitle({ title }),
    chrome.action.setIcon({ path: resolveActionIconPaths(mode) }),
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
    await setActionPresentation(dark.enabled ? 'dark' : 'light', dark.version);
  }
  catch (error) {
    console.error('Edge 外观状态同步失败。', error);
    await setActionFailure(error);
  }
}

async function setDarkThemeEnabled(theme, enabled) {
  const marker = { id: theme.id, enabled };
  expectedThemeEvents.push(marker);
  try { await chrome.management.setEnabled(theme.id, enabled); }
  catch (error) {
    const index = expectedThemeEvents.indexOf(marker);
    if (index !== -1) expectedThemeEvents.splice(index, 1);
    throw error;
  }
  const current = await chrome.management.get(theme.id);
  if (current?.enabled !== enabled) {
    throw new Error(`Edge did not ${enabled ? 'enable' : 'disable'} theme ${theme.id}.`);
  }
  return current;
}

async function performToggle() {
  await chrome.action.setTitle({ title: ACTION_TITLES.busy });

  try {
    await autoMode.manual();
  }
  catch (error) {
    console.error('Edge 整体外观切换失败。', error);
    await setActionFailure(error);
  }
}

async function reconcile() {
  try {
    await autoMode.reconcile(); await synchronizeActionPresentation();
    await chrome.storage?.local?.set({ watchLastError: null });
  }
  catch (error) {
    console.error('自动外观切换失败。', error);
    await chrome.storage?.local?.set({ watchLastError: String(error?.message || error) });
    await setActionFailure(error);
  }
}

async function attachExistingPages() {
  if (!chrome.scripting || !chrome.tabs) return;
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true,
    url: chrome.runtime.getManifest().host_permissions });
  await Promise.allSettled(tabs.filter(tab => isWatchSite(tab.url)).map(tab =>
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/watch-state.js'] })));
}

chrome.runtime?.onStartup?.addListener(() => enqueue(reconcile));
chrome.runtime?.onInstalled?.addListener(() => enqueue(async () => {
  // Never let an old/discarded background page hold the appearance queue open.
  void attachExistingPages().catch(error => console.error('页面状态检测加载失败。', error));
  await reconcile();
}));
chrome.action.onClicked.addListener(() => enqueue(performToggle));
function reconcileForegroundTab(tabId) {
  return enqueue(async () => {
    const window = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    const [current] = await chrome.tabs.query({ active: true, windowId: window.id });
    if (current?.id === tabId) await reconcile();
  });
}
chrome.runtime?.onMessage?.addListener((message, sender, respond) => {
  if (message?.type !== 'edge-theme-watch-state' || sender.frameId !== 0 ||
    !sender.tab || !isWatchSite(sender.url)) return;
  // Discard reports from every background tab, including other windows.
  void reconcileForegroundTab(sender.tab.id);
  respond({ ok: true });
});
chrome.tabs?.onActivated?.addListener(({ tabId }) => { void reconcileForegroundTab(tabId); });
chrome.tabs?.onUpdated?.addListener((id, change) => {
  if (change.status || change.url || change.discarded !== undefined) void reconcileForegroundTab(id);
});
chrome.tabs?.onRemoved?.addListener(id => { void enqueue(async () => {
  await autoMode.forget(id); await reconcile();
}); });
chrome.windows?.onFocusChanged?.addListener(id => {
  if (id !== chrome.windows.WINDOW_ID_NONE) void enqueue(reconcile);
});

function themeEvent(theme, enabled) {
  const index = expectedThemeEvents.findIndex(item => item.id === theme.id && item.enabled === enabled);
  if (index !== -1) { expectedThemeEvents.splice(index, 1); return; }
  if (theme.type !== 'theme' || (!enabled && theme.name !== DARK_THEME_NAME)) return;
  void enqueue(async () => { await autoMode.externalChange(); await synchronizeActionPresentation(); });
}
chrome.management?.onEnabled?.addListener(theme => themeEvent(theme, true));
chrome.management?.onDisabled?.addListener(theme => themeEvent(theme, false));

// A worker wake-up can occur without onStartup/onInstalled (e.g. reload/update).
if (chrome.tabs) void enqueue(reconcile);
