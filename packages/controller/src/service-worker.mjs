import {
  ACTION_TITLES,
  LOCAL_BRIDGE_TOKEN,
  LOCAL_BRIDGE_TOGGLE_URL,
  NATIVE_PROTOCOL_VERSION,
} from './constants.mjs';

let operationTail = Promise.resolve();

class NativeBridgeResponseError extends Error {
  constructor(response) {
    super(response?.message || response?.errorCode || 'The native bridge returned no supported result.');
    this.name = 'NativeBridgeResponseError';
    this.code = response?.errorCode || 'native-bridge-response';
  }
}

function enqueue(operation) {
  const result = operationTail.then(operation, operation);
  operationTail = result.catch(() => {});
  return result;
}

async function sendLocalToggleRequest() {
  const response = await fetch(LOCAL_BRIDGE_TOGGLE_URL, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      'x-edge-browser-theme-toggle': LOCAL_BRIDGE_TOKEN,
    },
    body: JSON.stringify({ command: 'toggle', protocolVersion: NATIVE_PROTOCOL_VERSION }),
  });

  if (!response.ok) {
    throw new Error(`Local bridge returned HTTP ${response.status}.`);
  }

  return response.json();
}

function isSupportedMode(mode) {
  return mode === 'light' || mode === 'dark';
}

async function setActionPresentation(mode) {
  await chrome.action.setTitle({ title: ACTION_TITLES[mode] });
}

async function setActionFailure(error) {
  const message = String(error?.message ?? '');
  const title = /failed to fetch|networkerror|local bridge returned http/i.test(message)
    ? ACTION_TITLES.bridgeUnavailable
    : ACTION_TITLES.failed;
  await chrome.action.setTitle({ title });
}

async function performToggle() {
  await chrome.action.setTitle({ title: ACTION_TITLES.busy });

  try {
    const response = await sendLocalToggleRequest();
    if (!response?.ok || !isSupportedMode(response.mode)) {
      throw new NativeBridgeResponseError(response);
    }

    await setActionPresentation(response.mode);
  }
  catch (error) {
    console.error('Edge 整体外观切换失败。', error);
    await setActionFailure(error);
  }
}

chrome.action.onClicked.addListener(() => enqueue(performToggle));
