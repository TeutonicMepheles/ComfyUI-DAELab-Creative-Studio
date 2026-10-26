import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {Element,installDom} from './prompt_optimization_dom.mjs';
import {attachPromptOptimization} from '../../frontend/src/features/prompt/prompt_optimization_controller.mjs';
import {OptimizationRevisions,NAMESPACE} from '../../frontend/src/features/prompt/prompt_optimization_model.mjs';
import {createBusinessDocument} from '../../frontend/src/application/business_document.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
async function until(predicate){const deadline=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<deadline,'async operation did not complete');await nextTurn();}}
const find=(root,predicate)=>predicate(root)?root:root.children.map(child=>find(child,predicate)).find(Boolean);
const makeTable=(rows=2,columns=2)=>({fields:Array.from({length:columns},(_,i)=>({id:`f${i}`,name:`字段 ${i}`,type:'text'})),records:Array.from({length:rows},(_,i)=>({id:`r${i}`,values:Object.fromEntries(Array.from({length:columns},(_,j)=>[`f${j}`,`合成 ${i}/${j}`]))})),meta:{}});

function setup(t){
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const doc=installDom(t),cleanups=[],observations=[];
 const original=OptimizationRevisions.prototype.observe;
 t.mock.method(OptimizationRevisions.prototype,'observe',function(table){
  const before=this.entries.size;const result=original.call(this,table);
  observations.push({table,registry:this,before,after:this.entries.size});return result;
 });
 t.after(()=>{for(const cleanup of cleanups.reverse())cleanup();doc.restore();});
 return {doc,cleanups,observations};
}

// Real attach, composer, API encoding, native document writes and revision model.
// The DOM double renders one anchor; data still includes every 500 x 10 target.
// Tickets intentionally remain admissible so ABA tests cannot pass via a second
// native-ticket guard while accidentally omitting optimization revision checks.
function mounted(t,env,{table=makeTable(),discovery=null,recover=null}={}){
 const graph={},identity={documentId:crypto.randomUUID(),tableId:crypto.randomUUID()},root=new Element('div'),anchor=new Element('td');
 const node={id:identity.tableId,graph,mode:0,properties:{[NAMESPACE]:{tableId:identity.tableId,revisions:{},batches:[]}}};
 anchor.dataset={field:'f0',record:'r0'};root.append(anchor);root.querySelectorAll=()=>[anchor];env.doc.body.append(root);
 const observers=new Set(),calls=[],tickets=[],batches=new Map();let tableReads=0,disposed=false;
 const native=createBusinessDocument({read:()=>table,write:value=>{table=value;},current:()=>node.graph===graph,
  identity:()=>({workflowSession:'workflow',epoch:0,documentId:identity.documentId}),history:{begin(){},end(){},amend:fn=>fn(),undo(){},redo(){}}});
 const editor={root,nativeDocument:native,beginAsync(target,requestId){const ticket={...target,requestId};tickets.push(ticket);return ticket;},canAsync:()=>true,releaseAsync(){},
  change(fn,options){native.edit('合成编辑',fn,options);for(const observer of observers)observer();},
  applyAsync(_tickets,fn){editor.change(fn);return true;},onTableChange(fn){observers.add(fn);return()=>observers.delete(fn);}};
 const fetchApi=async(url,options)=>{
  const action=url.split('/').at(-1),payload=JSON.parse(options.body);calls.push({action,payload});let result;
  if(action==='query')result=discovery?await discovery.promise:{batches:[]};
  else if(action==='capabilities')result={available:true,models:['qwen3.5:9b-q4_K_M']};
  else if(action==='estimate')result={status:'ready',quoteId:crypto.randomUUID(),provider:'qwen',budgetUpperCredits:0,expiresAt:Date.now()+60000};
  else if(action==='lease')result={leaseId:crypto.randomUUID()};
  else if(action==='submit'){
   result={...payload,paused:true,rows:payload.rows.map(row=>({...row,status:'succeeded',suggestion:{status:'valid',text:row.snapshot.input.prompt_text+'。简洁表达。'}}))};batches.set(payload.batchId,result);
  }else if(action==='recover')result=recover?await recover.promise:batches.get(payload.batchId)||{batchId:payload.batchId,rows:[],paused:true};
  else throw new Error(`Unexpected provider action: ${action}`);
  return {ok:true,json:async()=>result};
 };
 const lifecycle=attachPromptOptimization({node,graph,editor,getTable:()=>{tableReads++;return table;},identity,fetchApi});
 function destroy(){if(disposed)return;disposed=true;lifecycle.destroy();native.dispose();root.remove();}
 env.cleanups.push(destroy);
 const open=()=>{editor.openPromptOptimization({scope:'cell',fieldId:'f0',recordId:'r0',anchor});return env.doc.body.children.find(child=>child.id===anchor.getAttribute('aria-controls'));};
 return {node,editor,lifecycle,calls,tickets,identity,open,destroy,observers,
  get table(){return table;},get reads(){return tableReads;},
  edit(fn){editor.change(fn);},async ready(popover){await until(()=>{const start=find(popover,e=>e.getAttribute('aria-label')==='开始改写');return start&&!start.disabled&&calls.some(call=>call.action==='estimate');});await flush();},
  async submit(popover){const start=find(popover,e=>e.getAttribute('aria-label')==='开始改写');assert.equal(start.disabled,false);await start.onclick({preventDefault(){},stopPropagation(){}});t.mock.timers.tick(0);await flush();}
 };
}

