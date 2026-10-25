import test from 'node:test';
import assert from 'node:assert/strict';
import '../migrated_business/register.mjs';

const {installLayoutHistory}=await import('../../frontend/src/integrations/comfyui/canvas/creative_history.mjs');
const {installWorkflowGenerationHistory,preserveWorkflowGenerationHistory}=await import('../../frontend/src/integrations/comfyui/business/prompt_optimization_workflow_history.mjs');
const {NAMESPACE,OptimizationRevisions,prepareWorkflowIdentity}=await import('../../frontend/src/features/prompt/prompt_optimization_model.mjs');
const clone=value=>JSON.parse(JSON.stringify(value));
const key='daelabCreativeCanvasV1';

function state(connected=false){
  const nodes=[1,2,3,4].map(id=>{
    const table={id:`table-${id}`,fields:[{id:'text',name:'Text',type:'text'}],records:[{id:'row',values:{text:`Synthetic ${id}`}}]};
    const revisions=new OptimizationRevisions();revisions.observe(table);
    return {id,type:id<3?'DAELAB.Table':'DAELAB.LLMStylePreviewB',order:[0,2,1,3][id-1],mode:0,
      inputs:id<3?[{name:'source_table',type:'STRING',link:connected&&id===2?6:null}]:[{name:'text',type:'STRING',link:id}],
      outputs:[{name:id<3?'table_json':'text',type:'STRING',links:id===1?[3,...connected?[6]:[]]:id===2?[4]:[]}],
      properties:{unknown:{retain:[null,true,'opaque']},...(id<3?{[NAMESPACE]:{tableId:table.id,revisions:revisions.serialize(),batches:[]}}:{})},
      widgets_values:[id<3?JSON.stringify(table):JSON.stringify({instruction:`Instruction ${id}`,unknown:{retain:true}})]};
  });
  return {id:'synthetic-document',nodes,links:[[3,1,0,3,0,'STRING'],[4,2,0,4,0,'STRING'],...connected?[[6,1,0,2,0,'STRING']]:[]],extra:{[NAMESPACE]:{documentId:'synthetic-document'},[key]:{active:false,cards:{},viewport:{x:0,y:0,zoom:1}},unknown:{retain:17}}};
}
function attachTables(value){
  for(const node of value.nodes)if(node.type==='DAELAB.Table')Object.defineProperties(node,{
    widgets:{value:[{name:'table_data'}],configurable:true},
    __dataTable:{value:JSON.parse(node.widgets_values[0]),configurable:true},
  });
}
function withoutOrders(value){const copy=clone(value);for(const n of copy.nodes)delete n.order;return copy;}

// Authored synthetic contract fixture, fixed frontend 1.53.10:
// ChangeTracker.updateState retains the ORIGINAL load argument as activeState;
// captureCanvasState clears redo only when its full graph comparator differs.
// LGraph's disconnected topology normalizes the four native orders to 0/1/2/3.
// This is not a reimplementation of the host loader or proof of live UI behavior.
function harness(options={}){
  const {generationOrder,afterLoad,error,target=state(),beforeLoad}=options;
  const result=Object.hasOwn(options,'result')?options.result:true;
  let current=state(true),loads=0,loadArgs,entrySnapshot,mounted;
  attachTables(current);
  if(generationOrder)Object.values(current.nodes[0].properties[NAMESPACE].revisions)[0].revision+=7;
  const graph={get id(){return current.id;},get _nodes(){return current.nodes;},get extra(){return current.extra;},
    getNodeById:id=>current.nodes.find(n=>String(n.id)===String(id)),serialize:()=>clone(current)};
  const workflow={},app={isGraphReady:true,graph,rootGraph:graph,extensionManager:{workflow:{activeWorkflow:workflow}},
    async loadGraphData(source,...args){
      assert.equal(this,app);loads++;loadArgs=args;beforeLoad?.(source);entrySnapshot=clone(source);
      if(error)throw error;
      const configured=clone(source);
      if(generationOrder){prepareWorkflowIdentity(configured);preserveWorkflowGenerationHistory(graph,configured);}
      current=configured;current.nodes.forEach((n,i)=>{n.order=current.links.some(l=>l[0]===6)?[0,2,1,3][i]:i;});
      attachTables(current);
      mounted=[];
      if(generationOrder)for(const n of current.nodes.filter(n=>n.type==='DAELAB.Table')){
        const before=clone(n.properties[NAMESPACE].revisions),r=new OptimizationRevisions(before);r.observe(n.__dataTable);
        n.properties[NAMESPACE].revisions=r.serialize();mounted.push({before,after:r.serialize()});
      }
      await Promise.resolve();afterLoad?.({app,graph,workflow,tracker,target,current});return result;
    }};
  const tracker={workflow,_restoringState:false,changeCount:0,activeState:clone(current),undoQueue:[target],redoQueue:[],
    captureCanvasState(){
      if(this.changeCount||this._restoringState)return;
      const live=graph.serialize();if(JSON.stringify(live)===JSON.stringify(this.activeState))return;
      this.undoQueue.push(this.activeState);this.activeState=live;this.redoQueue.length=0;
    },
    prepareForSave(){this.captureCanvasState();},
    async updateState(from,to){
      const previous=from.pop();if(!previous)return;to.push(this.activeState);this._restoringState=true;
      try{await app.loadGraphData(previous,false,false,workflow,{checkForRerouteMigration:false,silentAssetErrors:true});this.activeState=previous;}
      finally{this._restoringState=false;}
    },
    undo(){return this.updateState(this.undoQueue,this.redoQueue);},redo(){return this.updateState(this.redoQueue,this.undoQueue);},
  };workflow.changeTracker=tracker;
  if(generationOrder==='generation-first')installWorkflowGenerationHistory(app);
  installLayoutHistory(app);
  if(generationOrder==='layout-first')installWorkflowGenerationHistory(app);
  return {app,graph,workflow,tracker,target,get current(){return current;},get loads(){return loads;},get loadArgs(){return loadArgs;},get entrySnapshot(){return entrySnapshot;},get mounted(){return mounted;}};
}

