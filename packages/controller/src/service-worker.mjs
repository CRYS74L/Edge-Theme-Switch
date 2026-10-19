import {
  ACTION_ICON_PATHS,
  ACTION_TITLES,
  DARK_THEME_NAME,
  DARK_THEME_VERSION,
  isDarkTheme,
} from './constants.mjs';
import { createAutoMode } from './auto-mode.mjs';
import { activeWatchContext, isWatchSite } from './watch-context.mjs';
import { createPresentationQueue } from './action-presentation.mjs';

let operationTail = Promise.resolve();
const expectedThemeEvents = [];
const AUTO_STATE_KEY = 'watchAutoMode';
let autoQueued = false;
let pendingAll = false;
let pendingTabs = new Set();
let pendingSentAt = new Map();
let transitionClock;
let lastThemeApplyMs;
let lastThemeDetails;
let lastThemeCompletedAt;
let lastThemeQueryMs;
let lastOwnershipSaveMs;
let knownThemeId;
let foreground;
let foregroundEpoch = 0;
let outsideBrowser = false;
const contextWaiters = new Set();
const focusProbes = new Map();
let lastContextTimings;
let pendingRemoved = new Set();
let forgetQueued = false;
const traffic = { ignoredBackground: 0, canceledContext: 0 };

function invalidateContext() {
  foregroundEpoch += 1;
  for (const cancel of contextWaiters) cancel({ ignored: true });
  contextWaiters.clear();
}

function isBackground(tabId, tab) {
  return outsideBrowser || tab?.active === false || (foreground?.tabId !== undefined && foreground.tabId !== tabId);
}

async function foregroundContext(expectedTabIds) {
  if (outsideBrowser) return { ignored: true };
  const epoch = foregroundEpoch;
  let cancel;
  const canceled = new Promise(resolve => { cancel = resolve; contextWaiters.add(resolve); });
  const current = () => epoch === foregroundEpoch;
  const context = activeWatchContext(chrome, expectedTabIds, {
    foreground, isCurrent: current, requireFocused: true,
    observe(value) {
      if (!current()) return;
      // A snapshot can lag a focus event. It must not latch detection off.
      if (value.focused === false) foreground = undefined;
      else foreground = value;
    },
    trace(value) { if (current()) lastContextTimings = value; },
  });
  try {
    const result = await Promise.race([context, canceled]);
    if (!current()) { traffic.canceledContext += 1; return { ignored: true }; }
    return result;
  }
  finally { contextWaiters.delete(cancel); }
}

function recoverWindowFocus(windowId) {
  if (!Number.isInteger(windowId) || windowId < 0 || !chrome.windows?.get) return;
  const epoch = foregroundEpoch;
  const eventAt = Date.now();
  if (focusProbes.get(windowId) === epoch) return;
  focusProbes.set(windowId, epoch);
  void (async () => {
    try {
      const window = await chrome.windows.get(windowId);
      if (epoch !== foregroundEpoch || !window.focused || window.type !== 'normal') return;
      outsideBrowser = false;
      invalidateContext(); foreground = { windowId };
      transitionClock = { at: eventAt };
      diagnose({ watchFocus: { source: 'verified-page-or-tab', windowId, checkedAt: Date.now() } });
      requestReconcile(undefined, eventAt);
    }
    catch { /* A closed window is not a foreground recovery signal. */ }
    finally { if (focusProbes.get(windowId) === epoch) focusProbes.delete(windowId); }
  })();
}

function forgetClosedTab(id) {
  pendingRemoved.add(id);
  if (forgetQueued) return;
  forgetQueued = true;
  void enqueue(async () => {
    const ids = pendingRemoved; pendingRemoved = new Set(); forgetQueued = false;
    await autoMode.forgetMany(ids);
  });
}
function diagnose(value) {
  void chrome.storage?.local?.set(value)?.catch(() => {});
}
const presentation = createPresentationQueue({
  async apply({ title, mode }) {
    const started = performance.now();
    const updates = await Promise.allSettled([
      chrome.action.setTitle({ title }),
      ...(mode ? [chrome.action.setIcon({ path: resolveActionIconPaths(mode) })] : []),
    ]);
    // Even if one update fails, the other must finish before any newer UI state.
    const failed = updates.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    diagnose({ watchPresentation: { mode: mode || 'error', durationMs: performance.now() - started,
      checkedAt: Date.now() }, watchPresentationError: null });
  },
  onError(error) {
    console.error('工具栏图标同步失败，主题切换状态保持。', error);
    diagnose({ watchPresentationError: String(error?.message || error) });
  },
});
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
    void setActionPresentation(enabled ? 'dark' : 'light', current.version);
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

