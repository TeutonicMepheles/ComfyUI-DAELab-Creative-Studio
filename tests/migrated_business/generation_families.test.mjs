import test from 'node:test';
import assert from 'node:assert/strict';
import {generationNodeKind,isGenerationNode} from '../../frontend/src/features/generation/node_families.js';
import {createVideoTasks,importVideoTasks,syncVideoTaskInputs} from '../../frontend/src/features/generation/video_tasks_model.mjs';
import {rowGenerationConfig,setRowGenerationConfig} from '../../frontend/src/features/generation/table_generation_model.mjs';
import {modelSourceBadge} from '../../frontend/src/features/models/source_badge.js';
import {DEFAULT_TEXT_INSTRUCTION,TEXT_TEMPLATES} from '../../frontend/src/features/prompt/text_templates.js';
const field=state=>state.table.fields.find(field=>field.id===state.fieldId);
const config=(state,row=state.table.records[0])=>rowGenerationConfig(row,state.fieldId,field(state).generation);

test('new media identities restrict kind; legacy identity remains mixed without rewriting data',()=>{
 assert.equal(generationNodeKind('DAELAB.ImageGenerate'),'image');assert.equal(generationNodeKind('DAELAB.VideoGenerate'),'video');
 assert.equal(generationNodeKind('DAELAB.LibTV.VideoGenerate'),null);assert.ok(isGenerationNode('DAELAB.LibTV.VideoGenerate'));
 assert.equal(config(createVideoTasks({},'image')).kind,'image');assert.equal(config(createVideoTasks({},'video')).kind,'video');
 const legacy=createVideoTasks({model:'Seedance 2.5',prompt:'existing'}),saved=JSON.stringify(legacy);
 assert.deepEqual(JSON.parse(saved),legacy);assert.equal(config(legacy).model,'Seedance 2.5');
});

test('typed table import and later upstream kind changes preserve own settings, draws and protected receipts',()=>{
 const origin=createVideoTasks({model:'Seedance 2.5',prompt:'source'});origin.table.records[0].selected=true;
 const image=importVideoTasks(origin.table,'',null,{kind:'image'}),row=image.table.records[0];
 assert.equal(config(image).kind,'image');setRowGenerationConfig(row,image.fieldId,{...config(image),attempts:3,settings:{ratio:'16:9',seed:42}});
 const previous=structuredClone(origin.table);field(origin).generation.settings.duration=8;field(origin).generationConfigRevision=2;
 syncVideoTaskInputs(image,origin.table,previous,{kind:'image'});
 assert.equal(config(image).kind,'image');assert.equal(config(image).attempts,3);assert.deepEqual(config(image).settings,{ratio:'16:9',seed:42});
 row.meta.generationColumns={[image.fieldId]:{requestId:'original',phase:'running'}};
 const before=structuredClone(row),prior=structuredClone(origin.table);field(origin).generationConfigRevision++;
 syncVideoTaskInputs(image,origin.table,prior,{kind:'image',skipConfig:new Set([row.id])});
 assert.deepEqual(row,before);
 const restored=JSON.parse(JSON.stringify(image));assert.deepEqual(config(restored),config(image));
});

test('source capsules use provider metadata regardless of model name and never infer licensing',()=>{
 assert.equal(modelSourceBadge({provider:'local',id:'API model'}),'本地');
 assert.equal(modelSourceBadge({provider:'comfy',id:'local model'}),'API');
 assert.equal(modelSourceBadge({provider:'qwen'}),'本地');assert.equal(modelSourceBadge({provider:'deepseek'}),'API');
 assert.equal(modelSourceBadge(null),'来源未知');
});

test('three editable templates constrain scene, movement and existing ordered references',()=>{
 assert.deepEqual(TEXT_TEMPLATES.map(template=>template.id),['scene','camera','references']);
 assert.ok(TEXT_TEMPLATES.every(template=>DEFAULT_TEXT_INSTRUCTION.includes(template.text)));
 assert.match(TEXT_TEMPLATES[2].text,/不虚构/);
});
