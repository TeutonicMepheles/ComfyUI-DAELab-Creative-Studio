import test from 'node:test';
import assert from 'node:assert/strict';
import {bindBusinessService} from '../../frontend/src/contracts/business.js';
import {attachGenerationTasks} from '../../frontend/src/features/generation/table_generation_tasks.mjs';

const clone = globalThis.structuredClone.bind(globalThis);
function tableFixture(label='A') {
 return {version:1,fields:[{id:'content',type:'content',generation:{kind:'image'},unknown:{keep:label}}],records:[{
  id:'row',values:{content:label,deletedField:{unknown:[label,1]}},meta:{unknown:{keep:label},
   generationColumns:{orphan:{requestId:'old-'+label,phase:'running',result:{url:'/view?filename=old.png&type=output'}}},
   studioGenerationRefs:{orphan:[{requestId:'ref-'+label,source:{recordId:'row',fieldId:'orphan'}}]}}
 }],meta:{unknown:{keep:label}}};
}
function addLegacyGeneration(table,id='image',kind='image',extra={}) {
 table.fields.push({id,type:'content',presentation:'generation',generation:{kind},...extra});
 table.records[0].meta.generationColumns[id]={requestId:'old-'+id,phase:'running'};
 return table;
}
function owner(t,table,{identity,read}={}) {
 const state={table,reads:0,edits:0};
 const editor={root:{querySelectorAll:()=>[]},taskIdentity:identity,change(){state.edits++;},
  beginAsync(){throw new Error('A read-only task snapshot must not open an edit ticket');},
  canAsync(){return false;},releaseAsync(){},applyAsync(){throw new Error('A read-only task snapshot must not apply a result');}};
 const tasks=attachGenerationTasks({editor,getTable:()=>{state.reads++;return read?read(state):state.table;},notify(){}});
 t.after(()=>tasks.destroy());
 return {state,tasks};
}
function cloneObserver(t) {
 const values=[];
 t.mock.method(globalThis,'structuredClone',value=>{values.push(value);return clone(value);});
 return values;
}
function assertRead(owner,clones,expectedClones) {
 owner.state.reads=0;clones.length=0;
 const result=owner.tasks.tasks();
 assert.equal(owner.state.reads,1,'the predicate and projection use one captured source');
 assert.equal(clones.length,expectedClones);
 if(expectedClones)assert.equal(clones[0],owner.state.table);
 return result;
}

test('two no-generation owners return empty without cloning, editing, requests or losing unknown receipts',t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const a=owner(t,tableFixture('A')),b=owner(t,tableFixture('B'));
 // A legacy-looking config and unknown presentation are not generation fields.
 b.state.table.fields[0].presentation='future-presentation';
 const beforeA=JSON.stringify(a.state.table),beforeB=JSON.stringify(b.state.table),calls=[];
 t.after(bindBusinessService('generation',{request:async action=>{calls.push(action);throw new Error('unexpected request');}}));
 const clones=cloneObserver(t);
 for(const current of [a,b,a,b])assert.deepEqual(assertRead(current,clones,0),[]);
 assert.equal(JSON.stringify(a.state.table),beforeA);assert.equal(JSON.stringify(b.state.table),beforeB);
 assert.equal(a.state.edits+b.state.edits,0);assert.deepEqual(calls,[]);
});

test('public projectedTable retains full detached projection even when no generation field exists',t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const current=owner(t,tableFixture()),before=JSON.stringify(current.state.table),clones=cloneObserver(t);
 const projected=current.tasks.projectedTable();
 assert.equal(current.state.reads,1);assert.deepEqual(clones,[current.state.table]);
 assert.notEqual(projected,current.state.table);assert.notEqual(projected.records[0],current.state.table.records[0]);
 assert.deepEqual(projected.records[0].meta.generationColumns,{});
 assert.equal(projected.records[0].meta.studioGenerationRefs.orphan[0].requestId,'ref-A');
 projected.records[0].values.content='detached edit';projected.meta.unknown.keep='changed';
 assert.equal(JSON.stringify(current.state.table),before,'public projection never changes the persisted row');
});

