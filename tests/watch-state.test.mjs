import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { activeWatchContext, isWatchSite } from '../packages/controller/src/watch-context.mjs';
const source = await readFile(new URL('../packages/controller/src/watch-state.js', import.meta.url), 'utf8');
function page(url) {
  const queryListeners = []; const reports = [];
  const observers=[];const microtasks=[];const listeners=new Map();
  const body = { screen: 'normal', theater: false, hidden: false };
  const biliPlayer={isConnected:true,getAttribute:()=>body.screen};
  const ytPlayer={isConnected:true,get hidden(){return body.hidden;},hasAttribute:name=>name==='theater'&&body.theater};
  const location = { href: url };
  const context = { URL, location, crypto: { randomUUID: () => 'doc' },
    queueMicrotask:fn=>microtasks.push(fn), Date,
    setTimeout: () => {throw Error('不允许固定延时或轮询');}, clearTimeout() {},
    window: { addEventListener(name,fn) {listeners.set(name,fn);}, removeEventListener(name) {listeners.delete(name);} },
    MutationObserver: class { constructor(fn){this.callback=fn;observers.push(this);} observe(target,options) {this.target=target;this.options=options;} disconnect() {} },
    document: { documentElement: {}, querySelector(selector) {
      if (selector === '.bpx-player-container') return biliPlayer;
      if (selector === 'ytd-watch-flexy') return ytPlayer;
      return null;
    } },
    chrome: { runtime: { onMessage: { addListener(fn) { queryListeners.push(fn); } },
      async sendMessage(value) { reports.push(value); return { ok: true }; } } } };
  vm.runInNewContext(source, context);
  return { body, location, reports, observers, microtasks, biliPlayer, ytPlayer, listeners,
    flush(){while(microtasks.length)microtasks.shift()();},
    read() { let value; queryListeners[0]({type:'edge-theme-watch-query'}, {}, v => { value = v; }); return value; } };
}
test('播放器属性变化在下一微任务报告，不等定时器；同轮变化只报告最终状态',()=>{
  const p=page('https://www.bilibili.com/video/BVfake/');p.flush();p.reports.length=0;
  assert.equal(p.observers[0].target,p.biliPlayer);
  assert.equal(p.observers[0].options.subtree,undefined);
  p.body.screen='web';p.observers[0].callback();p.observers[0].callback();
  assert.equal(p.microtasks.length,1);p.flush();assert.equal(p.reports.length,1);assert.equal(p.reports[0].immersive,true);
  p.body.screen='normal';p.observers[0].callback();p.body.screen='web';p.observers[0].callback();p.flush();
  assert.equal(p.reports.length,1,'最终状态未变化不重复发消息');
});
test('普通页面节点变化和直播弹幕不触发采样；单页导航和播放器替换仍会重新绑定',()=>{
  for(const url of ['https://live.bilibili.com/blanc/123','https://www.youtube.com/watch?v=one']){
    const p=page(url);p.flush();p.reports.length=0;
    for(let i=0;i<100;i++)p.observers[1].callback();
    assert.equal(p.microtasks.length,0);assert.equal(p.reports.length,0);
    p.location.href='https://www.youtube.com/watch?v=two';p.body.theater=true;p.observers[1].callback();p.flush();
    assert.equal(p.reports.at(-1).immersive,true);assert.equal(p.observers[0].target,p.ytPlayer);
    p.ytPlayer.isConnected=false;p.observers[1].callback();assert.equal(p.microtasks.length,1);
  }
});
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
