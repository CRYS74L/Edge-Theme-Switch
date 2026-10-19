import assert from 'node:assert/strict';
import test from 'node:test';
const turn = () => new Promise(setImmediate);
function event(){const handlers=[];return {addListener(fn){handlers.push(fn);},emit(...args){return handlers.map(fn=>fn(...args));}};}
export function createLatencyChrome() {
  const trace=[];const diagnostics=[];let enabled=false;let immersive=false;let hold=false;let release;
  const theme=()=>({id:'dark',name:'Edge 外观一键切换 - 深色主题',version:'1.0.0.6',type:'theme',enabled});
  let activeId=1;
  const api={
    runtime:{getManifest:()=>({version:'1.1.0.1',host_permissions:['https://www.bilibili.com/*']}),getURL:p=>p,onStartup:event(),onInstalled:event(),onMessage:event()},
    action:{setTitle:async()=>{trace.push('title');},setIcon:async()=>{trace.push('icon');},onClicked:event()},
    windows:{getLastFocused:async()=>{trace.push('window');return {id:1};},onFocusChanged:event(),WINDOW_ID_NONE:-1},
    tabs:{query:async()=>{trace.push('activeTab');return [{id:activeId,url:activeId===1?'https://www.bilibili.com/video/BVfake/':'https://example.invalid/'}];},sendMessage:async()=>{trace.push('playerQuery');return {type:'edge-theme-watch-state',immersive,episode:'page:1'};},onActivated:event(),onUpdated:event(),onRemoved:event()},
    storage:{session:{get:async()=>{trace.push('ownershipRead');return {};},set:async()=>{trace.push('ownershipWrite');}},local:{set:async value=>{trace.push('diagnostic');diagnostics.push(structuredClone(value));if(hold)await new Promise(r=>{release=r;});}}},
    management:{getAll:async()=>{trace.push('themes');return [theme()];},get:async()=>{trace.push('themeReadback');return theme();},setEnabled:async(id,value)=>{trace.push('themeApply');enabled=value;api.management[value?'onEnabled':'onDisabled'].emit({id,name:'Edge 外观一键切换 - 深色主题',type:'theme'});},onEnabled:event(),onDisabled:event()},
  };
  return {api,trace,diagnostics,get enabled(){return enabled;},set immersive(v){immersive=v;},set activeId(v){activeId=v;},holdDiagnostics(){hold=true;},releaseDiagnostics(){hold=false;release?.();}};
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
    h.api.management.getAll=async()=>{h.trace.push('rediscover');return [{id:'replacement',type:'theme',name:'Edge 外观一键切换 - 深色主题',version:'1.0.0.6',enabled:false}];};
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

test('图标更新停滞时，退出观看和手动切换仍立即进入主题操作队列', async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  let releaseIcon;let hold=true;let appliedIcon;const icons=[];
  try {
    await import(`../packages/controller/src/service-worker.mjs?slowIcon=${Date.now()}`);await turn();h.trace.length=0;
    h.api.action.setIcon=async value=>{
      icons.push(value.path[16]);
      if(hold)await new Promise(resolve=>{releaseIcon=resolve;});
      appliedIcon=value.path[16];
    };
    h.immersive=true;h.api.tabs.onActivated.emit({tabId:1});await turn();assert.equal(h.enabled,true);
    h.activeId=2;h.api.tabs.onActivated.emit({tabId:2});await turn();
    assert.equal(h.enabled,false,'慢图标不应阻塞退出观看后的浅色恢复');
    const clicks=h.api.action.onClicked.emit();await turn();
    assert.equal(h.enabled,true,'慢图标不应阻塞用户手动切换');
    h.activeId=1;h.api.tabs.onActivated.emit({tabId:1});await turn();
    h.activeId=2;h.api.tabs.onActivated.emit({tabId:2});await turn();
    assert.equal(h.enabled,true,'手动深色仍应保留');
    hold=false;releaseIcon();await Promise.all(clicks);await turn();
    assert.equal(appliedIcon,'icons/icon-dark-16.png');
    assert.equal(icons.length,1,'最终状态与正在同步的图标相同，不追加中间状态的过期更新');
  } finally {hold=false;releaseIcon?.();await turn();globalThis.chrome=old;}
});

