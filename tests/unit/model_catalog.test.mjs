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

test('DeepSeek remains selectable but unverified without a key and becomes available after safe capability discovery',async()=>{
 const catalog=createModelCatalog();
 assert.equal((await catalog.check('deepseek-flash',async()=>({available:true,provider:'deepseek',deepseekKeyConfigured:false}))).status,MODEL_STATUS.unverified);
 assert.equal(catalog.get('deepseek-flash').selectable,true);
 const ready=await catalog.check('deepseek-flash',async()=>({available:true,provider:'deepseek',deepseekKeyConfigured:true}),{force:true});
 assert.equal(ready.status,MODEL_STATUS.available);
 assert.equal(catalog.get('deepseek-flash').capability.deepseekKeyConfigured,true);
});

test('catalog filtering and invalidation keep logical identities while rebuilding readiness',async()=>{
 const catalog=createModelCatalog(),probes=[];
 await catalog.refresh(async model=>{probes.push(model.id);return {available:true};},{filters:{family:'optimization'}});
 assert.deepEqual(probes,['deepseek-flash','qwen3.5:9b-q4_K_M','gpt-6-luna']);
 assert.equal(catalog.snapshot({family:'optimization'}).every(model=>model.status==='available'),true);
 const invalidated=catalog.invalidate({family:'optimization'});
 assert.equal(invalidated.every(model=>model.status==='unverified'&&model.capability===null),true);
 assert.equal(catalog.snapshot({family:'generation'}).length,11);
});
test('backend-provided definitions replace hardcoded identities without carrying stale capability',()=>{
 const catalog=createModelCatalog();
 const entries=catalog.replaceDefinitions([{id:'backend-only',label:'Backend Only',family:'generation',kind:'image',provider:'local'}]);
 assert.deepEqual(entries.map(item=>[item.id,item.status,item.available,item.selectable]),[['backend-only','unverified',false,true]]);
 assert.equal(catalog.replaceDefinitions([{id:'technical-id',family:'optimization',kind:'text',provider:'qwen'}])[0].label,'未知模型');
});
test('provider change for the same logical id clears stale availability and capability',async()=>{
 const catalog=createModelCatalog();
 await catalog.check('deepseek-flash',async()=>({available:true,provider:'deepseek',deepseekKeyConfigured:true}));
 assert.equal(catalog.get('deepseek-flash').status,'available');
 const changed=catalog.replaceDefinitions([{id:'deepseek-flash',label:'Server LLM',family:'optimization',kind:'text',provider:'qwen'}])[0];
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