test('two unused 500 x 10 attachments never passively observe, read or persist revisions',async t=>{
 const env=setup(t),a=mounted(t,env,{table:makeTable(500,10)}),b=mounted(t,env,{table:makeTable(500,10)});await flush();
 const savedA=structuredClone(a.node.properties),savedB=structuredClone(b.node.properties);
 a.edit(table=>{table.records[0].values.f0='先改 A';});b.edit(table=>{table.records[499].values.f9='先改 B';});
 const reads=[a.reads,b.reads];a.lifecycle.observe();b.lifecycle.observe();a.lifecycle.pause();b.lifecycle.pause();
 assert.equal(env.observations.length,0,'No controller/request exists to consume a passive revision scan');
 assert.deepEqual([a.reads,b.reads],reads);assert.deepEqual(a.node.properties,savedA);assert.deepEqual(b.node.properties,savedB);
 assert.deepEqual(a.calls.map(call=>call.action),['query']);assert.deepEqual(b.calls.map(call=>call.action),['query']);
});

test('first open fully initializes current 5000 targets and permanently enables only its owner',async t=>{
 const env=setup(t),a=mounted(t,env,{table:makeTable(500,10)}),b=mounted(t,env,{table:makeTable(500,10)});await flush();
 a.edit(table=>{table.records[0].values.f0='打开前最新值';});a.edit(table=>{table.records[0].values.f0='最后当前值';});
 const popover=a.open();await a.ready(popover);
 const first=env.observations[0];assert.equal(first.before,0);assert.equal(first.after,5000);
 assert.equal(a.calls.find(call=>call.action==='estimate').payload.rows[0].input.prompt_text,'最后当前值');
 assert.equal(a.calls.find(call=>call.action==='estimate').payload.rows[0].revision,1);
 const before=env.observations.length;a.lifecycle.pause();const afterPause=env.observations.length;
 assert.ok(afterPause>before);a.edit(table=>{table.records[0].values.f0='关闭后仍观察';});assert.equal(env.observations.length,afterPause+2,'Outer and existing controller both retain their original full observe');
 const afterA=env.observations.length;b.edit(table=>{table.records[0].values.f0='B 仍未启用';});b.lifecycle.observe();assert.equal(env.observations.length,afterA);
 a.open();await flush();assert.equal(new Set(env.observations.map(item=>item.registry)).size,1,'Reopening retains one registry');
});

test('a synchronous obtain construction failure still permanently enables observation',async t=>{
 const env=setup(t),f=mounted(t,env);await flush();const failure=new Error('synthetic construction preferences failure');
 Object.defineProperty(f.node.properties[NAMESPACE],'preferences',{configurable:true,get(){throw failure;}});
 assert.throws(()=>f.open(),error=>error===failure);delete f.node.properties[NAMESPACE].preferences;
 f.lifecycle.pause();assert.equal(env.observations.length,0);
 f.lifecycle.observe();assert.equal(env.observations.length,1,'Activation precedes argument evaluation, not successful construction');
 assert.equal(env.observations[0].after,4);
 f.edit(table=>{table.records[0].values.f0='failed attempt remains enabled';});assert.equal(env.observations.length,2);
 const popover=f.open();await f.ready(popover);assert.equal(env.observations[2].before,4);
});

