// Read-only player observation: no player controls, page styles or cookies change.
(() => {
  globalThis.__edgeThemeWatchObserver?.dispose?.();
  const pageToken = crypto.randomUUID();
  let episode = 0;
  let previousKey = '';
  let previousReport = '';
  let scheduled = false;
  let observedPlayer;
  let boundUrl = '';
  let needsPlayer = false;
  let disconnected = false;

  function sample() {
    let immersive = false;
    const url = new URL(location.href);
    if (url.hostname === 'www.bilibili.com' && url.pathname.startsWith('/video/')) {
      immersive = document.querySelector('.bpx-player-container')?.getAttribute('data-screen') === 'web';
    }
    else if (url.hostname === 'live.bilibili.com' && /^\/(?:blanc\/)?\d+\/?$/.test(url.pathname)) {
      immersive = true;
    }
    else if (['www.youtube.com', 'youtube.com'].includes(url.hostname) &&
      ((url.pathname === '/watch' && url.searchParams.has('v')) || /^\/live\/[^/]+/.test(url.pathname))) {
      const watch = document.querySelector('ytd-watch-flexy');
      immersive = !!watch && !watch.hidden && watch.hasAttribute('theater');
    }
    const contextKey = immersive ? `${url.pathname}${url.searchParams.get('v') || ''}` : '';
    if (contextKey && contextKey !== previousKey) episode += 1;
    previousKey = contextKey;
    return { type: 'edge-theme-watch-state', immersive, episode: `${pageToken}:${episode}` };
  }
  function report() {
    scheduled = false;
    if (disconnected) return;
    const state = sample();
    const serialized = JSON.stringify(state);
    if (serialized === previousReport) return;
    previousReport = serialized;
    try {
      chrome.runtime.sendMessage({ ...state, sentAt: Date.now() }).catch(() => { disconnected = true; observer.disconnect(); treeObserver.disconnect(); });
    }
    catch { disconnected = true; observer.disconnect(); treeObserver.disconnect(); }
  }
  function schedule() {
    if (!scheduled && !disconnected) { scheduled = true; queueMicrotask(report); }
  }
  const observer = new MutationObserver(schedule);
  function bindPlayer() {
    boundUrl = location.href;
    const url = new URL(boundUrl);
    needsPlayer = url.hostname === 'www.bilibili.com' ||
      (['www.youtube.com', 'youtube.com'].includes(url.hostname) &&
       (url.pathname === '/watch' || url.pathname.startsWith('/live/')));
    const player = !needsPlayer ? null : url.hostname === 'www.bilibili.com'
      ? document.querySelector('.bpx-player-container') : document.querySelector('ytd-watch-flexy');
    if (player !== observedPlayer) {
      observer.disconnect(); observedPlayer = player;
      if (player) observer.observe(player, {
        attributes: true, attributeFilter: ['data-screen', 'theater', 'hidden'],
      });
    }
    schedule();
  }
  // Discover delayed/replaced players without observing page-wide class churn.
  const treeObserver = new MutationObserver(() => {
    if (location.href !== boundUrl || (needsPlayer && !observedPlayer?.isConnected)) bindPlayer();
  });
  treeObserver.observe(document.documentElement, { subtree: true, childList: true });
  const onQuery = (message, sender, respond) => {
    if (message?.type === 'edge-theme-watch-query') respond(sample());
  };
  chrome.runtime.onMessage.addListener(onQuery);
  const events = ['pageshow', 'popstate', 'hashchange', 'yt-navigate-finish', 'fullscreenchange'];
  for (const name of events) {
    window.addEventListener(name, bindPlayer);
  }
  globalThis.__edgeThemeWatchObserver = { dispose() {
    disconnected = true;
    observer.disconnect();
    treeObserver.disconnect();
    try { chrome.runtime.onMessage.removeListener(onQuery); } catch {}
    for (const name of events) window.removeEventListener(name, bindPlayer);
  } };
  bindPlayer();
  report();
})();
