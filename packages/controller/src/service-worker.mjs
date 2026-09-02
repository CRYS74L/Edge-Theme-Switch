import {
  ACTION_TITLES,
  NATIVE_HOST_NAME,
  NATIVE_PROTOCOL_VERSION,
} from './constants.mjs';

let operationTail = Promise.resolve();

class NativeHostResponseError extends Error {
  constructor(response) {
    super(response?.message || response?.errorCode || 'The native bridge returned no supported result.');
    this.name = 'NativeHostResponseError';
    this.code = response?.errorCode || 'native-host-response';
  }
}

function enqueue(operation) {
  const result = operationTail.then(operation, operation);
  operationTail = result.catch(() => {});
  return result;
}

const sendNativeToggleRequest = () => chrome.runtime.sendNativeMessage(
  NATIVE_HOST_NAME,
  { command: 'toggle', protocolVersion: NATIVE_PROTOCOL_VERSION },
);

function isSupportedMode(mode) {
  return mode === 'light' || mode === 'dark';
}

async function setActionPresentation(mode) {
  await chrome.action.setTitle({ title: ACTION_TITLES[mode] });
}

async function setActionFailure(error) {
  const message = String(error?.message ?? '');
  const title = /native messaging|native host|specified native|host not found/i.test(message)
    ? ACTION_TITLES.nativeHostUnavailable
    : ACTION_TITLES.failed;
  await chrome.action.setTitle({ title });
}

async function performToggle() {
  await chrome.action.setTitle({ title: ACTION_TITLES.busy });

  try {
    const response = await sendNativeToggleRequest();
    if (!response?.ok || !isSupportedMode(response.mode)) {
      throw new NativeHostResponseError(response);
    }

    await setActionPresentation(response.mode);
  }
  catch (error) {
    console.error('Edge 整体外观切换失败。', error);
    await setActionFailure(error);
  }
}

chrome.action.onClicked.addListener(() => enqueue(performToggle));
