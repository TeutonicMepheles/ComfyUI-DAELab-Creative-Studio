import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createBusinessDocument} from '../../frontend/src/application/business_document.ts';
import {clone,SnapshotHistory} from '../../frontend/src/features/table/data_table_model.mjs';

const source=readFileSync(new URL('../../frontend/src/features/table/editor_runtime.mjs',import.meta.url),'utf8');
const syntax=ts.createSourceFile('data_table_editor.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const functions=[];
function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='change')functions.push(node);ts.forEachChild(node,visit);}
visit(syntax);assert.equal(functions.length,1,'Execute the owning change function, never a duplicate implementation');
const changeSource=functions[0].getText(syntax);
const marker='transaction-serialization-fixture';
const table=()=>({version:1,fields:[{id:'a',name:'A',type:'content',width:100},{id:'b',name:'B',type:'content',width:200}],records:[{id:'row',selected:false,values:{a:'中文 English',b:'other'},future:{retained:7}}],meta:{canvasWidth:600},future:JSON.parse('{"__proto__":{"kept":true},"nested":[null,{"raw":1}]}'),serializationMarker:marker});
const duplicate=value=>structuredClone(value);

// Count only whole-table encodings, not cell stamps or unrelated JSON. Snapshot
// replacers remain visible: this must not accidentally reward dropping validation.
function encodings(operation){
 const stringify=JSON.stringify,counts={validated:0,plain:0,total:0};
 JSON.stringify=function(value,replacer,space){
  if(value?.serializationMarker===marker&&Array.isArray(value.fields)&&Array.isArray(value.records)){counts[typeof replacer==='function'?'validated':'plain']++;counts.total++;}
  return stringify.call(this,value,replacer,space);
 };
 try{operation();return counts;}finally{JSON.stringify=stringify;}
}

function harness({native=true,content=false,validate=()=>{},removeEmpty=false,proxy=false}={}){
 let value=table(),wire='',stamp=0,before=null,active=true;
 if(proxy)value=new Proxy(value,{});
 const initial=value,events=[],undo=[],redo=[],history=new SnapshotHistory();
 const write=next=>{events.push('write');wire=JSON.stringify(next);value=next;stamp++;};
 const nativeHistory={
  begin(){events.push('history.begin');before=value;},
  end(){events.push('history.end');undo.push(before);redo.length=0;},
  amend(fn){events.push('history.amend');return fn();},
  undo(){events.push('history.undo');if(undo.length){redo.push(value);value=undo.pop();stamp++;}},
  redo(){events.push('history.redo');if(redo.length){undo.push(value);value=redo.pop();stamp++;}},
 };
 const doc=createBusinessDocument({read:()=>value,write,current:()=>active,identity:()=>({workflowSession:'session',epoch:0,documentId:'node'}),stamp:(t,target)=>target.recordId?t.records.find(r=>r.id===target.recordId):t,history:nativeHistory,historyStamp:()=>stamp});
 const root={offsetWidth:400,getBoundingClientRect(){events.push('measure.root');return {width:800};}};
 const context={width:1000,getViewport:()=>({zoom:2}),resizeWidth(width){events.push('resize:'+width);context.width=width;}};
 const shell={querySelectorAll(selector){
  if(selector==='th[data-column]')return [{dataset:{column:'a'},getBoundingClientRect(){events.push('measure.a');return {width:200};}},{dataset:{column:'b'},getBoundingClientRect(){events.push('measure.b');return {width:400};}}];
  if(selector==='tbody>tr[data-record-id]')return [{dataset:{recordId:'row'},getBoundingClientRect(){events.push('measure.row');return {height:160};}}];
  throw Error('Unexpected geometry selector: '+selector);
 }};
 // The real transaction body runs with real document/controller/history classes.
 // Only surrounding DOM callbacks/host history are injected; this is not a DOM
 // render, ComfyUI integration, or performance acceptance test.
 const env={released:false,canAsync:ticket=>doc.canApply(ticket),clone,getTable:()=>value,promptColumnsOnly:content,displayContent:()=>content,
  globalThis:{[Symbol.for('DAELAB.CreativeCanvas.API.v1')]:{getPanelContext:target=>{assert.equal(target,root);return context;}}},root,shell,
  validateChange:(old,next)=>{events.push('validate');validate(old,next);},nativeDocument:native?doc:null,history,nativeHistory,setTable:write,
  removeEmptyNode:next=>{events.push('remove-check');return removeEmpty&&!next.records.length;},
  observed:()=>events.push('observed'),render:()=>events.push('render'),updateFooter:()=>events.push('footer')};
 const change=new Function(...Object.keys(env),'return ('+changeSource+');')(...Object.values(env));
 return {change,doc,history,events,initial,context,get value(){return value;},get wire(){return wire;},get undo(){return undo;},get redo(){return redo;},write,
  nativeEdit(){value={...value,future:{...value.future,native:true}};stamp++;},detach(){active=false;}};
}

