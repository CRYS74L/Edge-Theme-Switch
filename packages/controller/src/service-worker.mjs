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
let presentationKey;
let autoQueued = false;
let pendingAll = false;
let pendingTabs = new Set();
let pendingSentAt;
let lastThemeApplyMs;
let lastThemeCompletedAt;
let lastThemeQueryMs;
let lastOwnershipSaveMs;
let knownThemeId;
function diagnose(value) {
  void chrome.storage?.local?.set(value)?.catch(() => {});
}
const autoMode = createAutoMode({
  async load() { return (await chrome.storage?.session?.get(AUTO_STATE_KEY))?.[AUTO_STATE_KEY] || {}; },
  async save(value) {
    const started = performance.now();
    await chrome.storage?.session?.set({ [AUTO_STATE_KEY]: value });
    lastOwnershipSaveMs = performance.now() - started;
  },
  context: () => activeWatchContext(chrome),
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
  const key = `${mode}:${title}`;
  if (presentationKey === key) return;
  await Promise.all([
    chrome.action.setTitle({ title }),
    chrome.action.setIcon({ path: resolveActionIconPaths(mode) }),
  ]);
  presentationKey = key;
}

async function setActionFailure(error) {
  presentationKey = undefined;
  const title = error instanceof ThemeAvailabilityError
    ? ACTION_TITLES.themesUnavailable
    : ACTION_TITLES.failed;
  await chrome.action.setTitle({ title });
}

async function getDarkTheme() {
  const started = performance.now();
  try {
    // Cache identity only. Always ask Edge for current enabled/version metadata.
    if (knownThemeId) {
      try {
        const current = await chrome.management.get(knownThemeId);
        if (current?.type === 'theme' && current.name === DARK_THEME_NAME) return current;
      }
      catch { /* Removed/reinstalled themes are rediscovered below. */ }
      knownThemeId = undefined;
    }
    const dark = findDarkTheme(await chrome.management.getAll());
    if (!dark) throw new ThemeAvailabilityError();
    knownThemeId = dark.id;
    return dark;
  }
  finally {
    lastThemeQueryMs = performance.now() - started;
  }
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
  const started = performance.now();
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
  lastThemeApplyMs = performance.now() - started;
  lastThemeCompletedAt = Date.now();
  return { ...theme, ...current };
}

async function performToggle() {
  presentationKey = undefined;
  await chrome.action.setTitle({ title: ACTION_TITLES.busy });

  try {
    await autoMode.manual();
  }
  catch (error) {
    console.error('Edge 整体外观切换失败。', error);
    await setActionFailure(error);
  }
}

async function reconcile(expectedTabIds, sentAt) {
  const started = performance.now();
  try {
    const context = await activeWatchContext(chrome, expectedTabIds);
    if (context?.ignored) return;
    const contextMs = performance.now() - started;
    const result = await autoMode.reconcile(context);
    // setTheme already updates the action when appearance changes.
    if (!result.changed) await setActionPresentation(result.theme.enabled ? 'dark' : 'light', result.theme.version);
    const metrics = result.changed ? { watchLatency: {
      contextMs, themeQueryMs: lastThemeQueryMs, ownershipSaveMs: lastOwnershipSaveMs,
      themeApplyMs: lastThemeApplyMs, workerMs: performance.now() - started,
      eventToApiDoneMs: sentAt ? lastThemeCompletedAt - sentAt : null, checkedAt: Date.now(),
    } } : {};
    diagnose({ watchStatus: { context, checkedAt: Date.now() }, watchLastError: null, ...metrics });
  }
  catch (error) {
    console.error('自动外观切换失败。', error);
    diagnose({ watchLastError: String(error?.message || error) });
    await setActionFailure(error);
  }
}

// Coalesce bursts, but resolve the foreground tab and page state at execution time.
// A background report cannot override an already pending foreground activation.
function requestReconcile(tabId, sentAt) {
  if (tabId === undefined) pendingAll = true;
  else pendingTabs.add(tabId);
  if (Number.isFinite(sentAt) && sentAt <= Date.now() && Date.now() - sentAt < 60000) pendingSentAt = sentAt;
  if (autoQueued) return;
  autoQueued = true;
  void enqueue(async () => {
    const ids = pendingAll ? undefined : pendingTabs;
    const eventTime = pendingSentAt;
    pendingAll = false; pendingTabs = new Set(); pendingSentAt = undefined; autoQueued = false;
    await reconcile(ids, eventTime);
  });
}

async function attachExistingPages() {
  if (!chrome.scripting || !chrome.tabs) return;
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true,
    url: chrome.runtime.getManifest().host_permissions });
  await Promise.allSettled(tabs.filter(tab => isWatchSite(tab.url)).map(tab =>
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/watch-state.js'] })));
}

chrome.runtime?.onStartup?.addListener(() => enqueue(() => reconcile()));
chrome.runtime?.onInstalled?.addListener(() => enqueue(async () => {
  // Never let an old/discarded background page hold the appearance queue open.
  void attachExistingPages().catch(error => console.error('页面状态检测加载失败。', error));
  await reconcile();
}));
chrome.action.onClicked.addListener(() => enqueue(performToggle));
chrome.runtime?.onMessage?.addListener((message, sender, respond) => {
  if (message?.type !== 'edge-theme-watch-state' || sender.frameId !== 0 ||
    !sender.tab || !isWatchSite(sender.url)) return;
  // Discard reports from every background tab, including other windows.
  requestReconcile(sender.tab.id, message.sentAt);
  respond({ ok: true });
});
chrome.tabs?.onActivated?.addListener(({ tabId }) => { requestReconcile(tabId); });
chrome.tabs?.onUpdated?.addListener((id, change) => {
  if (change.status || change.url || change.discarded !== undefined) requestReconcile(id);
});
chrome.tabs?.onRemoved?.addListener(id => { void enqueue(async () => {
  await autoMode.forget(id); await reconcile();
}); });
chrome.windows?.onFocusChanged?.addListener(id => {
  if (id !== chrome.windows.WINDOW_ID_NONE) requestReconcile();
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
if (chrome.tabs) requestReconcile();
