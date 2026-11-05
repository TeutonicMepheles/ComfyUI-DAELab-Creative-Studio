import test from 'node:test';
import assert from 'node:assert/strict';
import {installColumnBindings,bindColumnGroup,boundColumnTargets} from '../../frontend/src/integrations/comfyui/business/column_group_binding.ts';
import {canvasHistory} from '../../frontend/src/integrations/comfyui/canvas/creative_history.mjs';

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
