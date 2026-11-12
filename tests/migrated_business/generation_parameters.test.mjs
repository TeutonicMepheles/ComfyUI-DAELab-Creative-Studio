import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {installDom} from './prompt_optimization_dom.mjs';
import {generationDurationOptions,generationParameterSpecs,generationParameterModes,generationModes,generationModeChoice,promptSettingsItems,generationParametersSummary,createGenerationParameters,generationSettingSpecs} from '../../frontend/src/features/prompt/table_prompt_settings.mjs';
import {generationModelIconURL} from '../../frontend/src/features/generation/generation_model_icons.mjs';
import {LOCAL_VIDEO_MODEL,applyColumnGenerationConfig,promptGenerationOwner,rowGenerationConfig,generationAttempts,applyTaskGenerationConfig,syncGenerationPromptMode} from '../../frontend/src/features/generation/table_generation_model.mjs';
import {createVideoTasks} from '../../frontend/src/features/generation/video_tasks_model.mjs';
import {LOCAL_VIDEO_SIZE_PRESETS,localVideoSizePresets,normalizeLocalGenerationConfig} from '../../frontend/src/features/prompt/table_prompt_settings.mjs';
import {applyGenerationModelDefaults,needsGenerationPromptSelector} from '../../frontend/src/features/generation/table_generation_panel.mjs';
import {normalizeTable} from '../../frontend/src/features/table/data_table_model.mjs';
import {OPTIMIZATION_MODELS} from '../../frontend/src/features/prompt/prompt_optimization_model.mjs';

test('new video tasks enable audio and saved off survives normalizing the model settings',()=>{
 const config=sound=>createVideoTasks({model:'Seedance 2.5',sound}).table.fields.find(field=>field.generation).generation;
 assert.equal(config().settings.enableSound,true);
 assert.equal(config(false).settings.enableSound,false);
 const saved=config(false);saved.settings.enableSound='off';
 normalizeLocalGenerationConfig(saved,{properties:{modeType:{items:{text2video:[]}},enableSound:{type:'boolean',default:true}},config:{settings:['enableSound']}});
 assert.equal(saved.settings.enableSound,false);
});

test('shared task choices preserve each row inputs, bindings and existing results across reload',()=>{
 const state=createVideoTasks(),table=state.table,field=table.fields.find(f=>f.id===state.fieldId),first=table.records[0];
 first.values[field.generation.promptFieldId]='first prompt';first.values[field.id]=[{id:'existing-result'}];
 first.meta={generationFrames:{[field.id]:{first:{assetId:'image-one'}}},generationReferences:{[field.id]:[{assetId:'image-one'}]}};
 const second=structuredClone(first);second.id='second';second.selected=false;second.values[field.generation.promptFieldId]='second prompt';second.meta.generationFrames[field.id].first.assetId='image-two';second.meta.generationReferences[field.id][0].assetId='image-two';table.records.push(second);
 const values=structuredClone(table.records.map(row=>row.values)),bindings=structuredClone(table.records.map(row=>row.meta));
 applyTaskGenerationConfig(table,field.id,{...field.generation,model:'Seedance 2.0',mode:'mixed2video',settings:{duration:8},attempts:3});
 const reloaded=JSON.parse(JSON.stringify(table));
 for(const [index,row] of reloaded.records.entries()){
  const config=rowGenerationConfig(row,field.id,reloaded.fields.find(f=>f.id===field.id).generation);
  assert.equal(config.mode,'mixed2video');assert.equal(config.model,'Seedance 2.0');assert.equal(config.settings.duration,8);assert.equal(generationAttempts(config),1);
  assert.deepEqual(row.values,values[index]);assert.deepEqual(row.meta.generationFrames,bindings[index].generationFrames);assert.deepEqual(row.meta.generationReferences,bindings[index].generationReferences);
 }
 first.meta.generationSettings[field.generation.promptFieldId][field.id].settings.duration=99;
 assert.equal(rowGenerationConfig(second,field.id,field.generation).settings.duration,8);
});