test('图标失败不会撤销已经成功切换的自动拥有权，后续仍可恢复浅色', async()=>{
  const old=globalThis.chrome;const oldError=console.error;const h=createLatencyChrome();globalThis.chrome=h.api;console.error=()=>{};
  try {
    await import(`../packages/controller/src/service-worker.mjs?failedIcon=${Date.now()}`);await turn();
    h.api.action.setIcon=async()=>{throw Error('icon unavailable');};
    h.immersive=true;h.api.tabs.onActivated.emit({tabId:1});await turn();assert.equal(h.enabled,true);
    h.activeId=2;h.api.tabs.onActivated.emit({tabId:2});await turn();
    assert.equal(h.enabled,false,'图标失败不应让自动深色变成无法撤销的手动深色');
  } finally {await turn();globalThis.chrome=old;console.error=oldError;}
});

test('慢图标完成后只应用最新状态，最终图标与当前浅色主题一致', async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  let releaseIcon;let hold=true;let appliedIcon;const icons=[];
  try {
    await import(`../packages/controller/src/service-worker.mjs?latestIcon=${Date.now()}`);await turn();
    h.api.action.setIcon=async value=>{icons.push(value.path[16]);if(hold)await new Promise(r=>{releaseIcon=r;});appliedIcon=value.path[16];};
    h.immersive=true;h.api.tabs.onActivated.emit({tabId:1});await turn();
    h.activeId=2;h.api.tabs.onActivated.emit({tabId:2});await turn();assert.equal(h.enabled,false);
    hold=false;releaseIcon();await turn();
    assert.equal(appliedIcon,'icons/icon-light-16.png');
    assert.deepEqual(icons,['icons/icon-dark-16.png','icons/icon-light-16.png']);
  } finally {hold=false;releaseIcon?.();await turn();globalThis.chrome=old;}
});

test('混合前后台报告的耗时只使用当前标签的事件时间戳', async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  try {
    await import(`../packages/controller/src/service-worker.mjs?timestamp=${Date.now()}`);await turn();h.immersive=true;
    h.api.runtime.onMessage.emit({type:'edge-theme-watch-state',sentAt:Date.now()-500},
      {frameId:0,url:'https://www.bilibili.com/video/BVfake/',tab:{id:1}},()=>{});
    h.api.runtime.onMessage.emit({type:'edge-theme-watch-state',sentAt:Date.now()-5},
      {frameId:0,url:'https://www.bilibili.com/video/BVfake/',tab:{id:99}},()=>{});
    await turn();const latency=h.diagnostics.findLast(v=>v.watchLatency)?.watchLatency;
    assert.ok(latency.eventToApiDoneMs>=500,'后台标签时间戳不能覆盖前台标签的测量起点');
  } finally {await turn();globalThis.chrome=old;}
});

test('旧标题失败且旧图标挂起时，不允许旧图标在最新浅色图标之后才写入', async()=>{
  const old=globalThis.chrome;const oldError=console.error;const h=createLatencyChrome();globalThis.chrome=h.api;console.error=()=>{};
  let releaseIcon;let appliedIcon;let failTitle=true;const icons=[];
  try {
    await import(`../packages/controller/src/service-worker.mjs?partialUiFailure=${Date.now()}`);await turn();
    h.api.action.setTitle=async()=>{if(failTitle){failTitle=false;throw Error('old title failed');}};
    h.api.action.setIcon=async value=>{const icon=value.path[16];icons.push(icon);if(icon.includes('icon-dark'))await new Promise(r=>{releaseIcon=r;});appliedIcon=icon;};
    h.immersive=true;h.api.tabs.onActivated.emit({tabId:1});await turn();
    h.activeId=2;h.api.tabs.onActivated.emit({tabId:2});await turn();assert.equal(h.enabled,false);
    assert.deepEqual(icons,['icons/icon-dark-16.png'],'另一项失败也必须等未完成的旧UI调用结束，避免覆盖新状态');
    releaseIcon();await turn();assert.equal(appliedIcon,'icons/icon-light-16.png');
  } finally {releaseIcon?.();await turn();globalThis.chrome=old;console.error=oldError;}
});

