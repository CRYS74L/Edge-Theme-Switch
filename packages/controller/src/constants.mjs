export const NATIVE_HOST_NAME = 'com.crys74l.edge_browser_theme_toggle';
export const NATIVE_PROTOCOL_VERSION = 1;

export const ACTION_ICON_PATHS = Object.freeze({
  light: Object.freeze({
    16: 'icons/icon-light-16.png',
    32: 'icons/icon-light-32.png',
    48: 'icons/icon-light-48.png',
    128: 'icons/icon-light-128.png',
  }),
  dark: Object.freeze({
    16: 'icons/icon-dark-16.png',
    32: 'icons/icon-dark-32.png',
    48: 'icons/icon-dark-48.png',
    128: 'icons/icon-dark-128.png',
  }),
});

export const ACTION_TITLES = Object.freeze({
  initial: '单击切换 Edge 整体外观',
  busy: '正在切换 Edge 整体外观…',
  light: 'Edge 当前为浅色，单击切换为深色',
  dark: 'Edge 当前为深色，单击切换为浅色',
  nativeHostUnavailable: '本机切换组件不可用：请运行一次安装脚本',
  failed: '未更改 Edge 外观：请查看扩展错误详情',
});