test('sharing keeps protected tasks on their original default even when they have no row override',()=>{
 const state=createVideoTasks(),table=state.table,field=table.fields.find(f=>f.id===state.fieldId),first=table.records[0],second=structuredClone(first);second.id='held';table.records.push(second);
 const before=structuredClone(rowGenerationConfig(second,field.id,field.generation));
 applyTaskGenerationConfig(table,field.id,{...field.generation,mode:'mixed2video',settings:{duration:9}},{skip:new Set(['held'])});
 assert.equal(rowGenerationConfig(first,field.id,field.generation).mode,'mixed2video');
 assert.deepEqual(rowGenerationConfig(second,field.id,field.generation),before);
});

test('explicit shared text mode is not silently changed by an existing material reference',()=>{
 const state=createVideoTasks({model:'Seedance 2.5'}),table=state.table,field=table.fields.find(f=>f.id===state.fieldId),row=table.records[0];
 row.values[field.generation.promptFieldId]={kind:'column-template',version:1,segments:[{type:'text',text:'Independent prompt'},{type:'column',fieldId:'pictures',assetId:'own-picture'}]};
 const before=structuredClone(table);applyTaskGenerationConfig(table,field.id,{...field.generation,mode:'text2video'});
 syncGenerationPromptMode(table,before,field.id,field.generation);
 assert.equal(rowGenerationConfig(row,field.id,field.generation).mode,'text2video');
 assert.deepEqual(row.values[field.generation.promptFieldId].segments,[{type:'text',text:'Independent prompt'}]);
});

test('H3 ratio presets use exact 32-aligned dimensions and obey live size bounds',()=>{
 const schema={properties:{width:{min:32,max:8192,step:32},height:{min:32,max:8192,step:32}}};
 assert.deepEqual(localVideoSizePresets(schema).map(p=>p.ratio),['16:9','9:16','1:1','4:3','3:4']);
 for(const preset of LOCAL_VIDEO_SIZE_PRESETS){const [w,h]=preset.ratio.split(':').map(Number);assert.equal(preset.width*h,preset.height*w);assert.equal(preset.width%32,0);assert.equal(preset.height%32,0);}
 assert.deepEqual(localVideoSizePresets({properties:{...schema.properties,width:{min:32,max:384,step:32}}}).map(p=>p.ratio),['9:16','1:1','3:4']);
 assert.deepEqual(localVideoSizePresets({}),[]);
});

test('new local H3 uses a preset while old custom dimensions and unrelated settings survive',()=>{
 const schema={properties:{modeType:{items:{text2video:[]}},width:{type:'integer',default:768,min:32,max:8192,step:32},height:{type:'integer',default:448,min:32,max:8192,step:32},seed:{type:'integer',default:-1,min:-1},turbo:{type:'boolean',default:false}},config:{settings:['width','height','seed','turbo']}};
 const fresh=normalizeLocalGenerationConfig({model:LOCAL_VIDEO_MODEL,mode:'text2video',settings:{}},schema);
 assert.deepEqual(fresh.settings,{width:512,height:288,seed:-1,turbo:false});
 const old={model:LOCAL_VIDEO_MODEL,mode:'text2video',settings:{width:768,height:448,seed:42,turbo:false}};
 assert.deepEqual(normalizeLocalGenerationConfig(structuredClone(old),schema),old);
 const image={...old,model:'Qwen-Image-2.1 Turbo（本地）',settings:{}};
 assert.equal(normalizeLocalGenerationConfig(image,schema).settings.width,768,'other local models retain their schema defaults');
});

test('combined video summary preserves saved values without mutating config or adding defaults',()=>{
 const config={kind:'video',model:'Seedance 2.5',mode:'frames2video',settings:{resolution:'720p',duration:9,enableSound:'off'}};
 const before=structuredClone(config),items=promptSettingsItems(config,{combined:true});
 assert.deepEqual(items.map(x=>x.key),['kind','model','mode','parameters']);
 assert.equal(items[2].text,'首尾帧');assert.equal(items[2].hidden,false);
 assert.equal(items[3].text,'比例 · 9s · 音频关闭');
 assert.equal(promptSettingsItems({kind:'image'},{combined:true}).find(item=>item.key==='mode').hidden,true);
 assert.deepEqual(config,before);
 assert.equal(promptSettingsItems(config).length,6,'existing table settings keep their individual entry points');
});
test('image summary omits stale video duration; pixels stay internal',()=>{
 assert.equal(generationParametersSummary({kind:'image',mode:'text2image',settings:{width:1024,height:1024,duration:9}}),'全能参考 · 1:1');
});

