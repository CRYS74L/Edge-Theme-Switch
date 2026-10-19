export const DARK_THEME_NAME = 'Edge 外观一键切换 - 深色主题';
export const DARK_THEME_VERSION = '1.1.1';

export function isDarkTheme(theme) {
  // Keep installed themes usable while the controller and CRX update separately.
  return theme?.type === 'theme' &&
    [DARK_THEME_NAME, 'Edge 外观切换 - 深色主题'].includes(theme.name);
}

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
  initial: '切换模式',
  busy: '正在切换…',
  light: '深色模式',
  dark: '浅色模式',
  themesUnavailable: '主题组件未加载：请加载深色主题包',
  failed: '未更改 Edge 外观：请查看扩展错误详情',
});
