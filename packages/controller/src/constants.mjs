export const NATIVE_PROTOCOL_VERSION = 1;
export const LOCAL_BRIDGE_TOGGLE_URL = 'http://127.0.0.1:42761/toggle';
export const LOCAL_BRIDGE_TOKEN = 'REDACTED_LOCAL_BRIDGE_TOKEN';

export const ACTION_TITLES = Object.freeze({
  initial: '单击切换 Edge 整体外观',
  busy: '正在切换 Edge 整体外观…',
  light: 'Edge 当前为浅色，单击切换为深色',
  dark: 'Edge 当前为深色，单击切换为浅色',
  bridgeUnavailable: '本地桥接未运行：运行 scripts/install-native-host.ps1',
  failed: '未更改 Edge 外观：请查看扩展错误详情',
});
