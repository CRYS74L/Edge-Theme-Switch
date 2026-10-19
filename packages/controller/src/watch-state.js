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
  let awaitingReplacement = false;
  let hiddenAncestors = [];
  const visible = () => document.visibilityState !== 'hidden';

  function sample() {
    let immersive = false;
    const url = new URL(location.href);
    if (!visible() && awaitingReplacement && !observedPlayer && previousKey &&
      previousKey === `${url.pathname}${url.searchParams.get('v') || ''}`) {
      // Missing DOM during a hidden rebuild is not evidence of leaving the mode.
      return { type: 'edge-theme-watch-state', immersive: true, episode: `${pageToken}:${episode}` };
    }
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
    if (!visible()) return; // Keep episode tracking, but never report background modes.
    const serialized = JSON.stringify(state);
    if (serialized === previousReport) return;
    previousReport = serialized;
    try {
      chrome.runtime.sendMessage({ ...state, sentAt: Date.now() }).catch(disconnect);
    }
    catch { disconnect(); }
  }
  function schedule() {
    if (!scheduled && !disconnected) { scheduled = true; queueMicrotask(report); }
  }
  const observer = new MutationObserver(schedule);
  function bindPlayer() {
    if (disconnected) return;
    boundUrl = location.href;
    const url = new URL(boundUrl);
    needsPlayer = url.hostname === 'www.bilibili.com' ||
      (['www.youtube.com', 'youtube.com'].includes(url.hostname) &&
       (url.pathname === '/watch' || url.pathname.startsWith('/live/')));
    const player = !needsPlayer ? null : url.hostname === 'www.bilibili.com'
      ? document.querySelector('.bpx-player-container') : document.querySelector('ytd-watch-flexy');
    if (observedPlayer && !observedPlayer.isConnected) awaitingReplacement = true;
    if (player !== observedPlayer) {
      observer.disconnect(); observedPlayer = player;
      if (player) observer.observe(player, {
        attributes: true, attributeFilter: ['data-screen', 'theater', 'hidden'],
      });
    }
    updateDiscovery();
    schedule();
  }
  // Discover delayed/replaced players without observing page-wide class churn.
  const treeObserver = new MutationObserver(() => {
    if (!visible() && !awaitingReplacement) return;
    if (location.href !== boundUrl || (needsPlayer && !observedPlayer?.isConnected)) bindPlayer();
  });
  const structureObserver = new MutationObserver(() => {
    if (visible() || disconnected || !needsPlayer) return;
    if (!observedPlayer?.isConnected) { awaitingReplacement = true; bindPlayer(); return; }
    const current = ancestors();
    if (current.length !== hiddenAncestors.length || current.some((node, index) => node !== hiddenAncestors[index])) updateDiscovery();
  });
  function ancestors() {
    const result = [];
    for (let node = observedPlayer?.parentElement; node; node = node.parentElement) result.push(node);
    return result;
  }
  function updateDiscovery() {
    treeObserver.disconnect(); structureObserver.disconnect();
    hiddenAncestors = [];
    if (disconnected) return;
    if (visible()) {
      awaitingReplacement = false;
      treeObserver.observe(document.documentElement, { subtree: true, childList: true });
    }
    else if (needsPlayer && observedPlayer?.isConnected) {
      awaitingReplacement = false;
      // Observe removal along the ancestor chain, not every descendant mutation.
      hiddenAncestors = ancestors();
      for (const node of hiddenAncestors) structureObserver.observe(node, { childList: true });
    }
    else if (needsPlayer && awaitingReplacement) {
      // A temporary replacement gap needs discovery until the new player exists.
      treeObserver.observe(document.documentElement, { subtree: true, childList: true });
    }
  }
  function disconnect() {
    disconnected = true;
    observer.disconnect(); treeObserver.disconnect(); structureObserver.disconnect();
  }
  function onVisibility() {
    if (visible() && !disconnected) bindPlayer();
    else updateDiscovery();
  }
  function onFocus() {
    if (!visible() || disconnected) return;
    // Window focus is an event-driven recovery signal even when mode is unchanged.
    previousReport = '';
    bindPlayer();
  }
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);
  const onQuery = (message, sender, respond) => {
    if (message?.type === 'edge-theme-watch-query') respond(sample());
  };
  chrome.runtime.onMessage.addListener(onQuery);
  const events = ['pageshow', 'popstate', 'hashchange', 'yt-navigate-finish', 'fullscreenchange'];
  for (const name of events) {
    window.addEventListener(name, bindPlayer);
  }
  globalThis.__edgeThemeWatchObserver = { dispose() {
    disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onFocus);
    try { chrome.runtime.onMessage.removeListener(onQuery); } catch {}
    for (const name of events) window.removeEventListener(name, bindPlayer);
  } };
  onVisibility();
  if (!visible()) bindPlayer();
  report();
})();
