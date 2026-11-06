import test from 'node:test';
import assert from 'node:assert/strict';
import {bindBusinessService} from '../../frontend/src/contracts/business.js';
import {attachGenerationTasks} from '../../frontend/src/features/generation/table_generation_tasks.mjs';
import {generationTaskSnapshots,trackTaskCompletion} from '../../frontend/src/features/generation/task_snapshots.mjs';
import {visibleTasks} from '../../frontend/src/features/tasks/creative_tasks_model.mjs';

test('confirmed local interruption becomes a short stop notification, not a paused capsule',t=>{
 let now=1000;t.mock.method(Date,'now',()=>now);
 const table={fields:[{id:'g',presentation:'generation',generation:{kind:'video'}}],records:[{id:'r',meta:{generationColumns:{g:{requestId:'request',phase:'running'}}}}]};
 const live=new Map([['request',{state:'running',phase:'running'}]]),read=trackTaskCompletion(()=>generationTaskSnapshots(table,live));
 assert.equal(read()[0].state,'running');
 live.set('request',{state:'running',phase:'interrupting',controlIntent:'interrupt'});
 assert.equal(read()[0].detail,'中止中');
 live.set('request',{state:'cancelled',phase:'interrupted',controlIntent:'interrupt',error:'interrupted_before_submit'});
 now=2000;const stopped=read()[0];
 assert.equal(stopped.state,'cancelled');assert.equal(stopped.detail,'已中止');assert.equal(stopped.done,0);assert.equal(stopped.finishedAt,2000);
 assert.match(visibleTasks([stopped],2000)[0].text,/已中止/);
 now=3000;assert.equal(read()[0].finishedAt,2000);
 assert.equal(visibleTasks(read(),6000).length,0);
 assert.equal(visibleTasks(trackTaskCompletion(()=>generationTaskSnapshots(table,live))(),6000).length,0);
});

test('mixed completed/stopped rows retain success counts, and unknown stop outcomes remain recovery',()=>{
 const source={createdAt:1,groupCount:2},table={fields:[{id:'g',presentation:'generation'}],records:['a','b'].map(id=>({id,meta:{generationColumns:{g:{requestId:id,phase:'running',source}}}}))};
 const live=new Map([['a',{phase:'complete',state:'succeeded',source}],['b',{phase:'interrupted',state:'cancelled',controlIntent:'interrupt',source}]]);
 const stopped=generationTaskSnapshots(table,live)[0];assert.equal(stopped.state,'cancelled');assert.equal(stopped.detail,'已中止');assert.equal(stopped.done,1);assert.equal(stopped.total,2);
 live.set('b',{phase:'needs_recovery',state:'unknown',error:'remote_execution_interrupted_unknown',source});
 const unknown=generationTaskSnapshots(table,live)[0];assert.equal(unknown.state,'recovery');assert.doesNotMatch(unknown.detail,/已中止|已暂停/);
 assert.match(unknown.detail,/本地执行已中断，远端结果待核实/);
 live.delete('b');table.records[1].meta.generationColumns.g.phase='interrupted';
 assert.equal(generationTaskSnapshots(table,live)[0].state,'recovery');
});

test('a pending remainder keeps the sequence stopping, while a success race stays success',()=>{
 const source={createdAt:1,groupCount:2},table={fields:[{id:'g',presentation:'generation'}],records:['a','b'].map(id=>({id,meta:{generationColumns:{g:{requestId:id,phase:'running',source}}}}))};
 const live=new Map([['a',{phase:'interrupted',state:'cancelled',source}],['b',{phase:'waiting',state:'pending',source}]]);
 const stopping=generationTaskSnapshots(table,live)[0];assert.equal(stopping.state,'running');assert.equal(stopping.detail,'中止中');
 live.set('a',{phase:'complete',state:'succeeded',controlIntent:'interrupt',source});live.set('b',{phase:'complete',state:'succeeded',source});
 const completed=generationTaskSnapshots(table,live)[0];assert.equal(completed.state,'success');assert.equal(completed.done,2);assert.doesNotMatch(completed.detail,/中止|暂停/);
});