test('大量后台标签分批更新和关闭，不查询前台、不读主题、不反复写会话', async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  try {
    await import(`../packages/controller/src/service-worker.mjs?backgroundLoad=${Date.now()}`);await turn();h.trace.length=0;
    for(let id=100;id<200;id++){
      h.api.tabs.onUpdated.emit(id,{status:'complete'},{id,active:false,windowId:1});
      h.api.runtime.onMessage.emit({type:'edge-theme-watch-state'},
        {frameId:0,url:'https://www.bilibili.com/video/BVfake/',tab:{id,active:false,windowId:1}},()=>{});
      h.api.tabs.onRemoved.emit(id,{windowId:1,isWindowClosing:false});
      await turn();
    }
    const apiWork=h.trace.filter(v=>['window','activeTab','activeTabById','themes','themeReadback','ownershipWrite'].includes(v));
    assert.equal(apiWork.length,0,'已知后台标签的事件不应触发前台查询或无意义状态保存');
    assert.equal(h.enabled,false);
  } finally {await turn();globalThis.chrome=old;}
});

test('离开响应缓慢的播放器后，旧页面查询不能继续卡住当前标签和手动按钮', async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  let release;let clicks;
  try {
    await import(`../packages/controller/src/service-worker.mjs?stalePlayer=${Date.now()}`);await turn();
    h.api.tabs.sendMessage=()=>new Promise(resolve=>{release=()=>resolve({type:'edge-theme-watch-state',immersive:true,episode:'old:1'});});
    h.api.runtime.onMessage.emit({type:'edge-theme-watch-state'},
      {frameId:0,url:'https://www.bilibili.com/video/BVfake/',tab:{id:1,active:true,windowId:1}},()=>{});
    await turn();assert.equal(typeof release,'function');
    h.activeId=2;h.api.tabs.onActivated.emit({tabId:2,windowId:1});
    clicks=h.api.action.onClicked.emit();await turn();
    assert.equal(h.enabled,true,'已离开的旧播放器查询应取消等待，允许当前普通标签上的手动切换');
  } finally {release?.();await Promise.all(clicks||[]);await turn();globalThis.chrome=old;}
});

test('前台稳定时直接验证单个标签；切到其他应用后后台事件不能切换外观',async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  try {
    await import(`../packages/controller/src/service-worker.mjs?directForeground=${Date.now()}`);await turn();h.trace.length=0;
    h.api.tabs.get=async id=>{h.trace.push('activeTabById');return {id,active:true,windowId:1,url:'https://www.bilibili.com/video/BVfake/'};};
    h.immersive=true;h.api.tabs.onActivated.emit({tabId:1,windowId:1});await turn();
    assert.equal(h.enabled,true);assert.equal(h.trace.includes('activeTab'),false);assert.equal(h.trace.includes('window'),false);
    h.api.windows.onFocusChanged.emit(-1);h.immersive=false;h.trace.length=0;
    h.api.runtime.onMessage.emit({type:'edge-theme-watch-state'},
      {frameId:0,url:'https://www.bilibili.com/video/BVfake/',tab:{id:1,active:true,windowId:1}},()=>{});
    h.api.tabs.onUpdated.emit(1,{status:'complete'},{id:1,active:true,windowId:1});await turn();
    assert.equal(h.enabled,true);assert.equal(h.trace.length,0);
    h.api.windows.onFocusChanged.emit(1);await turn();assert.equal(h.enabled,false);
  }finally{await turn();globalThis.chrome=old;}
});

