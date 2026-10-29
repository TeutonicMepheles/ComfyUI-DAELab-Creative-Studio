import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessDocument} from '../../web/application/business_document.js';
import {bindBusinessDocument,installBusinessDocuments,invalidateBusinessDocuments,loadedBusinessWorkflow,tableInputStamp} from '../../web/integrations/comfyui/business/business_document_host.js';
import {stopCanvasPropagation} from '../../frontend/src/features/table/list_editor_controls.mjs';

const table=()=>({fields:[{id:'prompt',unknown:{retained:true}}],records:[{id:'a',values:{prompt:'甲'},unknown:7},{id:'b',values:{prompt:'乙'}}],meta:{unknown:['keep']},future:{opaque:true}});
function harness(){
  let value=table(),active=true,epoch=0,session='workflow-a',before;
  const undo=[],redo=[];let begins=0,amends=0;
  const history={begin(){begins++;before=structuredClone(value);},end(){undo.push(before);redo.length=0;},amend(fn){amends++;return fn();},undo(){if(undo.length){redo.push(value);value=undo.pop();}},redo(){if(redo.length){undo.push(value);value=redo.pop();}}};
  const options={read:()=>value,write:next=>{value=next;},current:()=>active,identity:()=>({workflowSession:session,epoch,documentId:'node-1'}),stamp:tableInputStamp,history,historyStamp:()=>JSON.stringify(value)};
  const doc=createBusinessDocument(options);
  return {doc,options,history,get value(){return value;},get begins(){return begins;},get amends(){return amends;},get undo(){return undo;},switch(){session='workflow-b';},invalidate(){epoch++;},detach(){active=false;}};
}
test('real document binding has one history step for a grouped edit and retains unknown data and IDs',()=>{
  const h=harness();h.doc.edit('输入',t=>{t.records[0].values.prompt='甲一';},{group:'input-a'});h.doc.edit('输入',t=>{t.records[0].values.prompt='甲一二';},{group:'input-a'});
  assert.equal(h.begins,1);assert.equal(h.amends,1);assert.equal(h.value.records[0].id,'a');assert.deepEqual(h.value.future,{opaque:true});assert.equal(h.value.records[0].unknown,7);
  h.doc.undo();assert.equal(h.value.records[0].values.prompt,'甲');h.doc.redo();assert.equal(h.value.records[0].values.prompt,'甲一二');
});
test('intervening native changes break an input group instead of amending another action',()=>{
  const h=harness();h.doc.edit('输入',t=>{t.records[0].values.prompt='first';},{group:'input-a'});
  h.value.future.nativeChange=true;h.doc.edit('输入',t=>{t.records[0].values.prompt='second';},{group:'input-a'});
  assert.equal(h.begins,2);assert.equal(h.amends,0);
});

function committedHost({nested=false,afterCapture=()=>{}}={}){
  let value=table(),liveReads=0,begins=0,amends=0;
  const metadata={future:'original'},tracker={changeCount:nested?1:0,activeState:null};
  const snapshot=()=>structuredClone({nodes:[{id:1,table:value}],extra:metadata});
  const graph={getNodeById:id=>id===1?node:null,serialize(){liveReads++;return snapshot();}},node={id:1,graph};
  const app={graph,rootGraph:graph,extensionManager:{workflow:{activeWorkflow:{changeTracker:tracker}}}};
  const complete=()=>{if(!tracker.changeCount){tracker.activeState=snapshot();afterCapture(metadata);}};
  const history={begin(){begins++;tracker.changeCount++;},end(){tracker.changeCount--;complete();},amend(write){amends++;write();complete();},undo(){},redo(){}};
  installBusinessDocuments(app,history);
  const doc=bindBusinessDocument(node,()=>value,next=>{value=next;});
  return {doc,metadata,tracker,get liveReads(){return liveReads;},get begins(){return begins;},get amends(){return amends;}};
}

test('completed native snapshot avoids a second live read while the next grouped input still checks the live graph',()=>{
  const h=committedHost();
  h.doc.edit('输入',t=>{t.records[0].values.prompt='one';},{group:'typing'});
  assert.equal(h.liveReads,0);
  h.doc.edit('输入',t=>{t.records[0].values.prompt='two';},{group:'typing'});
  assert.equal(h.liveReads,1);assert.equal(h.begins,1);assert.equal(h.amends,1);
  h.metadata.future='outside edit';
  h.doc.edit('输入',t=>{t.records[0].values.prompt='three';},{group:'typing'});
  assert.equal(h.liveReads,2);assert.equal(h.begins,2);assert.equal(h.amends,1);
});

test('external mutation after native capture is not absorbed into the input-group baseline',()=>{
  const h=committedHost({afterCapture:metadata=>{metadata.future='changed after capture';}});
  h.doc.edit('输入',t=>{t.records[0].values.prompt='one';},{group:'typing'});
  assert.equal(h.tracker.activeState.extra.future,'original');
  h.doc.edit('输入',t=>{t.records[0].values.prompt='two';},{group:'typing'});
  assert.equal(h.begins,2);assert.equal(h.amends,0);assert.equal(h.metadata.future,'changed after capture');
});