test('official image settings remain editable and summarize the selected dimensions and quality',()=>{
 const names=['size','quality','background','custom_width','custom_height'];
 const schema={properties:Object.fromEntries(names.map(name=>[name,{type:'string'}])),config:{settings:{text2image:names,image2image:names}}};
 assert.deepEqual(generationParameterSpecs(schema,'image2image').map(x=>x.name),['size','custom_width','custom_height','quality','background']);
 const config={kind:'image',model:'GPT Image 2',mode:'text2image',settings:{size:'1536x1024',quality:'low',width:512,height:288}};
 const before=structuredClone(config);
 assert.equal(generationParametersSummary(config),'全能参考 · 3:2 · 质量 low');
 assert.deepEqual(config,before);
 assert.equal(generationParametersSummary({...config,settings:{size:'Custom',custom_width:2048,custom_height:1152}}),'全能参考 · 16:9');
 assert.equal(generationParametersSummary({...config,model:'Qwen-Image-2.1 Turbo（本地）'}),'全能参考 · 16:9');
 assert.equal(generationParametersSummary({...config,kind:'video',model:'Seedance 2.5',mode:'text2video'}),'16:9');
});

test('new cloud MiniMax tasks use its resolution default and preserve explicit saved values',()=>{
 const config=values=>{const state=createVideoTasks(values);return state.table.fields.find(field=>field.id===state.fieldId).generation;};
 assert.equal(config({model:'Minimax H3'}).settings.resolution,'768P');
 assert.equal(config({model:'Minimax H3',resolution:'2K'}).settings.resolution,'2K');
 assert.equal(config({model:'Seedance 2.5'}).settings.resolution,'720p');
});
test('combined options use mode-specific capabilities and include audio but omit advanced controls',()=>{
 const schema={properties:{ratio:{enum:['16:9']},resolution:{enum:['480p']},enableSound:{enum:['off','on']},seed:{type:'integer'}},config:{settings:{text2video:['ratio','resolution','enableSound'],frames2video:['resolution','enableSound']},advancedSettings:['seed','enableSound']}};
 assert.deepEqual(generationParameterSpecs(schema,'frames2video').map(x=>x.name),['resolution','enableSound']);
 assert.deepEqual(generationParameterSpecs(schema,'text2video').map(x=>x.name),['ratio','resolution','enableSound']);
});
test('local and cloud model versions share their brand; unknown models keep a safe generic fallback',()=>{
 assert.equal(generationModelIconURL('Minimax H3'),generationModelIconURL('MiniMax H3 FL（本地）'));
 assert.equal(generationModelIconURL('Seedance 2.0'),generationModelIconURL('Seedance 2.5'));
 assert.match(generationModelIconURL('Qwen-Image-2.1 Turbo（本地）'),/qwen\.svg$/);
 assert.match(generationModelIconURL('Lib Image 2.5 Pro'),/libtv\.svg$/);
 assert.match(generationModelIconURL('unrecognized'),/remixicon\/box-3-line\.svg$/);
});
test('mode choices only show declared capabilities and do not revive unsupported saved modes',()=>{
 const schema={properties:{modeType:{items:{text2video:[],singleImage2video:[],frames2video:[]}}}};
 assert.deepEqual(generationParameterModes({kind:'video',mode:'text2video'},schema),['omni2video','frames2video']);
 const config={kind:'video',mode:'mixed2video'};
 assert.deepEqual(generationParameterModes(config,schema),['omni2video','frames2video']);
 assert.equal(config.mode,'mixed2video');
});

test('duration choices show integer seconds within model bounds without fractional options',()=>{
 assert.deepEqual(generationDurationOptions({type:'integer',min:4,max:6,step:1},4.5),[4,5,6]);
 assert.deepEqual(generationDurationOptions({enum:[{value:5},{value:10}]},10),[5,10]);
 assert.deepEqual(generationDurationOptions({type:'number',min:.2,max:2},.2),[1,2]);
});

