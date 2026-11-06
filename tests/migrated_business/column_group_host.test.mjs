import test from 'node:test';
import assert from 'node:assert/strict';
import {installColumnBindings,bindColumnGroup,boundColumnTargets} from '../../frontend/src/integrations/comfyui/business/column_group_binding.ts';
import {canvasHistory} from '../../frontend/src/integrations/comfyui/canvas/creative_history.mjs';

test('deferred table installation cannot reverse a restored deletion or enter history',()=>{
 const interval=globalThis.setInterval;let tick;
 globalThis.setInterval=callback=>{tick=callback;return {unref(){}};};
 try{
  const f=fixture();f.history.begin();bindColumnGroup(f.app,f.table,'media',f.group);f.history.end();
  const restored=structuredClone(f.table.__dataTable),properties=structuredClone(f.table.properties);
  f.history.begin();f.table.__dataTable.records[0].values.media=[];f.history.end();
  const deleted=structuredClone(f.table.__dataTable),deletedProperties=structuredClone(f.table.properties),members=[...f.group.properties.members];
  const tracker=f.app.extensionManager.workflow.activeWorkflow.changeTracker;
  let captures=0;tracker.captureCanvasState=()=>{captures++;};
  for(let cycle=0;cycle<4;cycle++){
   // Configure has restored widget/properties/group, but the old editor remains.
   f.table.__dataTable=restored;f.table.properties=structuredClone(deletedProperties);
   f.table.widgets=[{name:'table_data',value:JSON.stringify(deleted)}];
   tick();f.app.daelabColumnBindings.flush(f.graph);
   assert.deepEqual(f.group.properties.members,members);assert.equal(captures,0);
   assert.deepEqual(f.table.properties,deletedProperties);
   // Deferred install catches up; a healthy restored state stays read-only.
   f.table.__dataTable=structuredClone(deleted);tick();assert.equal(captures,0);
  }
  assert.notDeepEqual(properties,deletedProperties);
 }finally{globalThis.setInterval=interval;delete globalThis.LiteGraph;delete globalThis.window;}
});

function fixture(){
 let serial=0,linkSerial=0;const snapshots=[];
 const graph={_nodes:[],links:{},extra:{},getNodeById(id){return this._nodes.find(n=>String(n.id)===String(id));},add(n){n.graph=this;this._nodes.push(n);},serialize(){return {nodes:this._nodes.map(n=>({id:n.id,type:n.type,properties:structuredClone(n.properties),inputs:structuredClone(n.inputs),widgets:structuredClone(n.widgets),table:structuredClone(n.__dataTable)})),links:structuredClone(this.links)};}};
 const create=type=>{const node={id:++serial,type,properties:{},widgets:type==='DAELAB.MediaUpload'?[{name:'asset_data',value:''}]:type==='DAELAB.TextInput'?[{name:'text',value:''}]:[],inputs:[],outputs:[{type:'DAELAB_ASSETS'}],addInput(name,type){this.inputs.push({name,type,link:null});},connect(index,target,input){const link={id:++linkSerial,origin_id:this.id,origin_slot:index,target_id:target.id,target_slot:input};graph.links[link.id]=link;target.inputs[input].link=link.id;return link;}};return node;};
 const tracker={changeCount:0,captureCanvasState(){},squashState:{flush(){}},beforeChange(){this.changeCount++;},afterChange(){if(--this.changeCount===0)snapshots.push(graph.serialize());}};
 const app={graph,rootGraph:graph,isGraphReady:true,extensionManager:{workflow:{activeWorkflow:{changeTracker:tracker}},toast:{add(){}}}};
 installColumnBindings(app);const history=canvasHistory(app);
 const a=create('DAELAB.MediaUpload');a.widgets[0].value=JSON.stringify({id:'file-a',filename:'a.png',type:'input',kind:'image'});graph.add(a);
 const b=create('DAELAB.MediaUpload');b.widgets[0].value=JSON.stringify({id:'file-b',filename:'b.png',type:'input',kind:'image'});graph.add(b);
 const group=create('DAELAB.MaterialGroup');group.properties.members=[a.id,b.id];graph.add(group);
 const table=create('DAELAB.Table');table.__dataTable={version:1,fields:[{id:'media',name:'Media',type:'content'},{id:'other',name:'Other',type:'text'}],records:[1,2,3].map(n=>({id:'row'+n,values:{media:[],other:'safe'}})),meta:{}};table.__dataTablePanel={editor:{change(fn){const draft=structuredClone(table.__dataTable);fn(draft);table.__dataTable=draft;}}};graph.add(table);
 globalThis.LiteGraph={createNode:create};globalThis.window={confirm:()=>true};
 return {app,history,graph,group,table,a,b,snapshots,create};
}
test('native binding, group edits, reference moves and disconnect share the originating native history boundary',()=>{
 const f=fixture();f.history.begin();assert.equal(bindColumnGroup(f.app,f.table,'media',f.group),true);f.history.end();
 assert.deepEqual(f.table.__dataTable.records.map(r=>r.values.media.length),[1,1,0]);assert.equal(f.snapshots.length,1);
 const index=boundColumnTargets(f.table,[{key:'media',project:true}])[0].inputIndex;assert.equal(index,0);assert.equal(f.snapshots[0].nodes.find(n=>n.id===f.table.id).inputs[0].daeColumnField,'media');
 const c=f.create('DAELAB.MediaUpload');c.widgets[0].value=f.a.widgets[0].value;f.graph.add(c);
 f.history.begin();f.group.properties.members.push(c.id);f.history.end();assert.deepEqual(f.table.__dataTable.records.map(r=>r.values.media.length),[1,1,0,1]);
 // One file deliberately referenced again in another row becomes a separate member.
 f.history.begin();f.table.__dataTable.records[2].values.media=[{...f.table.__dataTable.records[0].values.media[0],id:'copy-reference'}];f.history.end();assert.equal(f.group.properties.members.length,4);
 const otherReference=f.group.properties.members.at(-2);f.history.begin();f.table.__dataTable.records[0].values.media=[];f.history.end();assert.equal(f.group.properties.members.length,3);assert.ok(f.group.properties.members.includes(otherReference));
 assert.deepEqual(f.table.__dataTable.records.map(r=>r.values.other),['safe','safe','safe','']);
 const sourceBefore=[...f.group.properties.members];f.history.begin();delete f.graph.links[f.table.inputs[index].link];f.table.inputs[index].link=null;f.history.end();assert.ok(f.table.__dataTable.records.every(r=>r.values.media.length===0));assert.deepEqual(f.group.properties.members,sourceBefore);
 assert.equal(f.snapshots.length,5);delete globalThis.LiteGraph;delete globalThis.window;
});
test('ending an old workflow transaction cannot propagate into the new graph',()=>{
 const f=fixture();let propagated=0;f.app.daelabColumnBindings={flush(){propagated++;}};f.history.begin();f.app.extensionManager.workflow.activeWorkflow={changeTracker:{}};f.history.end();assert.equal(propagated,0);assert.equal(f.snapshots.length,1);
 delete globalThis.LiteGraph;delete globalThis.window;
});

