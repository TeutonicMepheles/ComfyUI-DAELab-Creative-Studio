import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTable,removeField,SnapshotHistory,setValue,addField} from '../../frontend/src/features/table/data_table_model.mjs';
import {setPromptSource,promptSourceId,requirePromptSource} from '../../frontend/src/features/prompt/table_prompt_source.mjs';
import {effectivePrompt,resolveColumnPrompt,toColumnPrompt,setColumnTemplate} from '../../frontend/src/features/prompt/table_prompt_template.mjs';
import {columnReferenceOptions} from '../../frontend/src/features/table/table_reference_menu.mjs';
import {importVideoTasks,syncVideoTaskInputs,selectTaskPrompt} from '../../frontend/src/features/generation/video_tasks_model.mjs';
import {generationInput,generationFrames,applyColumnGenerationConfig,applyColumnFrameSources,rowGenerationConfig,setRowGenerationConfig,LOCAL_VIDEO_MODEL} from '../../frontend/src/features/generation/table_generation_model.mjs';
import {tableInput} from '../../frontend/src/features/prompt/llm_io_model.mjs';
import {createMaterialTable} from '../../frontend/src/application/table_material_columns.mjs';

const template=()=>({kind:'column-template',version:1,segments:[{type:'column',fieldId:'scene',valueType:'text'},{type:'column',fieldId:'motion',valueType:'text'},{type:'text',text:'保持写实风格。'}]});
const fixture=()=>normalizeTable({fields:[{id:'scene',name:'画面描述',type:'json',presentation:'prompt'},{id:'motion',name:'镜头运动',type:'text'},{id:'final',name:'最终描述',type:'json',presentation:'prompt'}],records:[{id:'r1',name:'任务1',values:{scene:toColumnPrompt('地球在左。'),motion:'向前推进。',final:template()}},{id:'r2',name:'任务2',values:{scene:toColumnPrompt('卫星在右。'),motion:'向右横移。',final:template()}}]});
const text=input=>input.segments.map(s=>s.text).join('');

test('column frame sources select the first image in each row and retain individual overrides until explicitly reapplied',()=>{
 const table=createMaterialTable(),prompt=promptSourceId(table),first=table.fields[0].id,last=addField(table,{name:'结束图片',type:'content'}).id;
 const config={version:1,kind:'video',model:LOCAL_VIDEO_MODEL,promptFieldId:prompt,mode:'frames2video',settings:{duration:4}};
 table.records.forEach((row,index)=>{
  row.values[prompt]='保留文字';row.values[first]=[{id:'video-'+index,kind:'video',url:'/view?filename=clip.mp4'},{id:'first-'+index,kind:'image',url:'/view?filename=first.png'},{id:'extra-'+index,kind:'image',url:'/view?filename=extra.png'}];
  row.values[last]=index===2?[]:[{id:'last-'+index,kind:'image',url:'/view?filename=last.png'}];
 });table.records[1].selected=false;
 applyColumnGenerationConfig(table,prompt,config);applyColumnFrameSources(table,prompt,{first,last});
 for(const [index,row] of table.records.entries()){
  const frames=generationFrames(table,row,prompt,config);assert.equal(frames[0].asset.id,'first-'+index);assert.equal(frames[1].asset?.id,index===2?undefined:'last-'+index);
 }
 assert.deepEqual(table.fields.find(f=>f.id===prompt).generationFrameColumns,{first,last});
 const row=table.records[0];row.meta.generationFrames[prompt].first={fieldId:first,assetId:'extra-0'};
 applyColumnGenerationConfig(table,prompt,config);applyColumnFrameSources(table,prompt,{last});
 assert.equal(generationFrames(table,row,prompt,config)[0].asset.id,'extra-0');
 const restored=normalizeTable(JSON.parse(JSON.stringify(table)));
 assert.equal(generationFrames(restored,restored.records[0],prompt,config)[0].asset.id,'extra-0');
 applyColumnFrameSources(table,prompt,{first,last:first});assert(generationFrames(table,row,prompt,config).every(f=>f.asset.id==='first-0'));
 row.values[first]=[];applyColumnFrameSources(table,prompt,{first,last:first});assert(generationFrames(table,row,prompt,config).every(f=>!f.asset));
 assert.throws(()=>applyColumnFrameSources(table,prompt,{first:'deleted'}),/图片列已变化/);
 const state=importVideoTasks(restored,{nodeId:'table',fieldId:prompt}),task=state.table.records[0];
 assert.equal(generationFrames(state.table,task,state.fieldId,state.table.fields.find(f=>f.id===state.fieldId).generation)[0].asset.id,'extra-0');
 applyColumnGenerationConfig(table,prompt,{...config,mode:'singleImage2video'});applyColumnFrameSources(table,prompt,{first:last,last:first});
 assert.deepEqual(generationFrames(table,row,prompt,{...config,mode:'singleImage2video'}).map(f=>f.asset.id),['last-0']);
});

