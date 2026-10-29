import test from 'node:test';
import assert from 'node:assert/strict';
import {createVideoTasks,importVideoTasks,syncVideoTaskInputs,syncVideoTaskPromptWriteback} from '../../frontend/src/features/generation/video_tasks_model.mjs';
import {bindLinkedTaskReference,mergeLinkedTaskDuplicates,clearLinkedTaskInput} from '../../frontend/src/features/generation/video_task_linked_prompt.mjs';
import {generationInput,LOCAL_VIDEO_MODEL,LOCAL_REFERENCE_VIDEO_MODEL,applyPromptContent,setRowGenerationConfig,syncGenerationFrameTags,rowGenerationConfig} from '../../frontend/src/features/generation/table_generation_model.mjs';
function setup(){
 const state=createVideoTasks({model:LOCAL_VIDEO_MODEL,prompt:'A moving ball',mode:'text2video'}),{table,fieldId}=state,row=table.records[0],output=table.fields.find(f=>f.id===fieldId);
 const column={id:'linked',type:'content',videoInput:'first_frame'};table.fields.push(column);row.values.linked=[{id:'first',kind:'image',url:'/view?filename=first.png&type=input&subfolder='},{id:'last',kind:'image',url:'/view?filename=last.png&type=input&subfolder='}];state.inputs={first_frame:{recordId:row.id}};
 const cfg=()=>rowGenerationConfig(row,fieldId,output.generation),sync=()=>bindLinkedTaskReference(table,row,fieldId,cfg(),column,{preserveMode:true});
 return {state,table,fieldId,row,output,column,cfg,sync,input:()=>generationInput(table,fieldId,row.id)};
}
test('Slot material is immediately available without changing text-to-video or assigning frame roles',()=>{
 const a=setup(),b=setup();a.sync();a.sync();assert.equal(a.cfg().mode,'text2video');assert.equal(a.row.values.linked.length,2);assert.equal(a.input().assets.length,0);assert.equal(a.row.meta.generationFrames,undefined);assert.equal(b.row.meta?.generationReferences,undefined);
 const saved=JSON.parse(JSON.stringify(a.state));assert.deepEqual(generationInput(saved.table,saved.fieldId,saved.currentId),a.input());
});
test('explicit frame choices survive repeat Slot injection; disconnect requires reselection without changing mode',()=>{
 const a=setup();a.sync();setRowGenerationConfig(a.row,a.fieldId,{...a.cfg(),mode:'frames2video'});a.row.meta.generationFrames={[a.fieldId]:{first:{fieldId:'linked',assetId:'first'},last:{fieldId:'linked',assetId:'last'}}};syncGenerationFrameTags(a.table,a.fieldId,a.output.generation);a.sync();assert.deepEqual(a.input().assets.map(a=>a.id),['first','last']);clearLinkedTaskInput(a.state,'first_frame');assert.equal(a.cfg().mode,'frames2video');assert.throws(a.input,/首帧/);
});
test('material candidates become reference inputs only in supported reference mode; local FL still rejects it',()=>{
 const a=setup();a.sync();setRowGenerationConfig(a.row,a.fieldId,{...a.cfg(),mode:'image2video'});assert.throws(a.input,/仅支持/);setRowGenerationConfig(a.row,a.fieldId,{...a.cfg(),model:'Seedance 2.5'});assert.deepEqual(a.input().assets.map(a=>a.id),['first','last']);
});
test('legacy body copy is merged into Slot material and frame/@ identities follow canonical asset',()=>{
 const a=setup();a.table.fields.push({id:'snapshot',type:'content'});a.row.values.snapshot=[{id:'copy',sourceNodeId:'7',kind:'image',url:'/view?type=input&subfolder=&filename=first.png'}];a.row.meta||={};a.row.meta.generationFrames={[a.fieldId]:{first:{fieldId:'snapshot',assetId:'copy'},last:{fieldId:'linked',assetId:'last'}}};
 a.row.values[a.cfg().promptFieldId]={kind:'column-template',version:1,segments:[{type:'column',fieldId:'snapshot',assetId:'copy'}]};
 mergeLinkedTaskDuplicates(a.table,a.row,a.column);assert.equal(a.row.values.snapshot.length,0);assert.deepEqual(a.row.meta.generationFrames[a.fieldId].first,{fieldId:'linked',assetId:'first'});assert.equal(a.row.values[a.cfg().promptFieldId].segments[0].assetId,'first');
 const before=JSON.stringify(a.row);mergeLinkedTaskDuplicates(a.table,a.row,a.column);assert.equal(JSON.stringify(a.row),before);
});

test('frame-tag writeback preserves a table-fed node model switch; later source settings still win',()=>{
 const a=setup();a.sync();a.row.selected=true;setRowGenerationConfig(a.row,a.fieldId,{...a.cfg(),mode:'frames2video'});syncGenerationFrameTags(a.table,a.fieldId,a.output.generation);
 const source=structuredClone(a.table),state=importVideoTasks(source),output=state.table.fields.find(f=>f.id===state.fieldId),row=state.table.records[0];
 setRowGenerationConfig(row,state.fieldId,{...rowGenerationConfig(row,state.fieldId,output.generation),model:LOCAL_REFERENCE_VIDEO_MODEL,mode:'image2video'});syncGenerationFrameTags(state.table,state.fieldId,output.generation);
 const updated=structuredClone(source),origin=updated.records[0];applyPromptContent(updated,origin,a.cfg().promptFieldId,[{type:'text',text:'A moving ball'}]);
 assert.equal(rowGenerationConfig(origin,a.fieldId,a.output.generation).mode,'text2video');
 syncVideoTaskPromptWriteback(state,updated,source,[row.id]);assert.equal(rowGenerationConfig(row,state.fieldId,output.generation).model,LOCAL_REFERENCE_VIDEO_MODEL);assert.equal(generationInput(state.table,state.fieldId,row.id).config.mode,'image2video');
 const external=structuredClone(updated);setRowGenerationConfig(external.records[0],a.fieldId,{...a.cfg(),model:LOCAL_VIDEO_MODEL,mode:'text2video',settings:{seed:123}});
 syncVideoTaskInputs(state,external,updated);assert.equal(rowGenerationConfig(row,state.fieldId,output.generation).model,LOCAL_VIDEO_MODEL);
});
