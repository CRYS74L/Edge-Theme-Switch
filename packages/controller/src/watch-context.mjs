export function isWatchSite(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (
      parsed.hostname === 'www.bilibili.com' ||
      parsed.hostname === 'live.bilibili.com' ||
      ['www.youtube.com', 'youtube.com'].includes(parsed.hostname)
    );
  }
  catch { return false; }
}

function hasNoLastFocusedWindow(error) {
  return /\bno last-focused window\b/i.test(String(error?.message || error));
}

export async function activeWatchContext(api, expectedTabIds, options = {}) {
  if (!api.tabs || !api.windows) return null;
  const started = performance.now();
  const timings = { lookup: 'discovery', foregroundMs: 0, playerMs: 0 };
  try {
  let tab;
  let windowId;
  if (options.foreground?.tabId !== undefined && api.tabs.get) {
    const known = options.foreground;
    try {
      const current = await api.tabs.get(known.tabId);
      if (current?.active && current.windowId === known.windowId) {
        tab = current; windowId = known.windowId; timings.lookup = 'direct';
      }
    }
    catch { /* Closed or moved tab: rediscover the foreground below. */ }
  }
  if (!tab) {
    let window;
    try {
      window = options.foreground?.windowId !== undefined && api.windows.get
        ? await api.windows.get(options.foreground.windowId)
        : await api.windows.getLastFocused({ windowTypes: ['normal'] });
    }
    catch (error) {
      if (options.foreground?.windowId === undefined && hasNoLastFocusedWindow(error)) {
        options.observe?.({ focused: false });
        return { ignored: true };
      }
      throw error;
    }
    windowId = window.id;
    if (window.type && window.type !== 'normal') return { ignored: true };
    if (options.requireFocused && window.focused === false) {
      options.observe?.({ focused: false, windowId });
      return { ignored: true };
    }
    [tab] = await api.tabs.query({ active: true, windowId });
  }
  timings.foregroundMs = performance.now() - started;
  if (options.isCurrent?.() === false) return { ignored: true };
  options.observe?.({ tabId: tab?.id, windowId });
  if (expectedTabIds && !expectedTabIds.has(tab?.id)) return { ignored: true };
  if (!tab || !isWatchSite(tab.url)) return null;
  const playerStarted = performance.now();
  const query = () => api.tabs.sendMessage(tab.id, { type: 'edge-theme-watch-query' }, { frameId: 0 });
  try {
    let report;
    try { report = await query(); }
    catch (error) {
      if (options.isCurrent?.() === false) return { ignored: true };
      if (!api.scripting || tab.discarded || tab.status === 'loading') throw error;
      await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/watch-state.js'] });
      if (options.isCurrent?.() === false) return { ignored: true };
      report = await query();
    }
    timings.playerMs = performance.now() - playerStarted;
    if (options.isCurrent?.() === false) return { ignored: true };
    if (report?.type !== 'edge-theme-watch-state' || typeof report.immersive !== 'boolean' ||
      typeof report.episode !== 'string' || report.episode.length > 128) return null;
    return { tabId: tab.id, immersive: report.immersive, episode: report.episode };
  }
  catch (error) {
    if (options.isCurrent?.() === false) return { ignored: true };
    // Diagnostics must never hold the appearance decision behind disk writes.
    void api.storage?.local?.set({ watchContextError: String(error?.message || error) })?.catch(() => {});
    return null;
  } // Closed, navigating, discarded or not yet granted site access.
  }
  finally { options.trace?.(timings); }
}
