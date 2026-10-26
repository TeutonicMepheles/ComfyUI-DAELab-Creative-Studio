import test from 'node:test';
import assert from 'node:assert/strict';
import {Element,installDom} from './prompt_optimization_dom.mjs';
import {attachPromptOptimization} from '../../frontend/src/features/prompt/prompt_optimization_controller.mjs';
import {createSettingsPopover} from '../../frontend/src/features/prompt/table_prompt_settings.mjs';
import {NAMESPACE} from '../../frontend/src/features/prompt/prompt_optimization_model.mjs';
import {createBusinessDocument} from '../../frontend/src/application/business_document.js';

const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
const find=(root,predicate)=>predicate(root)?root:root.children.map(child=>find(child,predicate)).find(Boolean);
function setupDom(t){const doc=installDom(t);doc.cleanups=[];t.after(()=>{for(const cleanup of doc.cleanups)cleanup();doc.restore();});return doc;}

function mounted(t,doc){
 let table={fields:[{id:'p',name:'提示词',type:'text'}],records:[{id:'r',values:{p:'合成原文'}}],meta:{}};
 const graph={},identity={documentId:crypto.randomUUID(),tableId:crypto.randomUUID()},root=new Element('div'),observers=new Set(),calls=[];
 const node={id:identity.documentId,graph,mode:0,properties:{[NAMESPACE]:{tableId:identity.tableId,revisions:{},batches:[]}}};
 doc.body.append(root);
 const native=createBusinessDocument({read:()=>table,write:value=>{table=value;},current:()=>node.graph===graph,
  identity:()=>({workflowSession:'workflow',epoch:0,documentId:identity.documentId}),history:{begin(){},end(){},amend:fn=>fn(),undo(){},redo(){}}});
 function render(){
  for(const child of [...root.children])child.remove();
  for(const field of table.fields){const header=new Element('th');header.dataset.column=field.id;root.append(header);}
  for(const record of table.records)for(const field of table.fields){const cell=new Element('td');cell.dataset={field:field.id,record:record.id};root.append(cell);}
 }
 root.querySelectorAll=selector=>root.children.filter(child=>selector.startsWith('th')?child.tagName==='th':child.tagName==='td');
 const editor={root,nativeDocument:native,beginAsync:(target,id)=>native.beginRequest(id,target),canAsync:ticket=>native.canApply(ticket),releaseAsync:ticket=>native.releaseRequest(ticket),
  change(fn,options){native.edit('编辑',fn,options);for(const observer of observers)observer();render();},onTableChange(fn){observers.add(fn);return()=>observers.delete(fn);}};
 const fetchApi=async(url,options)=>{
  const action=url.split('/').at(-1),payload=JSON.parse(options.body);calls.push({action,payload});
  const result=action==='query'?{batches:[]}:action==='capabilities'?{available:true,models:['qwen3.5:9b-q4_K_M']}:
   action==='lease'?{leaseId:crypto.randomUUID()}:action==='submit'?{...payload,paused:true,provider:'qwen',rows:payload.rows.map(row=>({...row,status:'queued'}))}:
   {status:'ready',quoteId:crypto.randomUUID(),provider:'qwen',budgetUpperCredits:0,estimatedCredits:0,expiresAt:Date.now()+60000};
  return {ok:true,json:async()=>result};
 };
 render();const lifecycle=attachPromptOptimization({node,graph,editor,getTable:()=>table,identity,fetchApi});
 doc.cleanups.push(()=>{lifecycle.destroy();native.dispose();root.remove();});
 const cell=()=>root.children.find(child=>child.tagName==='td'),header=()=>root.children.find(child=>child.tagName==='th');
 function open(scope='cell'){
  editor.openPromptOptimization({scope,fieldId:'p',...(scope==='cell'?{recordId:'r'}:{}),anchor:scope==='cell'?cell():header()});
  return doc.body.children.find(child=>child.getAttribute('role')==='dialog'&&child.id=== (scope==='cell'?cell():header()).getAttribute('aria-controls'));
 }
 return {editor,node,root,calls,cell,header,open,lifecycle,get table(){return table;}};
}

