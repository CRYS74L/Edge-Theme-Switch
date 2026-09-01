export const ACTION_ICONS = Object.freeze({
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
  light: '当前网页为原色，单击启用深色模式',
  dark: '当前网页为深色模式，单击恢复原色',
  noTab: '没有可切换的网页标签页',
  unsupported: '当前页面不支持切换，请在普通网页中使用',
  error: '网页色彩切换失败，请在扩展错误详情中查看原因',
});
