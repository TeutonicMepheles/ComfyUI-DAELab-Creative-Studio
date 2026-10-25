import test from 'node:test';
import assert from 'node:assert/strict';
import '../migrated_business/register.mjs';

const {installLayoutHistory}=await import('../../frontend/src/integrations/comfyui/canvas/creative_history.mjs');
const {installWorkflowGenerationHistory,preserveWorkflowGenerationHistory}=await import('../../frontend/src/integrations/comfyui/business/prompt_optimization_workflow_history.mjs');
const {NAMESPACE,OptimizationRevisions,prepareWorkflowIdentity}=await import('../../frontend/src/features/prompt/prompt_optimization_model.mjs');
const clone=value=>JSON.parse(JSON.stringify(value));
const stateKey='daelabCreativeCanvasV1';

function state(connected=false){
  const nodes=[1,2,3,4].map(id=>{
    const table={id:`lease-table-${id}`,fields:[{id:'text',name:'Text',type:'text'}],records:[{id:'row',values:{text:`Synthetic ${id}`}}]};
    const revisions=new OptimizationRevisions();revisions.observe(table);
    return {id,type:id<3?'DAELAB.Table':'DAELAB.LLMStylePreviewB',order:[0,2,1,3][id-1],mode:0,
      inputs:[{name:id<3?'source_table':'text',type:'STRING',link:connected&&id===2?6:null}],
      outputs:[{name:id<3?'table_json':'text',type:'STRING',links:id===1?[3,...connected?[6]:[]]:id===2?[4]:[]}],
      properties:{opaque:{keep:[null,true,'unknown']},...(id<3?{[NAMESPACE]:{tableId:table.id,revisions:revisions.serialize(),batches:[]}}:{})},
      widgets_values:[id<3?JSON.stringify(table):JSON.stringify({instruction:`Instruction ${id}`})]};
  });
  return {id:'lease-document',nodes,links:[[3,1,0,3,0,'STRING'],[4,2,0,4,0,'STRING'],...connected?[[6,1,0,2,0,'STRING']]:[]],extra:{[NAMESPACE]:{documentId:'lease-document'},[stateKey]:{active:false,cards:{}},unknown:{keep:17}}};
}
function attach(value){
  for(const n of value.nodes)if(n.type==='DAELAB.Table')Object.defineProperties(n,{
    widgets:{value:[{name:'table_data'}],configurable:true},__dataTable:{value:JSON.parse(n.widgets_values[0]),configurable:true},
  });
}
function withoutOrders(value){const result=clone(value);for(const n of result.nodes)delete n.order;return result;}

// Fixed host contract: activeWorkflow can be a reactive handle while the
// markRaw ChangeTracker retains the raw workflow passed to loadGraphData.
// This exercises the actual product installer; it does not emulate Vue or
// establish the identity of a particular live A/B callback.
function harness(options={}){
  const {kind='split',generationOrder,afterLoad,nativeError}=options;
  const nativeResult=Object.hasOwn(options,'nativeResult')?options.nativeResult:true;
  let current=state(true),loads=0,entrySnapshot;
  attach(current);
  const raw={path:'same-owned-workflow.json'},exposed=kind==='plain'?raw:new Proxy(raw,{});
  const argument=kind==='proxy-argument'?exposed:raw;
  const target=state(),graph={get id(){return current.id;},get _nodes(){return current.nodes;},get extra(){return current.extra;},
    getNodeById:id=>current.nodes.find(n=>String(n.id)===String(id)),serialize:()=>clone(current)};
  const app={isGraphReady:true,graph,rootGraph:graph,extensionManager:{workflow:{activeWorkflow:exposed}},
    async loadGraphData(source,reset,restoreView,workflow){
      loads++;assert.equal(this,app);assert.equal(reset,false);assert.equal(restoreView,false);assert.equal(workflow,argument);
      entrySnapshot=clone(source);if(nativeError)throw nativeError;
      const next=clone(source);
      if(generationOrder){prepareWorkflowIdentity(next);preserveWorkflowGenerationHistory(graph,next);}
      next.nodes.forEach((n,i)=>{n.order=next.links.some(l=>l[0]===6)?[0,2,1,3][i]:i;});current=next;attach(current);
      await Promise.resolve();afterLoad?.({app,graph,raw,exposed,argument,tracker,target,current});return nativeResult;
    }};
  const tracker={workflow:argument,_restoringState:false,changeCount:0,activeState:clone(current),undoQueue:[target],redoQueue:[],
    captureCanvasState(){if(this.changeCount||this._restoringState)return;const live=graph.serialize();if(JSON.stringify(live)===JSON.stringify(this.activeState))return;this.undoQueue.push(this.activeState);this.activeState=live;this.redoQueue.length=0;},
    async updateState(from,to){const prev=from.pop();if(!prev)return;to.push(this.activeState);this._restoringState=true;try{await app.loadGraphData(prev,false,false,this.workflow);this.activeState=prev;}finally{this._restoringState=false;}},
    undo(){return this.updateState(this.undoQueue,this.redoQueue);},redo(){return this.updateState(this.redoQueue,this.undoQueue);}};
  raw.changeTracker=tracker;
  if(generationOrder==='generation-first')installWorkflowGenerationHistory(app);
  installLayoutHistory(app);
  if(generationOrder==='layout-first')installWorkflowGenerationHistory(app);
  return {app,graph,raw,exposed,argument,tracker,target,get current(){return current;},get loads(){return loads;},get entrySnapshot(){return entrySnapshot;}};
}