test('column configuration applies to every row without creating a generation column and syncs explicit reapplication',()=>{
 const table=createMaterialTable(),prompt=promptSourceId(table),originalFields=table.fields.map(f=>f.id);
 table.records[1].selected=false;for(const row of table.records)row.values[prompt]='保留文字';
 assert.throws(()=>setPromptSource(table,null),/必须保留提示词列/);assert.throws(()=>removeField(table,prompt),/必须保留提示词列/);
 const config={version:1,kind:'video',model:LOCAL_VIDEO_MODEL,promptFieldId:prompt,mode:'frames2video',settings:{width:512,height:288,duration:4,turbo:true,seed:42}};
 const first=table.records[0],media=table.fields[0].id,binding={fieldId:media,assetId:'reference'};
 first.values[media]=[{id:'reference',kind:'image',url:'/view?filename=reference.png'}];first.values[prompt]={kind:'column-template',version:1,segments:[{type:'frame',generationFieldId:'old-output',role:'first'},{type:'text',text:'保留文字'}]};first.meta={generationFrames:{'old-output':{first:binding}}};
 applyColumnGenerationConfig(table,prompt,config);
 assert.deepEqual(first.meta.generationFrames[prompt].first,binding);assert.equal(generationFrames(table,first,prompt,config)[0].asset.id,'reference');
 assert.deepEqual(table.fields.map(f=>f.id),originalFields);assert.equal(table.fields.some(f=>f.presentation==='generation'),false);
 for(const row of table.records){assert.deepEqual(rowGenerationConfig(row,prompt,config),config);assert(row.values[prompt].segments.some(s=>s.type==='text'&&s.text==='保留文字'));assert.deepEqual(row.values[prompt].segments.filter(s=>s.type==='frame').map(s=>s.role),['first','last']);}
 const state=importVideoTasks(table),task=state.table.records[0];assert.notEqual(state.fieldId,prompt);assert.equal(state.table.fields.filter(f=>f.generation).length,1);
 assert.deepEqual(rowGenerationConfig(task,state.fieldId,config),config);
 setRowGenerationConfig(task,state.fieldId,{...config,settings:{...config.settings,duration:8}});
 task.values[state.fieldId]=[{id:'result',url:'/view?filename=result.mp4',kind:'video'}];
 let previous=structuredClone(table);table.records[0].name='重命名';syncVideoTaskInputs(state,table,previous);assert.equal(rowGenerationConfig(task,state.fieldId,config).settings.duration,8);
 previous=structuredClone(table);applyColumnGenerationConfig(table,prompt,config);syncVideoTaskInputs(state,table,previous);
 assert.equal(rowGenerationConfig(task,state.fieldId,config).settings.duration,4);assert.equal(task.values[state.fieldId][0].id,'result');assert.equal(state.table.fields.filter(f=>f.generation).length,1);
 const restored=JSON.parse(JSON.stringify(table));assert.deepEqual(rowGenerationConfig(restored.records[1],prompt,config),config);
 applyColumnGenerationConfig(table,prompt,{...config,mode:'text2video'});assert.equal(first.values[prompt].segments.some(s=>s.type==='frame'),false);assert(first.values[prompt].segments.some(s=>s.text==='保留文字'));
 const other=addField(table,{name:'其他文字',type:'text'});setPromptSource(table,other.id);removeField(table,prompt);assert.equal(promptSourceId(table),other.id);
});

test('generation and LLM task names match source row headers across selection, rename and reorder',()=>{
 const source=fixture();setPromptSource(source,'final');
 source.records.push({...structuredClone(source.records[1]),id:'r3'});
 for(const row of source.records)delete row.name;
 source.records[1].selected=false;
 const state=importVideoTasks(source);
 const check=(table,names)=>{assert.deepEqual(state.table.records.map(row=>row.name),names);assert.deepEqual(tableInput(table).rows.map(row=>row.name),names);};
 check(source,['任务1','任务3']);
 let previous=structuredClone(source);source.records[2].name='结尾镜头';syncVideoTaskInputs(state,source,previous);check(source,['任务1','结尾镜头']);
 previous=structuredClone(source);source.records.reverse();delete source.records[0].name;syncVideoTaskInputs(state,source,previous);check(source,['任务1','任务3']);
 assert.deepEqual(state.table.records.map(row=>row.id),['r3','r1']);
 previous=structuredClone(source);source.records[1].selected=true;syncVideoTaskInputs(state,source,previous);check(source,['任务1','任务2','任务3']);
 const restored=JSON.parse(JSON.stringify(source));check(restored,['任务1','任务2','任务3']);
});