test('nested native transactions keep the live-stamp fallback until their outer boundary closes',()=>{
  const h=committedHost({nested:true});
  h.doc.edit('输入',t=>{t.records[0].values.prompt='one';},{group:'typing'});
  assert.equal(h.liveReads,1);assert.equal(h.tracker.activeState,null);
  h.doc.edit('输入',t=>{t.records[0].values.prompt='two';},{group:'typing'});
  assert.equal(h.liveReads,3);assert.equal(h.begins,1);assert.equal(h.amends,1);
});
test('batch review checks all stable row targets before one native step',()=>{
  const h=harness(),a=h.doc.beginRequest('a',{recordId:'a',fieldId:'prompt'}),b=h.doc.beginRequest('b',{recordId:'b',fieldId:'prompt'});
  const next=structuredClone(h.value);next.records[0].values.prompt='结果甲';next.records[1].values.prompt='结果乙';
  assert.equal(h.doc.replaceResults([a,b],next),true);assert.equal(h.begins,1);assert.equal(h.doc.replaceResults([a,b],next),false);
  h.doc.undo();assert.deepEqual(h.value,table());
});
test('row revision preserves independent edits but rejects edit then undo to identical input',()=>{
  const h=harness(),a=h.doc.beginRequest('a',{recordId:'a',fieldId:'prompt'});
  h.doc.edit('另行编辑',t=>{t.records[1].values.prompt='other';});assert.equal(h.doc.canApply(a),true);
  h.doc.edit('编辑',t=>{t.records[0].values.prompt='changed';});assert.equal(h.doc.canApply(a),false);
  h.doc.undo();assert.equal(h.value.records[0].values.prompt,'甲');assert.equal(h.doc.canApply(a),false);
});
test('same request ID in two controllers does not authorize another instance ticket or a forged clone',()=>{
  const h=harness(),other=createBusinessDocument(h.options),a=h.doc.beginRequest('same'),b=other.beginRequest('same');
  assert.equal(other.canApply(a),false);assert.equal(other.canApply({...b}),false);assert.equal(other.canApply(b),true);
});
test('workflow, epoch, detach and disposal reject callbacks without changing data or ledger facts',()=>{
  for(const change of ['switch','invalidate','detach']){
    const h=harness(),ticket=h.doc.beginRequest(change),facts={status:'succeeded',receipt:'immutable'};h[change]();
    assert.equal(h.doc.canApply(ticket),false);assert.equal(h.doc.replaceResults([ticket],{bad:true}),false);assert.deepEqual(h.value,table());assert.equal(facts.status,'succeeded');
  }
  const h=harness(),ticket=h.doc.beginRequest('released');h.doc.dispose();assert.equal(h.doc.canApply(ticket),false);assert.throws(()=>h.doc.edit('late',()=>{}),/released/);
});
test('a rejected mutation leaves ticket reusable and native history unopened',()=>{
  const h=harness(),ticket=h.doc.beginRequest('retry');assert.throws(()=>h.doc.controller.applyResult(ticket,'bad',()=>{throw Error('validation');}),/validation/);
  assert.equal(h.begins,0);assert.equal(h.doc.canApply(ticket),true);assert.equal(h.doc.controller.applyResult(ticket,'ok',t=>{t.records[0].values.prompt='ok';}),true);
});
test('ComfyUI lifecycle invalidates all owners even if graph object and document IDs are reused',()=>{
  let value=table();const node={id:9};const graph={getNodeById:id=>id===9?node:null,serialize:()=>value};node.graph=graph;
  const app={graph,rootGraph:graph,extensionManager:{workflow:{activeWorkflow:{}}}};
  const history={begin(){},end(){},amend(fn){fn();},undo(){},redo(){}};installBusinessDocuments(app,history);
  const doc=bindBusinessDocument(node,()=>value,next=>{value=next;},tableInputStamp),ticket=doc.beginRequest('load');
  invalidateBusinessDocuments();loadedBusinessWorkflow();assert.equal(doc.canApply(ticket),false);
  const second=doc.beginRequest('switch');app.extensionManager.workflow.activeWorkflow={};assert.equal(doc.canApply(second),false);
  const third=doc.beginRequest('detached');node.graph=null;assert.equal(doc.canApply(third),false);
});
test('host save command propagates only outside IME, without changing other keyboard ownership',()=>{
  for(const [event,stops] of [[{type:'keydown',key:'s',ctrlKey:true},0],[{type:'keydown',key:'S',metaKey:true},0],[{type:'keydown',key:'s',ctrlKey:true,isComposing:true},1],[{type:'keydown',key:'s',ctrlKey:true,keyCode:229},1],[{type:'keydown',key:'z',ctrlKey:true},1],[{type:'pointerdown'},1]]){
    let count=0;stopCanvasPropagation({...event,stopPropagation(){count++;}});assert.equal(count,stops);
  }
});
