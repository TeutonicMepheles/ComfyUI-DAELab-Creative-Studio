import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createBusinessDocument} from '../../frontend/src/application/business_document.ts';
import {clone,SnapshotHistory,setValue} from '../../frontend/src/features/table/data_table_model.mjs';
import {captureEmptyRowStateScope} from '../../frontend/src/features/table/empty_row_state_scope.ts';

const source=fs.readFileSync(new URL('../../frontend/src/features/table/data_table_editor.mjs',import.meta.url),'utf8');
const syntax=ts.createSourceFile('data_table_editor.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),found=[];
function visit(n){if(ts.isFunctionDeclaration(n)&&['change','changeCell'].includes(n.name?.text))found.push(n);ts.forEachChild(n,visit);}visit(syntax);
assert.equal(found.length,2);
const body=found.map(n=>n.getText(syntax)).join('\n');

const marker='table-copy-boundary-local';
const table=()=>({version:1,fields:[{id:'a',type:'content',name:'A',width:100},{id:'b',type:'content',name:'B',width:200}],records:[{id:'r',selected:false,values:{a:'before',b:'peer'},unknown:{keep:[1,null]}},{id:'s',selected:false,values:{a:'other',b:'peer2'}}],meta:{material_columns:true},unknown:JSON.parse('{"__proto__":{"kept":1},"nested":[null,{"future":true}]}'),serializationMarker:marker});
function harness({value=table(),native=true,content=true,validate=()=>{},empty=()=>true,after=()=>{},failWrite=false}={}){
 const initial=value,events=[],scopes=[],undo=[],redo=[];let before,stamp=0,current=true,throwNextWrite=failWrite,retainedWrite;
 const write=next=>{events.push('write');retainedWrite=next;if(throwNextWrite){throwNextWrite=false;next.records[0].values.a='write-partial';throw Error('write-failed');}JSON.stringify(next);value=next;stamp++;};
 const history={begin(){events.push('begin');before=value;},end(){events.push('end');undo.push(before);redo.length=0;},amend(fn){events.push('amend');return fn();},undo(){if(undo.length){redo.push(value);value=undo.pop();stamp++;}},redo(){if(redo.length){undo.push(value);value=redo.pop();stamp++;}}};
 const doc=createBusinessDocument({read:()=>value,write,current:()=>current,identity:()=>({workflowSession:'local',epoch:0,documentId:'node'}),history,historyStamp:()=>stamp});
 const context={width:1000,getViewport:()=>({}),resizeWidth:w=>{context.width=w;events.push('resize');}},root={offsetWidth:400,getBoundingClientRect:()=>({width:800})};
 const env={released:false,canAsync:ticket=>doc.canApply(ticket),clone,getTable:()=>value,promptColumnsOnly:content,displayContent:()=>content,
  globalThis:{[Symbol.for('DAELAB.CreativeCanvas.API.v1')]:{getPanelContext:()=>context}},root,
  shell:{querySelectorAll:s=>s.startsWith('th')?[{dataset:{column:'a'},getBoundingClientRect:()=>({width:200})},{dataset:{column:'b'},getBoundingClientRect:()=>({width:400})}]:[{dataset:{recordId:'r'},getBoundingClientRect:()=>({height:160})}]},
  validateChange:(old,next)=>{events.push('validate');validate(old,next);},nativeDocument:native?doc:null,history:new SnapshotHistory(),nativeHistory:history,setTable:write,removeEmptyNode:()=>false,
  observed:()=>{events.push('observe');after(value);},render:()=>events.push('render'),updateFooter:scope=>{events.push('footer');scopes.push(scope);},captureEmptyRowStateScope,isRowStateEmpty:empty,stateRows:new Map(),stateTable:{}};
 const owner=new Function(...Object.keys(env),body+'\nreturn {change,changeCell};')(...Object.values(env));
 const cell={dataset:{record:'r',field:'a'}};
 return {initial,events,scopes,doc,context,undo,redo,get value(){return value;},get retainedWrite(){return retainedWrite;},edit(fn,options={}){return owner.changeCell(cell,fn,{render:false,group:'typing',...options});},general:owner.change,detach(){current=false;}};
}

test('two instances, unknown JSON keys and leaked drafts remain detached',()=>{
 const a=harness(),b=harness();const before=clone(a.value);let draft;
 a.edit(t=>{draft=t;setValue(t,'r','a','accepted');});assert.equal(a.value.records[0].values.a,'accepted');assert.equal(b.value.records[0].values.a,'before');assert.deepEqual(a.initial,before);
 draft.records[0].values.a='late';draft.unknown.nested[1].future=false;assert.equal(a.value.records[0].values.a,'accepted');assert.equal(a.value.unknown.nested[1].future,true);assert.equal(a.value.unknown.__proto__.kept,1);assert.ok(Object.hasOwn(a.value.unknown,'__proto__'));
});
test('mutator and validation failure preserve current and leave history unopened',()=>{
 for(const where of ['mutator','validation']){const h=harness({validate:()=>{if(where==='validation')throw Error('invalid');}}),before=clone(h.value);assert.throws(()=>h.edit(t=>{t.records[0].values.a='draft';if(where==='mutator')throw Error('invalid');}),/invalid/);assert.deepEqual(h.value,before);assert.equal(h.events.includes('begin'),false);}
});
test('real replacement snapshots restore original after write or afterWrite failure',()=>{
 for(const where of ['write','after']){const h=harness({failWrite:where==='write',after:()=>{if(where==='after')throw Error('after-failed');}}),before=clone(h.value);assert.throws(()=>h.edit(t=>{t.records[0].values.a='draft';}),/failed/);assert.deepEqual(h.value,before);assert.deepEqual(h.initial,before);assert.deepEqual(h.events.slice(-1),['end']);}
});
test('grouping, undo/redo and another instance keep independent values',()=>{
 const a=harness(),b=harness();a.edit(t=>{t.records[0].values.a='one';});a.edit(t=>{t.records[0].values.a='two';});b.edit(t=>{t.records[0].values.a='B';});assert.equal(a.undo.length,1);assert.equal(a.events.filter(x=>x==='amend').length,1);a.doc.undo();assert.equal(a.value.records[0].values.a,'before');assert.equal(b.value.records[0].values.a,'B');a.doc.redo();assert.equal(a.value.records[0].values.a,'two');
});
test('width synchronization and structural edits retain detached previous metadata',()=>{
 for(const native of [true,false]){const value=table();value.meta.canvasWidth=600;const h=harness({value,native});h.edit(t=>{t.records[0].values.a='edit';});assert.equal(h.value.meta.canvasWidth,1000);assert.equal(h.initial.meta.canvasWidth,600);h.general(t=>{t.fields=t.fields.filter(f=>f.id!=='b');for(const row of t.records)delete row.values.b;});assert.equal(h.value.meta.canvasWidth,800);assert.equal(h.initial.meta.canvasWidth,600);}
});
test('undefined source JSON normalizes, while nonfinite source and mutated invalid values fail before native history',()=>{
 const value=table();value.unknown.optional=undefined;value.unknown.array=[undefined,null];const h=harness({value});h.edit(t=>{t.records[0].values.a='ok';});assert.equal(Object.hasOwn(h.value.unknown,'optional'),false);assert.deepEqual(h.value.unknown.array,[null,null]);
 const invalidSource=table();invalidSource.unknown.number=NaN;const invalid=harness({value:invalidSource});assert.throws(()=>invalid.edit(t=>{t.records[0].values.a='draft';}),TypeError);assert.equal(invalid.events.includes('begin'),false);assert.ok(Number.isNaN(invalid.value.unknown.number));
 for(const bad of [NaN,Infinity,1n,()=>{},Symbol('bad')]){const h=harness(),before=clone(h.value);assert.throws(()=>h.edit(t=>{t.unknown.bad=bad;}),TypeError);assert.deepEqual(h.value,before);assert.equal(h.events.includes('begin'),false);}
});
test('a scoped empty-state provider cannot acquire the live previous table',()=>{
 let captured;const h=harness({empty:t=>{captured??=t;return true;}});h.edit(t=>{t.records[0].values.a='one';});assert.notEqual(captured,h.initial,'previous must remain a detached snapshot across provider callbacks');captured.records[0].values.a='provider-late-mutation';assert.equal(h.initial.records[0].values.a,'before');h.doc.undo();assert.equal(h.value.records[0].values.a,'before');
});
test('JSON toJSON boundary still supplies serialized previous metadata to empty-row scope',()=>{
 const value=table();value.meta.liveOnly=true;Object.defineProperty(value,'toJSON',{value(){const {toJSON,...copy}=this;return {...copy,meta:{material_columns:true}};},enumerable:false});
 const h=harness({value});h.edit(t=>{t.records[0].values.a='ok';});assert.equal(h.value.meta.liveOnly,undefined);assert.ok(h.scopes[0],'matching serialized before/next metadata should retain scoped state');assert.equal(h.scopes[0].recordId,'r');
});
test('retained rollback before is stable even when write mutates incoming next before throwing',()=>{
 const h=harness({failWrite:true}),before=clone(h.value);assert.throws(()=>h.edit(t=>{t.records[0].values.a='draft';}),/write-failed/);assert.deepEqual(h.value,before);assert.notEqual(h.value,h.initial);assert.equal(h.value.unknown.__proto__.kept,1);
});
test('render, derived and width-sync edits retain their fallback encoding and effects',()=>{
 for(const mode of ['render','derived','width']){
  const value=table();if(mode==='width')value.meta.canvasWidth=600;
  const h=harness({value}),stringify=JSON.stringify;let plain=0;
  JSON.stringify=function(v,replacer,space){if(v?.serializationMarker===marker&&typeof replacer!=='function')plain++;return stringify.call(this,v,replacer,space);};
  try{h.edit(t=>{t.records[0].values.a='fallback';},mode==='render'?{render:true}:mode==='derived'?{derived:true}:{});}finally{JSON.stringify=stringify;}
  assert.equal(plain,3);assert.equal(h.value.records[0].values.a,'fallback');assert.equal(h.initial.records[0].values.a,'before');
  if(mode==='render')assert.ok(h.events.includes('render'));
  if(mode==='derived'){assert.ok(h.events.includes('amend'));assert.equal(h.events.includes('begin'),false);}
  if(mode==='width'){assert.equal(h.value.meta.canvasWidth,1000);assert.equal(h.initial.meta.canvasWidth,600);}
 }
});
test('private cell result tickets retain validation, consume-on-success and stale rejection',()=>{
 const h=harness(),ticket=h.doc.beginRequest('accepted',{recordId:'r',fieldId:'a'});
 h.edit(t=>{t.records[0].values.a='result';},{tickets:[ticket]});assert.equal(h.value.records[0].values.a,'result');assert.equal(h.initial.records[0].values.a,'before');assert.equal(h.doc.canApply(ticket),false);
 const before=clone(h.value),events=h.events.length;let mutated=false;
 assert.throws(()=>h.edit(()=>{mutated=true;},{tickets:[ticket]}),/输入或工作流已变化/);assert.equal(mutated,false);assert.deepEqual(h.value,before);assert.equal(h.events.length,events);
});
test('500x10 owner input reports encoding count without treating it as latency',t=>{
 const workflow=JSON.parse(fs.readFileSync(new URL('../fixtures/performance/FX-PERF-M-no-video.json',import.meta.url),'utf8'));const node=workflow.nodes.find(n=>n.type==='DAELAB.Table');const value=node.widgets_values.map(x=>{try{return JSON.parse(x);}catch{return null;}}).find(x=>x?.records?.length===500);assert.equal(value.fields.length,10);value.serializationMarker=marker;value.records[0].id='r';
 const h=harness({value});const stringify=JSON.stringify;const counts={plain:0,validated:0};JSON.stringify=function(v,replacer,space){if(v?.serializationMarker===marker&&Array.isArray(v.records))counts[typeof replacer==='function'?'validated':'plain']++;return stringify.call(this,v,replacer,space);};
 try{h.edit(t=>{t.records[0].values['field-00']='P';});}finally{JSON.stringify=stringify;}
 assert.equal(h.value.records[0].values['field-00'],'P');assert.equal(h.value.records.length,500);assert.equal(h.value.fields.length,10);assert.equal(counts.validated,2,'do not remove transaction validation snapshots');assert.equal(counts.plain,2,'reuse only the encoded editor snapshot; keep separate previous/next objects and the widget write');t.diagnostic(JSON.stringify({wholeTableEncodings:counts,actualPerformance:false}));
});