test('native table edit keeps two replacement snapshots and the required widget encodings',t=>{
 const h=harness(),before=duplicate(h.value);let retainedDraft;
 const counts=encodings(()=>h.change(next=>{retainedDraft=next;next.records[0].values.a+=' edited';},{render:false,group:'typing'}));
 t.diagnostic('whole-table encodings: '+JSON.stringify(counts));
 assert.deepEqual(counts,{validated:2,plain:3,total:5});
 assert.deepEqual(h.events,['validate','history.begin','write','observed','footer','history.end']);
 assert.equal(h.value.records[0].values.a,'中文 English edited');
 assert.deepEqual(JSON.parse(h.wire),h.value);
 assert.deepEqual(h.initial,before);
 retainedDraft.records[0].values.a='late external mutation';
 assert.equal(h.value.records[0].values.a,'中文 English edited');
 assert.equal(h.value.future.__proto__.kept,true);assert.equal(Object.hasOwn(h.value.future,'__proto__'),true);
});

test('afterWrite same-value transaction still writes and runs callbacks; no-afterWrite no-op remains a no-op',()=>{
 const h=harness();
 h.doc.edit('equal',()=>{});assert.deepEqual(h.events,[]);
 h.doc.edit('equal callback',()=>{},{afterWrite:()=>h.events.push('afterWrite')});
 assert.deepEqual(h.events,['history.begin','write','afterWrite','history.end']);
 h.events.length=0;
 h.doc.edit('changed',draft=>{draft.records[0].values.a='changed';});
 assert.deepEqual(h.events,['history.begin','write','history.end']);
});

test('native grouped input, intervening native change, undo and redo keep their boundaries',()=>{
 const h=harness();
 h.change(next=>{next.records[0].values.a='one';},{render:false,group:'typing'});
 h.change(next=>{next.records[0].values.a='two';},{render:false,group:'typing'});
 assert.equal(h.events.filter(x=>x==='history.begin').length,1);assert.equal(h.events.filter(x=>x==='history.amend').length,1);
 assert.equal(h.undo.length,1);h.doc.undo();assert.equal(h.value.records[0].values.a,'中文 English');h.doc.redo();assert.equal(h.value.records[0].values.a,'two');
 h.nativeEdit();h.change(next=>{next.records[0].values.a='three';},{render:false,group:'typing'});
 assert.equal(h.events.filter(x=>x==='history.begin').length,2);assert.equal(h.value.future.native,true);
});

test('standalone SnapshotHistory retains encodings, grouped undo/redo and native wrapper order',()=>{
 const h=harness({native:false,content:true});
 const counts=encodings(()=>h.change(next=>{next.records[0].values.a='one';},{render:false,group:'typing'}));
 assert.deepEqual(counts,{validated:0,plain:5,total:5});
 assert.deepEqual(h.events,['validate','history.begin','remove-check','write','observed','footer','history.end']);
 h.events.length=0;h.change(next=>{next.records[0].values.a='two';},{render:false,group:'typing'});
 assert.deepEqual(h.events,['validate','history.amend','remove-check','write','observed','footer']);
 assert.equal(h.history.undoStack.length,1);
 const restored=h.history.restore(JSON.stringify(h.value));assert.equal(restored.records[0].values.a,'中文 English');
 const redone=h.history.restore(JSON.stringify(restored),true);assert.equal(redone.records[0].values.a,'two');
});

