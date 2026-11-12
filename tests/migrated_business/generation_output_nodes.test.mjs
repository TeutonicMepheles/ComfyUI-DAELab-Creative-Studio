import test from 'node:test';
import assert from 'node:assert/strict';
import {createGenerationOutputs} from '../../frontend/src/integrations/comfyui/business/generation_output_nodes.js';
function fixture(){
 let id=0,edits=0;const graph={_nodes:[],links:{},extra:{},add(n){n.id=++id;n.graph=this;this._nodes.push(n);},remove(n){this._nodes=this._nodes.filter(x=>x!==n);},getNodeById(id){return this._nodes.find(n=>n.id===id);}};
 const create=type=>({type,properties:{},pos:[0,0],widgets:type==='DAELAB.MediaUpload'?[{name:'asset_data',value:'{}'}]:[],inputs:[{name:'source_report',link:null}],outputs:[],__mediaUpload:{reload(){},render(){}}});
 const node=create('generation');graph.add(node);node.outputs=[{name:'task_report',links:[]}];node.connect=(out,target,input)=>{const key=target.id;node.outputs[out].links.push(key);graph.links[key]={origin_id:node.id,target_id:target.id,origin_slot:out};target.inputs[input].link=key;return graph.links[key];};
 const app={graph};const controller=createGenerationOutputs(node,app,{amend(fn){edits++;return fn();}},create,()=>true);
 const job=(requestId,row='row-a')=>({requestId,source:{nodeId:String(node.id),documentId:'doc',recordId:row,inputDigest:'a'.repeat(64)},input:{recordId:row,config:{kind:'image'}}});
 const options={batch:false,rows:[{id:'row-a',name:'第一个任务'},{id:'row-b',name:'第二个任务'}]};
 const report=(job,phase='running')=>({requestId:job.requestId,source:job.source,phase,state:phase==='complete'?'succeeded':'running',version:1,inputFingerprint:'b'.repeat(64),...(phase==='complete'?{result:{url:'/view?filename=result.png&type=output',kind:'image',asset_id:'asset',reference_id:'ref'},receipt:{kind:'assets',items:[{asset_id:'asset',reference_id:'ref'}]}}:{})});
 const outputs=()=>graph._nodes.filter(n=>n.type==='DAELAB.MediaUpload');
 const drop=(batch=false)=>{const existing=!batch&&controller.activeOutput();if(existing)return existing;const target=create(batch?'DAELAB.MaterialGroup':'DAELAB.MediaUpload');graph.add(target);controller.bindWaiting(target);return target;};
 return {graph,node,app,controller,drop,job,options,report,outputs,edits:()=>edits};
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
 assert.equal(Object.keys(f.graph.links).length,1);assert.equal(f.graph.links[group.inputs[0].link].target_id,group.id);
 assert.ok([one,two].every(n=>n.inputs[0].link===null&&n.properties.generationOutput.groupId===group.id));
 f.controller.update([f.report(a,'complete'),f.report(b)]);assert.deepEqual(group.properties.members,[two.id,one.id]);
 f.controller.prepare([f.job('retry')],{...f.options,batch:true});assert.equal(f.graph._nodes.filter(n=>n.type==='DAELAB.MaterialGroup').length,1);assert.equal(f.outputs().length,3);
 assert.equal(Object.keys(f.graph.links).length,1);
});

