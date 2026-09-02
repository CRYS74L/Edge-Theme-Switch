import {
  ACTION_ICON_PATHS,
  ACTION_TITLES,
  NATIVE_HOST_NAME,
  NATIVE_PROTOCOL_VERSION,
} from './constants.mjs';

let operationTail = Promise.resolve();

class NativeHostUnavailableError extends Error {
  constructor(cause) {
    super(cause?.message || 'The Edge appearance native host is unavailable.', { cause });
    this.name = 'NativeHostUnavailableError';
    this.code = 'native-host-unavailable';
  }
}

class NativeHostResponseError extends Error {
  constructor(response) {
    super(response?.message || 'The native host did not confirm the new Edge appearance.');
    this.name = 'NativeHostResponseError';
    this.code = response?.errorCode || 'native-host-response-invalid';
  }
}

function enqueue(operation) {
  const result = operationTail.then(operation, operation);
  operationTail = result.catch(() => {});
  return result;
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
  const title = error?.code === 'native-host-unavailable'
    ? ACTION_TITLES.nativeHostUnavailable
    : ACTION_TITLES.failed;
  await chrome.action.setTitle({ title });
}

async function readStoredMode() {
  const values = await chrome.storage.local.get({ mode: 'light' });
  return values?.mode === 'dark' ? 'dark' : 'light';
}

async function callNativeHost() {
  try {
    return await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      command: 'toggle',
      protocolVersion: NATIVE_PROTOCOL_VERSION,
    });
  }
  catch (error) {
    throw new NativeHostUnavailableError(error);
  }
}

function assertNativeHostSuccess(response) {
  if (response?.ok !== true || !['light', 'dark'].includes(response.mode)) {
    throw new NativeHostResponseError(response);
  }

  return response.mode;
}

async function performToggle() {
  await chrome.action.setTitle({ title: ACTION_TITLES.busy });

  try {
    const mode = assertNativeHostSuccess(await callNativeHost());
    await chrome.storage.local.set({ mode });
    await setActionPresentation(mode);
  }
  catch (error) {
    console.error('Edge 整体外观切换失败。', error);
    await setActionFailure(error);
  }
}

async function synchronizeActionPresentation() {
  try {
    await setActionPresentation(await readStoredMode());
  }
  catch (error) {
    console.error('Edge 外观状态同步失败。', error);
    await setActionFailure(error);
  }
}

chrome.runtime?.onStartup?.addListener(() => enqueue(synchronizeActionPresentation));
chrome.runtime?.onInstalled?.addListener(() => enqueue(synchronizeActionPresentation));
chrome.action.onClicked.addListener(() => enqueue(performToggle));
