import test from 'node:test';
import assert from 'node:assert/strict';
import '../migrated_business/register.mjs';

const {createBusinessDocument}=await import('../../frontend/src/application/business_document.ts');
const {DocumentController}=await import('../../frontend/src/application/document_controller.ts');
const {snapshotJson}=await import('../../frontend/src/contracts/json_snapshot.ts');
const initial=()=>JSON.parse('{"fields":[{"id":"text","future":{"keep":true}}],"records":[{"id":"a","values":{"text":"original"}},{"id":"b","values":{"text":"peer"}}],"meta":{"future":[null,false]},"__proto__":{"opaque":true},"future":{"__proto__":{"nested":true}}}');
const copy=value=>JSON.parse(JSON.stringify(value));
function reactive(value,cache=new WeakMap()){
 if(!value||typeof value!=='object')return value;
 if(!cache.has(value))cache.set(value,new Proxy(value,{get(target,key,receiver){return reactive(Reflect.get(target,key,receiver),cache);}}));
 return cache.get(value);
}
function harness({value=initial(),proxy=false,writeFailure=false}={}){
 let state=value,active=true,before,stamp=0,failWrite=writeFailure;
 const events=[],undo=[],redo=[];
 const history={begin(){events.push('begin');before=copy(state);},end(){events.push('end');undo.push(before);redo.length=0;},
  amend(fn){events.push('amend');return fn();},undo(){events.push('undo');if(undo.length){redo.push(copy(state));state=undo.pop();stamp++;}},
  redo(){events.push('redo');if(redo.length){undo.push(copy(state));state=redo.pop();stamp++;}}};
 const doc=createBusinessDocument({read:()=>proxy?reactive(state):state,current:()=>active,
  write(next){events.push('write');state=next;stamp++;if(failWrite){failWrite=false;next.records[0].values.text='partial write';throw Error('write failed');}},
  identity:()=>({workflowSession:'test-workflow',documentId:'table',epoch:0}),
  stamp:(table,target)=>target.recordId?table.records.find(row=>row.id===target.recordId)?.values:table,
  history,historyStamp:()=>stamp});
 return {doc,events,undo,redo,original:value,get value(){return state;},detach(){active=false;},external(next){state=next;stamp++;}};
}

test('prepared edits isolate previous, draft, committed native data and opaque JSON keys',()=>{
 const a=harness({proxy:true}),b=harness(),original=copy(a.value);let old,draft;
 a.doc.editPrepared('input',(previous,next)=>{
  a.events.push('prepare');old=previous;draft=next;
  previous.records[0].values.text='tampered previous';previous.future.__proto__.nested=false;
  assert.equal(next.records[0].values.text,'original');assert.equal(next.future.__proto__.nested,true);
  next.records[0].values.text='accepted';
 },{group:'input',afterWrite:()=>a.events.push('after')});
 assert.deepEqual(a.events,['prepare','begin','write','after','end']);
 assert.deepEqual(a.original,original);assert.deepEqual(b.value,original);
 assert.equal(a.value.records[0].values.text,'accepted');assert.equal(Object.hasOwn(a.value,'__proto__'),true);
 assert.equal(a.value.__proto__.opaque,true);assert.equal(a.value.future.__proto__.nested,true);
 old.records[0].values.text='late old';draft.records[0].values.text='late draft';draft.fields[0].future.keep=false;
 assert.equal(a.value.records[0].values.text,'accepted');assert.equal(a.value.fields[0].future.keep,true);
});

test('prepare or validation failure occurs before host history and preserves pending requests',()=>{
 for(const mode of ['prepare','validation']){
  const h=harness(),ticket=h.doc.beginRequest('pending',{recordId:'a'}),before=copy(h.value);
  assert.throws(()=>h.doc.editPrepared('rejected',(previous,draft)=>{
   previous.records[0].values.text='old changed';draft.records[0].values.text='draft';
   if(mode==='prepare')throw Error('prepare failed');
   draft.future.invalid=Infinity;
  }),mode==='prepare'?/prepare failed/:TypeError);
  assert.deepEqual(h.events,[]);assert.deepEqual(h.value,before);assert.equal(h.doc.canApply(ticket),true);
 }
});

test('invalid native JSON rejects before preparation without opening host history',()=>{
 for(const bad of [NaN,Infinity,-Infinity,1n,()=>{},Symbol('bad')]){
  const value=initial();value.future.invalid=bad;const h=harness({value,proxy:true});let called=false;
  assert.equal(typeof h.doc.editPrepared,'function');
  assert.throws(()=>h.doc.editPrepared('invalid',()=>{called=true;}),TypeError);
  assert.equal(called,false);assert.deepEqual(h.events,[]);assert.equal(h.value,value);
 }
 const value=initial();value.future.cycle=value;const h=harness({value});
 assert.throws(()=>h.doc.editPrepared('cycle',()=>{}),TypeError);assert.deepEqual(h.events,[]);
});

