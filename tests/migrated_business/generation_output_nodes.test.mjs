import test from 'node:test';
import assert from 'node:assert/strict';
import {createGenerationOutputs} from '../../frontend/src/integrations/comfyui/business/generation_output_nodes.js';
function fixture(){
 let id=0,edits=0;const graph={_nodes:[],links:{},extra:{},add(n){n.id=++id;n.graph=this;this._nodes.push(n);},remove(n){this._nodes=this._nodes.filter(x=>x!==n);},getNodeById(id){return this._nodes.find(n=>n.id===id);}};
 const create=type=>({type,properties:{},pos:[0,0],widgets:type==='DAELAB.MediaUpload'?[{name:'asset_data',value:'{}'}]:[],inputs:[{name:'source_report',link:null}],outputs:[],__mediaUpload:{reload(){},render(){}}});
 const node=create('generation');graph.add(node);node.outputs=[{name:'task_report'}];node.connect=(out,target,input)=>{const key=target.id;graph.links[key]={origin_id:node.id,target_id:target.id,origin_slot:out};target.inputs[input].link=key;return graph.links[key];};
 const app={graph};const controller=createGenerationOutputs(node,app,{amend(fn){edits++;return fn();}},create,()=>true);
 const job=(requestId,row='row-a')=>({requestId,source:{nodeId:String(node.id),documentId:'doc',recordId:row,inputDigest:'a'.repeat(64)},input:{recordId:row,config:{kind:'image'}}});
 const options={batch:false,rows:[{id:'row-a',name:'第一个任务'},{id:'row-b',name:'第二个任务'}]};
 const report=(job,phase='running')=>({requestId:job.requestId,source:job.source,phase,state:phase==='complete'?'succeeded':'running',version:1,inputFingerprint:'b'.repeat(64),...(phase==='complete'?{result:{url:'/view?filename=result.png&type=output',kind:'image',asset_id:'asset',reference_id:'ref'},receipt:{kind:'assets',items:[{asset_id:'asset',reference_id:'ref'}]}}:{})});
 const outputs=()=>graph._nodes.filter(n=>n.type==='DAELAB.MediaUpload');
 return {graph,node,app,controller,job,options,report,outputs,edits:()=>edits};
}
test('prepare links one persistent target and updates it in place, idempotently',()=>{
 const f=fixture(),job=f.job('one');f.controller.prepare([job],f.options);const target=f.outputs()[0],id=target.id;
 assert.equal(f.graph.links[target.inputs[0].link].origin_id,f.node.id);assert.equal(target.properties.materialPlaceholder.busy,true);
 f.controller.prepare([job],f.options);assert.equal(f.outputs().length,1);
 f.controller.update([f.report(job,'complete')]);assert.equal(f.outputs()[0].id,id);assert.equal(JSON.parse(target.widgets[0].value).filename,'result.png');
 const edits=f.edits();f.controller.update([f.report(job,'complete')]);assert.equal(f.edits(),edits);
});
test('batch outputs share a material group and sort by phase then task order',()=>{
 const f=fixture(),a=f.job('a'),b=f.job('b','row-b');f.controller.prepare([a,b],{...f.options,batch:true});
 const [one,two]=f.outputs(),group=f.graph._nodes.find(n=>n.type==='DAELAB.MaterialGroup');
 f.controller.update([f.report(a,'complete'),f.report(b)]);assert.deepEqual(group.properties.members,[two.id,one.id]);
 f.controller.prepare([f.job('retry')],{...f.options,batch:true});assert.equal(f.graph._nodes.filter(n=>n.type==='DAELAB.MaterialGroup').length,1);assert.equal(f.outputs().length,3);
});
test('deleted and disconnected outputs never resurrect on later reports',()=>{
 const f=fixture(),job=f.job('a');f.controller.prepare([job],f.options);const target=f.outputs()[0];target.inputs[0].link=null;assert.equal(f.controller.owns(job.requestId),false);
 f.controller.update([f.report(job,'complete')]);assert.equal(target.widgets[0].value,'{}');f.graph.remove(target);f.controller.update([f.report(job)]);assert.equal(f.outputs().length,0);
});
test('wrong identity, workflow switch and disposal cannot write targets',()=>{
 const f=fixture(),job=f.job('a');f.controller.prepare([job],f.options);const target=f.outputs()[0];
 f.controller.update([{...f.report(job,'complete'),source:{...job.source,documentId:'other'}}]);assert.equal(target.widgets[0].value,'{}');
 f.app.graph={};f.controller.update([f.report(job,'complete')]);assert.equal(target.widgets[0].value,'{}');f.app.graph=f.graph;f.controller.dispose();f.controller.update([f.report(job,'complete')]);assert.equal(target.widgets[0].value,'{}');
});
test('receipt mismatch and failure do not install media; unknown outcomes remain visible',()=>{
 const f=fixture(),job=f.job('a');f.controller.prepare([job],f.options);const target=f.outputs()[0];
 f.controller.update([{...f.report(job,'complete'),receipt:{kind:'assets',items:[]}}]);assert.equal(target.widgets[0].value,'{}');
 f.controller.update([{...f.report(job,'failed'),error:'failure'}]);assert.equal(target.properties.materialPlaceholder.label,'生成失败');assert.equal(target.properties.materialPlaceholder.busy,false);
 f.controller.update([f.report(job,'needs_recovery')]);assert.equal(target.properties.materialPlaceholder.label,'待恢复');
});
test('user replacement is not overwritten and separate instances stay independent',()=>{
 const f=fixture(),g=fixture(),job=f.job('a');f.controller.prepare([job],f.options);g.controller.prepare([g.job('b')],g.options);
 f.outputs()[0].widgets[0].value=JSON.stringify({filename:'manual.png'});f.controller.update([f.report(job,'complete')]);assert.equal(JSON.parse(f.outputs()[0].widgets[0].value).filename,'manual.png');assert.equal(g.outputs()[0].properties.materialPlaceholder.phase,'waiting');
});
test('JSON key order does not prevent legitimate ledger updates',()=>{
 const f=fixture(),job=f.job('a');f.controller.prepare([job],f.options);const report=f.report(job,'complete');report.source=Object.fromEntries(Object.entries(report.source).reverse());f.controller.update([report]);assert.equal(JSON.parse(f.outputs()[0].widgets[0].value).filename,'result.png');
});