test('explicit native Undo → Save keeps redo and Redo → Save keeps the native restored link',async()=>{
  const f=harness(),original=clone(f.target),oldActive=f.tracker.activeState;
  await f.tracker.undo();assert.equal(f.tracker.activeState,f.target);assert.equal(f.tracker.redoQueue[0],oldActive);
  assert.deepEqual(withoutOrders(f.target),withoutOrders(original));assert.deepEqual(f.target.nodes.map(n=>n.order),[0,1,2,3]);
  assert.deepEqual(f.current,{...original,nodes:original.nodes.map((n,i)=>({...n,order:i}))});
  assert.equal(f.loads,1);assert.deepEqual(f.loadArgs,[false,false,f.workflow,{checkForRerouteMigration:false,silentAssetErrors:true}]);
  f.tracker.prepareForSave();assert.equal(f.tracker.redoQueue.length,1);assert.equal(f.tracker.undoQueue.length,0);
  await f.tracker.redo();f.tracker.prepareForSave();assert.equal(f.current.links.at(-1)[0],6);assert.equal(f.tracker.undoQueue.length,1);
});

for(const generationOrder of ['generation-first','layout-first'])test(`${generationOrder}: real source overlays stay before configure; remounted revisions and order agree`,async()=>{
  const f=harness({generationOrder}),old=clone(f.target);await f.tracker.undo();
  assert.notDeepEqual(f.entrySnapshot.nodes[0].properties[NAMESPACE].revisions,old.nodes[0].properties[NAMESPACE].revisions);
  assert.deepEqual(withoutOrders(f.target),withoutOrders(f.entrySnapshot));
  for(const pair of f.mounted)assert.deepEqual(pair.before,pair.after);
  f.tracker.prepareForSave();assert.equal(f.tracker.redoQueue.length,1);
});

test('real widget, unknown property, revision and link changes still clear redo under both wrapper orders',async()=>{
  for(const generationOrder of [undefined,'generation-first','layout-first'])for(const mutation of [
    c=>{c.nodes[0].widgets_values[0]+=' ';},c=>{c.nodes[0].properties.extra={real:'edit'};},
    c=>{Object.values(c.nodes[0].properties[NAMESPACE].revisions)[0].revision++;},c=>{c.links.push([99,1,0,4,0,'STRING']);},
  ]){
    const f=harness({generationOrder,afterLoad:({current})=>mutation(current)});await f.tracker.undo();
    f.tracker.prepareForSave();assert.equal(f.tracker.redoQueue.length,0);assert.equal(f.tracker.undoQueue.length,1);
  }
});