test('only the designated prompt column offers text references while other columns retain images',()=>{
 const t=fixture(),row=t.records[0];setPromptSource(t,'final');
 t.fields.push({id:'images',name:'参考图',type:'content'});row.values.images=[{id:'img',kind:'image',url:'/view?filename=reference.png'}];
 assert.deepEqual(columnReferenceOptions(t,row,'scene').map(f=>f.id),['images']);
 assert(columnReferenceOptions(t,row,'final').some(f=>f.id==='motion'));
 const words={kind:'column-template',version:1,segments:[{type:'column',fieldId:'motion',valueType:'text'}]},picture={kind:'column-template',version:1,segments:[{type:'column',fieldId:'images',assetId:'img'}]};
 assert.equal(text(resolveColumnPrompt(words,t,row,'final')),'向前推进。');
 assert.throws(()=>resolveColumnPrompt(words,t,row,'scene'),/只有列头指定的提示词列/);
 assert.equal(resolveColumnPrompt(picture,t,row,'scene').assets[0].id,'img');
 setPromptSource(t,'scene');assert(columnReferenceOptions(t,row,'scene').some(f=>f.id==='motion'));
 assert.deepEqual(columnReferenceOptions(t,row,'final').map(f=>f.id),['images']);
 assert.throws(()=>resolveColumnPrompt(words,t,row,'final'),/只有列头指定的提示词列/);
});

test('legacy order/names are not bindings; explicit old binding migrates once and conflicts do not guess',()=>{
 const t=fixture();assert.equal(promptSourceId(t),null);assert.throws(()=>importVideoTasks(t,'scene'),/列头/);
 delete t.meta.generationInput;t.meta.prompt_config={bindings:{final_prompt:'final'}};
 const migrated=normalizeTable(t);assert.equal(promptSourceId(migrated),'final');assert.deepEqual(migrated.records,t.records);
 setPromptSource(migrated,null);assert.equal(promptSourceId(normalizeTable(migrated)),null);
 t.fields.push({id:'result',type:'content',presentation:'generation',generation:{promptFieldId:'scene'}});
 assert.equal(promptSourceId(normalizeTable(t)),null);
});

test('one binding transfers, copies do not claim it, deletion/undo/redo and serialization retain identity',()=>{
 let t=fixture();setPromptSource(t,'final');const original=JSON.stringify(t),history=new SnapshotHistory();
 setPromptSource(t,'scene');history.record(original,JSON.stringify(t));assert.equal(promptSourceId(t),'scene');assert.deepEqual(t.records[0].values.final,template());
 t=history.restore(JSON.stringify(t));assert.equal(promptSourceId(t),'final');
 t=history.restore(JSON.stringify(t),true);assert.equal(promptSourceId(t),'scene');
 const copied=addField(t,{...t.fields[0],id:'copied'});assert.equal(promptSourceId(t),'scene');assert.equal(copied.presentation,'prompt');
 const before=JSON.stringify(t);removeField(t,'scene');history.record(before,JSON.stringify(t));assert.equal(promptSourceId(normalizeTable(t)),null);
 t=history.restore(JSON.stringify(t));assert.equal(requirePromptSource(t).id,'scene');assert.equal(t.records[0].values.scene.segments[0].text,'地球在左。');
});

test('same-row text expansion matches imported generation input and survives rename/reorder/reload',()=>{
 const source=fixture();setPromptSource(source,'final');source.fields.reverse();source.records.reverse();source.fields.find(f=>f.id==='scene').name='画面（重命名）';
 const state=importVideoTasks(source,'motion');assert.equal(state.table.meta.generationInput.promptFieldId,'final');
 assert.equal(typeof state.table.records[0].values.motion,'string');
 for(const row of source.records){const expected=text(resolveColumnPrompt(row.values.final,source,row,'final'));assert.equal(text(generationInput(state.table,state.fieldId,row.id)),expected);}
 const restored=JSON.parse(JSON.stringify(state));assert.deepEqual(generationInput(restored.table,restored.fieldId,'r1'),generationInput(state.table,state.fieldId,'r1'));
 assert.throws(()=>selectTaskPrompt(state,'r1','motion'),/列头/);
});