test('invalid prepared values and cycles cannot escape final JSON validation',()=>{
 for(const bad of [NaN,Infinity,-Infinity,1n,()=>{},Symbol('bad')]){
  const h=harness(),before=copy(h.value);
  assert.equal(typeof h.doc.editPrepared,'function');
  assert.throws(()=>h.doc.editPrepared('invalid',(_previous,draft)=>{draft.future.invalid=bad;}),TypeError);
  assert.deepEqual(h.value,before);assert.deepEqual(h.events,[]);
 }
 const h=harness();assert.throws(()=>h.doc.editPrepared('cycle',(_previous,draft)=>{draft.future.cycle=draft;}),TypeError);
 assert.deepEqual(h.events,[]);
});

test('native JSON omissions and a once-read toJSON boundary feed independent preparation copies',()=>{
 const value=initial();value.future.omitted=undefined;value.future.array=[undefined,null,false];let calls=0;
 Object.defineProperty(value,'toJSON',{value(){calls++;return {...this,meta:{serialized:true}};}});
 const h=harness({value,proxy:true});
 h.doc.editPrepared('normalize',(previous,draft)=>{
  assert.deepEqual(previous.meta,{serialized:true});assert.deepEqual(draft.meta,{serialized:true});
  assert.equal(Object.hasOwn(previous.future,'omitted'),false);assert.deepEqual(draft.future.array,[null,null,false]);
  previous.meta.serialized=false;assert.equal(draft.meta.serialized,true);draft.records[0].values.text='P';
 });
 assert.equal(calls,2,'one preparation capture and the harness native history snapshot each serialize the live source once');
 assert.deepEqual(h.value.meta,{serialized:true});assert.equal(h.value.records[0].values.text,'P');
});

test('private rollback survives retained preparation references and a write that mutates then throws',()=>{
 const h=harness({writeFailure:true}),before=copy(h.value);let old,draft;
 assert.throws(()=>h.doc.editPrepared('failed',(previous,next)=>{
  old=previous;draft=next;previous.records[0].values.text='not rollback';next.records[0].values.text='intended';
 }),/write failed/);
 assert.deepEqual(h.value,before);assert.deepEqual(h.original,before);assert.deepEqual(h.events,['begin','write','write','end']);
 old.future.__proto__.nested=false;draft.future.__proto__.nested=false;
 assert.equal(h.value.future.__proto__.nested,true);
});

test('afterWrite failure rolls back independently, keeps unchanged input request usable, then permits retry',()=>{
 const h=harness({proxy:true}),before=copy(h.value),ticket=h.doc.beginRequest('pending',{recordId:'a'});let retained;
 assert.throws(()=>h.doc.editPrepared('failed',(previous,draft)=>{retained=previous;previous.records[0].values.text='poison';draft.records[0].values.text='new';},
  {group:'typing',afterWrite:()=>{h.events.push('after');throw Error('after failed');}}),/after failed/);
 assert.deepEqual(h.value,before);assert.equal(h.doc.canApply(ticket),true);
 assert.deepEqual(h.events,['begin','write','after','write','end']);retained.meta.future.push('late');assert.deepEqual(h.value.meta.future,[null,false]);
 h.events.length=0;h.doc.editPrepared('retry',(_previous,draft)=>{draft.records[0].values.text='accepted';},{group:'typing'});
 assert.deepEqual(h.events,['begin','write','end']);assert.equal(h.doc.canApply(ticket),false);
});

test('grouped edits, external native actions, undo and redo preserve boundaries',()=>{
 const h=harness();h.doc.editPrepared('one',(_previous,draft)=>{draft.records[0].values.text='one';},{group:'typing'});
 h.doc.editPrepared('two',(_previous,draft)=>{draft.records[0].values.text='two';},{group:'typing'});
 assert.deepEqual(h.events,['begin','write','end','amend','write']);assert.equal(h.undo.length,1);
 h.doc.undo();assert.equal(h.value.records[0].values.text,'original');h.doc.redo();assert.equal(h.value.records[0].values.text,'two');
 h.external({...h.value,nativeUnknown:{kept:true}});h.events.length=0;
 h.doc.editPrepared('three',(_previous,draft)=>{draft.records[0].values.text='three';},{group:'typing'});
 assert.deepEqual(h.events,['begin','write','end']);assert.deepEqual(h.value.nativeUnknown,{kept:true});
});

