import test from 'node:test';
import assert from 'node:assert/strict';
import {generationNodeKind,isGenerationNode} from '../../frontend/src/features/generation/node_families.js';
import {createVideoTasks,importVideoTasks,syncVideoTaskInputs} from '../../frontend/src/features/generation/video_tasks_model.mjs';
import {rowGenerationConfig,setRowGenerationConfig} from '../../frontend/src/features/generation/table_generation_model.mjs';
import {modelSourceBadge} from '../../frontend/src/features/models/source_badge.js';
import {DEFAULT_TEXT_INSTRUCTION,TEXT_TEMPLATES,changeInstructionTarget,processingInstruction} from '../../frontend/src/features/prompt/text_templates.js';
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
 assert.match(DEFAULT_TEXT_INSTRUCTION,/保留原意/);
 assert.match(DEFAULT_TEXT_INSTRUCTION,/未说明.*留白/);
 assert.match(TEXT_TEMPLATES[2].text,/不虚构/);
});

test('image reverse uses visual instructions and restores drafts for each target and mode',()=>{
 const state={purpose:'video',videoTarget:'seedance',mode:'polish',instruction:'保留原话'};
 changeInstructionTarget(state,'mode','reverse');
 const seedance=processingInstruction(state);
 assert.match(seedance,/^观察参考图片.*可见/);
 state.instruction='侧重背景建筑';
 changeInstructionTarget(state,'videoTarget','minimax');
 assert.doesNotMatch(processingInstruction(state),/首帧|尾帧|对齐/);
 assert.match(processingInstruction(state),/subject_definitions、summary、retention_analysis、detailed_description/);
 changeInstructionTarget(state,'purpose','image');
 assert.match(processingInstruction(state,'侧重材质'),/重现这张图片[\s\S]*侧重材质$/);
 changeInstructionTarget(state,'purpose','video');
 changeInstructionTarget(state,'videoTarget','seedance');
 assert.equal(processingInstruction(state),'侧重背景建筑');
 changeInstructionTarget(state,'mode','polish');
 assert.equal(processingInstruction(state),'保留原话');
 const savedDefault=processingInstruction({...state,instruction:undefined});
 assert.equal(processingInstruction({...state,mode:'reverse',instruction:savedDefault}),seedance);
 assert.equal(processingInstruction({...state,mode:'reverse',instruction:savedDefault+'\n侧重服装'}),seedance+'\n侧重服装');
});

test('switching video targets replaces the submitted requirements and restores edited drafts',()=>{
 const state={purpose:'video',videoTarget:'seedance',instruction:DEFAULT_TEXT_INSTRUCTION};
 const seedance=processingInstruction(state);
 assert.match(seedance,/首句直接写谁做了第一个动作/);
 assert.match(seedance,/\{原话\}.*<音效>.*（音乐）.*〖字幕原文〗/);
 const oldOpening='先写原文中的主体与场景，再按发生顺序描述动作和画面变化。区分主体动作与运镜，沿用已有参考素材的编号与用途。只有原文明确分镜时才分镜。';
 const previousSeedance=oldOpening+'\n'+DEFAULT_TEXT_INSTRUCTION;
 assert.equal(processingInstruction({...state,instruction:previousSeedance}),seedance);
 assert.equal(processingInstruction({...state,instruction:oldOpening+seedance.slice(seedance.indexOf('\n'))+'\n保留字幕'}),seedance+'\n保留字幕');
 assert.equal(processingInstruction({...state,instruction:'为 Seedance 整理提示词。'+seedance+'\n保留字幕'}),seedance+'\n保留字幕');
 state.instruction='保留台词原话';
 changeInstructionTarget(state,'videoTarget','minimax');
 const minimax=processingInstruction(state);
 assert.match(minimax,/^写中文镜头描述.*\[Shot 1\]/);
 const oldFrames=minimax.replace('已指定完整参考时','已指定首尾帧时写清两帧之间的连续变化；已指定完整参考时')
   .replace('\n参考素材','\n首帧是动作起点，尾帧是落点；两帧都给出时描述中间可见的变化。参考素材');
 assert.equal(processingInstruction({...state,instruction:oldFrames+'\n保留对白'}),minimax+'\n保留对白');
 const oldReference=TEXT_TEMPLATES.find(template=>template.id==='references').text;
 assert.equal(processingInstruction({...state,instruction:oldReference}),minimax);
 assert.equal(processingInstruction({...state,purpose:'image',instruction:oldReference}),oldReference);
 assert.equal(processingInstruction({...state,instruction:oldReference+'\n保留字幕'}),oldReference+'\n保留字幕');
 assert.match(minimax,/没有画面信息时，直接保留原句/);
 assert.equal(processingInstruction({...state,instruction:'为 MiniMax H3 '+minimax}),minimax);
 const previous=minimax.replace('写中文镜头描述','写英文镜头描述');
 for(const prefix of ['', '为 MiniMax H3 '])
  assert.equal(processingInstruction({...state,instruction:prefix+previous+'\n保留对白'}),minimax+'\n保留对白');
 assert.equal(processingInstruction({...state,instruction:'写英文镜头描述，只写三句'}),'写英文镜头描述，只写三句');
 assert.doesNotMatch(processingInstruction(state),/Seedance/);
 state.instruction='保留对白语言';
 changeInstructionTarget(state,'purpose','image');
 assert.equal(processingInstruction(state),DEFAULT_TEXT_INSTRUCTION);
 changeInstructionTarget(state,'purpose','video');
 assert.equal(processingInstruction(state),'保留对白语言');
 changeInstructionTarget(state,'videoTarget','seedance');
 assert.equal(processingInstruction(state),'保留台词原话');
});
