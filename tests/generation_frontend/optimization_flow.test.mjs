import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessDocument} from '../../web/application/business_document.js';
import {tableInputStamp} from '../../web/integrations/comfyui/business/business_document_host.js';
import {createOptimizationController} from '../../web/features/prompt/prompt_optimization_controller.mjs';
import {OptimizationRevisions} from '../../web/features/prompt/prompt_optimization_model.mjs';
const flush=()=>new Promise(setImmediate);
function fixture(t,persistRequests=false){
 let table={fields:[{id:'prompt',type:'text',name:'提示词'}],records:[{id:'row',values:{prompt:'合成旧输入'}}],meta:{}},epoch=0,steps=0,batch,lastIntent;const history=[],calls=[],hooks={};
 const native=createBusinessDocument({read:()=>table,write:value=>{table=value;},stamp:tableInputStamp,current:()=>true,identity:()=>({workflowSession:'workflow',epoch,documentId:'node'}),history:{begin(){steps++;history.push(structuredClone(table));},end(){},amend(fn){fn();},undo(){table=history.pop();},redo(){}}});
 const api={capabilities:async()=>({available:true,models:['qwen3.5:9b-q4_K_M']}),estimate:async()=>{await hooks.estimate?.();return {status:'ready',quoteId:'quote',expiresAt:Date.now()+60000,budgetUpperCredits:0};},lease:async()=>({leaseId:'lease'}),submit:async payload=>{calls.push('submit');lastIntent=structuredClone(payload);await hooks.submit?.();batch={...payload,paused:true,rows:payload.rows.map(row=>({...row,status:'succeeded',suggestion:{status:'valid',text:'合成优化结果'}}))};return structuredClone(batch);},recover:async()=>{calls.push('recover');await hooks.recover?.();return structuredClone(batch);},query:async()=>structuredClone(batch)};
 api.fence=async payload=>{calls.push('fence');return {batchId:payload.batchId,rows:payload.references.map(row=>({...row,snapshot:{snapshotDigest:row.source.inputDigest},status:'skipped',replacementAllowed:true,source:row.source}))};};
 const controller=createOptimizationController({getTable:()=>table,identity:{documentId:'document',tableId:'table'},revisions:new OptimizationRevisions(),persist(){},change:fn=>native.edit('编辑',fn),api,scope:'cell',fieldId:'prompt',recordId:'row',...(persistRequests?{persistIntent:ref=>native.edit('保存请求引用',table=>{table.meta.studioOptimizationRequests||=[];table.meta.studioOptimizationRequests.push(ref);})}:{}),edits:{begin:(target,id)=>native.beginRequest(id,target),can:native.canApply,release:native.releaseRequest,apply:(tickets,fn)=>{if(!native.controller.applyResults(tickets,'审阅应用',fn))throw Error('stale');}}});
 t.after(()=>{controller.destroy();native.dispose();});
 return {controller,native,api,hooks,calls,get table(){return table;},get steps(){return steps;},get batch(){return batch;},switch(){epoch++;}};
}
test('actual optimization applies a scoped suggestion once; undo changes content without changing durable success',async t=>{
 const f=fixture(t);await flush();await f.controller.estimate();await f.controller.submit();assert.equal(f.controller.getState().rows[0].canApply,true);await f.controller.applyAll();assert.equal(f.steps,1);assert.equal(f.table.records[0].values.prompt,'合成优化结果');
 f.native.undo();f.controller.observe();assert.equal(f.table.records[0].values.prompt,'合成旧输入');assert.equal(f.batch.rows[0].status,'succeeded');await f.controller.applyAll();assert.equal(f.steps,1);
});
test('actual optimization late completion after workflow switch remains review-only',async t=>{
 const f=fixture(t);let release;f.hooks.submit=()=>new Promise(resolve=>{release=resolve;});await flush();await f.controller.estimate();const pending=f.controller.submit();while(!release)await flush();f.switch();release();await pending;
 assert.equal(f.controller.getState().rows[0].canApply,false);await f.controller.applyAll();assert.equal(f.steps,0);assert.equal(f.table.records[0].values.prompt,'合成旧输入');assert.equal(f.batch.rows[0].status,'succeeded');
});
test('estimate started in an old workflow cannot become a new submit after the response arrives',async t=>{
 const f=fixture(t);let release;f.hooks.estimate=()=>new Promise(resolve=>{release=resolve;});await flush();const pending=f.controller.estimate();while(!release)await flush();f.switch();release();await pending;await f.controller.submit();assert.deepEqual(f.calls,[]);assert.equal(f.steps,0);
});

