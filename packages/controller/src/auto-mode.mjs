// All calls are serialized by the service worker. Only auto-owned dark mode
// is reverted; a manual click always takes ownership of the resulting mode.
export function createAutoMode(io) {
  let state;
  async function load() {
    state ??= { owned: false, suppressed: {}, ...await io.load() };
    return state;
  }
  const save = () => io.save(state);
  async function forgetMany(tabIds) {
    await load();
    let changed = false;
    for (const tabId of tabIds) {
      if (Object.hasOwn(state.suppressed, tabId)) {
        delete state.suppressed[tabId]; changed = true;
      }
    }
    if (changed) await save();
  }
  const key = context => context?.immersive ? `${context.tabId}:${context.episode}` : null;
  async function suppressCurrent() {
    const context = await io.context();
    if (key(context)) state.suppressed[context.tabId] = context.episode;
    state.owned = false;
    await save();
  }
  return {
    async reconcile(providedContext, isCurrent = () => true) {
      await load();
      const context = providedContext === undefined ? await io.context() : providedContext;
      const theme = await io.theme();
      if (!isCurrent()) return { ignored: true };
      const eligible = !!key(context) && state.suppressed[context.tabId] !== context.episode;
      if (eligible && !theme.enabled) {
        const previousOwned = state.owned;
        state.owned = true;
        await save(); // Persist before changing appearance so worker suspension is safe.
        if (!isCurrent()) {
          state.owned = previousOwned; await save(); return { ignored: true };
        }
        try { await io.setTheme(theme, true); }
        catch (error) { state.owned = false; await save(); throw error; }
        return { theme: { ...theme, enabled: true }, changed: true };
      }
      else if (!eligible && state.owned) {
        if (theme.enabled) await io.setTheme(theme, false);
        state.owned = false;
        await save();
        return { theme: { ...theme, enabled: false }, changed: !!theme.enabled };
      }
      return { theme, changed: false };
    },
    async manual() {
      await load();
      const theme = await io.theme();
      await suppressCurrent();
      await io.setTheme(theme, !theme.enabled);
    },
    async externalChange() { await load(); await suppressCurrent(); },
    forget: tabId => forgetMany([tabId]),
    forgetMany,
  };
}