test('history restore retains references when native IO serialization drops custom input metadata',()=>{
 const f=fixture();f.history.begin();bindColumnGroup(f.app,f.table,'media',f.group);f.history.end();
 const before=structuredClone(f.table.__dataTable),properties=structuredClone(f.table.properties),widgets=[f.a.widgets[0].value,f.b.widgets[0].value];
 f.history.begin();f.table.__dataTable.records[0].values.media=[];f.history.end();assert.equal(f.group.properties.members.length,1);
 // Restore the owning graph snapshot as native history does, with runtime-only IO data omitted.
 f.table.__dataTable=before;f.table.properties=properties;f.group.properties.members=[f.a.id,f.b.id];[f.a.widgets[0].value,f.b.widgets[0].value]=widgets;delete f.table.inputs[0].daeColumnField;
 const tracker=f.app.extensionManager.workflow.activeWorkflow.changeTracker;tracker._restoringState=true;
 const savedLink=f.table.inputs[0].link;f.table.inputs[0].link=null;f.app.daelabColumnBindings.flush(f.graph);assert.equal(f.table.__dataTable.records[0].values.media.length,1,'transient missing links during restore cannot clear data');
 f.table.inputs[0].link=savedLink;tracker._restoringState=false;f.app.daelabColumnBindings.flush(f.graph);
 assert.deepEqual(f.table.__dataTable,before);assert.equal(f.table.inputs[0].daeColumnField,'media');assert.ok(f.table.properties.daelabColumnBindings.media);
 delete globalThis.LiteGraph;delete globalThis.window;
});

test('Autogrow renaming after a disconnected column never steals another bound column',()=>{
 const f=fixture();f.table.__dataTable.fields.push({id:'second',type:'content',name:'Second'});for(const row of f.table.__dataTable.records)row.values.second=[];
 f.history.begin();bindColumnGroup(f.app,f.table,'media',f.group);bindColumnGroup(f.app,f.table,'second',f.group);f.history.end();
 const second=structuredClone(f.table.__dataTable.records.map(row=>row.values.second));
 f.history.begin();const gone=f.table.inputs.shift();delete f.graph.links[gone.link];f.table.inputs[0].name='columns.column0';delete f.table.inputs[0].daeColumnField;f.history.end();
 assert.ok(f.table.__dataTable.records.every(row=>row.values.media.length===0));assert.deepEqual(f.table.__dataTable.records.map(row=>row.values.second),second);assert.equal(f.table.inputs[0].daeColumnField,'second');
 delete f.table.inputs[0].daeColumnField;f.app.daelabColumnBindings.flush(f.graph);assert.equal(f.table.inputs[0].daeColumnField,'second');
 delete globalThis.LiteGraph;delete globalThis.window;
});

test('post-restore polling rebuilds runtime ports without entering history or consuming redo',()=>{
 const interval=globalThis.setInterval;let tick;
 globalThis.setInterval=callback=>{tick=callback;return {unref(){}};};
 try{
  const f=fixture();f.history.begin();bindColumnGroup(f.app,f.table,'media',f.group);f.history.end();
  const tracker=f.app.extensionManager.workflow.activeWorkflow.changeTracker;
  const redo={deleteReference:true};tracker.redoQueue=[redo];
  tracker.beforeChange=()=>{tracker.redoQueue=[];throw new Error('restored state is not a new edit');};
  delete f.table.inputs[0].daeColumnField;
  const table=structuredClone(f.table.__dataTable),members=[...f.group.properties.members];
  tick();tick();
  assert.equal(f.table.inputs[0].daeColumnField,'media');
  assert.deepEqual(f.table.__dataTable,table);assert.deepEqual(f.group.properties.members,members);
  assert.deepEqual(tracker.redoQueue,[redo]);
 }finally{globalThis.setInterval=interval;delete globalThis.LiteGraph;delete globalThis.window;}
});
