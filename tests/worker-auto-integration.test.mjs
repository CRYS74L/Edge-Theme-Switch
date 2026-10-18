import assert from 'node:assert/strict';
import test from 'node:test';
const url = new URL('../packages/controller/src/service-worker.mjs', import.meta.url);
const event = () => { const listeners=[]; return {addListener(fn){listeners.push(fn);},emit(...args){return listeners.map(fn=>fn(...args));},listeners}; };
const settle = () => new Promise(setImmediate);
test('实际 worker 事件链：页面报告、标签切换、手动按钮和 worker 重建', async () => {
  const old = globalThis.chrome; let enabled=false; let active={id:1,url:'https://www.bilibili.com/video/BVfake/',immersive:false,episode:'one:1'};
  const session={},local={},calls=[];
  const chrome = {
    action:{setIcon:async()=>{},setTitle:async()=>{},onClicked:event()},
    storage:{session:{get:async key=>({[key]:session[key]}),set:async value=>Object.assign(session,structuredClone(value))},local:{set:async value=>Object.assign(local,structuredClone(value))}},
    runtime:{getManifest:()=>({version:'1.1.0.1',host_permissions:['https://www.bilibili.com/*']}),getURL:p=>p,onStartup:event(),onInstalled:event(),onMessage:event()},
    management:{getAll:async()=>[{id:'dark',type:'theme',name:'Edge 外观切换 - 深色主题',version:'1.0.0.5',enabled}],get:async()=>({enabled}),
      setEnabled:async(id,value)=>{enabled=value;calls.push(value);chrome.management[value?'onEnabled':'onDisabled'].emit({id,type:'theme',name:'Edge 外观切换 - 深色主题'});},onEnabled:event(),onDisabled:event()},
    windows:{getLastFocused:async()=>({id:7}),onFocusChanged:event(),WINDOW_ID_NONE:-1},
    tabs:{query:async()=>[active],sendMessage:async()=>({type:'edge-theme-watch-state',immersive:active.immersive,episode:active.episode}),onActivated:event(),onUpdated:event(),onRemoved:event()},
  };
  globalThis.chrome=chrome;
  try {
    await import(`${url.href}?integration=${Date.now()}`);
    await settle();
    active={id:2,url:'https://example.invalid/'};
    chrome.runtime.onMessage.emit({type:'edge-theme-watch-state',immersive:true},
      {frameId:0,url:'https://www.bilibili.com/video/BVfake/',tab:{id:1}},()=>{});
    chrome.tabs.onUpdated.emit(1,{status:'complete'});
    chrome.tabs.onActivated.emit({tabId:99,windowId:8});
    await settle();
    assert.deepEqual(calls,[], '后台视频和其他窗口标签均不能触发深色');
    active={id:1,url:'https://www.bilibili.com/video/BVfake/',immersive:false,episode:'one:1'};
    active.immersive=true;
    let ack;
    chrome.runtime.onMessage.emit({type:'edge-theme-watch-state'},{frameId:0,url:active.url,tab:{id:1}},v=>{ack=v;});await settle();
    assert.equal(ack.ok,true);assert.deepEqual(calls,[true]);assert.equal(local.watchLastError,null);
    active={id:2,url:'https://example.invalid/'};chrome.tabs.onActivated.emit({tabId:2});await settle();assert.deepEqual(calls,[true,false]);
    active={id:1,url:'https://www.bilibili.com/video/BVfake/',immersive:true,episode:'one:1'};chrome.tabs.onActivated.emit({tabId:1});await settle();
    await chrome.action.onClicked.listeners[0]();assert.equal(enabled,false);
    chrome.tabs.onActivated.emit({tabId:1});await settle();assert.equal(enabled,false);
    active.episode='one:2';chrome.tabs.onActivated.emit({tabId:1});await settle();assert.equal(enabled,true);
    assert.equal(session.watchAutoMode.owned,true);
    assert.equal(local.watchLastError,null);
  } finally {globalThis.chrome=old;}
});
