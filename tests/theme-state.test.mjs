import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseNextThemeId,
  classifyActiveTheme,
} from '../packages/controller/src/theme-state.mjs';
import * as themeState from '../packages/controller/src/theme-state.mjs';

const ids = {
  light: 'light-theme-id',
  dark: 'dark-theme-id',
};

test('已启用深色主题时选择浅色主题作为下一主题', () => {
  const extensions = [{ id: ids.dark, type: 'theme', enabled: true }];

  assert.equal(classifyActiveTheme(extensions, ids), 'dark');
  assert.equal(chooseNextThemeId(extensions, ids), ids.light);
});

test('默认、浅色和第三方主题状态都选择深色主题作为下一主题', () => {
  const cases = [
    { name: '默认主题', extensions: [] },
    { name: '本项目浅色主题', extensions: [{ id: ids.light, type: 'theme', enabled: true }] },
    { name: '第三方主题', extensions: [{ id: 'third-party-theme', type: 'theme', enabled: true }] },
  ];

  for (const scenario of cases) {
    assert.equal(
      chooseNextThemeId(scenario.extensions, ids),
      ids.dark,
      `${scenario.name} 不应错误地选择浅色主题`,
    );
  }
});

test('忽略未启用和非主题项目，避免错误改变主题方向', () => {
  const extensions = [
    { id: ids.dark, type: 'theme', enabled: false },
    { id: ids.light, type: 'extension', enabled: true },
  ];

  assert.equal(classifyActiveTheme(extensions, ids), 'other');
  assert.equal(chooseNextThemeId(extensions, ids), ids.dark);
});

test('两个本项目主题意外同时启用时，切换计划先停用二者再只启用浅色主题', () => {
  assert.equal(
    typeof themeState.createThemeSwitchPlan,
    'function',
    '控制器必须能生成明确的主题切换计划，避免两个主题同时保持启用',
  );

  assert.deepEqual(
    themeState.createThemeSwitchPlan([
      { id: ids.dark, type: 'theme', enabled: true },
      { id: ids.light, type: 'theme', enabled: true },
    ], ids),
    {
      targetThemeId: ids.light,
      disableThemeIds: [ids.dark, ids.light],
    },
  );
});