test('editing rewrite requirements and persisting the original intent retain the same composer across replacement cells',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const doc=setupDom(t);
 const f=mounted(t,doc),first=f.cell(),popover=f.open();await flush();
 const input=find(popover,e=>e.getAttribute('aria-label')==='改写要求');doc.activeElement=input;
 input.value='合成新增改写要求';input.dispatchEvent(new Event('input'));await flush();
 assert.notEqual(f.cell(),first);t.mock.timers.tick(201);await flush();
 assert.equal(popover.isConnected,true);assert.equal(find(popover,e=>e.getAttribute('aria-label')==='改写要求'),input);
 assert.equal(doc.activeElement,input);assert.equal(f.cell().getAttribute('aria-controls'),popover.id);assert.equal(first.getAttribute('aria-controls'),null);
 assert.equal(Object.values(f.table.meta.studioOptimizationPreferences.drafts)[0],'合成新增改写要求');
 const beforeSubmit=f.cell(),start=find(popover,e=>e.getAttribute('aria-label')==='开始改写');
 await start.onclick({preventDefault(){},stopPropagation(){}});await flush();
 assert.equal(f.calls.filter(call=>call.action==='submit').length,1);
 assert.equal(f.table.meta.studioOptimizationRequests.length,1);assert.notEqual(f.cell(),beforeSubmit);
 t.mock.timers.tick(201);await flush();assert.equal(popover.isConnected,true);assert.equal(f.cell().getAttribute('aria-controls'),popover.id);
 assert.equal(f.calls.filter(call=>call.action==='advance').length,0,'No model execution is part of this DOM regression');
});

test('two editors with identical field/record IDs reanchor only within their own roots',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const doc=setupDom(t);
 const a=mounted(t,doc),b=mounted(t,doc),pa=a.open(),pb=b.open();await flush();
 a.editor.change(table=>{table.meta.redraw=true;});t.mock.timers.tick(201);await flush();
 assert.equal(pa.isConnected,true);assert.equal(pb.isConnected,true);
 assert.equal(a.cell().getAttribute('aria-controls'),pa.id);assert.equal(b.cell().getAttribute('aria-controls'),pb.id);
 a.cell().remove();t.mock.timers.tick(201);await flush();
 assert.equal(pa.isConnected,false,'A cannot borrow the matching cell from B');assert.equal(pb.isConnected,true);
});

for(const reason of ['record-deleted','field-deleted','graph-changed','inactive','root-replaced','document-replaced','root-hidden','root-disconnected','lifecycle-pause'])test(`real target invalidation closes the composer: ${reason}`,async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const doc=setupDom(t);
 const f=mounted(t,doc),popover=f.open();await flush();
 if(reason==='record-deleted')f.editor.change(table=>{table.records=[];});
 else if(reason==='field-deleted')f.editor.change(table=>{table.fields=[];});
 else if(reason==='graph-changed')f.node.graph={};
 else if(reason==='inactive')f.node.mode=4;
 else if(reason==='root-replaced')f.editor.root=new Element('div');
 else if(reason==='document-replaced')f.editor.nativeDocument={};
 else if(reason==='root-disconnected')f.root.isConnected=false;
 else if(reason==='lifecycle-pause')f.lifecycle.pause();
 else f.root.getClientRects=()=>[];
 t.mock.timers.tick(201);await flush();assert.equal(popover.isConnected,false);
 assert.equal(f.calls.filter(call=>['submit','advance'].includes(call.action)).length,0);
});

test('column target survives header reconstruction and closes when the stable field is deleted',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const doc=setupDom(t);
 const f=mounted(t,doc),original=f.header(),popover=f.open('column');await flush();
 f.editor.change(table=>{table.meta.redraw=true;});t.mock.timers.tick(201);await flush();
 assert.notEqual(f.header(),original);assert.equal(popover.isConnected,true);assert.equal(f.header().getAttribute('aria-controls'),popover.id);
 f.editor.change(table=>{table.fields=[];});t.mock.timers.tick(201);assert.equal(popover.isConnected,false);
});

test('shared popover resolver transfers accessibility ownership and Escape focus without recreating content',t=>{
 const doc=setupDom(t);
 const first=new Element('button'),second=new Element('button');let current=first,closed=0,focused=null;
 first.focus=()=>{focused=first;};second.focus=()=>{focused=second;};
 const popover=createSettingsPopover(first,'合成设置',()=>{closed++;},{resolveAnchor:()=>current});doc.cleanups.push(()=>popover.close());
 const content=new Element('textarea');popover.root.append(content);first.isConnected=false;current=second;popover.reposition();
 assert.equal(popover.anchor,second);assert.equal(popover.root.children.at(-1),content);assert.equal(first.getAttribute('aria-controls'),null);
 assert.equal(second.getAttribute('aria-controls'),popover.root.id);
 doc.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{key:'Escape'}));
 assert.equal(closed,1);assert.equal(focused,second);assert.equal(second.getAttribute('aria-controls'),null);
});

test('existing static-anchor consumers still close when their original anchor disappears',t=>{
 const doc=setupDom(t);const anchor=new Element('button');let closed=0;
 const popover=createSettingsPopover(anchor,'原设置',()=>{closed++;});doc.cleanups.push(()=>popover.close());
 anchor.isConnected=false;popover.reposition();assert.equal(closed,1);assert.equal(popover.root.isConnected,false);
});
