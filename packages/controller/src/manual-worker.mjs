// Release entry point for the management-only edition. No page APIs or observers.
import { ACTION_ICON_PATHS, ACTION_TITLES, DARK_THEME_VERSION, isDarkTheme } from './constants.mjs';
import { createPresentationQueue } from './action-presentation.mjs';

let operationTail = Promise.resolve();
let knownThemeId;
const presentation = createPresentationQueue({
  async apply({ title, mode }) {
    const updates = await Promise.allSettled([
      chrome.action.setTitle({ title }),
      ...(mode ? [chrome.action.setIcon({ path: Object.fromEntries(
        Object.entries(ACTION_ICON_PATHS[mode]).map(([size, value]) => [size, chrome.runtime.getURL(value)]),
      ) })] : []),
    ]);
    const failed = updates.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  },
  onError(error) { console.error('工具栏图标同步失败，主题切换状态保持。', error); },
});

class ThemeAvailabilityError extends Error {}

function showTheme(theme) {
  const mode = theme.enabled ? 'dark' : 'light';
  const title = theme.version === DARK_THEME_VERSION ? ACTION_TITLES[mode]
    : `主题未更新：当前 ${theme.version}，需要 ${DARK_THEME_VERSION}`;
  void presentation.request({ key: `${mode}:${title}`, title, mode });
}

function showFailure(error) {
  console.error('Edge 外观一键切换失败。', error);
  const title = error instanceof ThemeAvailabilityError ? ACTION_TITLES.themesUnavailable : ACTION_TITLES.failed;
  void presentation.request({ key: `error:${title}`, title });
}

function enqueue(operation) {
  const result = operationTail.then(operation, operation);
  operationTail = result.catch(() => {});
  return result.then(() => presentation.whenIdle());
}

async function getTheme() {
  if (knownThemeId) {
    try {
      const current = await chrome.management.get(knownThemeId);
      if (isDarkTheme(current)) return current;
    }
    catch { /* Rediscover a removed/reinstalled theme below. */ }
    knownThemeId = undefined;
  }
  const theme = (await chrome.management.getAll()).find(isDarkTheme);
  if (!theme) throw new ThemeAvailabilityError('Dark theme package is not installed.');
  knownThemeId = theme.id;
  return theme;
}

async function synchronize() {
  try { showTheme(await getTheme()); }
  catch (error) { showFailure(error); }
}

async function toggle() {
  try {
    const theme = await getTheme();
    const enabled = !theme.enabled;
    await chrome.management.setEnabled(theme.id, enabled);
    const current = await chrome.management.get(theme.id);
    if (current?.enabled !== enabled) throw new Error('Edge did not apply the requested theme state.');
    showTheme({ ...theme, ...current });
  }
  catch (error) { showFailure(error); }
}

chrome.action.onClicked.addListener(() => enqueue(toggle));
chrome.runtime?.onStartup?.addListener(() => enqueue(synchronize));
chrome.runtime?.onInstalled?.addListener(() => enqueue(synchronize));
chrome.management?.onEnabled?.addListener(theme => {
  if (theme.type === 'theme') void enqueue(synchronize);
});
chrome.management?.onDisabled?.addListener(theme => {
  if (isDarkTheme(theme)) void enqueue(synchronize);
});
void enqueue(synchronize);
