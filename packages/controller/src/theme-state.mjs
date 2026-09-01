function isEnabledTheme(extension, id) {
  return extension?.id === id && extension.type === 'theme' && extension.enabled === true;
}

function isInstalledTheme(extension, id) {
  return extension?.id === id && extension.type === 'theme';
}

export function hasAllProjectThemes(extensions, ids) {
  return [ids.dark, ids.light].every((id) =>
    extensions.some((extension) => isInstalledTheme(extension, id)),
  );
}

export function classifyActiveTheme(extensions, ids) {
  if (extensions.some((extension) => isEnabledTheme(extension, ids.dark))) {
    return 'dark';
  }

  if (extensions.some((extension) => isEnabledTheme(extension, ids.light))) {
    return 'light';
  }

  return 'other';
}

export function chooseNextThemeId(extensions, ids) {
  return classifyActiveTheme(extensions, ids) === 'dark' ? ids.light : ids.dark;
}

export function createThemeSwitchPlan(extensions, ids) {
  const targetThemeId = chooseNextThemeId(extensions, ids);
  const disableThemeIds = [ids.dark, ids.light].filter((id) =>
    extensions.some((extension) => isEnabledTheme(extension, id)),
  );

  return {
    targetThemeId,
    disableThemeIds,
  };
}
