import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { activeWatchContext, isWatchSite } from '../packages/controller/src/watch-context.mjs';
const source = await readFile(new URL('../packages/controller/src/watch-state.js', import.meta.url), 'utf8');
function page(url, { visibility = 'visible' } = {}) {
  const queryListeners = []; const reports = [];
  const observers=[];const microtasks=[];const listeners=new Map();
  const body = { screen: 'normal', theater: false, hidden: false, visibility };
  const rootNode={isConnected:true,parentElement:null};
  let playerParent={isConnected:true,parentElement:rootNode};
  let biliPlayer={isConnected:true,parentElement:playerParent,getAttribute:()=>body.screen};
  const ytPlayer={isConnected:true,get hidden(){return body.hidden;},hasAttribute:name=>name==='theater'&&body.theater};
  const location = { href: url };
  const context = { URL, location, crypto: { randomUUID: () => 'doc' },
    queueMicrotask:fn=>microtasks.push(fn), Date,
    setTimeout: () => {throw Error('不允许固定延时或轮询');}, clearTimeout() {},
    window: { addEventListener(name,fn) {listeners.set(name,fn);}, removeEventListener(name) {listeners.delete(name);} },
    MutationObserver: class { constructor(fn){this.callback=fn;this.targets=new Set();observers.push(this);} observe(target,options) {this.target=target;this.targets.add(target);this.options=options;this.connected=true;} disconnect() {this.connected=false;this.targets.clear();} },
    document: { documentElement: rootNode, get visibilityState(){return body.visibility;},
      addEventListener(name,fn){listeners.set(name,fn);}, removeEventListener(name){listeners.delete(name);}, querySelector(selector) {
      if (selector === '.bpx-player-container') return biliPlayer;
      if (selector === 'ytd-watch-flexy') return ytPlayer;
      return null;
    } },
    chrome: { runtime: { onMessage: { addListener(fn) { queryListeners.push(fn); } },
      async sendMessage(value) { reports.push(value); return { ok: true }; } } } };
  vm.runInNewContext(source, context);
  return { body, location, reports, observers, microtasks, get biliPlayer(){return biliPlayer;}, ytPlayer, listeners,
    replaceBili(){biliPlayer.isConnected=false;biliPlayer={isConnected:true,parentElement:playerParent,getAttribute:()=>body.screen};},
    removeBili(){biliPlayer.isConnected=false;biliPlayer=null;},
    createBili(){biliPlayer={isConnected:true,parentElement:playerParent,getAttribute:()=>body.screen};},
    reparentBili(){playerParent={isConnected:true,parentElement:rootNode};biliPlayer.parentElement=playerParent;},
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

test('隐藏页面暂停整页DOM监听和报告，返回可见时恢复并报告当前模式',()=>{
  const p=page('https://www.bilibili.com/video/BVfake/');p.flush();p.reports.length=0;
  p.body.visibility='hidden';p.listeners.get('visibilitychange')?.();
  assert.equal(p.observers[1].connected,false,'后台页面不应继续监听整页节点变化');
  p.body.screen='web';p.observers[0].callback();p.flush();assert.equal(p.reports.length,0);
  p.body.visibility='visible';p.listeners.get('visibilitychange')();p.flush();
  assert.equal(p.observers[1].connected,true);assert.equal(p.reports.at(-1).immersive,true);
});

test('页面重新获得焦点时即使模式没变也重新通知，供后台验证窗口焦点后恢复检测',()=>{
  const p=page('https://www.bilibili.com/video/BVfake/');p.flush();
  p.body.screen='web';p.observers[0].callback();p.flush();
  const episode=p.reports.at(-1).episode;p.reports.length=0;
  p.listeners.get('focus')?.();p.flush();
  assert.equal(p.reports.length,1,'焦点恢复必须发事件，不能被相同模式去重吞掉');
  assert.equal(p.reports[0].immersive,true);assert.equal(p.reports[0].episode,episode);
  p.body.visibility='hidden';p.listeners.get('focus')?.();p.flush();
  assert.equal(p.reports.length,1,'隐藏页面不报告焦点恢复');
});

test('初始后台页不启用整页监听；后台播放器属性仍维护观看段，回前台不遗漏新段',()=>{
  const p=page('https://www.bilibili.com/video/BVfake/',{visibility:'hidden'});p.flush();
  assert.equal(p.observers[1].connected,false);assert.equal(p.reports.length,0);
  p.body.visibility='visible';p.body.screen='web';p.listeners.get('visibilitychange')();p.flush();
  const first=p.reports.at(-1).episode;
  p.body.visibility='hidden';p.listeners.get('visibilitychange')();
  p.body.screen='normal';p.observers[0].callback();p.flush();
  p.body.screen='web';p.observers[0].callback();p.flush();
  p.body.visibility='visible';p.listeners.get('visibilitychange')();p.flush();
  assert.notEqual(p.reports.at(-1).episode,first);
});

test('隐藏时替换播放器：普通模式再进网页全屏是新段，保持全屏的DOM重建仍保留原段',()=>{
  for(const exits of [true,false]){
    const p=page('https://www.bilibili.com/video/BVfake/');p.flush();p.body.screen='web';p.observers[0].callback();p.flush();
    const before=p.reports.at(-1).episode;
    p.body.visibility='hidden';p.listeners.get('visibilitychange')();
    assert.equal(p.observers[1].connected,false);
    p.replaceBili();if(exits)p.body.screen='normal';
    // The hidden structural observer watches ancestors without subtree churn.
    p.observers[2]?.callback();p.flush();
    p.body.screen='web';p.observers[0].callback();p.flush();
    p.body.visibility='visible';p.listeners.get('visibilitychange')();p.flush();
    if(exits)assert.notEqual(p.reports.at(-1).episode,before,'确实退出又进入的新播放器应开始新段');
    else assert.equal(p.reports.at(-1).episode,before,'保持全屏的播放器重建不应取消手动抑制');
  }
});

test('隐藏播放器重建的空档不算退出；新节点保持网页全屏时保留手动观看段',()=>{
  const p=page('https://www.bilibili.com/video/BVfake/');p.flush();p.body.screen='web';p.observers[0].callback();p.flush();
  const before=p.reports.at(-1).episode;
  p.body.visibility='hidden';p.listeners.get('visibilitychange')();
  p.removeBili();p.observers[2].callback();p.flush();assert.equal(p.observers[1].connected,true);
  p.createBili();p.observers[1].callback();p.flush();assert.equal(p.observers[1].connected,false);
  p.body.visibility='visible';p.listeners.get('visibilitychange')();p.flush();
  assert.equal(p.reports.at(-1).episode,before);
});

test('隐藏播放器移动容器后更新窄范围祖先链，不退回持续整页监听',()=>{
  const p=page('https://www.bilibili.com/video/BVfake/');p.flush();p.body.screen='web';p.observers[0].callback();p.flush();
  const before=p.reports.at(-1).episode;
  p.body.visibility='hidden';p.listeners.get('visibilitychange')();
  p.reparentBili();p.observers[2].callback();
  assert.ok(p.observers[2].targets.has(p.biliPlayer.parentElement));assert.equal(p.observers[1].connected,false);
  p.replaceBili();p.body.screen='normal';p.observers[2].callback();p.flush();
  p.body.screen='web';p.observers[0].callback();p.flush();
  p.body.visibility='visible';p.listeners.get('visibilitychange')();p.flush();assert.notEqual(p.reports.at(-1).episode,before);
});

test('已知前台按ID读取并验证active和窗口，不枚举标签；失效时重新发现',async()=>{
  const calls=[];const known={tabId:1,windowId:7};let valid=true;
  const api={windows:{getLastFocused:async()=>{calls.push('window');return {id:7};}},tabs:{
    get:async id=>{calls.push(`get:${id}`);return {id,active:true,windowId:valid?7:8,url:'https://www.youtube.com/watch?v=one'};},
    query:async()=>{calls.push('query');return [{id:2,active:true,windowId:7,url:'https://www.youtube.com/watch?v=two'}];},
    sendMessage:async id=>{calls.push(`sample:${id}`);return {type:'edge-theme-watch-state',immersive:true,episode:'doc:1'};},
  }};
  assert.equal((await activeWatchContext(api,undefined,{foreground:known})).tabId,1);
  assert.deepEqual(calls,['get:1','sample:1']);calls.length=0;valid=false;
  assert.equal((await activeWatchContext(api,undefined,{foreground:known})).tabId,2);
  assert.deepEqual(calls,['get:1','window','query','sample:2']);
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
