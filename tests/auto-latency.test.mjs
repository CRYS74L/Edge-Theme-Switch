import assert from 'node:assert/strict';
import test from 'node:test';
const turn = () => new Promise(setImmediate);
function event(){const handlers=[];return {addListener(fn){handlers.push(fn);},emit(...args){return handlers.map(fn=>fn(...args));}};}
export function createLatencyChrome() {
  const trace=[];let enabled=false;let immersive=false;let hold=false;let release;
  const theme=()=>({id:'dark',name:'Edge 外观切换 - 深色主题',version:'1.0.0.5',type:'theme',enabled});
  let activeId=1;
  const api={
    runtime:{getManifest:()=>({version:'1.1.0.1',host_permissions:['https://www.bilibili.com/*']}),getURL:p=>p,onStartup:event(),onInstalled:event(),onMessage:event()},
    action:{setTitle:async()=>{trace.push('title');},setIcon:async()=>{trace.push('icon');},onClicked:event()},
    windows:{getLastFocused:async()=>{trace.push('window');return {id:1};},onFocusChanged:event(),WINDOW_ID_NONE:-1},
    tabs:{query:async()=>{trace.push('activeTab');return [{id:activeId,url:activeId===1?'https://www.bilibili.com/video/BVfake/':'https://example.invalid/'}];},sendMessage:async()=>{trace.push('playerQuery');return {type:'edge-theme-watch-state',immersive,episode:'page:1'};},onActivated:event(),onUpdated:event(),onRemoved:event()},
    storage:{session:{get:async()=>{trace.push('ownershipRead');return {};},set:async()=>{trace.push('ownershipWrite');}},local:{set:async()=>{trace.push('diagnostic');if(hold)await new Promise(r=>{release=r;});}}},
    management:{getAll:async()=>{trace.push('themes');return [theme()];},get:async()=>{trace.push('themeReadback');return theme();},setEnabled:async(id,value)=>{trace.push('themeApply');enabled=value;api.management[value?'onEnabled':'onDisabled'].emit({id,name:'Edge 外观切换 - 深色主题',type:'theme'});},onEnabled:event(),onDisabled:event()},
  };
  return {api,trace,get enabled(){return enabled;},set immersive(v){immersive=v;},set activeId(v){activeId=v;},holdDiagnostics(){hold=true;},releaseDiagnostics(){hold=false;release?.();}};
}

test('本机诊断写入阻塞时仍能切换主题；前台只复核一次且保留来源保存和状态回读', async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  try {
    await import(`../packages/controller/src/service-worker.mjs?latency=${Date.now()}`);await turn();h.trace.length=0;
    h.holdDiagnostics();h.immersive=true;
    h.api.runtime.onMessage.emit({type:'edge-theme-watch-state'},{frameId:0,url:'https://www.bilibili.com/video/BVfake/',tab:{id:1}},()=>{});
    await turn();
    assert.equal(h.enabled,true,`诊断不得阻塞主题切换：${h.trace.join(' → ')}`);
    assert.equal(h.trace.filter(x=>x==='activeTab').length,1);
    assert.equal(h.trace.filter(x=>x==='window').length,1);
    assert.ok(h.trace.indexOf('ownershipWrite')<h.trace.indexOf('themeApply'));
    assert.ok(h.trace.lastIndexOf('themeReadback')>h.trace.indexOf('themeApply'));
    assert.equal(h.trace.includes('themes'),false,'已知主题仅查询当前元数据，不再枚举所有扩展');
  } finally {h.releaseDiagnostics();await turn();globalThis.chrome=old;}
});

test('缓存只保存主题身份，主题被移除或换ID后仍重新发现', async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  try {
    await import(`../packages/controller/src/service-worker.mjs?rediscover=${Date.now()}`);await turn();h.trace.length=0;
    const oldGet=h.api.management.get;
    h.api.management.get=async id=>{if(id==='dark')throw Error('removed');return {...await oldGet(id),id};};
    h.api.management.getAll=async()=>{h.trace.push('rediscover');return [{id:'replacement',type:'theme',name:'Edge 外观切换 - 深色主题',version:'1.0.0.5',enabled:false}];};
    h.immersive=true;h.api.tabs.onActivated.emit({tabId:1});await turn();
    assert.equal(h.enabled,true);assert.ok(h.trace.includes('rediscover'));
  } finally {await turn();globalThis.chrome=old;}
});

test('突发页面通知合并为一次复核，随后后台通知不覆盖前台标签', async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  try {
    await import(`../packages/controller/src/service-worker.mjs?burst=${Date.now()}`);await turn();h.trace.length=0;
    h.immersive=true;
    for(let i=0;i<100;i++) h.api.runtime.onMessage.emit({type:'edge-theme-watch-state'},
      {frameId:0,url:'https://www.bilibili.com/video/BVfake/',tab:{id:1}},()=>{});
    await turn();assert.equal(h.enabled,true);
    assert.equal(h.trace.filter(x=>x==='activeTab').length,1);
    assert.equal(h.trace.filter(x=>x==='themeApply').length,1);
    h.trace.length=0;h.activeId=2;
    h.api.tabs.onActivated.emit({tabId:2});
    h.api.runtime.onMessage.emit({type:'edge-theme-watch-state'},
      {frameId:0,url:'https://www.bilibili.com/video/BVfake/',tab:{id:1}},()=>{});
    await turn();assert.equal(h.enabled,false);
    assert.equal(h.trace.filter(x=>x==='activeTab').length,1);
  } finally {await turn();globalThis.chrome=old;}
});

test('连续切标签以执行时的当前标签为准，诊断慢也不阻塞手动操作', async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  try {
    await import(`../packages/controller/src/service-worker.mjs?manualLatency=${Date.now()}`);await turn();h.trace.length=0;
    h.immersive=true;
    h.api.tabs.onActivated.emit({tabId:1});h.activeId=2;h.api.tabs.onActivated.emit({tabId:2});
    await turn();assert.equal(h.enabled,false);assert.equal(h.trace.includes('themeApply'),false);
    h.activeId=1;h.holdDiagnostics();h.api.tabs.onActivated.emit({tabId:1});
    await turn();assert.equal(h.enabled,true);
    await Promise.all(h.api.action.onClicked.emit());
    assert.equal(h.enabled,false);
    h.api.tabs.onActivated.emit({tabId:1});await turn();assert.equal(h.enabled,false);
  } finally {h.releaseDiagnostics();await turn();globalThis.chrome=old;}
});