test('其他窗口活动标签不抢占当前窗口；真正切换窗口后重新发现前台',async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  try {
    await import(`../packages/controller/src/service-worker.mjs?windows=${Date.now()}`);await turn();h.trace.length=0;
    h.api.tabs.onActivated.emit({tabId:99,windowId:8});await turn();assert.equal(h.trace.length,0);
    h.api.windows.getLastFocused=async()=>({id:8});
    h.api.tabs.query=async()=>[{id:99,active:true,windowId:8,url:'https://www.bilibili.com/video/BVfake/'}];
    h.immersive=true;h.api.windows.onFocusChanged.emit(8);await turn();assert.equal(h.enabled,true);
    h.trace.length=0;h.api.tabs.onActivated.emit({tabId:1,windowId:1});
    h.api.runtime.onMessage.emit({type:'edge-theme-watch-state'},
      {frameId:0,url:'https://www.bilibili.com/video/BVfake/',tab:{id:1,active:true,windowId:1}},()=>{});
    await turn();assert.equal(h.trace.length,0);assert.equal(h.enabled,true);
  }finally{await turn();globalThis.chrome=old;}
});

test('worker在Edge不处于前台时唤醒，只保持原主题；获得焦点后才自动切换',async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  let focused=false;h.immersive=true;
  h.api.windows.getLastFocused=async()=>({id:1,focused});
  try {
    await import(`../packages/controller/src/service-worker.mjs?unfocusedWake=${Date.now()}`);await turn();
    assert.equal(h.enabled,false,'非前台唤醒不应因为上一次浏览器标签仍在观看模式而切换主题');
    focused=true;h.api.windows.onFocusChanged.emit(1);await turn();assert.equal(h.enabled,true);
  }finally{await turn();globalThis.chrome=old;}
});

test('恢复焦点时一次未聚焦快照不能永久停用后续页面检测',async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  let focused=true;
  h.api.windows.getLastFocused=async()=>({id:1,focused});
  try {
    await import(`../packages/controller/src/service-worker.mjs?focusSnapshot=${Date.now()}`);await turn();
    h.api.windows.onFocusChanged.emit(-1);focused=false;
    h.api.windows.onFocusChanged.emit(1);await turn();
    focused=true;h.immersive=true;
    h.api.runtime.onMessage.emit({type:'edge-theme-watch-state'},
      {frameId:0,url:'https://www.bilibili.com/video/BVfake/',tab:{id:1,active:true,windowId:1}},()=>{});
    await turn();assert.equal(h.enabled,true,'瞬时未聚焦不能形成必须重载才解除的停用状态');
  }finally{await turn();globalThis.chrome=old;}
});

test('两个工作区恢复焦点时使用事件指定窗口，不被另一个工作区的最近窗口快照误导',async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  try {
    await import(`../packages/controller/src/service-worker.mjs?focusWindow=${Date.now()}`);await turn();
    h.api.windows.onFocusChanged.emit(-1);
    h.api.windows.getLastFocused=async()=>({id:1,focused:false});
    h.api.windows.get=async id=>({id,focused:true,type:'normal'});
    h.api.tabs.query=async query=>[{id:query.windowId===8?99:2,active:true,windowId:query.windowId,
      url:query.windowId===8?'https://www.bilibili.com/video/BVfake/':'https://example.invalid/'}];
    h.immersive=true;h.api.windows.onFocusChanged.emit(8);await turn();
    assert.equal(h.enabled,true,'应识别恢复焦点的第二工作区当前播放器');
  }finally{await turn();globalThis.chrome=old;}
});

test('页面焦点通知可补救漏掉的窗口焦点事件，但在其他应用前台时不能切换主题',async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  let focused=false;
  h.api.windows.get=async id=>({id,focused,type:'normal'});
  try {
    await import(`../packages/controller/src/service-worker.mjs?focusRecovery=${Date.now()}`);await turn();
    h.api.windows.onFocusChanged.emit(-1);h.immersive=true;
    const notify=()=>h.api.runtime.onMessage.emit({type:'edge-theme-watch-state'},
      {frameId:0,url:'https://www.bilibili.com/video/BVfake/',tab:{id:1,active:true,windowId:1}},()=>{});
    notify();await turn();assert.equal(h.enabled,false,'后台窗口自己的活动标签不等于前台标签');
    focused=true;notify();await turn();assert.equal(h.enabled,true,'无需重载即可通过已核验的页面焦点事件恢复');
    h.immersive=false;notify();await turn();assert.equal(h.enabled,false);
  }finally{await turn();globalThis.chrome=old;}
});

