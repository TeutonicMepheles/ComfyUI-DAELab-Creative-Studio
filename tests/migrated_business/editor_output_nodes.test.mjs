import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditorOutputs} from '../../frontend/src/integrations/comfyui/canvas/editor_output_nodes.js';
import {ExportSession} from '../../frontend/src/features/editor/export_session.js';
import {MediaExportService} from '../../frontend/src/application/media_export_service.js';

function fixture(){
 let id=0;const graph={id:'doc',_nodes:[],links:{},extra:{},add(n){n.id=++id;n.graph=this;this._nodes.push(n);},remove(n){this._nodes=this._nodes.filter(item=>item!==n);},getNodeById(id){return this._nodes.find(n=>String(n.id)===String(id));}};
 const source={type:'DAELAB.VideoEdit',pos:[100,100],properties:{},outputs:[{name:'video'},{name:'video_ref'}]};graph.add(source);
 source.connect=(output,target,input)=>{assert.equal(output,1,'lineage uses video_ref rather than native video');const link=target.id;graph.links[link]={origin_id:source.id,target_id:target.id,origin_slot:output};target.inputs[input].link=link;return graph.links[link];};
 const create=type=>({type,pos:[0,0],properties:{},widgets:[{name:'asset_data',value:'{}'}],inputs:[{name:'source_report',link:null},{name:'source_video',link:null}],__mediaUpload:{reload(){}}});
 const app={graph},history={amend:fn=>fn()},controller=createEditorOutputs(source,app,history,create,()=>true);
 const binding=requestId=>({schemaVersion:1,reference:{schemaVersion:1,requestId,inputDigest:'a'.repeat(64),source:{documentId:'doc',nodeId:String(source.id)}},fingerprint:'b'.repeat(64),asset:{asset_id:'asset-'+requestId,reference_id:'ref-'+requestId,sha256:'c'.repeat(64),bytes:123},output:{filename:requestId+'.mp4',subfolder:'DAELAB/exports',type:'output'}});
 const outputs=()=>graph._nodes.filter(n=>n.type==='DAELAB.MediaUpload');
 return {graph,source,app,history,create,controller,binding,outputs};
}

test('verified export becomes one independently playable media reference with persistent lineage',()=>{
 const f=fixture(),binding=f.binding('one');assert.equal(f.controller.publish(binding),true);const target=f.outputs()[0],asset=JSON.parse(target.widgets[0].value);
 assert.equal(asset.filename,'one.mp4');assert.equal(asset.type,'output');assert.equal(asset.assetId,binding.asset.asset_id);assert.equal(asset.referenceId,binding.asset.reference_id);assert.equal(asset.contentSha256,binding.asset.sha256);
 assert.equal(f.graph.links[target.inputs[1].link].origin_id,f.source.id);assert.equal(target.inputs[0].link,null);
 f.controller.publish(binding);assert.equal(f.outputs().length,1);
 const reloaded=createEditorOutputs(f.source,f.app,f.history,f.create,()=>true);reloaded.publish(structuredClone(binding));assert.equal(f.outputs().length,1);
});

test('deletion or disconnection is retained on repeated notifications; a new export has a new output',()=>{
 const f=fixture();f.controller.publish(f.binding('one'));const target=f.outputs()[0];target.inputs[1].link=null;
 f.controller.publish(f.binding('one'));assert.equal(target.inputs[1].link,null);f.graph.remove(target);f.controller.publish(f.binding('one'));assert.equal(f.outputs().length,0);
 f.controller.publish(f.binding('two'));assert.equal(f.outputs().length,1);assert.equal(JSON.parse(f.outputs()[0].widgets[0].value).filename,'two.mp4');
});

test('failed, missing, copied or stale-workflow results do not create material',()=>{
 const f=fixture();f.controller.publish(undefined);f.controller.publish({...f.binding('copy'),reference:{...f.binding('copy').reference,source:{documentId:'other',nodeId:'1'}}});assert.equal(f.outputs().length,0);
 f.app.graph={};f.controller.publish(f.binding('stale'));assert.equal(f.outputs().length,0);f.app.graph=f.graph;f.controller.dispose();f.controller.publish(f.binding('disposed'));assert.equal(f.outputs().length,0);
});

test('a failed connection rolls back and is not marked as materialized',()=>{
 const f=fixture();f.source.connect=()=>null;assert.throws(()=>f.controller.publish(f.binding('one')),/无法连接/);assert.equal(f.outputs().length,0);assert.equal(f.source.properties.daelabEditOutputs,undefined);
});

test('localized native output names still connect the COMFYTV_VIDEO reference at its original slot',()=>{
 const f=fixture();f.source.outputs=[{name:'剪辑成片',type:'VIDEO'},{name:'剪辑成片引用',type:'COMFYTV_VIDEO'}];
 f.controller.publish(f.binding('localized'));assert.equal(f.graph.links[f.outputs()[0].inputs[1].link].origin_slot,1);
});

test('output placement avoids existing cards and keeps prior exports unchanged',()=>{
 const f=fixture();f.graph.extra.daelabCreativeCanvasV1={cards:{[f.source.id]:{x:100,y:100,width:840},existing:{x:1040,y:100,width:350,height:200}}};
 f.controller.publish(f.binding('one'));const first=f.outputs()[0],saved=first.widgets[0].value;assert.ok(first.pos[0]>1390);
 f.controller.publish(f.binding('two'));assert.equal(first.widgets[0].value,saved);assert.ok(f.outputs()[1].pos[0]>first.pos[0]+350);
});

test('a verified export-session completion automatically publishes once without another export submission',async t=>{
 const f=fixture(),state={},calls=[];
 const session=new ExportSession(new MediaExportService({async submit(value){calls.push(value.requestId);return{schemaVersion:1,requestId:value.requestId,state:'succeeded',version:1,fingerprint:'a'.repeat(64),editFingerprint:'b'.repeat(64),native:{promptId:'native',nodeId:'save',listIndex:0},providerTaskId:'native',cancelRequested:false,result:{kind:'assets',items:[{asset_id:'asset',reference_id:'ref',sha256:'c'.repeat(64),bytes:99}]},errorCode:null,source:{...value.source,operation:'video_export'},attempt:1,output:{filename:'verified.mp4',subfolder:'exports',type:'output'},recoveryAction:'read_result'};}}),{
  input:()=>({edit_data:JSON.stringify({version:1,clips:[{id:'one',duration:1}]}),connections:{},source:{documentId:'doc',nodeId:String(f.source.id)}}),current:()=>true,
  begin:()=>({}),canApply:()=>true,release(){},saveReference(ref){state.ref=ref;},apply(_ticket,binding){state.binding=binding;return true;},binding:()=>state.binding,
  changed(view){if(view.currentOutput&&!view.copied)f.controller.publish(view.currentOutput);}
 });t.after(()=>session.dispose());
 await session.start();assert.equal(f.outputs().length,1);assert.equal(JSON.parse(f.outputs()[0].widgets[0].value).filename,'verified.mp4');
 await session.inputChanged();assert.equal(f.outputs().length,1);assert.equal(calls.length,1);
});
