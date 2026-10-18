// Read-only player observation: no player controls, page styles or cookies change.
(() => {
  globalThis.__edgeThemeWatchObserver?.dispose?.();
  const pageToken = crypto.randomUUID();
  let episode = 0;
  let previousKey = '';
  let previousReport = '';
  let timer;
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
    timer = undefined;
    if (disconnected) return;
    const state = sample();
    const serialized = JSON.stringify(state);
    if (serialized === previousReport) return;
    previousReport = serialized;
    try {
      chrome.runtime.sendMessage(state).catch(() => { disconnected = true; observer.disconnect(); });
    }
    catch { disconnected = true; observer.disconnect(); }
  }
  function schedule() {
    if (timer === undefined && !disconnected) timer = setTimeout(report, 80);
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['data-screen', 'class', 'theater', 'fullscreen', 'hidden'],
  });
  const onQuery = (message, sender, respond) => {
    if (message?.type === 'edge-theme-watch-query') respond(sample());
  };
  chrome.runtime.onMessage.addListener(onQuery);
  const events = ['pageshow', 'popstate', 'hashchange', 'yt-navigate-finish', 'fullscreenchange'];
  for (const name of events) {
    window.addEventListener(name, schedule);
  }
  globalThis.__edgeThemeWatchObserver = { dispose() {
    disconnected = true;
    observer.disconnect();
    if (timer !== undefined) clearTimeout(timer);
    try { chrome.runtime.onMessage.removeListener(onQuery); } catch {}
    for (const name of events) window.removeEventListener(name, schedule);
  } };
  report();
})();