test('missing optimization batch remains locked until explicit identity-checked fence',async t=>{
 const f=fixture(t);f.hooks.submit=()=>{throw Error('synthetic lost reply');};await flush();await f.controller.estimate();await f.controller.submit();assert.ok(f.controller.getState().batchId);assert.equal(f.controller.getState().permissions.canEstimate,false);
 f.api.recover=async()=>{throw Object.assign(Error('Optimization batch was not found.'),{status:404,code:'record_not_found'});};f.api.query=async()=>({batches:[]});
 await f.controller.recover();await f.controller.estimate();await f.controller.submit();assert.ok(f.controller.getState().batchId);assert.equal(f.controller.getState().permissions.canEstimate,false);assert.equal(f.controller.getState().permissions.canFence,true);assert.equal(f.steps,0);assert.deepEqual(f.calls,['submit']);await f.controller.fenceOriginalBatch();assert.equal(f.controller.getState().batchId,null);assert.equal(f.controller.getState().permissions.canEstimate,true);
 delete f.hooks.submit;await f.controller.estimate();await f.controller.submit();assert.deepEqual(f.calls,['submit','fence','submit']);
});

test('wrong-scope fence response and active winner both preserve the original optimization lock',async t=>{
 const f=fixture(t);f.hooks.submit=()=>{throw Error('unknown reply');};await flush();await f.controller.estimate();await f.controller.submit();const id=f.controller.getState().batchId;
 f.api.recover=async()=>{throw Object.assign(Error('missing'),{status:404,code:'record_not_found'});};await f.controller.recover();
 const fence=f.api.fence;f.api.fence=async intent=>{const value=await fence(intent);value.rows[0].source={...value.rows[0].source,nodeId:'other-node'};return value;};await f.controller.fenceOriginalBatch();assert.equal(f.controller.getState().batchId,id);assert.equal(f.controller.getState().permissions.canEstimate,false);
 f.api.fence=async intent=>{const value=await fence(intent);value.rows[0].replacementAllowed=false;value.rows[0].status='submitting';return value;};await f.controller.fenceOriginalBatch();await f.controller.estimate();await f.controller.submit();assert.equal(f.calls.filter(call=>call==='submit').length,1);assert.equal(f.controller.getState().batchId,id);assert.equal(f.steps,0);
});

test('persisted optimization intent excludes input and keeps a remounted controller locked until durable fencing',async t=>{
 const f=fixture(t,true);f.hooks.submit=()=>{throw Error('unknown ACK');};await flush();await f.controller.estimate();await f.controller.submit();
 assert.deepEqual(f.calls,['submit']);const saved=f.table.meta.studioOptimizationRequests[0];assert.ok(saved.references[0].source.inputDigest);assert.equal(JSON.stringify(saved).includes('合成旧输入'),false);assert.equal(f.steps,1);
 const remounted=fixture(t);remounted.controller.restoreIntent(saved);remounted.api.recover=async()=>{throw Object.assign(Error('missing'),{status:404,code:'record_not_found'});};await remounted.controller.recover(saved.batchId);await remounted.controller.estimate();await remounted.controller.submit();assert.equal(remounted.calls.includes('submit'),false);assert.equal(remounted.controller.getState().permissions.canFence,true);
 await remounted.controller.fenceOriginalBatch();assert.equal(remounted.controller.getState().batchId,null);assert.equal(remounted.controller.getState().permissions.canEstimate,true);assert.equal(saved.references.length,1);
});

test('saving the real submit reference preserves the freshly issued result edit ticket',async t=>{
 const f=fixture(t,true);await flush();await f.controller.estimate();await f.controller.submit();assert.deepEqual(f.calls,['submit']);assert.equal(f.controller.getState().rows[0].canApply,true);await f.controller.applyAll();assert.equal(f.table.records[0].values.prompt,'合成优化结果');assert.equal(f.steps,2);
});