test('text picker supports old literal documents; nested, empty, deleted and converted sources fail explicitly',()=>{
 const t=fixture(),row=t.records[0];setPromptSource(t,'final');
 const choices=columnReferenceOptions(t,row);assert.deepEqual(choices.map(f=>f.id),['scene','motion']);assert.equal(choices[0].textPreview,'地球在左。');
 row.values.scene=template();assert.throws(()=>resolveColumnPrompt(template(),t,row,'final'),/嵌套/);
 row.values.scene=toColumnPrompt('');assert.throws(()=>resolveColumnPrompt(template(),t,row,'final'),/任务1.*缺少文字.*画面描述/);
 row.values.scene=toColumnPrompt('恢复');removeField(t,'motion');assert.throws(()=>resolveColumnPrompt(template(),t,row,'final'),/已删除或类型已变化/);
 const self={...template(),segments:[{type:'column',fieldId:'final',valueType:'text'}]};assert.throws(()=>resolveColumnPrompt(self,t,row,'final'),/自身/);
 const f=t.fields.find(f=>f.id==='scene');f.type='content';delete f.presentation;row.values.scene=[{id:'a',url:'/view?filename=a.png'}];assert.throws(()=>resolveColumnPrompt(template(),t,row,'final'),/类型已变化/);
});

test('source updates preserve submitted snapshots/results, and clearing designation blocks new export',()=>{
 const source=fixture();setPromptSource(source,'final');const state=importVideoTasks(source),row=state.table.records[0];
 const receipt={phase:'complete',input:generationInput(state.table,state.fieldId,row.id),requestId:'saved'};row.meta.generationColumns={[state.fieldId]:structuredClone(receipt)};row.values[state.fieldId]=[{id:'done',url:'/view?filename=done.png'}];
 const next=structuredClone(source);next.records[0].values.motion='拉远。';syncVideoTaskInputs(state,next,source);assert.equal(text(generationInput(state.table,state.fieldId,row.id)),'地球在左。拉远。保持写实风格。');
 assert.deepEqual(row.meta.generationColumns[state.fieldId],receipt);assert.equal(row.values[state.fieldId][0].id,'done');
 const changed=structuredClone(next);setPromptSource(changed,'motion');syncVideoTaskInputs(state,changed,next);assert.equal(text(generationInput(state.table,state.fieldId,row.id)),'拉远。');
 const cancelled=structuredClone(changed);setPromptSource(cancelled,null);syncVideoTaskInputs(state,cancelled,changed);assert.throws(()=>generationInput(state.table,state.fieldId,row.id),/列头/);
 syncVideoTaskInputs(state,changed,cancelled);assert.equal(text(generationInput(state.table,state.fieldId,row.id)),'拉远。');assert.deepEqual(row.meta.generationColumns[state.fieldId],receipt);
});

test('deleted source rows remove tasks and restored rows import current inputs',()=>{
 const source=fixture();setPromptSource(source,'final');const state=importVideoTasks(source),row=state.table.records[0];
 const receipt={phase:'complete',input:generationInput(state.table,state.fieldId,row.id),requestId:'saved'};
 row.meta.generationColumns={[state.fieldId]:structuredClone(receipt)};row.values[state.fieldId]=[{id:'done',url:'/view?filename=done.png'}];
 const deleted=structuredClone(source);deleted.records=deleted.records.filter(r=>r.id!==row.id);syncVideoTaskInputs(state,deleted,source);
 assert.throws(()=>generationInput(state.table,state.fieldId,row.id),/记录已删除/);
 assert.equal(state.table.records.some(r=>r.id===row.id),false);
 assert.deepEqual(row.meta.generationColumns[state.fieldId],receipt);assert.equal(row.values[state.fieldId][0].id,'done');
 syncVideoTaskInputs(state,source,deleted);assert.equal(text(generationInput(state.table,state.fieldId,row.id)),'地球在左。向前推进。保持写实风格。');
 const restored=state.table.records.find(r=>r.id===row.id);assert.deepEqual(restored.values[state.fieldId],[]);assert.equal(restored.meta.generationColumns,undefined);
});

test('explicit clear differs from inheriting a column template, and pasted @ stays literal',()=>{
 const t=fixture(),row=t.records[0];setPromptSource(t,'final');setColumnTemplate(t,'final',template(),{replaceRows:true});
 assert.equal(text(resolveColumnPrompt(effectivePrompt(t,row,'final'),t,row,'final')),'地球在左。向前推进。保持写实风格。');
 setValue(t,row.id,'final','');assert.throws(()=>resolveColumnPrompt(effectivePrompt(t,row,'final'),t,row,'final'),/为空/);
 row.values.final='';assert.equal(effectivePrompt(t,row,'final'),t.fields.find(f=>f.id==='final').promptTemplate);
 setValue(t,row.id,'final','@画面描述');assert.equal(text(resolveColumnPrompt(effectivePrompt(t,row,'final'),t,row,'final')),'@画面描述');
});