const clone = globalThis.structuredClone.bind(globalThis);
test('four source rows remain counted across submission times including an earlier cancellation',()=>{
 const table={fields:[{id:'g',presentation:'generation',generation:{kind:'video'}}],records:['a','b','c','d'].map((id,i)=>({id,meta:{generationColumns:{g:{requestId:id,phase:i?'complete':'interrupted',state:i?'succeeded':'cancelled',source:{recordId:id,createdAt:i?20:10}}}}}))};
 const snapshot=generationTaskSnapshots(table)[0];
 assert.equal(snapshot.total,3);assert.equal(snapshot.done,3);assert.equal(snapshot.state,'success');assert.match(snapshot.detail,/其它批次 1 行/);assert.match(snapshot.detail,/已中止 1/);
});
test('reload verification of an old receipt does not announce its historical terminal result',t=>{
 t.mock.method(Date,'now',()=>9000);
 for(const [state,phase] of [['cancelled','interrupted'],['succeeded','complete']]){
  const table={fields:[{id:'g',presentation:'generation'}],records:[{id:'r',meta:{generationColumns:{g:{requestId:'old',phase:'running'}}}}]},live=new Map();
  const read=trackTaskCompletion(()=>generationTaskSnapshots(table,live));
  assert.equal(read()[0].state,'queued'); // saved active receipt, not yet checked
  live.set('old',{state,phase});
  const terminal=read()[0];assert.equal(terminal.finishedAt,undefined);assert.equal(visibleTasks([terminal],9000).length,0);
 }
});
test('a new local request can announce a stop before its first active status response',t=>{
 t.mock.method(Date,'now',()=>12000);
 const table={fields:[{id:'g',presentation:'generation'}],records:[{id:'r',meta:{generationColumns:{g:{requestId:'new',phase:'waiting'}}}}]},live=new Map(),localRequests=new Set(['new']);
 const read=trackTaskCompletion(()=>generationTaskSnapshots(table,live,localRequests));
 read();live.set('new',{state:'cancelled',phase:'interrupted'});
 assert.equal(read()[0].finishedAt,12000);
 table.records[0].meta.generationColumns.g={requestId:'different-old',phase:'running'};read();
 live.set('different-old',{state:'cancelled',phase:'interrupted'});
 assert.equal(read()[0].finishedAt,undefined);
});
test('grouped task scope reports verified aggregate progress and counts only verified success in the submitted group',()=>{
 const field={id:'image',presentation:'generation',generation:{kind:'image'}},source={createdAt:10,groupCount:2};
 const table={fields:[field],records:[
  {id:'a',meta:{generationColumns:{image:{requestId:'a',phase:'running',source,groupIndex:0}}}},
  {id:'b',meta:{generationColumns:{image:{requestId:'b',phase:'running',source,groupIndex:1}}}},
 ]},live=new Map([
  ['a',{requestId:'a',phase:'running',stage:'generating',progress:40,source}],
  ['b',{requestId:'b',phase:'running',stage:'generating',progress:20,source}],
 ]);
 const task=generationTaskSnapshots(table,live)[0];
 assert.equal(task.total,2);assert.equal(task.done,0);assert.equal(task.progress,30);
 assert.match(task.detail,/处理中 2\/2/);
 live.set('a',{requestId:'a',phase:'complete',source,result:{url:'/view?filename=a.png&type=output'}});
 const updated=generationTaskSnapshots(table,live)[0];
 assert.equal(updated.done,1);assert.equal(updated.total,2);assert.equal(updated.progress,60);
});
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
function owner(t,table,{identity,read,getArchivedRows}={}) {
 const state={table,reads:0,edits:0};
 const editor={root:{querySelectorAll:()=>[]},taskIdentity:identity,change(){state.edits++;},
  beginAsync(){throw new Error('A read-only task snapshot must not open an edit ticket');},
  canAsync(){return false;},releaseAsync(){},applyAsync(){throw new Error('A read-only task snapshot must not apply a result');}};
 const tasks=attachGenerationTasks({editor,getTable:()=>{state.reads++;return read?read(state):state.table;},getArchivedRows,notify(){}});
 t.after(()=>tasks.destroy());
 return {state,tasks};
}
test('archived submitted rows remain in progress without entering the submission table',t=>{
 const table=addLegacyGeneration(tableFixture()),archived=clone(table.records[0]);archived.id='deselected';
 archived.meta.generationColumns.image.requestId='archived-request';
 const before=JSON.stringify(table),saved=JSON.stringify(archived),o=owner(t,table,{getArchivedRows:()=>[archived,table.records[0]]});
 assert.equal(o.tasks.tasks()[0].total,2);
 assert.equal(o.tasks.projectedTable().records.length,1);
 assert.equal(JSON.stringify(table),before);assert.equal(JSON.stringify(archived),saved);assert.equal(o.state.edits,0);
});
function cloneObserver(t) {
 const values=[];
 t.mock.method(globalThis,'structuredClone',value=>{values.push(value);return clone(value);});
 return values;
}
test('host reload first projects an unverified reference, then reads its old stopped fact without notification',async t=>{
 t.mock.timers.enable({apis:['setInterval']});t.mock.method(Date,'now',()=>15000);
 const table=addLegacyGeneration(tableFixture()),identity={documentId:'reopened',tableId:'table',nodeId:'node'},source={...identity,recordId:'row',fieldId:'image',createdAt:1};
 const ref={requestId:'old-stopped',source,inputDigest:'a'.repeat(64),model:'synthetic'};
 table.records[0].meta.studioGenerationRefs={image:[ref]};
 const report={requestId:ref.requestId,source,inputFingerprint:ref.inputDigest,version:9,state:'cancelled',phase:'interrupted',controlIntent:'interrupt'};
 const calls=[];t.after(bindBusinessService('generation',{request:async action=>{calls.push(action);return {ok:true,json:async()=>({jobs:[report],nextOffset:null})};}}));
 const reopened=owner(t,table,{identity});
 assert.equal(reopened.tasks.tasks()[0].state,'recovery');
 t.mock.timers.tick(3000);await new Promise(setImmediate);
 const stopped=reopened.tasks.tasks()[0];assert.equal(stopped.state,'cancelled');assert.equal(stopped.finishedAt,undefined);assert.deepEqual(visibleTasks([stopped],15000),[]);
 assert.equal(reopened.state.edits,0);assert.ok(calls.every(action=>action==='status'));
});
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
