import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelCatalog,MODEL_STATUS} from '../../frontend/src/features/models/model_catalog.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('model catalog coalesces checks and publishes selectable, checking, unverified and unavailable states',async()=>{
 const logs=[],catalog=createModelCatalog({now:()=>Date.parse('2026-11-02T00:00:00Z'),log:value=>logs.push(value)}),gate=deferred(),seen=[];
 catalog.subscribe(value=>seen.push(value.map(model=>[model.id,model.status])));
 const first=catalog.check('Qwen-Image-2.1 Turbo（本地）',async()=>gate.promise),second=catalog.check('Qwen-Image-2.1 Turbo（本地）',async()=>{throw new Error('duplicate probe');});
 assert.equal(first,second);
 assert.equal(catalog.get('Qwen-Image-2.1 Turbo（本地）').status,MODEL_STATUS.checking);
 assert.equal(catalog.get('Qwen-Image-2.1 Turbo（本地）').selectable,false);
 gate.resolve({available:true,provider:'local'});
 await first;
 assert.equal(catalog.get('Qwen-Image-2.1 Turbo（本地）').status,MODEL_STATUS.available);
 const failed=await catalog.check('Qwen-Image-2.1 Turbo（本地）',async()=>{const error=new Error('path secret');error.code='provider_unavailable';throw error;},{force:true});
 assert.equal(failed.status,MODEL_STATUS.unavailable);
 assert.equal(failed.selectable,false);
 assert.equal(JSON.stringify(logs).includes('path secret'),false);
 assert.deepEqual(logs[0],{version:1,provider:'local',model:'Qwen-Image-2.1 Turbo（本地）',stage:'probe',code:'provider_unavailable',time:'2026-11-02T00:00:00.000Z'});
 assert.ok(seen.some(value=>value.some(([id,status])=>id==='Qwen-Image-2.1 Turbo（本地）'&&status==='checking')));
});

test('retired DeepSeek is absent and cannot be probed or reintroduced',()=>{
 const catalog=createModelCatalog();assert.equal(catalog.get('deepseek-flash'),null);assert.throws(()=>catalog.check('deepseek-flash',()=>{throw Error('must not probe');}));
 catalog.replaceDefinitions([{id:'deepseek-flash',family:'optimization',kind:'text',provider:'deepseek'}]);assert.equal(catalog.snapshot().length,0);
});

test('catalog filtering and invalidation keep logical identities while rebuilding readiness',async()=>{
 const catalog=createModelCatalog(),probes=[];
 await catalog.refresh(async model=>{probes.push(model.id);return {available:true};},{filters:{family:'optimization'}});
 assert.deepEqual(probes,['qwen3.8-27b-w4a8','qwen-image-2.1-pe','qwen3.5:9b-q4_K_M','gpt-6-luna']);
 assert.equal(catalog.snapshot({family:'optimization'}).every(model=>model.status==='available'),true);
 const invalidated=catalog.invalidate({family:'optimization'});
 assert.equal(invalidated.every(model=>model.status==='unverified'&&model.capability===null),true);
 const generation=catalog.snapshot({family:'generation'});assert.equal(generation.length,14);
 assert.equal(generation.some(model=>['MiniMax H3 FL（本地）','MiniMax H3 Ref（本地）'].includes(model.id)),false);
 assert.equal(generation[0].id,'Qwen-Image-2.1 Turbo（本地）');
 for(const id of ['MiniMax H3 FL 低配（本地）','MiniMax H3 Ref 低配（本地）','MiniMax H3 FL 高配（本地）','MiniMax H3 Ref 高配（本地）'])assert.ok(generation.some(model=>model.id===id));
});
test('backend-provided definitions replace hardcoded identities without carrying stale capability',()=>{
 const catalog=createModelCatalog();
 const entries=catalog.replaceDefinitions([{id:'backend-only',label:'Backend Only',family:'generation',kind:'image',provider:'local'}]);
 assert.deepEqual(entries.map(item=>[item.id,item.status,item.available,item.selectable]),[['backend-only','unverified',false,true]]);
 assert.equal(catalog.replaceDefinitions([{id:'technical-id',family:'optimization',kind:'text',provider:'qwen'}])[0].label,'未知模型');
});
test('provider change for the same logical id clears stale availability and capability',async()=>{
 const catalog=createModelCatalog();
 await catalog.check('gpt-6-luna',async()=>({available:true,provider:'comfy'}));
 assert.equal(catalog.get('gpt-6-luna').status,'available');
 const changed=catalog.replaceDefinitions([{id:'gpt-6-luna',label:'Server LLM',family:'optimization',kind:'text',provider:'qwen'}])[0];
 assert.deepEqual([changed.status,changed.capability,changed.available,changed.selectable],['unverified',null,false,true]);
});
test('non-capability probe results are rejected as unavailable and never become available',async()=>{
 const logs=[],catalog=createModelCatalog({log:value=>logs.push(value)});
 for(const value of [undefined,null,{},()=>{},[]]){
  const result=await catalog.check('Qwen-Image-2.1 Turbo（本地）',async()=>value,{force:true});
  assert.deepEqual([result.status,result.available,result.selectable],['unavailable',false,false]);
 }
 assert.ok(logs.every(item=>item.code==='invalid_model_capability'));
});
test('a probe that never answers stays unknown and retryable instead of unavailable', async () => {
  const catalog = createModelCatalog();
  const timeout = Object.assign(new Error('probe timed out'), {name: 'AbortError', code: 'probe_timeout'});
  await catalog.refresh(async () => { throw timeout; }, {filters: {family: 'generation'}});
  const entries = catalog.snapshot({family: 'generation'});
  assert.equal(entries.every(entry => entry.status === 'unknown'), true);
  assert.equal(entries.every(entry => entry.selectable === false), true);
  await catalog.refresh(async () => { throw Object.assign(new Error('missing binding'),{code:'provider_unavailable'}); }, {filters: {family: 'generation'}, force: true});
  assert.equal(catalog.snapshot({family: 'generation'}).every(entry => entry.status === 'unavailable'), true);
});
test('a timed-out probe is rechecked a bounded number of times and then stops', async () => {
  const catalog = createModelCatalog({recheckDelays: [1, 1]});
  let calls = 0;
  const probe = async () => {
    calls += 1;
    throw Object.assign(new Error('probe timed out'), {name: 'AbortError',code:'probe_timeout'});
  };
  await catalog.refresh(probe, {filters: {family: 'generation'}});
  const first = catalog.snapshot({family: 'generation'});
  assert.equal(first.every(entry => entry.status === 'unknown'), true);
  assert.equal(first.every(entry => entry.code === 'probe_timeout'), true);
  const initial = calls;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(calls > initial, true, 'a bounded recheck must run');
  // Every model in the family gets at most 1 probe + 2 bounded rechecks.
  assert.equal(calls <= initial * 3, true, 'rechecks must stop after the configured budget');
  assert.equal(catalog.snapshot({family: 'generation'}).every(entry => entry.status === 'unknown'), true);
});