export function isWatchSite(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (
      (parsed.hostname === 'www.bilibili.com' && parsed.pathname.startsWith('/video/')) ||
      parsed.hostname === 'live.bilibili.com' ||
      ['www.youtube.com', 'youtube.com'].includes(parsed.hostname)
    );
  }
  catch { return false; }
}

export async function activeWatchContext(api, expectedTabIds) {
  if (!api.tabs || !api.windows) return null;
  const window = await api.windows.getLastFocused({ windowTypes: ['normal'] });
  const [tab] = await api.tabs.query({ active: true, windowId: window.id });
  if (expectedTabIds && !expectedTabIds.has(tab?.id)) return { ignored: true };
  if (!tab || !isWatchSite(tab.url)) return null;
  const query = () => api.tabs.sendMessage(tab.id, { type: 'edge-theme-watch-query' }, { frameId: 0 });
  try {
    let report;
    try { report = await query(); }
    catch (error) {
      if (!api.scripting || tab.discarded || tab.status === 'loading') throw error;
      await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/watch-state.js'] });
      report = await query();
    }
    if (report?.type !== 'edge-theme-watch-state' || typeof report.immersive !== 'boolean' ||
      typeof report.episode !== 'string' || report.episode.length > 128) return null;
    return { tabId: tab.id, immersive: report.immersive, episode: report.episode };
  }
  catch (error) {
    // Diagnostics must never hold the appearance decision behind disk writes.
    void api.storage?.local?.set({ watchContextError: String(error?.message || error) })?.catch(() => {});
    return null;
  } // Closed, navigating, discarded or not yet granted site access.
}
