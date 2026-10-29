import test from 'node:test';
import assert from 'node:assert/strict';
import './register.mjs';
import {installWorkflowNodeLifecycle} from '../../frontend/src/integrations/comfyui/business/workflow_node_lifecycle.ts';
import {canvasHistory} from '../../frontend/src/integrations/comfyui/canvas/creative_history.mjs';
const tick=()=>new Promise(resolve=>queueMicrotask(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function harness(){
 const frames=[],nodes=new Map(),graph={getNodeById:id=>nodes.get(id),serialize:()=>({nodes:[]})};
 let load=async()=>true;
 const app={isGraphReady:true,graph,rootGraph:graph,extensionManager:{workflow:{activeWorkflow:{}}},
  loadGraphData(...args){assert.equal(this,app);return load(...args);}};
 const lifecycle=installWorkflowNodeLifecycle(app,callback=>frames.push(callback));
 const node=id=>{const node={id,graph};nodes.set(id,node);return node;};
 return {app,graph,nodes,node,lifecycle,frames,setLoad(fn){load=fn;},frame(){for(const callback of frames.splice(0))callback();}};
}
test('coalesces two node owners and ignores removed/replaced identities',async()=>{
 const h=harness(),a=h.node(1),b=h.node(2),seen=[];
 h.lifecycle.schedule(a,()=>seen.push('old'));h.lifecycle.schedule(a,()=>seen.push('a'));
 h.lifecycle.schedule(b,()=>seen.push('b'));await tick();assert.deepEqual(seen,['a','b']);
 h.lifecycle.schedule(a,()=>seen.push('removed'));h.lifecycle.cancel(a);
 h.lifecycle.schedule(b,()=>seen.push('replaced'));h.node(2);await tick();
 assert.deepEqual(seen,['a','b']);assert.equal(h.lifecycle.ready(b),false);
 assert.equal(installWorkflowNodeLifecycle(h.app),h.lifecycle);
});
test('graph readiness alone cannot install before native tracker activation and undo continuation',async()=>{
 const h=harness(),a=h.node(1),b=h.node(2),gate=deferred(),seen=[];
 let restoring=true;
 h.setLoad(async()=>{h.lifecycle.schedule(a,()=>seen.push(restoring?'early':'a'));await tick();await gate.promise;h.lifecycle.schedule(b,()=>seen.push('b'));return true;});
 const loading=h.app.loadGraphData({synthetic:true}).then(value=>{restoring=false;return value;});
 await tick();assert.equal(h.app.isGraphReady,true);assert.equal(h.lifecycle.ready(a),false);assert.deepEqual(seen,[]);
 gate.resolve();assert.equal(await loading,true);assert.deepEqual(seen,[]);
 h.frame();assert.deepEqual(seen,['a','b']);assert.equal(h.lifecycle.ready(a),true);
});
test('an old tracker does not authorize syncing while another workflow loads',async()=>{
 const h=harness(),a=h.node(1),gate=deferred();
 h.app.extensionManager.workflow.activeWorkflow.changeTracker={captureCanvasState(){}};
 h.setLoad(()=>gate.promise);const loading=h.app.loadGraphData();
 assert.equal(h.lifecycle.ready(a),false);gate.resolve(true);await loading;h.frame();
 assert.equal(h.lifecycle.ready(a),true);
});
test('native false and throw discard pending installs; a subsequent successful load recovers',async()=>{
 for(const fail of [false,new Error('native failure')]){
  const h=harness(),a=h.node(1),seen=[];
  h.setLoad(async()=>{h.lifecycle.schedule(a,()=>seen.push('failed'));if(fail instanceof Error)throw fail;return fail;});
  if(fail instanceof Error)await assert.rejects(h.app.loadGraphData(),e=>e===fail);
  else assert.equal(await h.app.loadGraphData(),false);
  await tick();h.frame();assert.deepEqual(seen,[]);assert.equal(h.lifecycle.ready(a),false);
  h.setLoad(async()=>{h.lifecycle.schedule(a,()=>seen.push('recovered'));return true;});
  await h.app.loadGraphData();h.frame();assert.deepEqual(seen,['recovered']);
 }
});
test('overlapping loads and queued frames never revive the prior node or graph',async()=>{
 const h=harness(),a=h.node(1),first=deferred(),second=deferred(),seen=[];let calls=0;
 h.setLoad(()=>++calls===1?first.promise:second.promise);
 const old=h.app.loadGraphData();h.lifecycle.schedule(a,()=>seen.push('old'));
 const latest=h.app.loadGraphData();const b=h.node(1);h.lifecycle.schedule(b,()=>seen.push('new'));
 second.resolve(true);await latest;h.frame();assert.deepEqual(seen,[]);
 first.resolve(false);await old;h.frame();assert.deepEqual(seen,['new']);
 h.lifecycle.schedule(b,()=>seen.push('wrong graph'));h.app.graph={getNodeById:()=>b};
 await tick();assert.deepEqual(seen,['new']);
});
test('real capability validation remains visible after a successful native load',async()=>{
 const h=harness(),a=h.node(1),diagnostics=[];
 const history=canvasHistory(h.app,{diagnose:d=>diagnostics.push(d)});
 h.setLoad(async()=>{h.lifecycle.schedule(a,()=>history.amend(()=>assert.fail('must not write')));return true;});
 await h.app.loadGraphData();
 assert.throws(()=>h.frame(),/history.captureCanvasState/);
 assert.equal(diagnostics[0].capability,'history.captureCanvasState');
});
