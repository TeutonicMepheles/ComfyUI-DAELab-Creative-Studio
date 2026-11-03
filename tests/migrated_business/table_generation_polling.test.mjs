import {bindBusinessService} from '../../frontend/src/contracts/business.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {attachGenerationTasks} from '../../frontend/src/features/generation/table_generation_tasks.mjs';

test('an exhausted original request stays readable without sending recover or a new submit',async t=>{
 const stable={documentId:'doc',tableId:'table',nodeId:'node'},source={...stable,recordId:'r',fieldId:'g'},inputDigest='a'.repeat(64);
 const ref={requestId:'original',source,inputDigest,model:'GPT Image 2'};
 const table={fields:[{id:'g',presentation:'generation',readonly:true}],meta:{},records:[{id:'r',values:{},meta:{studioGenerationRefs:{g:[ref]}}}]};
 const report={requestId:'original',source,inputFingerprint:inputDigest,version:9,state:'unknown',phase:'needs_recovery',error:'remote_execution_interrupted_unknown',recovery:{available:false,reason:'recovery_limit_reached',message:'原任务核对次数已用尽，远端结果仍待确认',attempts:3,limit:3}};
 const calls=[],notices=[];
 t.after(bindBusinessService('generation',{request:async action=>{calls.push(action);return {ok:true,json:async()=>({jobs:[report]})};}}));
 const tasks=attachGenerationTasks({getTable:()=>table,editor:{taskIdentity:stable,nativeDocument:{},root:{querySelectorAll:()=>[]}},notify:message=>notices.push(message)});
 t.after(()=>tasks.destroy());
 await tasks.generate('g','r',true);
 assert.deepEqual(calls,['status']);
 assert.equal(tasks.stateFor(table.records[0],'g').error,'remote_execution_interrupted_unknown');
 assert.equal(tasks.stateFor(table.records[0],'g').recovery.attempts,3);
 assert.deepEqual(notices,[report.recovery.message]);
});

test('synchronized and orphaned receipts never poll or create history edits; owning columns still recover',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const ref=(fieldId,requestId)=>({requestId,source:{recordId:'r',fieldId}});
 const calls=[],table={fields:[{id:'copy',presentation:'generation',readonly:true},{id:'owned',presentation:'generation',readonly:true}],meta:{liveSource:{fields:{copy:'upstream'}}},records:[{id:'r',values:{},meta:{studioGenerationRefs:{orphan:[ref('orphan','upstream-missing')],copy:[ref('copy','upstream-copy')],owned:[ref('owned','own')]},generationColumns:{orphan:{phase:'complete',requestId:'upstream-missing'},copy:{phase:'running',requestId:'upstream-copy'},owned:{phase:'running',requestId:'own'}}}}]};
 t.after(bindBusinessService('generation',{request:async(_action,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({jobs:[]})};}}));
 let edits=0;const tasks=attachGenerationTasks({getTable:()=>table,editor:{root:{querySelectorAll:()=>[]},change(){edits++;}},notify(){}});t.after(()=>tasks.destroy());
 t.mock.timers.tick(3000);await new Promise(setImmediate);
 assert.deepEqual(calls,[{contractVersion:1,requestIds:['own']}]);assert.equal(edits,0);
 table.fields=table.fields.filter(f=>f.id!=='owned');t.mock.timers.tick(3000);await new Promise(setImmediate);
 assert.equal(calls.length,1);assert.equal(edits,0);assert.equal(table.records[0].meta.generationColumns.orphan.phase,'complete');
});