test('late local ledger recovery activates full observation of current values without submitting',async t=>{
 const env=setup(t),discovery=deferred(),recovery=deferred(),f=mounted(t,env,{discovery,recover:recovery});
 f.edit(table=>{table.records[0].values.f0='ledger arrives after edit';});f.lifecycle.observe();assert.equal(env.observations.length,0);
 discovery.resolve({batches:[{batchId:'saved-batch',scope:'cell',fieldId:'f0',recordId:'r0'}]});await flush();
 assert.ok(f.calls.some(call=>call.action==='recover'));assert.equal(env.observations[0].before,0);assert.equal(env.observations[0].after,4);
 assert.match(env.observations[0].registry.read('r0','f0').stamp,/ledger arrives after edit/);
 f.edit(table=>{table.records[0].values.f0='changed while recovering';});const high=env.observations[0].registry.read('r0','f0').revision;
 recovery.resolve({batchId:'saved-batch',rows:[],paused:true});await flush();f.lifecycle.pause();f.lifecycle.observe();
 assert.equal(env.observations[0].registry.read('r0','f0').revision,high);
 assert.equal(f.calls.filter(call=>['submit','estimate','advance','permit'].includes(call.action)).length,0);
});

test('destroy before discovery prevents activation/recovery and removes edit listeners',async t=>{
 const env=setup(t),discovery=deferred(),f=mounted(t,env,{discovery});f.destroy();
 discovery.resolve({batches:[{batchId:'late',scope:'cell',fieldId:'f0',recordId:'r0'}]});await flush();
 assert.equal(env.observations.length,0);assert.equal(f.observers.size,0);
 assert.equal(f.editor.openPromptOptimization,undefined);assert.equal(f.editor.promptOptimizationEstimate,undefined);
 assert.deepEqual(f.calls.map(call=>call.action),['query']);
});

test('standalone estimates read current inputs in isolated temporary registries without activating requests',async t=>{
 const env=setup(t),f=mounted(t,env);await flush();const target={scope:'cell',fieldId:'f0',recordId:'r0'};
 const first=await f.editor.promptOptimizationEstimate(target);f.edit(table=>{table.records[0].values.f0='估算第二次当前值';});
 const second=await f.editor.promptOptimizationEstimate(target);const rows=f.calls.filter(call=>call.action==='estimate').map(call=>call.payload.rows[0]);
 assert.equal(rows[0].input.prompt_text,'合成 0/0');assert.equal(rows[1].input.prompt_text,'估算第二次当前值');
 assert.notEqual(first.quoteId,second.quoteId);assert.deepEqual(rows.map(row=>[row.revision,row.requestSeq]),[[1,1],[1,1]]);
 f.lifecycle.observe();assert.equal(env.observations.length,0);assert.equal(f.tickets.length,0);
 assert.equal(f.calls.filter(call=>['submit','advance','permit','lease'].includes(call.action)).length,0);
 assert.equal(f.table.meta.studioOptimizationRequests,undefined);
});

for(const dependency of [false,true])test(`after a submitted request, ${dependency?'referenced text':'target'} A to B to A never revalidates old results`,async t=>{
 const env=setup(t),table=makeTable();
 if(dependency){table.fields[0]={id:'f0',name:'提示词',type:'json',presentation:'prompt',promptTemplate:{kind:'column-template',version:1,segments:[{type:'text',text:'描述：'},{type:'column',fieldId:'f1'}]}};delete table.records[0].values.f0;delete table.records[1].values.f0;}
 const f=mounted(t,env,{table}),popover=f.open();await f.ready(popover);await f.submit(popover);
 assert.equal(f.calls.filter(call=>call.action==='submit').length,1);const apply=find(popover,e=>e.getAttribute('aria-label')==='应用结果');assert.equal(apply.disabled,false);
 const registry=env.observations[0].registry,original=structuredClone(f.table),entry={...registry.read('r0','f0')},field=dependency?'f1':'f0';
 f.edit(value=>{value.records[0].values[field]='依赖或原文 B';});assert.equal(apply.disabled,true);
 f.edit(value=>{value.records[0].values[field]=original.records[0].values[field];});
 assert.equal(apply.disabled,true);assert.equal(registry.read('r0','f0').revision,entry.revision+2);assert.equal(registry.read('r0','f0').requestSeq,entry.requestSeq);
 const before=structuredClone(f.table);await apply.onclick({preventDefault(){},stopPropagation(){}});await flush();assert.deepEqual(f.table,before);
 assert.equal(f.calls.filter(call=>['advance','permit'].includes(call.action)).length,0,'Synthetic service response, no provider execution');
});