for(const generationOrder of [undefined,'generation-first','layout-first'])test(`raw argument and exposed handle share one tracker: ${generationOrder??'native'} Undo/Save/Redo/Save`,async()=>{
  const f=harness({generationOrder});assert.notEqual(f.exposed,f.argument);assert.equal(f.exposed.changeTracker,f.tracker);
  const original=clone(f.target),oldActive=f.tracker.activeState;
  await f.tracker.undo();assert.equal(f.tracker.activeState,f.target);assert.equal(f.tracker.redoQueue[0],oldActive);
  assert.deepEqual(f.target.nodes.map(n=>n.order),[0,1,2,3]);assert.deepEqual(withoutOrders(f.target),withoutOrders(f.entrySnapshot));
  if(!generationOrder)assert.deepEqual(withoutOrders(f.target),withoutOrders(original));
  f.tracker.captureCanvasState();assert.equal(f.tracker.redoQueue.length,1);assert.equal(f.tracker.undoQueue.length,0);
  await f.tracker.redo();f.tracker.captureCanvasState();assert.equal(f.tracker.undoQueue.length,1);assert.equal(f.tracker.redoQueue.length,0);
  assert.equal(f.current.links.at(-1)[0],6);assert.equal(f.loads,2);
});

test('plain workflow and proxy argument retain the same supported behavior',async()=>{
  for(const kind of ['plain','proxy-argument']){const f=harness({kind});await f.tracker.undo();f.tracker.captureCanvasState();assert.equal(f.tracker.redoQueue.length,1);assert.deepEqual(f.target.nodes.map(n=>n.order),[0,1,2,3]);}
});

test('another active handle rejects after await, during order staging, or final lookup even for the same path/tracker',async()=>{
  for(const phase of ['await','order','lookup']){
    let reads=0;
    const f=harness({afterLoad:x=>{
      const replace=()=>{x.app.extensionManager.workflow.activeWorkflow=new Proxy(x.raw,{});};
      if(phase==='await')replace();
      if(phase==='order')Object.defineProperty(x.current.nodes[3],'order',{enumerable:true,get(){reads++;replace();return 3;}});
      if(phase==='lookup'){const lookup=x.graph.getNodeById;x.graph.getNodeById=id=>{if(++reads===8)replace();return lookup(id);};}
    }}),before=clone(f.target);
    await f.tracker.undo();assert.deepEqual(f.target,before);
    assert.equal(reads,phase==='order'?1:phase==='lookup'?8:0);
  }
});

test('tracker, argument, root, restoration or transaction changes still reject every staged order',async()=>{
  for(const change of [
    x=>{x.raw.changeTracker={};},x=>{x.tracker.workflow=new Proxy(x.raw,{});},x=>{x.app.graph={};},x=>{x.app.rootGraph={};},
    x=>{x.tracker._restoringState=false;},x=>{x.tracker.changeCount=1;},x=>{x.current.id='another-document';},
  ]){const f=harness({afterLoad:change}),before=clone(f.target);await f.tracker.undo();assert.deepEqual(f.target,before);}
});

test('native false/undefined/throw preserve source and ordinary opens never repair orders',async()=>{
  for(const nativeResult of [false,undefined,null,0]){const f=harness({nativeResult}),before=clone(f.target);await f.tracker.undo();assert.deepEqual(f.target,before);}
  const error=new Error('native failure'),f=harness({nativeError:error}),before=clone(f.target);await assert.rejects(f.tracker.undo(),e=>e===error);assert.deepEqual(f.target,before);
  const g=harness(),saved=clone(g.target);assert.equal(await g.app.loadGraphData(g.target,false,false,g.argument),true);assert.deepEqual(g.target,saved);
});

test('real edits remain visible and clear redo with both generation installation orders',async()=>{
  for(const generationOrder of ['generation-first','layout-first'])for(const mutate of [
    c=>{c.nodes[0].properties.opaque.keep.push('actual edit');},c=>{c.nodes[0].widgets_values[0]+=' ';},c=>{c.links.push([99,1,0,4,0,'STRING']);},
    c=>{Object.values(c.nodes[0].properties[NAMESPACE].revisions)[0].revision++;},
  ]){const f=harness({generationOrder});await f.tracker.undo();mutate(f.current);f.tracker.captureCanvasState();assert.equal(f.tracker.redoQueue.length,0);assert.equal(f.tracker.undoQueue.length,1);}
});