// Event callers may await visual feedback without holding operationTail open.
function enqueueWithPresentation(operation) {
  return enqueue(operation).then(() => presentation.whenIdle());
}

function findDarkTheme(themes) {
  return themes.find(isDarkTheme);
}

function resolveActionIconPaths(mode) {
  return Object.fromEntries(
    Object.entries(ACTION_ICON_PATHS[mode]).map(([size, path]) => (
      [size, chrome.runtime.getURL(path)]
    )),
  );
}

function setActionPresentation(mode, themeVersion) {
  const expectedVersion = DARK_THEME_VERSION;
  const title = themeVersion === expectedVersion
    ? ACTION_TITLES[mode]
    : `主题未更新：当前 ${themeVersion}，需要 ${expectedVersion}`;
  return presentation.request({ key: `${mode}:${title}`, title, mode });
}

function setActionFailure(error) {
  const title = error instanceof ThemeAvailabilityError
    ? ACTION_TITLES.themesUnavailable
    : ACTION_TITLES.failed;
  return presentation.request({ key: `error:${title}`, title });
}

async function getDarkTheme() {
  const started = performance.now();
  try {
    // Cache identity only. Always ask Edge for current enabled/version metadata.
    if (knownThemeId) {
      try {
        const current = await chrome.management.get(knownThemeId);
        if (isDarkTheme(current)) return current;
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
    void setActionPresentation(dark.enabled ? 'dark' : 'light', dark.version);
  }
  catch (error) {
    console.error('Edge 外观状态同步失败。', error);
    void setActionFailure(error);
  }
}

async function setDarkThemeEnabled(theme, enabled) {
  const started = performance.now();
  const marker = { id: theme.id, enabled };
  expectedThemeEvents.push(marker);
  const setStarted = performance.now();
  try { await chrome.management.setEnabled(theme.id, enabled); }
  catch (error) {
    const index = expectedThemeEvents.indexOf(marker);
    if (index !== -1) expectedThemeEvents.splice(index, 1);
    throw error;
  }
  const themeSetMs = performance.now() - setStarted;
  const verifyStarted = performance.now();
  const current = await chrome.management.get(theme.id);
  if (current?.enabled !== enabled) {
    throw new Error(`Edge did not ${enabled ? 'enable' : 'disable'} theme ${theme.id}.`);
  }
  lastThemeApplyMs = performance.now() - started;
  lastThemeCompletedAt = Date.now();
  lastThemeDetails = { enabled, themeSetMs, themeVerifyMs: performance.now() - verifyStarted };
  return { ...theme, ...current };
}

async function performToggle() {
  try {
    await autoMode.manual();
  }
  catch (error) {
    console.error('Edge 外观一键切换失败。', error);
    void setActionFailure(error);
  }
}

async function reconcile(expectedTabIds, eventTimes) {
  const started = performance.now();
  const epoch = foregroundEpoch;
  const clock = transitionClock;
  try {
    const context = await foregroundContext(expectedTabIds);
    if (context?.ignored) return;
    const tabId = context?.tabId ?? foreground?.tabId;
    const eventAt = eventTimes?.get(tabId) ?? eventTimes?.get(undefined);
    const clockAt = clock && (clock.tabId === undefined || clock.tabId === tabId) ? clock.at : undefined;
    const sentAt = Math.min(eventAt ?? Infinity, clockAt ?? Infinity);
    const contextMs = performance.now() - started;
    const result = await autoMode.reconcile(context, () => epoch === foregroundEpoch && !outsideBrowser);
    if (result.ignored) return;
    if (transitionClock === clock) transitionClock = undefined;
    // setTheme already updates the action when appearance changes.
    if (!result.changed) void setActionPresentation(result.theme.enabled ? 'dark' : 'light', result.theme.version);
    const metrics = result.changed ? { watchLatency: {
      controllerVersion: chrome.runtime.getManifest().version,
      eventAt: Number.isFinite(sentAt) ? sentAt : null, themeCompletedAt: lastThemeCompletedAt,
      ...lastThemeDetails, contextLookup: lastContextTimings,
      traffic: { ...traffic },
      contextMs, themeQueryMs: lastThemeQueryMs, ownershipSaveMs: lastOwnershipSaveMs,
      themeApplyMs: lastThemeApplyMs, workerMs: performance.now() - started,
      eventToApiDoneMs: Number.isFinite(sentAt) ? lastThemeCompletedAt - sentAt : null, checkedAt: Date.now(),
    } } : {};
    diagnose({ watchStatus: { context, checkedAt: Date.now() }, watchLastError: null, ...metrics });
  }
  catch (error) {
    console.error('自动外观切换失败。', error);
    diagnose({ watchLastError: String(error?.message || error) });
    void setActionFailure(error);
  }
}

// Coalesce bursts, but resolve the foreground tab and page state at execution time.
// A background report cannot override an already pending foreground activation.
function requestReconcile(tabId, sentAt) {
  if (tabId === undefined) pendingAll = true;
  else pendingTabs.add(tabId);
  if (Number.isFinite(sentAt) && sentAt <= Date.now() && Date.now() - sentAt < 60000) {
    pendingSentAt.set(tabId, Math.min(pendingSentAt.get(tabId) ?? sentAt, sentAt));
    if (!transitionClock || (tabId !== undefined && transitionClock.tabId !== undefined && transitionClock.tabId !== tabId)) {
      transitionClock = { tabId, at: sentAt };
    }
    else transitionClock.at = Math.min(transitionClock.at, sentAt);
  }
  if (autoQueued) return;
  autoQueued = true;
  void enqueue(async () => {
    const ids = pendingAll ? undefined : pendingTabs;
    const eventTime = pendingSentAt;
    pendingAll = false; pendingTabs = new Set(); pendingSentAt = new Map(); autoQueued = false;
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

chrome.runtime?.onStartup?.addListener(() => enqueueWithPresentation(() => reconcile()));
chrome.runtime?.onInstalled?.addListener(() => enqueueWithPresentation(async () => {
  // Never let an old/discarded background page hold the appearance queue open.
  void attachExistingPages().catch(error => console.error('页面状态检测加载失败。', error));
  await reconcile();
}));
chrome.action.onClicked.addListener(() => enqueueWithPresentation(performToggle));
chrome.runtime?.onMessage?.addListener((message, sender, respond) => {
  if (message?.type !== 'edge-theme-watch-state' || sender.frameId !== 0 ||
    !sender.tab || !isWatchSite(sender.url)) return;
  if (isBackground(sender.tab.id, sender.tab)) {
    if (sender.tab.active === true) recoverWindowFocus(sender.tab.windowId);
    traffic.ignoredBackground += 1; respond({ ok: true }); return;
  }
  invalidateContext();
  requestReconcile(sender.tab.id, message.sentAt);
  respond({ ok: true });
});
chrome.tabs?.onActivated?.addListener(({ tabId, windowId }) => {
  if (outsideBrowser || (foreground && windowId !== undefined && foreground.windowId !== windowId)) {
    recoverWindowFocus(windowId); return;
  }
  invalidateContext();
  if (foreground) foreground = { tabId, windowId: foreground.windowId };
  transitionClock = { tabId, at: Date.now() };
  requestReconcile(tabId, Date.now());
});
chrome.tabs?.onUpdated?.addListener((id, change, tab) => {
  if (!(change.status || change.url || change.discarded !== undefined)) return;
  if (isBackground(id, tab)) { traffic.ignoredBackground += 1; return; }
  if (change.url || change.status === 'loading' || change.discarded) invalidateContext();
  requestReconcile(id);
});
chrome.tabs?.onRemoved?.addListener(id => {
  forgetClosedTab(id);
  if (isBackground(id)) return;
  invalidateContext(); foreground = undefined; requestReconcile();
});
chrome.windows?.onFocusChanged?.addListener(id => {
  outsideBrowser = id === chrome.windows.WINDOW_ID_NONE;
  invalidateContext(); foreground = outsideBrowser ? undefined : { windowId: id };
  transitionClock = outsideBrowser ? undefined : { at: Date.now() };
  diagnose({ watchFocus: { source: 'window-event', windowId: id, checkedAt: Date.now() } });
  if (!outsideBrowser) requestReconcile(undefined, Date.now());
});

function themeEvent(theme, enabled) {
  const index = expectedThemeEvents.findIndex(item => item.id === theme.id && item.enabled === enabled);
  if (index !== -1) { expectedThemeEvents.splice(index, 1); return; }
  if (theme.type !== 'theme' || (!enabled && !isDarkTheme(theme))) return;
  void enqueue(async () => { await autoMode.externalChange(); await synchronizeActionPresentation(); });
}
chrome.management?.onEnabled?.addListener(theme => themeEvent(theme, true));
chrome.management?.onDisabled?.addListener(theme => themeEvent(theme, false));

// A worker wake-up can occur without onStartup/onInstalled (e.g. reload/update).
if (chrome.tabs) requestReconcile();