test('image and mixed references share one omnireference choice without rewriting saved configuration',()=>{
 const schema={properties:{modeType:{items:{text2video:[],frames2video:[],image2video:[],mixed2video:[]}}}};
 for(const mode of ['image2video','mixed2video']){
  const config={kind:'video',model:'Seedance 2.5',mode,settings:{duration:4}},before=structuredClone(config);
  assert.deepEqual(generationParameterModes(config,schema),['omni2video','frames2video']);
  assert.equal(generationModeChoice(mode,schema),'omni2video');
  assert.doesNotMatch(generationParametersSummary(config),/全能参考/);
  assert.equal(promptSettingsItems(config).find(item=>item.key==='mode').text,'全能参考');
  assert.deepEqual(config,before);
 }
 assert.deepEqual(generationModes({},'video'),[]);
});

test('attempt summary is explicit only above one and invalid values remain detectable',()=>{
 const one={kind:'video',model:'Seedance 2.5',mode:'text2video',settings:{duration:4}},four={...one,attempts:4};
 assert.doesNotMatch(generationParametersSummary(one),/抽卡/);
 assert.match(generationParametersSummary(four),/抽卡 4 次/);
 assert.throws(()=>generationParametersSummary({...one,attempts:0}),/1–4/);
 assert.throws(()=>generationParametersSummary({...one,attempts:5}),/1–4/);
});

test('new model defaults use medium image quality and integer video seconds without rewriting explicit values',()=>{
 const imageSchema={properties:{modeType:{items:{text2image:[]}},quality:{enum:['low','medium','high'],default:'low'}},config:{settings:['quality']}};
 const freshImage={kind:'image',model:'GPT Image 2',mode:'text2image',settings:{}};applyGenerationModelDefaults(freshImage,imageSchema);
 assert.equal(freshImage.settings.quality,'medium');
 const savedImage={kind:'image',model:'GPT Image 2',mode:'text2image',settings:{quality:'low'}};applyGenerationModelDefaults(savedImage,imageSchema);
 assert.equal(savedImage.settings.quality,'low');
 const videoSchema={properties:{modeType:{items:{text2video:[]}},duration:{type:'number',min:.5,max:10,step:.5,default:1.5}},config:{settings:['duration']}};
 const freshVideo={kind:'video',model:'Seedance 2.5',mode:'text2video',settings:{}};applyGenerationModelDefaults(freshVideo,videoSchema);
 assert.equal(freshVideo.settings.duration,2);assert.equal(Number.isInteger(freshVideo.settings.duration),true);
 const savedVideo={kind:'video',model:'Seedance 2.5',mode:'text2video',settings:{duration:1.5}};applyGenerationModelDefaults(savedVideo,videoSchema);
 assert.equal(savedVideo.settings.duration,1.5);
});

test('generation prompt selector is hidden only when the table already designates one',()=>{
 const bare=normalizeTable({fields:[{id:'text',name:'文本',type:'text'}],records:[]});
 assert.equal(needsGenerationPromptSelector(bare),true);
 bare.meta.generationInput={version:1,promptFieldId:'text'};
 assert.equal(needsGenerationPromptSelector(bare),false);
});

test('user-facing generation identities use the agreed Comfy and omnireference labels',()=>{
 assert.equal(OPTIMIZATION_MODELS.find(model=>model.logo==='openai').label,'GPT-6 Luna（Comfy）');
 assert.equal(promptSettingsItems({kind:'video',model:'Seedance 2.5',mode:'image2video',settings:{duration:4}}).find(item=>item.key==='mode').text,'全能参考');
});