test('group disconnection or membership removal stops writes without reviving the group',()=>{
 const f=fixture(),a=f.job('a'),b=f.job('b','row-b');f.controller.prepare([a,b],{...f.options,batch:true});
 const [one,two]=f.outputs(),group=f.graph._nodes.find(n=>n.type==='DAELAB.MaterialGroup');
 group.properties.members=group.properties.members.filter(id=>id!==one.id);
 f.controller.update([f.report(a,'complete'),f.report(b)]);assert.equal(one.widgets[0].value,'{}');assert.equal(two.properties.materialPlaceholder.phase,'running');
 group.inputs[0].link=null;assert.equal(f.controller.owns(b.requestId),false);
 f.controller.update([f.report(b,'complete')]);assert.equal(two.widgets[0].value,'{}');
 f.controller.prepare([f.job('new')],{...f.options,batch:true});assert.equal(group.inputs[0].link,null);assert.equal(f.graph._nodes.filter(n=>n.type==='DAELAB.MaterialGroup').length,2);
 f.graph.remove(group);f.controller.update([f.report(b,'complete')]);assert.equal(two.widgets[0].value,'{}');
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
 f.controller.update([{...f.report(job,'needs_recovery'),error:'remote_execution_interrupted_unknown'}]);assert.equal(target.properties.materialPlaceholder.label,'执行状态待核实');
 assert.equal(target.properties.materialPlaceholder.detail,'本地执行已中断，远端结果待核实');assert.equal(target.properties.materialPlaceholder.busy,false);
 f.controller.update([f.report(job,'interrupting')]);assert.equal(target.properties.materialPlaceholder.label,'中止中');assert.equal(target.properties.materialPlaceholder.busy,true);
});
test('user replacement is not overwritten and separate instances stay independent',()=>{
 const f=fixture(),g=fixture(),job=f.job('a');f.controller.prepare([job],f.options);g.controller.prepare([g.job('b')],g.options);
 f.outputs()[0].widgets[0].value=JSON.stringify({filename:'manual.png'});f.controller.update([f.report(job,'complete')]);assert.equal(JSON.parse(f.outputs()[0].widgets[0].value).filename,'manual.png');assert.equal(g.outputs()[0].properties.materialPlaceholder.phase,'waiting');
});
test('JSON key order does not prevent legitimate ledger updates',()=>{
 const f=fixture(),job=f.job('a');f.controller.prepare([job],f.options);const report=f.report(job,'complete');report.source=Object.fromEntries(Object.entries(report.source).reverse());f.controller.update([report]);assert.equal(JSON.parse(f.outputs()[0].widgets[0].value).filename,'result.png');
});

