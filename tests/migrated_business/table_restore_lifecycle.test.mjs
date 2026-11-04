import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import './register.mjs';
import {installWorkflowNodeLifecycle} from '../../frontend/src/integrations/comfyui/business/workflow_node_lifecycle.ts';
import {canvasHistory} from '../../frontend/src/integrations/comfyui/canvas/creative_history.mjs';

test('actual table registration waits for native restore and tracker activation before derived frame edits',async()=>{
 const frames=[],microtasks=[],extensions=[],nodes=new Map(),installs=[],events=[];
 const graph={getNodeById:id=>nodes.get(id),serialize:()=>({nodes:[]})};
 let finish;
 const gate=new Promise(resolve=>{finish=resolve;});
 let table;
 const app={graph,rootGraph:graph,isGraphReady:true,extensionManager:{workflow:{activeWorkflow:{}}},
  registerExtension:extension=>extensions.push(extension),
  async loadGraphData(){table.onAdded();table.saved='configured-reference';table.onConfigure();await gate;return true;}};
 const history=canvasHistory(app,{diagnose:()=>{}});
 const original=readFileSync(new URL('../../frontend/src/integrations/comfyui/business/data_table_nodes.mjs',import.meta.url),'utf8');
 // Keep production registration/scheduling; replace only DOM-heavy panel assembly.
 const source=original.replace(/^import .*;\s*$/gm,'')
  .replace(/function install\(node\)\{[\s\S]*?\nexport function registerTableNodes\(\)/,
   "function install(node){history.begin();try{installs.push(node.saved);}finally{history.end();}}\nfunction registerTableNodes()")
  +'\nregisterTableNodes();';
 runInNewContext(source,{app,history,installs,queueMicrotask:fn=>microtasks.push(fn),
  installWorkflowNodeLifecycle:host=>installWorkflowNodeLifecycle(host,fn=>frames.push(fn))});
 const extension=extensions[0];extension.setup?.();
 class Table{};extension.beforeRegisterNodeDef(Table,{name:'DAELAB.Table'});
 table=new Table();table.id=1;table.graph=graph;nodes.set(1,table);
 const loading=app.loadGraphData();
 for(const fn of microtasks.splice(0))fn();
 assert.deepEqual(installs,[],'no table edit may run during native load with a missing tracker');
 app.extensionManager.workflow.activeWorkflow.changeTracker={captureCanvasState(){events.push('capture');},
  squashState:{flush(){}},beforeChange(){events.push('begin');},afterChange(){events.push('end');}};
 finish();await loading;
 assert.deepEqual(installs,[]);
 for(const fn of frames.splice(0))fn();
 assert.deepEqual(installs,['configured-reference']);assert.deepEqual(events,['capture','begin','end']);
});