test('single-frame and image-reference modes never become unsupported alternatives',()=>{
 for(const mode of ['singleImage2video','frames2video','image2video','mixed2video','text2image']){
  const schema={properties:{modeType:{items:{[mode]:[]}}}};
  const expected=mode==='text2image'?mode:mode.includes('frames')||mode==='singleImage2video'?'frames2video':'omni2video';
  assert.deepEqual(generationModes(schema,mode.endsWith('image')?'image':'video'),[expected]);
  assert.equal(generationModeChoice(mode,schema),expected);
 }
 assert.deepEqual(generationParameterModes({model:'unavailable',kind:'image',mode:'image2image'},{}),[]);
});
// The column-header "apply all" popover builds its parameters with a callback bundle.
// Read the real drawing code so a missing callback cannot hide behind a stub.
const panelPath='../../frontend/src/features/generation/table_generation_panel.mjs';
function columnParameterDrawing(){
 const text=readFileSync(new URL(panelPath,import.meta.url),'utf8'),tree=ts.createSourceFile(panelPath,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const named=(node,name)=>{const found=[];(function visit(child){if(ts.isFunctionDeclaration(child)&&child.name?.text===name)found.push(child);ts.forEachChild(child,visit);})(node);return found;};
 const open=named(tree,'openPromptColumn');
 assert.equal(open.length,1,'the prompt-column popover must stay one function');
 const draw=named(open[0],'drawSettings');
 assert.equal(draw.length,1,'the prompt-column popover must build its parameters in one place');
 assert.match(draw[0].getText(tree),/createGenerationParameters\(/);
 return draw[0].getText(tree);
}
const columnDrawing=columnParameterDrawing();
function descendants(node,found=[]){for(const child of node.children||[]){found.push(child);descendants(child,found);}return found;}
function drawColumn({draft,schema,table}){
 const settings={children:[],contains:()=>false,querySelector:()=>null,replaceChildren(){this.children=[];},append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}};
 const draws={count:0};
 const drawSettings=new Function('settings','document','schema','draft','owner','frameColumns','getTable','el','createGenerationParameters','generationFrameRoles','isLocalVideoModel','localVideoSizePicker','generationParameterSpecs','generationSettingSpecs',
  `let parameterView=null;${columnDrawing};return drawSettings;`)(
  settings,document,schema,draft,null,{},()=>table,
  (tag,parent,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;parent?.append(node);return node;},
  (config,spec,handlers)=>{draws.count++;return createGenerationParameters(config,spec,handlers);},
  ()=>[],()=>false,()=>null,generationParameterSpecs,generationSettingSpecs);
 drawSettings();
 return {settings,draws,drawSettings};
}
const attemptButton=(settings,label)=>descendants(settings).find(node=>node.tagName==='button'&&node.textContent===label);
const pressAttempts=button=>button.onclick({preventDefault(){},stopPropagation(){}});

test('the prompt-column apply-all popover excludes per-task attempts and preserves their saved values',t=>{
 const dom=installDom(t);t.after(()=>dom.restore());
 const state=createVideoTasks({prompt:'任务'}),table=state.table,field=table.fields.find(item=>item.generation),promptFieldId=field.generation.promptFieldId;
 const schema={properties:{modeType:{items:{text2video:[]}}}};
 const draft={...structuredClone(field.generation),kind:'video',model:'Seedance 2.5',mode:'text2video',settings:{}};
 const column=drawColumn({draft,schema,table});
 assert.equal(attemptButton(column.settings,'4 次'),undefined);
 const row=table.records[0];row.meta||={};row.meta.generationSettings={[promptFieldId]:{[field.id]:{...field.generation,attempts:4}}};
 applyColumnGenerationConfig(table,promptFieldId,draft);
 const saved=promptGenerationOwner(table,promptFieldId);
 assert.equal(generationAttempts(saved.generation),1);
 assert.equal(generationAttempts(rowGenerationConfig(row,saved.id,saved.generation)),4);
 const reopened=drawColumn({draft:structuredClone(saved.generation),schema,table});
 assert.equal(attemptButton(reopened.settings,'4 次'),undefined);
});

test('column apply uses shared keys and leaves protected row configuration and frame bindings intact',()=>{
 const state=createVideoTasks(),table=state.table,field=table.fields.find(f=>f.id===state.fieldId),prompt=field.generation.promptFieldId;
 const first=table.records[0],held=structuredClone(first);held.id='protected';held.meta={generationFrames:{[field.id]:{first:{fieldId:'pictures',assetId:'keep-me'}}}};table.records.push(held);
 const before=structuredClone(rowGenerationConfig(held,field.id,field.generation)),values=structuredClone(held.values),frames=structuredClone(held.meta.generationFrames);
 applyColumnGenerationConfig(table,prompt,{...field.generation,mode:'mixed2video',settings:{duration:8},attempts:4,reference:'must-not-copy'},{skip:new Set([held.id])});
 assert.equal(rowGenerationConfig(first,field.id,field.generation).mode,'mixed2video');assert.equal(rowGenerationConfig(first,field.id,field.generation).reference,undefined);
 assert.deepEqual(rowGenerationConfig(held,field.id,field.generation),before);assert.deepEqual(held.values,values);assert.deepEqual(held.meta.generationFrames,frames);
});
