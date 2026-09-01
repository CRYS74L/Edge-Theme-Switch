import {
  ACTION_ICONS,
  ACTION_TITLES,
  THEME_IDS,
} from './constants.mjs';
import {
  classifyActiveTheme,
  createThemeSwitchPlan,
  hasAllProjectThemes,
} from './theme-state.mjs';

let operationTail = Promise.resolve();

function enqueue(operation) {
  const result = operationTail.then(operation, operation);
  operationTail = result.catch(() => {});
  return result;
}

function presentationMode(extensions) {
  return classifyActiveTheme(extensions, THEME_IDS) === 'dark' ? 'dark' : 'light';
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

async function refreshActionPresentation() {
  const extensions = await chrome.management.getAll();
  if (!hasAllProjectThemes(extensions, THEME_IDS)) {
    await chrome.action.setTitle({ title: ACTION_TITLES.setupRequired });
    return;
  }

  const mode = presentationMode(extensions);

  await Promise.all([
    chrome.action.setIcon({ path: ACTION_ICONS[mode] }),
    chrome.action.setTitle({ title: ACTION_TITLES[mode] }),
  ]);
}

async function setErrorTitle(error) {
  recordDiagnostic('set-error-title', error);
  console.error('Edge 浏览器主题切换失败。', error);
  await chrome.action.setTitle({ title: ACTION_TITLES.error });
}

async function performThemeSwitch() {
  try {
    const extensions = await chrome.management.getAll();
    if (!hasAllProjectThemes(extensions, THEME_IDS)) {
      await chrome.action.setTitle({ title: ACTION_TITLES.setupRequired });
      return;
    }

    const { targetThemeId, disableThemeIds } = createThemeSwitchPlan(extensions, THEME_IDS);

    for (const themeId of disableThemeIds) {
      await chrome.management.setEnabled(themeId, false);
    }
    await chrome.management.setEnabled(targetThemeId, true);
    await refreshActionPresentation();
  }
  catch (error) {
    await setErrorTitle(error);
  }
}

function switchTheme() {
  return enqueue(performThemeSwitch);
}

function refreshAfterManagementChange() {
  enqueue(refreshActionPresentation).catch(setErrorTitle);
}

chrome.action.onClicked.addListener(switchTheme);
chrome.management.onEnabled.addListener(refreshAfterManagementChange);
chrome.management.onDisabled.addListener(refreshAfterManagementChange);
chrome.management.onInstalled.addListener(refreshAfterManagementChange);
chrome.management.onUninstalled.addListener(refreshAfterManagementChange);

refreshAfterManagementChange();