test('ordinary Open, unsuccessful native return and native rejection preserve original orders/result/error',async()=>{
  const f=harness(),saved=clone(f.target);assert.equal(await f.app.loadGraphData(f.target),true);assert.deepEqual(f.target,saved);
  for(const result of [false,undefined,null,0]){
    const g=harness({result}),before=clone(g.target);
    await g.tracker.undo();assert.deepEqual(g.target,before);
  }
  const error=new Error('native restore failed'),g=harness({error}),before=clone(g.target);
  await assert.rejects(g.tracker.undo(),e=>e===error);assert.deepEqual(g.target,before);
});

test('startup never reads an uninitialized graph',async()=>{
  let calls=0;const app={get graph(){throw Error('not ready');},async loadGraphData(){calls++;return true;}};
  installLayoutHistory(app);assert.equal(await app.loadGraphData({}),true);assert.equal(calls,1);
});

test('post-await workflow/root/tracker/restore/graph identity changes skip the entire correction',async()=>{
  for(const change of [
    f=>{f.app.extensionManager.workflow.activeWorkflow={};},f=>{f.app.rootGraph={};},f=>{f.app.graph={};},
    f=>{f.workflow.changeTracker={};},f=>{f.tracker.workflow={};},f=>{f.tracker._restoringState=false;},
    f=>{f.tracker.changeCount=1;},f=>{f.current.id='other';},f=>{f.app.isGraphReady=false;},
  ]){const f=harness({afterLoad:change}),before=clone(f.target);await f.tracker.undo();assert.deepEqual(f.target,before);}
});

test('missing, duplicate, replacement, mismatched-type or invalid native/saved order skips atomically',async()=>{
  for(const change of [
    f=>f.current.nodes.pop(),f=>{f.current.nodes[1].id=1;},f=>{f.current.nodes[1].type='Foreign';},
    f=>{f.current.nodes[1].order=NaN;},f=>{f.current.nodes[1].order=-1;},
    f=>{delete f.target.nodes[1].order;},f=>{Object.defineProperty(f.target.nodes[1],'order',{writable:false});},
  ]){let before;const f=harness({afterLoad:x=>{change(x);before=clone(x.target);}});await f.tracker.undo();assert.deepEqual(f.target,before);}
});

test('foreign orders remain untouched and visible to Save comparison',async()=>{
  const target=state();target.nodes[1].type='Foreign.Order';const f=harness({target});await f.tracker.undo();
  assert.equal(target.nodes[1].order,2);f.tracker.prepareForSave();assert.equal(f.tracker.redoQueue.length,0);
});

test('order getter is read once; switching workflow or replacing a node during staging makes no writes',async()=>{
  for(const action of [f=>{f.app.extensionManager.workflow.activeWorkflow={};},f=>{f.current.nodes[1]={...f.current.nodes[1]};},f=>{throw Error('native order unavailable');}]){
    let reads=0;const f=harness({afterLoad:x=>Object.defineProperty(x.current.nodes[3],'order',{enumerable:true,get(){reads++;action(x);return 3;}})}),before=clone(f.target);
    await f.tracker.undo();assert.deepEqual(f.target,before);assert.equal(reads,1);
  }
});

test('transparent reactive proxies and canonical native numeric-string IDs retain source identity',async()=>{
  const target=state();target.nodes=target.nodes.map(n=>new Proxy(n,{}));const f=harness({target,afterLoad:({current})=>{
    current.nodes=current.nodes.map(n=>new Proxy({...n,id:String(n.id)},{}));
  }});await f.tracker.undo();assert.deepEqual(target.nodes.map(n=>n.order),[0,1,2,3]);
  assert.equal(f.tracker.activeState,target);assert.deepEqual(target.nodes.map(n=>n.id),[1,2,3,4]);
});

test('lookup reentrancy during final validation and live/source alias both refuse snapshot writes',async()=>{
  let calls=0;
  const f=harness({afterLoad:({graph,current})=>{
    graph.getNodeById=id=>{if(++calls===8)current.nodes[0]={...current.nodes[0]};return current.nodes.find(n=>n.id===id);};
  }}),before=clone(f.target);await f.tracker.undo();assert.deepEqual(f.target,before);assert.equal(calls,8);
  const g=harness({afterLoad:({current,target})=>{current.nodes=target.nodes;}}),saved=clone(g.target);
  await g.tracker.undo();assert.deepEqual(g.target,saved);
});