for(const kind of ['image','video'])test(`dragged output waits, receives ${kind} in place, and remains bound on retry`,()=>{
 const f=fixture(),target=f.drop(),job=f.job('first');
 assert.equal(target.properties.materialPlaceholder.label,'等待上游生成结果');
 assert.equal(f.graph.links[target.inputs[0].link].origin_id,f.node.id);
 job.input.config.kind=kind;f.controller.prepare([job],f.options);
 assert.equal(f.outputs().length,1);assert.equal(target.properties.generationOutput.requestId,'first');
 const during=f.drop(),done=f.report(job,'complete');done.result.kind=kind;done.result.url='/view?type=output&filename=result.'+(kind==='video'?'mp4':'png');
 assert.equal(during,target);assert.equal(f.outputs().length,1);
 f.controller.update([done]);assert.equal(JSON.parse(target.widgets[0].value).kind,kind);
 const next=f.drop();f.controller.prepare([f.job('retry')],f.options);assert.equal(next.properties.generationOutput.requestId,'retry');assert.equal(target.properties.generationOutput.requestId,'first');
});
test('new batch groups receive subsequent submissions while running and queued jobs finish in their original group',()=>{
 const f=fixture(),options={...f.options,batch:true},a=f.job('a'),b=f.job('b','row-b');
 f.controller.prepare([a,b],options);
 const original=f.graph._nodes.find(n=>n.type==='DAELAB.MaterialGroup'),[first,second]=f.outputs();
 f.controller.update([f.report(a),f.report(b,'waiting')]);
 const next=f.drop(true);assert.deepEqual(next.properties.members,[]);assert.equal(f.outputs().length,2);
 f.graph._nodes.reverse();
 const c=f.job('c');f.controller.prepare([a,b,c],options);
 const third=f.outputs().find(n=>n.properties.generationOutput.requestId==='c');
 assert.deepEqual(next.properties.members,[third.id]);
 f.controller.update([f.report(a,'complete'),f.report(b,'complete'),f.report(c)]);
 assert.deepEqual(original.properties.members,[first.id,second.id]);assert.deepEqual(next.properties.members,[third.id]);
 assert.equal(JSON.parse(first.widgets[0].value).filename,'result.png');assert.equal(third.properties.materialPlaceholder.phase,'running');
 const newest=f.drop(true);f.controller.prepare([f.job('d')],options);
 assert.equal(newest.properties.members.length,1);assert.deepEqual(next.properties.members,[third.id]);
});
test('the saved user-selected group receives every later submission, regardless of link ordering or single-row mode',()=>{
 const f=fixture(),first=f.drop(true),chosen=f.drop(true),chosenId=chosen.id;
 assert.equal(f.node.properties.generationOutputGroupId,chosenId);
 // A native graph may renumber links when it is restored.
 const slot=first.inputs[0];f.graph.links[100]=f.graph.links[slot.link];delete f.graph.links[slot.link];slot.link=100;
 for(const [batch,keys] of [[true,['a','b']],[false,['c']],[true,['d']]]){
  f.controller.prepare(keys.map(key=>f.job(key)),{...f.options,batch});
  assert.ok(f.outputs().every(n=>n.properties.generationOutput.groupId===chosenId));
  assert.equal(f.graph._nodes.filter(n=>n.type==='DAELAB.MaterialGroup').length,2);
 }
 assert.equal(first.properties.members.length,0);assert.equal(chosen.properties.members.length,4);
});
test('a previously saved empty group is adopted even if an automatic group was connected later',()=>{
 const f=fixture(),waiting=f.drop(true),auto=f.drop(true),options={...f.options,batch:true};
 f.controller.prepare([f.job('old')],options);delete f.node.properties.generationOutputGroupId;
 f.controller.prepare([f.job('a'),f.job('b')],options);
 f.controller.prepare([f.job('c')],options);
 assert.equal(f.node.properties.generationOutputGroupId,waiting.id);
 assert.equal(waiting.properties.members.length,3);assert.equal(auto.properties.members.length,1);
 assert.equal(f.graph._nodes.filter(n=>n.type==='DAELAB.MaterialGroup').length,2);
});
test('a new batch group takes priority over old single waiting nodes and skips disconnected or locked groups',()=>{
 const f=fixture(),waiting=f.drop(),g=f.drop(true),next=f.drop(true),last=f.drop(true);
 next.properties.locked=true;last.inputs[0].link=null;
 f.controller.prepare([f.job('a')],{...f.options,batch:true});
 assert.equal(waiting.properties.generationOutput.requestId,undefined);assert.equal(g.properties.members.length,1);
 assert.deepEqual(next.properties.members,[]);assert.deepEqual(last.properties.members,[]);
});
test('surplus waiting nodes only receive later requests',()=>{
 const f=fixture(),first=f.drop(),next=f.drop(),job=f.job('a');
 f.controller.prepare([job],f.options);assert.equal(first.properties.generationOutput.requestId,'a');
 assert.equal(next.properties.generationOutput.requestId,undefined);
 f.controller.update([f.report(job,'complete')]);assert.equal(next.widgets[0].value,'{}');
 f.controller.prepare([f.job('b')],f.options);assert.equal(next.properties.generationOutput.requestId,'b');
});
test('waiting outputs follow batch submission order and skip disconnected targets',()=>{
 const f=fixture(),detached=f.drop(),first=f.drop();detached.inputs[0].link=null;
 f.controller.prepare([f.job('a'),f.job('b','row-b')],{...f.options,batch:true});
 assert.equal(detached.properties.generationOutput.requestId,undefined);assert.equal(first.properties.generationOutput.requestId,'a');
 const next=f.outputs().find(n=>n.properties.generationOutput.requestId==='b');
 assert.ok(next.properties.generationOutput.groupId);
});
