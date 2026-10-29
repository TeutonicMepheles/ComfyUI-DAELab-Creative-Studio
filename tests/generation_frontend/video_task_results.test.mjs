import test from 'node:test';
import assert from 'node:assert/strict';
import {videoTaskResultPreviews} from '../../web/features/generation/video_task_results.js';
import {createVideoTasks,videoTaskAssets} from '../../web/features/generation/video_tasks_model.mjs';
import {clearLinkedTaskInput} from '../../web/features/generation/video_task_linked_prompt.mjs';

const image={url:'/view?filename=old.png&type=output',kind:'image',name:'old'};
const video={url:'/view?filename=new.mp4&type=output',kind:'video',name:'new'};
const completed=(requestId,result,createdAt=1)=>({requestId,phase:'complete',result,source:{createdAt}});
const referenced=(asset,requestId)=>({...asset,id:requestId,provenance:{requestId}});

test('completed results remain viewable without writeback after inputs change or reload',()=>{
 const receipt=completed('old',video),before=structuredClone(receipt),saved=[];
 assert.deepEqual(videoTaskResultPreviews(saved,receipt),[referenced(video,'old')]);
 assert.deepEqual(videoTaskResultPreviews(saved,JSON.parse(JSON.stringify(receipt))),[referenced(video,'old')]);
 assert.deepEqual(saved,[]);assert.deepEqual(receipt,before);
});

test('rerunning, failure and completion preserve prior history without duplicate previews',()=>{
 const old=completed('old',image),saved=[{...image,provenance:{requestId:'old'}}];
 for(const phase of ['waiting','running','failed','needs_recovery']){
  assert.deepEqual(videoTaskResultPreviews(saved,{requestId:'new',phase,history:[old]}),saved);
 }
 const receipt={...completed('new',video),history:[old]};
 assert.deepEqual(videoTaskResultPreviews(saved,receipt),[...saved,referenced(video,'new')]);
 assert.deepEqual(videoTaskResultPreviews([...saved,{...video,provenance:{requestId:'new'}}],receipt).map(a=>a.url),[image.url,video.url]);
 assert.deepEqual(videoTaskResultPreviews([],completed('pending',undefined)),[]);
});

test('legacy retained results can be viewed; unfinished media is not presented as completed',()=>{
 assert.deepEqual(videoTaskResultPreviews([],{phase:'stale',result:video,legacy:true}),[video]);
 assert.deepEqual(videoTaskResultPreviews([],{phase:'running',result:video}),[]);
 assert.deepEqual(videoTaskResultPreviews([],{phase:'complete',result:{kind:'text',url:'not-media'}}),[]);
 assert.deepEqual(videoTaskResultPreviews([],null),[]);
});

test('disconnect clears old previews persistently, without erasing history or blocking later results',()=>{
 const state=createVideoTasks({prompt:'linked'}),row=state.table.records[0];
 state.inputs={text_input:{recordId:row.id,text:'linked'}};row.values[state.fieldId]=[image];
 clearLinkedTaskInput(state,'text_input');
 const after=row.meta.generationPreviewAfter[state.fieldId],receipt={...completed('new',video,after+1),history:[completed('old',image,after-1)]};
 assert.deepEqual(row.values[state.fieldId],[]);
 assert.deepEqual(videoTaskResultPreviews([],receipt,after),[referenced(video,'new')]);
 const restored=JSON.parse(JSON.stringify(state));
 assert.deepEqual(videoTaskResultPreviews([],receipt,restored.table.records[0].meta.generationPreviewAfter[state.fieldId]),[referenced(video,'new')]);
 assert.deepEqual(receipt.history[0].result,image);
});

test('material groups use the visible completed history in row order and preserve source identity without writeback',()=>{
 const state=createVideoTasks(),first=state.table.records[0],fieldId=state.fieldId;
 const historyVideo={...video,reference_id:'video-ref'},historyImage={...image,reference_id:'image-ref'};
 first.name='第一行';first.meta={generationColumns:{[fieldId]:{...completed('new',historyVideo),history:[completed('old',historyImage)]}}};first.values[fieldId]=[{...historyImage,id:'saved-image',provenance:{requestId:'old'}}];
 const second={id:'second',name:'第二行',values:{[fieldId]:[]},meta:{generationColumns:{[fieldId]:completed('second-video',{...video,url:'/view?filename=second.mp4',reference_id:'second-ref'})}}};
 const empty={id:'empty',values:{[fieldId]:[]}};
 state.table.records=[second,empty,first];const before=JSON.stringify(state),out=videoTaskAssets(state);
 assert.equal(out.ready,true);assert.equal(out.skipped,1);
 assert.deepEqual(out.groups,[{label:'第二行',count:1},{label:'第一行',count:2}]);
 assert.deepEqual(out.assets.map(a=>a.id),['second-ref','saved-image','video-ref']);
 assert.deepEqual(out.assets.map(a=>a.provenance.requestId),['second-video','old','new']);
 assert.deepEqual(out.assets.map(a=>a.provenance.recordId),['second',first.id,first.id]);
 assert(out.assets.every(a=>a.provenance.fieldId===fieldId&&a.provenance.materialId===a.id));
 assert.equal(JSON.stringify(state),before);
 assert.deepEqual(videoTaskAssets(JSON.parse(before)),out);
});

test('material output still skips disconnected history and unfinished tasks',()=>{
 const state=createVideoTasks(),row=state.table.records[0],fieldId=state.fieldId;
 row.values[fieldId]=[];row.meta={generationColumns:{[fieldId]:completed('old',video,1)},generationPreviewAfter:{[fieldId]:2}};
 assert.equal(videoTaskAssets(state).ready,false);assert.equal(videoTaskAssets(state).skipped,1);
 row.meta.generationColumns[fieldId]={phase:'running',result:video};
 assert.equal(videoTaskAssets(state).ready,false);
});
