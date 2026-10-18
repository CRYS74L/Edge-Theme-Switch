import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { activeWatchContext, isWatchSite } from '../packages/controller/src/watch-context.mjs';
const source = await readFile(new URL('../packages/controller/src/watch-state.js', import.meta.url), 'utf8');
function page(url) {
  const queryListeners = []; const reports = [];
  const body = { screen: 'normal', theater: false, hidden: false };
  const location = { href: url };
  const context = { URL, location, crypto: { randomUUID: () => 'doc' },
    setTimeout: () => 1, clearTimeout() {}, window: { addEventListener() {}, removeEventListener() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    document: { documentElement: {}, querySelector(selector) {
      if (selector === '.bpx-player-container') return { getAttribute: () => body.screen };
      if (selector === 'ytd-watch-flexy') return { hidden: body.hidden, hasAttribute: name => name === 'theater' && body.theater };
      return null;
    } },
    chrome: { runtime: { onMessage: { addListener(fn) { queryListeners.push(fn); } },
      async sendMessage(value) { reports.push(value); return { ok: true }; } } } };
  vm.runInNewContext(source, context);
  return { body, location, reports, read() { let value; queryListeners[0]({type:'edge-theme-watch-query'}, {}, v => { value = v; }); return value; } };
}
test('B站只在网页全屏触发；退出再进入会创建新观看段', () => {
  const p = page('https://www.bilibili.com/video/BVfake/'); assert.equal(p.read().immersive, false);
  p.body.screen = 'web'; const first = p.read(); assert.equal(first.immersive, true);
  assert.equal(p.read().episode, first.episode);
  p.body.screen = 'wide'; assert.equal(p.read().immersive, false);
  p.body.screen = 'web'; assert.notEqual(p.read().episode, first.episode);
});
test('B站直播仅数字房间路径触发，首页与活动页不触发', () => {
  for (const url of ['https://live.bilibili.com/12345?broadcast_type=0','https://live.bilibili.com/12345/','https://live.bilibili.com/blanc/12345']) assert.equal(page(url).read().immersive, true);
  for (const url of ['https://live.bilibili.com/','https://live.bilibili.com/p/html/activity']) assert.equal(page(url).read().immersive, false);
});
test('YouTube 影院与单页导航、隐藏旧播放器正确识别', () => {
  const p = page('https://www.youtube.com/watch?v=video1'); assert.equal(p.read().immersive, false);
  p.body.theater = true; const first = p.read(); assert.equal(first.immersive, true);
  p.location.href = 'https://www.youtube.com/'; assert.equal(p.read().immersive, false);
  p.location.href = 'https://www.youtube.com/watch?v=video2'; assert.notEqual(p.read().episode, first.episode);
  p.body.hidden = true; assert.equal(p.read().immersive, false);
});
test('前台上下文查询指定窗口及主框架，不接受相似恶意域名', async () => {
  assert.equal(isWatchSite('https://www.youtube.com.evil.invalid/watch?v=x'), false);
  assert.equal(isWatchSite('http://www.youtube.com/watch?v=x'), false);
  let asked;
  const api = { windows: { getLastFocused: async () => ({id:7}) }, tabs: {
    query: async query => { assert.equal(query.windowId,7); return [{id:9,url:'https://www.youtube.com/watch?v=x'}]; },
    sendMessage: async (id,query,options) => { asked = {id,options}; return {type:'edge-theme-watch-state',immersive:true,episode:'a:1'}; },
  } };
  assert.deepEqual(await activeWatchContext(api), {tabId:9,immersive:true,episode:'a:1'});
  assert.deepEqual(asked,{id:9,options:{frameId:0}});
  api.tabs.sendMessage = async () => { throw Error('tab closed'); };
  assert.equal(await activeWatchContext(api), null);
});

test('旧页重载后没有接收者时只为当前页补注入脚本', async () => {
  let ready=false; const injected=[];
  const api={windows:{getLastFocused:async()=>({id:1})},tabs:{
    query:async()=>[{id:2,url:'https://www.bilibili.com/video/BVfake/',status:'complete'}],
    sendMessage:async()=>{if(!ready)throw Error('no receiver');return {type:'edge-theme-watch-state',immersive:true,episode:'rebound:1'};},
  },scripting:{executeScript:async value=>{injected.push(value);ready=true;}}};
  assert.equal((await activeWatchContext(api)).immersive,true);
  assert.deepEqual(injected,[{target:{tabId:2},files:['src/watch-state.js']}]);
  ready=false;api.tabs.query=async()=>[{id:2,url:'https://www.bilibili.com/video/BVfake/',discarded:true}];
  assert.equal(await activeWatchContext(api),null);assert.equal(injected.length,1);
});