test('旧工作区的慢焦点核验完成后不能覆盖新工作区',async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  let release;
  try {
    await import(`../packages/controller/src/service-worker.mjs?staleFocus=${Date.now()}`);await turn();
    h.api.windows.onFocusChanged.emit(-1);
    h.api.windows.get=async id=>id===1?await new Promise(r=>{release=()=>r({id,focused:true,type:'normal'});}):{id,focused:true,type:'normal'};
    h.api.tabs.query=async query=>[{id:query.windowId===8?99:1,active:true,windowId:query.windowId,
      url:query.windowId===8?'https://example.invalid/':'https://www.bilibili.com/video/BVfake/'}];
    h.immersive=true;h.api.tabs.onActivated.emit({tabId:1,windowId:1});await turn();
    h.api.windows.onFocusChanged.emit(8);await turn();release();await turn();
    assert.equal(h.enabled,false,'已失效的窗口核验不得把旧工作区恢复成前台');
    h.api.tabs.onActivated.emit({tabId:99,windowId:8});await turn();assert.equal(h.enabled,false);
  }finally{release?.();await turn();globalThis.chrome=old;}
});

test('切入观看页和切回普通页都从标签激活事件开始计时，普通页也保留有效起点',async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  try {
    await import(`../packages/controller/src/service-worker.mjs?activationTiming=${Date.now()}`);await turn();
    h.activeId=2;h.api.tabs.onActivated.emit({tabId:2,windowId:1});await turn();
    const start=Date.now();h.activeId=1;h.immersive=true;
    h.api.tabs.onActivated.emit({tabId:1,windowId:1});await turn();
    const entering=h.diagnostics.findLast(v=>v.watchLatency)?.watchLatency;
    assert.equal(entering.enabled,true);assert.ok(entering.eventAt>=start,'切标签没有页面报告时仍需测量调度等待');
    h.activeId=2;h.api.tabs.onActivated.emit({tabId:2,windowId:1});await turn();
    const leaving=h.diagnostics.findLast(v=>v.watchLatency)?.watchLatency;
    assert.equal(leaving.enabled,false);assert.ok(Number.isFinite(leaving.eventAt));
    assert.ok(Number.isFinite(leaving.eventToApiDoneMs));
  }finally{await turn();globalThis.chrome=old;}
});

test('同标签的新报告取消旧查询后，仍保留首次激活时间而非只计最后一轮',async()=>{
  const old=globalThis.chrome;const h=createLatencyChrome();globalThis.chrome=h.api;
  let release;let first=true;
  try {
    await import(`../packages/controller/src/service-worker.mjs?canceledTiming=${Date.now()}`);await turn();
    h.api.tabs.sendMessage=async()=>{
      if(first){first=false;await new Promise(r=>{release=r;});}
      return {type:'edge-theme-watch-state',immersive:true,episode:'page:1'};
    };
    h.api.tabs.onActivated.emit({tabId:1,windowId:1});await turn();
    await new Promise(resolve=>setTimeout(resolve,30));
    const reportedAt=Date.now();h.api.runtime.onMessage.emit({type:'edge-theme-watch-state',sentAt:reportedAt},
      {frameId:0,url:'https://www.bilibili.com/video/BVfake/',tab:{id:1,active:true,windowId:1}},()=>{});
    await turn();assert.equal(h.enabled,true);
    const latency=h.diagnostics.findLast(v=>v.watchLatency)?.watchLatency;
    assert.ok(latency.eventAt<=reportedAt-20,'被取消轮次中的等待也属于用户看到的切换延迟');
  }finally{release?.();await turn();globalThis.chrome=old;}
});