test('column deletion measures before transaction and resizes after write, preserving clone isolation',()=>{
 for(const native of [true,false]){
  const h=harness({native,content:true}),before=duplicate(h.value);
  h.change(next=>{next.fields=next.fields.filter(f=>f.id!=='b');delete next.records[0].values.b;});
  assert.deepEqual(h.events,['validate','measure.root','measure.a','measure.b','measure.row','history.begin',...(native?['write','remove-check']:['remove-check','write']),'resize:800','observed','render','history.end']);
  assert.equal(h.context.width,800);assert.equal(h.value.meta.canvasWidth,800);assert.equal(h.value.fields[0].width,100);assert.equal(h.value.records[0].meta.height,80);
  assert.deepEqual(h.initial,before,'context width adjustment must not mutate original metadata');
 }
});

test('empty-node removal retains the existing native versus fallback callback ordering',()=>{
 const native=harness({native:true,content:true,removeEmpty:true});native.change(next=>{next.records=[];});
 assert.deepEqual(native.events.slice(-4),['history.begin','write','remove-check','history.end']);
 assert.equal(native.events.includes('observed'),false);assert.equal(native.events.includes('render'),false);
 const fallback=harness({native:false,content:true,removeEmpty:true});fallback.change(next=>{next.records=[];});
 assert.deepEqual(fallback.events.slice(-3),['history.begin','remove-check','history.end']);
 assert.equal(fallback.events.includes('write'),false);assert.equal(fallback.value.records.length,1);
});

test('unsupported JSON and cycles still reject before history and preserve the original',()=>{
 for(const bad of [NaN,Infinity,1n,()=>{},Symbol('bad')]){
  const h=harness(),before=duplicate(h.value);
  assert.throws(()=>h.change(next=>{next.future.bad=bad;}),TypeError);
  assert.deepEqual(h.value,before);assert.deepEqual(h.events,['validate']);
 }
 const h=harness(),before=duplicate(h.value);
 assert.throws(()=>h.change(next=>{next.future.cycle=next;}),TypeError);
 assert.deepEqual(h.value,before);assert.deepEqual(h.events,['validate']);
});

test('mutator/validation failures and stale tickets do not open history or write partial data',()=>{
 for(const failure of ['mutator','validation']){
  const h=harness({validate:()=>{if(failure==='validation')throw Error('rejected');}}),before=duplicate(h.value);
  assert.throws(()=>h.change(next=>{next.records[0].values.a='partial';if(failure==='mutator')throw Error('rejected');}),/rejected/);
  assert.deepEqual(h.value,before);assert.equal(h.events.some(x=>x.startsWith('history.')||x==='write'),false);
 }
 const h=harness();let called=false;assert.throws(()=>h.change(()=>{called=true;},{tickets:[{}]}),/输入或工作流已变化/);assert.equal(called,false);assert.deepEqual(h.events,[]);
});

test('afterWrite failure restores exact unknown JSON and does not consume the request ticket',()=>{
 const h=harness(),before=duplicate(h.value),ticket=h.doc.beginRequest('request',{recordId:'row',fieldId:'a'});
 assert.throws(()=>h.doc.controller.applyResults([ticket],'failing write',next=>{next.records[0].values.a='partial';},{afterWrite:()=>{h.events.push('afterWrite');throw Error('failed callback');}}),/failed callback/);
 assert.deepEqual(h.events,['history.begin','write','afterWrite','write','history.end']);assert.deepEqual(h.value,before);assert.equal(h.doc.canApply(ticket),true);
 assert.equal(h.doc.controller.applyResult(ticket,'retry',next=>{next.records[0].values.a='accepted';}),true);assert.equal(h.doc.canApply(ticket),false);
});

test('proxy source and retained mutation/replacement aliases remain detached JSON snapshots',()=>{
 const h=harness({proxy:true});let captured;
 h.doc.edit('capture',draft=>{captured=draft;draft.future.nested.push({unknown:'kept'});});
 captured.future.nested[1].raw=99;assert.equal(h.value.future.nested[1].raw,1);
 const replacement=duplicate(h.value);h.doc.replace(replacement);replacement.records[0].values.a='outside';assert.equal(h.value.records[0].values.a,'中文 English');
 assert.deepEqual(h.value.future.nested.at(-1),{unknown:'kept'});assert.equal(h.value.future.__proto__.kept,true);
});