test('hidden, readonly and synchronized generation fields still project with separate owner clone counts',t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const table=addLegacyGeneration(addLegacyGeneration(tableFixture(),'image','image',{hidden:true}),'video','video',{readonly:true});
 table.meta.liveSource={fields:{video:'upstream-video'}};
 const a=owner(t,table),b=owner(t,tableFixture('B')),before=JSON.stringify(table),clones=cloneObserver(t);
 const snapshots=assertRead(a,clones,1);
 assert.deepEqual(snapshots.map(({id,state,total})=>({id,state,total})),[
  {id:'generation:image',state:'recovery',total:1},{id:'generation:video',state:'recovery',total:1},
 ]);
 assert.deepEqual(assertRead(b,clones,0),[]);
 assert.equal(JSON.stringify(table),before);
 assert.equal(a.state.edits+b.state.edits,0);
});

test('generation-present snapshots use the first getTable source even if a second read would differ',t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const first=addLegacyGeneration(tableFixture()),second=tableFixture('other');
 const current=owner(t,first,{read:state=>state.reads===1?first:second}),clones=cloneObserver(t);
 const snapshots=assertRead(current,clones,1);
 assert.equal(snapshots.length,1);assert.equal(snapshots[0].id,'generation:image');
 assert.equal(snapshots[0].state,'recovery');assert.equal(clones[0],first);
});

test('last-generation deletion and restored snapshot keep live completion history without reissuing work',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 let now=1000;t.mock.method(Date,'now',()=>now);
 const table=tableFixture(),identity={documentId:'document-A',tableId:'table-A',nodeId:'node-A'};
 table.fields.push({id:'image',type:'content',presentation:'generation',generation:{kind:'image'}});
 const source={...identity,recordId:'row',fieldId:'image',workflowSession:'workflow',epoch:0,inputVersion:1,
  inputDigest:'b'.repeat(64),model:'synthetic-model',createdAt:1};
 const ref={requestId:'request-A',inputDigest:source.inputDigest,source,model:source.model};
 table.records[0].meta.studioGenerationRefs={image:[ref]};
 let report={requestId:ref.requestId,source,inputFingerprint:'a'.repeat(64),version:1,state:'running',phase:'running',stage:'generating',progress:25};
 const calls=[];
 t.after(bindBusinessService('generation',{request:async(action,options)=>{
  const body=JSON.parse(options.body);calls.push({action,body});
  assert.equal(action,'status','this fixture only exercises the existing read-only poll');
  return {ok:true,json:async()=>({jobs:[report],nextOffset:null})};
 }}));
 const a=owner(t,table,{identity}),b=owner(t,addLegacyGeneration(tableFixture('B'))),clones=cloneObserver(t);
 t.mock.timers.tick(3000);await new Promise(setImmediate);
 const running=assertRead(a,clones,1)[0];assert.equal(running.state,'running');assert.equal(running.progress,25);
 assert.equal(running.finishedAt,undefined);assert.equal(assertRead(b,clones,1)[0].state,'recovery');
 now=2000;report={...report,version:2,state:'succeeded',phase:'complete',result:{url:'/view?filename=result.png&type=output'}};
 t.mock.timers.tick(3000);await new Promise(setImmediate);
 const finished=assertRead(a,clones,1)[0];assert.equal(finished.state,'success');assert.equal(finished.finishedAt,2000);
 const restored=clone(a.state.table),requestCount=calls.length;
 a.state.table=clone(restored);a.state.table.fields=a.state.table.fields.filter(field=>field.id!=='image');
 now=3000;assert.deepEqual(assertRead(a,clones,0),[]);
 // Restore the saved table snapshot as the data side of Undo; this does not claim native UI Undo coverage.
 a.state.table=clone(restored);now=4000;
 const afterRestore=assertRead(a,clones,1)[0];assert.equal(afterRestore.finishedAt,2000);assert.equal(afterRestore.state,'success');
 assert.equal(assertRead(b,clones,1)[0].finishedAt,undefined);
 assert.equal(calls.length,requestCount,'task reads do not poll, retry, recover or submit');
 assert.equal(a.state.edits+b.state.edits,0);
 assert.equal(a.state.table.records[0].meta.studioGenerationRefs.image[0].requestId,'request-A');
});

test('malformed null fields still fail instead of being silently treated as a valid no-generation table',t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const table=tableFixture();table.fields.push(null);
 const current=owner(t,table),before=JSON.stringify(table);
 assert.throws(()=>current.tasks.tasks(),TypeError);
 assert.equal(JSON.stringify(table),before);assert.equal(current.state.edits,0);
});
