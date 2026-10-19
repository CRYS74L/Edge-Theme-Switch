import assert from 'node:assert/strict';
import test from 'node:test';
import { createAutoMode } from '../packages/controller/src/auto-mode.mjs';

function harness({ dark = false, saved = {} } = {}) {
  let enabled = dark;
  let context = null;
  let data = structuredClone(saved);
  const calls = [];
  const create = () => createAutoMode({
    async load() { return structuredClone(data); },
    async save(value) { data = structuredClone(value); },
    async context() { return context; },
    async theme() { return { id: 'dark', enabled }; },
    async setTheme(theme, value) { calls.push(value); enabled = value; },
  });
  return { create, calls, setContext(value) { context = value; },
    get enabled() { return enabled; }, get saved() { return data; } };
}
const watching = (tabId = 1, episode = 'page:1') => ({ tabId, episode, immersive: true });

test('自动进入、普通标签退出、返回原视频再次进入', async () => {
  const h = harness(); const mode = h.create();
  h.setContext(watching()); await mode.reconcile();
  h.setContext(null); await mode.reconcile();
  h.setContext(watching()); await mode.reconcile();
  assert.deepEqual(h.calls, [true, false, true]);
});
test('手动开启的深色不会在退出视频时关闭', async () => {
  const h = harness({ dark: true }); const mode = h.create();
  h.setContext(watching()); await mode.reconcile();
  h.setContext(null); await mode.reconcile();
  assert.deepEqual(h.calls, []); assert.equal(h.enabled, true);
});
test('自动深色时手动关闭，本段观看期间不再自动开启，重新进入模式后恢复', async () => {
  const h = harness(); const mode = h.create();
  h.setContext(watching()); await mode.reconcile();
  await mode.manual();
  h.setContext(null); await mode.reconcile();
  h.setContext(watching()); await mode.reconcile();
  assert.deepEqual(h.calls, [true, false]);
  h.setContext(watching(1, 'page:2')); await mode.reconcile();
  assert.deepEqual(h.calls, [true, false, true]);
});
test('手动重新打开的深色取得控制权，退出后保留', async () => {
  const h = harness(); const mode = h.create();
  h.setContext(watching()); await mode.reconcile();
  await mode.manual(); await mode.manual();
  h.setContext(null); await mode.reconcile();
  assert.deepEqual(h.calls, [true, false, true]); assert.equal(h.enabled, true);
});
test('两个观看标签之间切换不闪回浅色，后台报告不会改变当前上下文', async () => {
  const h = harness(); const mode = h.create();
  h.setContext(watching()); await mode.reconcile();
  h.setContext(watching(2)); await mode.reconcile(); await mode.reconcile();
  assert.deepEqual(h.calls, [true]);
});
test('后台 worker 重建后仍能撤销自己开启的深色，保留手动抑制', async () => {
  const h = harness(); let mode = h.create();
  h.setContext(watching()); await mode.reconcile();
  mode = h.create(); h.setContext(null); await mode.reconcile();
  assert.deepEqual(h.calls, [true, false]);
  h.setContext(watching()); await mode.reconcile(); await mode.manual();
  mode = h.create(); await mode.reconcile(); assert.equal(h.enabled, false);
});
test('外部主题更改清除自动控制权，不覆盖新的手动选择', async () => {
  const h = harness(); const mode = h.create();
  h.setContext(watching()); await mode.reconcile();
  await mode.externalChange(); h.setContext(null); await mode.reconcile();
  assert.deepEqual(h.calls, [true]);
});
test('启用失败不会留下自动拥有权，也不会吞掉错误', async () => {
  let saved;
  const mode = createAutoMode({ load: async () => ({}), save: async v => { saved = structuredClone(v); },
    context: async () => watching(), theme: async () => ({enabled: false}),
    setTheme: async () => { throw new Error('blocked'); } });
  await assert.rejects(mode.reconcile(), /blocked/); assert.equal(saved.owned, false);
});

test('关闭没有手动抑制记录的后台标签不写会话；批量关闭只保存实际变化', async()=>{
  let writes=0;
  const mode=createAutoMode({load:async()=>({suppressed:{7:'page:1'}}),save:async()=>{writes++;}});
  await mode.forget(100);assert.equal(writes,0);
  await mode.forgetMany([8,9,7,10]);assert.equal(writes,1);
  await mode.forgetMany([7,8]);assert.equal(writes,1);
});

test('保存自动来源期间前台已变化，不再应用旧标签的深色并回滚拥有权',async()=>{
  let current=true;let release;let saved;const calls=[];
  const mode=createAutoMode({load:async()=>({}),theme:async()=>({enabled:false}),
    save:async value=>{saved=structuredClone(value);if(value.owned)await new Promise(resolve=>{release=resolve;});},
    setTheme:async(theme,enabled)=>calls.push(enabled),
  });
  const pending=mode.reconcile(watching(),()=>current);
  await new Promise(setImmediate);current=false;release();
  assert.equal((await pending).ignored,true);assert.deepEqual(calls,[]);assert.equal(saved.owned,false);
});
