import {
  ACTION_ICON_PATHS,
  ACTION_TITLES,
  DARK_THEME_NAME,
} from './constants.mjs';

let operationTail = Promise.resolve();

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

async function setActionPresentation(mode) {
  await Promise.all([
    chrome.action.setTitle({ title: ACTION_TITLES[mode] }),
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