test('no-op, afterWrite and derived projections retain existing commit behavior',()=>{
 const h=harness();h.doc.editPrepared('noop',()=>{});assert.deepEqual(h.events,[]);
 h.doc.editPrepared('after',()=>{},{afterWrite:()=>h.events.push('after')});assert.deepEqual(h.events,['begin','write','after','end']);
 h.events.length=0;h.doc.editPrepared('derived',(_previous,draft)=>{draft.records[1].values.text='projection';},{derived:true});
 assert.deepEqual(h.events,['amend','write']);
});

test('nested derived work stays inside its owner history and outer rollback restores original',()=>{
 for(const fail of [false,true]){
  const h=harness(),before=copy(h.value);
  const run=()=>h.doc.editPrepared('outer',(_previous,draft)=>{draft.records[0].values.text='outer';},{afterWrite:()=>{
   h.doc.editPrepared('derived',(_previous,draft)=>{draft.records[1].values.text='inner';},{derived:true});
   if(fail)throw Error('outer after failed');
  }});
  if(fail){assert.throws(run,/outer after failed/);assert.deepEqual(h.value,before);assert.deepEqual(h.events,['begin','write','amend','write','write','end']);}
  else {run();assert.equal(h.value.records[0].values.text,'outer');assert.equal(h.value.records[1].values.text,'inner');assert.deepEqual(h.events,['begin','write','amend','write','end']);h.doc.undo();assert.deepEqual(h.value,before);}
 }
});

test('prepared row edits preserve unrelated tickets and invalidate changed targets and tickets after undo',()=>{
 const a=harness(),b=harness(),ticket=a.doc.beginRequest('same',{recordId:'a'}),peer=b.doc.beginRequest('same',{recordId:'a'});
 a.doc.editPrepared('other row',(_previous,draft)=>{draft.records[1].values.text='other';});assert.equal(a.doc.canApply(ticket),true);
 a.doc.editPrepared('target',(_previous,draft)=>{draft.records[0].values.text='target';});assert.equal(a.doc.canApply(ticket),false);assert.equal(b.doc.canApply(peer),true);
 assert.equal(b.doc.canApply(ticket),false);a.doc.undo();assert.equal(a.value.records[0].values.text,'original');assert.equal(a.doc.canApply(ticket),false);
});

test('detach and disposal reject preparation before callbacks or history access',()=>{
 for(const mode of ['detach','dispose']){
  const h=harness();if(mode==='detach')h.detach();else h.doc.dispose();let called=false;
  assert.throws(()=>h.doc.editPrepared('late',()=>{called=true;}),mode==='detach'?/失效/:/released/);
  assert.equal(called,false);assert.deepEqual(h.events,[]);assert.deepEqual(h.value,initial());
 }
});

test('a session invalidated by preparation cannot open history or commit',()=>{
 const h=harness(),before=copy(h.value);
 assert.throws(()=>h.doc.editPrepared('detached',(_previous,draft)=>{draft.records[0].values.text='late';h.detach();}),/失效/);
 assert.deepEqual(h.events,[]);assert.deepEqual(h.value,before);
});

test('controller forwards the optional capability with receiver/options and blocks disposed access',()=>{
 const prepare=()=>{},settings={group:'owned'},calls=[];
 const port={read:initial,identity:()=>({workflowSession:'s',documentId:'n',epoch:0}),revision:()=>0,
  transact(){throw Error('wrong path');},transactPrepared(label,fn,options){assert.equal(this,port);calls.push({label,fn,options});}};
 const c=new DocumentController(port);c.editPrepared('prepared',prepare,settings);assert.deepEqual(calls,[{label:'prepared',fn:prepare,options:settings}]);
 c.dispose();Object.defineProperty(port,'transactPrepared',{get(){throw Error('disposed touched port');}});assert.throws(()=>c.editPrepared('late',prepare),/released/);
});

test('legacy ports use their transaction owner and isolate the preparation previous value',()=>{
 let value=initial(),before,after;const events=[],port={read:()=>value,identity:()=>({workflowSession:'s',documentId:'n',epoch:0}),revision:()=>0,
  transact(label,fn,options){events.push({label,options});const draft=snapshotJson(value);fn(draft);value=snapshotJson(draft);}};
 const c=new DocumentController(port);c.editPrepared('legacy',(previous,draft)=>{before=previous;after=draft;previous.records[0].values.text='poison';assert.equal(draft.records[0].values.text,'original');draft.records[0].values.text='accepted';},{group:'legacy'});
 assert.equal(value.records[0].values.text,'accepted');before.records[0].values.text='late';after.records[0].values.text='late';assert.equal(value.records[0].values.text,'accepted');
 assert.deepEqual(events,[{label:'legacy',options:{group:'legacy'}}]);assert.equal(Object.hasOwn(value,'__proto__'),true);
});
