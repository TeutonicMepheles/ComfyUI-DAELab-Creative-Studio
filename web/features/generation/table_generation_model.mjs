import {addField,uid} from '../../application/table_model.mjs';
import {isTextColumn,promptSourceId,setPromptSource,requirePromptSource} from '../prompt/table_prompt_source.mjs';
import {effectivePrompt,isColumnPrompt,resolveColumnPrompt,columnValue,toColumnPrompt} from '../prompt/table_prompt_template.mjs';
import {tableAssets} from '../prompt/table_prompt_model.mjs';
import {GENERATION_MODEL_DEFINITIONS,getModelCatalog} from '../models/model_catalog.mjs';

const generationModels=(kind,provider)=>GENERATION_MODEL_DEFINITIONS.filter(model=>model.kind===kind&&model.provider===provider).map(model=>model.id);
export const LOCAL_VIDEO_MODEL=generationModels('video','local')[0];
export const LOCAL_REFERENCE_VIDEO_MODEL=generationModels('video','local')[1];
export const LOCAL_VIDEO_MODELS=generationModels('video','local');
export const isLocalVideoModel=model=>LOCAL_VIDEO_MODELS.includes(model);
export function textOnlyVideoInput(config,modes=getModelCatalog().get(config?.model)?.capability?.schema?.properties?.modeType?.items){
 if(config?.kind!=='video')return false;
 if(config.mode==='text2video')return true;
 if(config.mode!=='omni2video')return false;
 if(modes)return 'text2video' in modes&&!('mixed2video' in modes||'image2video' in modes);
 return isLocalVideoModel(config.model)&&config.model.includes('H3 FL');
}
export const LOCAL_VIDEO_MODES=['text2video','singleImage2video','frames2video'];
export const LOCAL_IMAGE_MODEL=generationModels('image','local')[0];
export const isLocalImageModel=model=>generationModels('image','local').includes(model);
export const isLocalGenerationModel=model=>isLocalImageModel(model)||isLocalVideoModel(model);
export const COMFY_VIDEO_MODELS=generationModels('video','comfy');
export const COMFY_IMAGE_MODELS=generationModels('image','comfy');
export const isComfyGenerationModel=model=>[...COMFY_VIDEO_MODELS,...COMFY_IMAGE_MODELS].includes(model);
export const needsGenerationProject=()=>false;
export const GENERATION_MODELS={
 image:generationModels('image','local').concat(generationModels('image','comfy')),
 video:generationModels('video','comfy').concat(generationModels('video','local')),
};
export const MAX_GENERATION_ATTEMPTS=4;
export function generationAttempts(config){
 const attempts=config?.attempts??1;
 if(!Number.isInteger(attempts)||attempts<1||attempts>MAX_GENERATION_ATTEMPTS)throw new Error('抽卡次数必须是 1–4 的整数');
 return attempts;
}
export const isGeneration=field=>field?.presentation==='generation';
export function rowGenerationConfig(row,fieldId,defaults){
 const source=row?.meta?.generationPromptFields?.[fieldId]??defaults?.promptFieldId;
 return row?.meta?.generationSettings?.[source]?.[fieldId]||(source!==defaults?.promptFieldId?{...defaults,promptFieldId:source}:defaults);
}
export function setRowGenerationConfig(row,fieldId,config){
 row.meta||={};row.meta.generationSettings||={};row.meta.generationSettings[config.promptFieldId]||={};
 row.meta.generationSettings[config.promptFieldId][fieldId]=structuredClone(config);
}
// Share execution choices, never another row's prompt or material bindings.
export function mergeTaskGenerationConfig(own,config){
 const shared=Object.fromEntries(['kind','model','mode','settings'].filter(key=>key in config).map(key=>[key,structuredClone(config[key])]));
 return {...own,...shared};
}
export function applyTaskGenerationConfig(table,fieldId,config,{skip=new Set()}={}){
 const field=table.fields.find(field=>field.id===fieldId);
 if(!field)throw new Error('生成配置已变化');
 for(const row of table.records){
  const own=rowGenerationConfig(row,fieldId,field.generation);
  const next=skip.has(row.id)?own:mergeTaskGenerationConfig(own,config);
  setRowGenerationConfig(row,fieldId,next);
  if(!skip.has(row.id)&&textOnlyVideoInput(next)){
   const value=effectivePrompt(table,row,next.promptFieldId),clean=withoutMediaMentions(value,row);
   if(clean!==value)row.values[next.promptFieldId]=clean;
  }
 }
 field.generation=mergeTaskGenerationConfig(field.generation,config);
 field.generationConfigRevision=(field.generationConfigRevision||0)+1;
}
export const promptColumns=table=>table.fields.filter(f=>isTextColumn(table,f));
export function generationConfigField(table,fieldId,promptFieldId){
 const field=table.fields.find(f=>f.id===fieldId);if(!isGeneration(field))return field;
 const source=promptFieldId??field.generation.promptFieldId,prompt=table.fields.find(f=>f.id===source);
 if(!prompt)return field;
 const linked=table.fields.filter(f=>isGeneration(f)&&f.generation.promptFieldId===source);
 return linked.find(f=>f.id===prompt?.generationConfigFieldId)||linked[0]||field;
}
export function promptGenerationOwner(table,promptFieldId){
 const linked=table.fields.find(f=>isGeneration(f)&&f.generation.promptFieldId===promptFieldId);
 if(linked)return generationConfigField(table,linked.id);
 const prompt=table.fields.find(f=>f.id===promptFieldId);return prompt?.generation?prompt:null;
}
export function applyColumnGenerationConfig(table,promptFieldId,config,{skip=new Set()}={}){
 const prompt=requirePromptSource(table);if(prompt.id!==promptFieldId)throw new Error('提示词列已变化，请重新打开配置');
 const owner=promptGenerationOwner(table,promptFieldId)||prompt;
 owner.generation||={version:1,promptFieldId};
 applyTaskGenerationConfig(table,owner.id,config,{skip});
 for(const row of table.records){
  if(skip.has(row.id))continue;
  const document=toColumnPrompt(effectivePrompt(table,row,promptFieldId),row),frames=document.segments.filter(segment=>segment.type==='frame');
  if(frames.length){
   const bindings={};for(const tag of frames){const binding=row.meta?.generationFrames?.[tag.generationFieldId]?.[tag.role];if(binding)bindings[tag.role]=structuredClone(binding);}
   const roles=new Set();document.segments=document.segments.filter(segment=>{if(segment.type!=='frame')return true;if(roles.has(segment.role))return false;roles.add(segment.role);segment.generationFieldId=owner.id;return true;});
   row.values[promptFieldId]=document;row.meta||={};row.meta.generationFrames||={};row.meta.generationFrames[owner.id]=bindings;
   row.meta.generationFrameTags||={};row.meta.generationFrameTags[owner.id]=JSON.stringify([promptFieldId,[...roles]]);
  }
  syncGenerationFrameTags(table,owner.id,rowGenerationConfig(row,owner.id,owner.generation),row.id);
 }
}
export function applyColumnFrameSources(table,promptFieldId,sources,{skip=new Set()}={}){
 const owner=promptGenerationOwner(table,promptFieldId),roles=generationFrameRoles(owner.generation);
 for(const role of roles)if(sources[role]&&!table.fields.some(field=>field.id===sources[role]&&['content','assets'].includes(field.type)&&field.presentation!=='prompt'&&field.id!==owner.id))throw new Error('图片列已变化，请重新选择');
 if(!roles.length)return;
 owner.generationFrameColumns=Object.fromEntries(roles.filter(role=>sources[role]||sources[role]===null).map(role=>[role,sources[role]]));
 for(const row of table.records)for(const role of roles){
  if(skip.has(row.id))continue;
  const fieldId=sources[role];if(fieldId===undefined||fieldId==='')continue;
  const value=fieldId===null?null:row.values[fieldId],asset=Array.isArray(value)?value.find(item=>!item.kind||item.kind==='image'):null;
  row.meta||={};row.meta.generationFrames||={};const frames=row.meta.generationFrames[owner.id]||={};
  if(asset)frames[role]={fieldId,assetId:asset.id};else delete frames[role];
 }
}
export function syncGenerationConfigOwners(table,before=table){
 for(const prompt of promptColumns(table)){
  const linked=table.fields.filter(f=>isGeneration(f)&&f.generation.promptFieldId===prompt.id);if(!linked.length)continue;
  const previous=before.fields.find(f=>f.id===prompt.id)?.generationConfigFieldId||before.fields.find(f=>isGeneration(f)&&f.generation.promptFieldId===prompt.id)?.id;
  const owner=linked.find(f=>f.id===previous)||linked[0];prompt.generationConfigFieldId=owner.id;
  if(previous&&owner.id!==previous){
   const old=before.fields.find(f=>f.id===previous);
   if(old?.generation)owner.generation={...structuredClone(old.generation),promptFieldId:prompt.id};
   for(const row of table.records){
    const oldRow=before.records.find(r=>r.id===row.id),settings=oldRow?.meta?.generationSettings?.[prompt.id]?.[previous];
    if(settings)setRowGenerationConfig(row,owner.id,{...settings,promptFieldId:prompt.id});
    for(const key of ['generationFrames','generationFrameTags'])if(oldRow?.meta?.[key]?.[previous]!==undefined){row.meta||={};row.meta[key]||={};row.meta[key][owner.id]=structuredClone(oldRow.meta[key][previous]);}
   }
  }
  for(const doc of [prompt.promptTemplate,...table.records.map(row=>row.values[prompt.id])])if(doc?.segments?.some(s=>s.type==='frame'&&s.generationFieldId!==owner.id&&(s.generationFieldId===previous||linked.some(f=>f.id===s.generationFieldId)))){
   const roles=new Set();doc.segments=doc.segments.filter(s=>{
    if(s.type!=='frame'||!(s.generationFieldId===previous||linked.some(f=>f.id===s.generationFieldId)))return true;
    s.generationFieldId=owner.id;if(roles.has(s.role))return false;roles.add(s.role);return true;
   });
  }
 }
}
export function syncGenerationPromptSource(table,before,config){
 if(table.meta?.generationInput){const id=promptSourceId(table)||'';if(config.promptFieldId===id)return false;config.promptFieldId=id;return true;}
 const source=config.promptFieldId;
 if(!source||table.fields.some(f=>f.id===source)||!before.fields.some(f=>f.id===source))return false;
 config.promptFieldId='';
 return true;
}
export function enableColumnPrompt(table,fieldId){
 const field=table.fields.find(f=>f.id===fieldId);
 if(!field||field.readonly)throw new Error('提示词列不可编辑');
 if(field.presentation==='prompt')return;
 if(!promptColumns(table).some(f=>f.id===fieldId))throw new Error('请选择文本列');
 field.type='json';field.presentation='prompt';field.generationPrompt=true;
 for(const row of table.records){const text=row.values[fieldId];row.values[fieldId]=isColumnPrompt(text)?text:typeof text==='string'&&text?{kind:'column-template',version:1,segments:[{type:'text',text}]}:'';}
}
export function addGenerationColumn(table,spec={}){
 const field=addField(table,{...spec,type:'content',presentation:'generation',readonly:true,width:340,generation:{version:1,kind:'image',model:LOCAL_IMAGE_MODEL,promptFieldId:'',mode:'text2image',settings:{width:1024,height:1024,seed:-1}}});
 const prompts=promptColumns(table);
 if(promptSourceId(table))field.generation.promptFieldId=promptSourceId(table);
 else if(!prompts.length)field.generation.promptFieldId=createGenerationPrompt(table,field.id).id;
 for(const row of table.records)row.values[field.id]=[];
 return field;
}
export function createGenerationPrompt(table,fieldId){
 const target=table.fields.find(f=>f.id===fieldId);if(!target)throw new Error('生成列已删除');
 const prompt=addField(table,{name:'提示词',type:'json',presentation:'prompt',generationPrompt:true,width:360});
 table.fields.splice(table.fields.indexOf(prompt),1);table.fields.splice(table.fields.indexOf(target),0,prompt);
 for(const row of table.records)row.values[prompt.id]='';
 target.generation.promptFieldId=prompt.id;setPromptSource(table,prompt.id);return prompt;
}
export function generationRows(table,fieldId){
 const selected=table.records.filter(r=>r.selected);
 return selected.length?selected:table.records.filter(r=>!r.values[fieldId]?.length);
}
function withoutMediaMentions(value,row){
 if(!value?.segments)return value;
 const document=toColumnPrompt(value,row);
 const segments=document.segments.filter(s=>s.type!=='column'||!(s.assetId||s.assetIndex!==undefined||Array.isArray(row.values[s.fieldId])));
 return segments.length===document.segments.length?value:{...document,segments};
}
function generationPrompt(table,row,promptFieldId,allowEmptyPrompt=false,textOnly=false){
 const source=table.fields.find(f=>f.id===promptFieldId);
 if(!source)throw new Error('请选择提示词列');
 const original=effectivePrompt(table,row,source.id),value=textOnly?withoutMediaMentions(original,row):original;
 let document;
 if(typeof value==='string')document={segments:[{type:'text',text:value}],references:[],assets:[]};
 else if(isColumnPrompt(value)){
  const empty=allowEmptyPrompt&&value.version===1&&Array.isArray(value.segments)&&value.segments.every(s=>s.type==='text'&&typeof s.text==='string'&&!s.text.trim());
  document=empty?{segments:[],references:[],assets:[]}:resolveColumnPrompt(value,table,row,promptFieldId);
 }
 else if(value?.segments){
  const references=value.references||[];
  document={...value,assets:references.filter(r=>r.included!==false).map(ref=>{
   const asset=row.values[ref.fieldId]?.find?.(a=>a.id===ref.assetId);
   if(!asset)throw new Error('提示词引用的素材已不存在');return {...asset,fieldId:ref.fieldId};
  })};
 }else throw new Error('本行提示词为空');
 return document;
}
export const generationFrameRoles=config=>config.kind!=='video'?[]:config.mode==='frames2video'?['first','last']:config.mode==='singleImage2video'?['first']:[];
export const generationFrameTagKey=config=>JSON.stringify([config.promptFieldId,generationFrameRoles(config)]);
export function applyPromptContent(table,row,promptFieldId,segments,ownerId){
 const previous=toColumnPrompt(effectivePrompt(table,row,promptFieldId),row),linked=table.fields.find(f=>isGeneration(f)&&f.generation.promptFieldId===promptFieldId);
 const owner=generationConfigField(table,ownerId||linked?.id),frameId=owner?.id||previous.segments.find(s=>s.type==='frame')?.generationFieldId;
 const frames=segments.filter(s=>s.type==='frame'),doc={...previous,segments:structuredClone(segments).map(s=>{
  if(s.type!=='frame')return s;
  const {binding,...tag}=s;return {...tag,generationFieldId:frameId||tag.generationFieldId};
 })};
 row.values[promptFieldId]=doc;
 // A source table can carry frame choices without owning a generation column.
 // Keep these bindings with the serialized tag IDs for exchange and re-import.
 if(!isGeneration(owner)){
  if(!frames.length&&!previous.segments.some(s=>s.type==='frame'))return;
  row.meta||={};row.meta.generationFrames||={};
  const ids=new Set([...previous.segments,...doc.segments].filter(s=>s.type==='frame').map(s=>s.generationFieldId));
  for(const id of ids)row.meta.generationFrames[id]=Object.fromEntries(frames.filter(s=>(frameId||s.generationFieldId)===id&&s.binding).map(s=>[s.role,structuredClone(s.binding)]));
  return;
 }
 if(!isGeneration(owner)||!frames.length&&!previous.segments.some(s=>s.type==='frame'))return;
 const active=rowGenerationConfig(row,owner.id,owner.generation)?.promptFieldId===promptFieldId;
 const config=row.meta?.generationSettings?.[promptFieldId]?.[owner.id]||{...owner.generation,promptFieldId};
 if(active){row.meta||={};row.meta.generationFrames||={};row.meta.generationFrames[owner.id]=Object.fromEntries(frames.filter(s=>s.binding).map(s=>[s.role,structuredClone(s.binding)]));}
 if(config.kind==='video'){
  const mode=frames.some(s=>s.role==='last')?'frames2video':frames.some(s=>s.role==='first')?'singleImage2video':'text2video';
  const next={...config,promptFieldId,mode};setRowGenerationConfig(row,owner.id,next);
  if(active){row.meta.generationFrameTags||={};row.meta.generationFrameTags[owner.id]=generationFrameTagKey(next);}
 }
}
export function syncGenerationFrameTags(table,fieldId,defaults,recordId=null){
 const changed=new Set();
 for(const row of table.records){
  if(recordId!==null&&row.id!==recordId)continue;
  const config=rowGenerationConfig(row,fieldId,defaults),roles=generationFrameRoles(config),key=generationFrameTagKey(config);
  if(!config.promptFieldId||!table.fields.some(f=>f.id===config.promptFieldId))continue;
  const previous=row.meta?.generationFrameTags?.[fieldId];if(previous===key||!previous&&!roles.length)continue;
  if(roles.length)enableColumnPrompt(table,config.promptFieldId);
  let frames;try{frames=generationFrames(table,row,fieldId,config);}catch{frames=[];}
  const current=row.values[config.promptFieldId];if(isColumnPrompt(current)&&current.segments.some(s=>s.type==='frame'&&s.generationFieldId===fieldId)){current.segments=current.segments.filter(s=>s.type!=='frame'||s.generationFieldId!==fieldId);changed.add(config.promptFieldId);}
  row.meta||={};row.meta.generationFrameTags||={};row.meta.generationFrameTags[fieldId]=key;
  if(!roles.length)continue;
  row.meta.generationFrames||={};row.meta.generationFrames[fieldId]||=Object.fromEntries(frames.filter(f=>f.asset).map(f=>[f.role,{assetId:f.asset.id,fieldId:f.asset.fieldId}]));
  const doc=toColumnPrompt(effectivePrompt(table,row,config.promptFieldId),row);
  doc.segments=doc.segments.filter(s=>s.type!=='frame'||s.generationFieldId!==fieldId);
  doc.segments.unshift(...roles.map(role=>({type:'frame',generationFieldId:fieldId,role})));
  row.values[config.promptFieldId]=doc;changed.add(config.promptFieldId);
 }
 return changed;
}
export function syncGenerationPromptMode(table,before,fieldId,defaults){
 const oldRows=new Map(before.records.map(row=>[row.id,row]));
 for(const row of table.records){
  const old=oldRows.get(row.id);if(!old)continue;
  const config=rowGenerationConfig(row,fieldId,defaults),previous=rowGenerationConfig(old,fieldId,defaults);
  if(config.kind==='video'&&config.mode==='text2video'&&COMFY_VIDEO_MODELS.includes(config.model)&&JSON.stringify(config)===JSON.stringify(previous)&&JSON.stringify(effectivePrompt(table,row,config.promptFieldId))!==JSON.stringify(effectivePrompt(before,old,config.promptFieldId))){
   const doc=toColumnPrompt(effectivePrompt(table,row,config.promptFieldId),row);
   if(doc.segments.some(s=>s.type==='column'&&(s.assetId||Array.isArray(row.values[s.fieldId])))){
    setRowGenerationConfig(row,fieldId,{...config,mode:'mixed2video'});continue;
   }
  }
  if(config.kind!=='video'||generationFrameTagKey(config)!==generationFrameTagKey(previous)||row.meta?.generationFrameTags?.[fieldId]!==old.meta?.generationFrameTags?.[fieldId])continue;
  const roles=(table,row)=>(effectivePrompt(table,row,config.promptFieldId)?.segments||[]).filter(s=>s.type==='frame'&&s.generationFieldId===fieldId).map(s=>s.role);
  const oldRoles=roles(before,old),remaining=roles(table,row);
  if(oldRoles.length===remaining.length&&oldRoles.every(role=>remaining.includes(role)))continue;
  const mode=remaining.includes('last')?'frames2video':remaining.includes('first')?'singleImage2video':'text2video';
  if(mode===config.mode)continue;
  const updated={...config,mode};setRowGenerationConfig(row,fieldId,updated);
  row.meta.generationFrameTags||={};row.meta.generationFrameTags[fieldId]=generationFrameTagKey(updated);
 }
}
export function generationFrames(table,row,fieldId,config){
 const roles=generationFrameRoles(config),bound=row?.meta?.generationFrames?.[fieldId];
 if(!roles.length||!row)return [];
 if(!bound){
  const doc=generationPrompt(table,row,config.promptFieldId),assets=[];
  for(const s of doc.segments)if(s.type==='ref'){const ref=doc.references.find(r=>r.refId===s.refId&&r.included!==false),asset=ref&&doc.assets.find(a=>a.id===ref.assetId&&a.fieldId===ref.fieldId);if(asset&&!assets.some(a=>a.id===asset.id))assets.push(asset);}
  return roles.map((role,index)=>assets[index]?.kind==='video'||assets[index]?.kind==='audio'?{role,error:'首尾帧请选择图片'}:{role,asset:assets[index]});
 }
 return roles.map(role=>{
  if(row.meta?.generationFrameTags?.[fieldId]&&!effectivePrompt(table,row,config.promptFieldId)?.segments?.some(s=>s.type==='frame'&&s.generationFieldId===fieldId&&s.role===role))return {role};
  const ref=bound[role];if(!ref)return {role};
  try{const value=columnValue(table,row,ref.fieldId,undefined,ref.assetId);if(value.asset?.kind==='video'||!value.asset)throw new Error('请选择图片');if(value.field.id===fieldId)throw new Error('不能引用当前生成列');return {role,asset:value.asset};}
  catch(error){return {role,error:error.message};}
 });
}
function unsupportedVideoInput(config,modes){
 const inputs={text2video:'纯文字生成视频',singleImage2video:'仅用首帧生成',lastImage2video:'仅用尾帧生成',frames2video:'同时使用首帧和尾帧',image2video:'使用参考图片生成',mixed2video:'使用全能参考素材生成'};
 const change={
  text2video:modes.mixed2video?'请在全能参考中添加图片或视频。':modes.image2video?'请在全能参考中添加参考图片。':null,
  singleImage2video:modes.frames2video?'请在尾帧位置再选择一张图片。':null,
  lastImage2video:modes.frames2video?'请在首帧位置补一张图片。':modes.singleImage2video?'请把图片改选为首帧。':null,
  frames2video:modes.singleImage2video?'请只保留首帧图片。':null,
 };
 const input=inputs[config.mode];
 if(!input)return config.model+' 无法使用已保存的生成方式，请重新打开「生成方式」并选择当前模型提供的选项。';
 const action=change[config.mode]||(modes.singleImage2video?'可切换到「首尾帧」并只选择首帧图片。':modes.frames2video?'可切换到「首尾帧」并选择两张图片。':modes.text2video?'可在「全能参考」中只输入文字。':'请更换支持该输入方式的模型。');
 return config.model+' 当前不支持'+input+'。'+action;
}
export function generationInput(table,fieldId,recordId,{allowEmptyPrompt=false,autoImageMode=false,videoModes}={}){
 const field=table.fields.find(f=>f.id===fieldId),row=table.records.find(r=>r.id===recordId);
 if(!isGeneration(field)||!row)throw new Error('生成列或记录已删除');
 if(row.meta?.generationSourceMissing)throw new Error('来源表格中的任务行已删除；已有结果保留');
 const source=requirePromptSource(table),owner=generationConfigField(table,fieldId),config={...rowGenerationConfig(row,owner.id,owner.generation),promptFieldId:source.id};
 const onlyText=config.mode==='omni2video'&&textOnlyVideoInput(config,videoModes);
 const document=generationPrompt(table,row,source.id,allowEmptyPrompt,onlyText);
 generationAttempts(config);
 const localRef=isLocalVideoModel(config.model)&&config.model.includes('H3 Ref');
 const localFL=isLocalVideoModel(config.model)&&!localRef;
 if(localFL&&config.mode!=='omni2video'&&!LOCAL_VIDEO_MODES.includes(config.mode))throw new Error('本地 H3 FL 仅支持文字或首尾帧输入，请重新选择生成方式');
 if(localRef&&!['omni2video','image2video'].includes(config.mode))throw new Error('本地 H3 Ref 仅支持图片参考，请切换到「全能参考」并添加图片');
 if(generationFrameRoles(config).length&&document.segments.some(s=>s.type==='ref'))throw new Error('首帧／首尾帧模式不能在提示词中 @ 素材，请移除正文素材引用，并通过帧选择入口填入图片');
 if(!allowEmptyPrompt&&!document.segments.some(s=>s.type==='ref'||s.text?.trim()))throw new Error('本行提示词为空');
 if(isLocalVideoModel(config.model)&&LOCAL_VIDEO_MODES.includes(config.mode)&&document.segments.some(s=>s.type==='ref'))throw new Error('本地 H3 FL 的当前方式不接受正文图片引用；请移除正文素材引用，需要图片时明确选择首帧／首尾帧并填入对应图片');
 const assets=[],frameBindings=row.meta?.generationFrames?.[owner.id];
 const frames=generationFrameRoles(config).length?generationFrames(table,row,owner.id,config):[];
 for(const frame of frames){
  if(frame.error)throw new Error((frame.role==='first'?'首帧':'尾帧')+'：'+frame.error);
  if(!frame.asset)continue;
  const a=frame.asset;if(a.fieldId===fieldId)throw new Error('生成列不能引用自身结果，请引用其他已完成的生成列');assets.push({id:a.id,fieldId:a.fieldId,kind:a.kind||'image',url:a.url});
 }
 const automaticImage=autoImageMode&&config.kind==='image';
 if(automaticImage){
  const inputs=new Set(table.fields.filter(f=>!f.readonly&&f.id!==fieldId).map(f=>f.id));
  for(const asset of tableAssets(table,row)){
   if(inputs.has(asset.fieldId)&&(asset.kind||'image')==='image')assets.push({id:asset.id,fieldId:asset.fieldId,kind:'image',url:asset.url});
  }
 }else if(!onlyText&&!generationFrameRoles(config).length&&!['text2video','text2image'].includes(config.mode))for(const ref of row.meta?.generationReferences?.[owner.id]||[]){
  if(ref.fieldId===fieldId)throw new Error('生成列不能引用自身结果，请引用其他已完成的生成列');
  const {asset}=columnValue(table,row,ref.fieldId,undefined,ref.assetId);
  if(!asset)throw new Error('参考素材已不存在');
  if(!assets.some(a=>a.id===asset.id&&a.fieldId===asset.fieldId))assets.push({id:asset.id,fieldId:asset.fieldId,kind:asset.kind||'image',url:asset.url});
 }
 const segments=document.segments.map(s=>{
  if(s.type==='text')return {type:'text',text:s.text};
  const ref=document.references.find(r=>r.refId===s.refId&&r.included!==false);
  if(ref?.fieldId===fieldId)throw new Error('生成列不能引用自身结果，请引用其他已完成的生成列');
  const asset=ref&&document.assets.find(a=>a.id===ref.assetId&&a.fieldId===ref.fieldId);
  if(!asset)throw new Error('提示词引用的素材已不存在');
  let index=assets.findIndex(a=>a.id===asset.id&&a.fieldId===asset.fieldId);
  if(index<0){if(frameBindings&&generationFrameRoles(config).length)throw new Error('正文引用的素材未选为首尾帧，请调整图片选择或正文引用');index=assets.length;assets.push({id:asset.id,fieldId:asset.fieldId,kind:asset.kind,url:asset.url});}
  return {type:'asset',index};
 });
 if(frames.length){
  if(!assets.length)throw new Error('请至少选择一张首帧或尾帧图片');
  if(assets.length===1){
   if(frames.find(frame=>frame.asset).role==='last'){
    if(!localFL)throw new Error(videoModes?unsupportedVideoInput({...config,mode:'lastImage2video'},videoModes):config.model+' 不支持仅用尾帧生成，请补充首帧');
    config.mode='lastImage2video';
   }else config.mode='singleImage2video';
  }
 }
 if(localRef&&!assets.length)throw new Error(config.model+' 需要图片参考，当前没有参考图片。请至少添加一张图片。');
 if(config.mode==='omni2video'){
  config.mode=!assets.length?'text2video':localRef||videoModes&&!('mixed2video' in videoModes)&&'image2video' in videoModes?'image2video':'mixed2video';
 }
 const nonImage=config.mode==='image2video'&&(localRef||videoModes&&!('mixed2video' in videoModes))&&assets.find(a=>a.kind!=='image');
 if(nonImage){
  const kind=nonImage.kind;
  throw new Error(config.model+' 的图片参考中含有'+({video:'视频',audio:'音频'}[kind]||'非图片')+'素材。请移除该素材或替换为图片。');
 }
 if(localRef&&assets.length>9)throw new Error(config.model+' 最多支持 9 张参考图片，当前有 '+assets.length+' 张。请移除 '+(assets.length-9)+' 张。');
 if(config.kind==='video'&&videoModes&&!Object.hasOwn(videoModes,config.mode))throw new Error(unsupportedVideoInput(config,videoModes));
 if(automaticImage)config.mode=assets.length?'image2image':'text2image';
 return {recordId,fieldId,config:{...structuredClone(config),...(isComfyGenerationModel(config.model)?{provider:'comfy'}:{})},project:needsGenerationProject(config.model)?table.meta.generationProject||'':'',segments,assets};
}
export const inputStamp=input=>JSON.stringify(input);
export function appendGenerationResult(table,row,fieldId,requestId,result,model){
 const field=table.fields.find(f=>f.id===fieldId);if(!field||!row)return;
 delete field.maxItems;
 const values=Array.isArray(row.values[fieldId])?row.values[fieldId]:[];
 if(!values.some(a=>a.provenance?.requestId===requestId||a.url===result.url))values.push({...result,id:uid(),provenance:{requestId,model}});
 row.values[fieldId]=values;
}
export function applyGenerationResult(table,fieldId,recordId,requestId,stamp,result){
 const row=table.records.find(r=>r.id===recordId),state=row?.meta?.generationColumns?.[fieldId];
 if(!state||state.requestId!==requestId)return false;
 try{if(inputStamp(generationInput(table,fieldId,recordId))!==stamp){state.phase='stale';state.error='输入已变化，结果保留在历史中';state.result=result;return false;}}
 catch{state.phase='stale';state.result=result;return false;}
 appendGenerationResult(table,row,fieldId,requestId,result,state.input?.config?.model);state.result=result;state.phase='complete';delete state.error;return true;
}

export function generationReportNeedsApply(table,job,report){
 if(report.phase!=='complete')return job.phase!==report.phase||job.error!==report.error;
 if(job.phase==='stale'&&job.result?.url===report.result?.url){
  try{return inputStamp(generationInput(table,job.fieldId,job.recordId))===job.stamp;}catch{return false;}
 }
 const row=table.records.find(r=>r.id===job.recordId);
 return job.phase!=='complete'||Boolean(job.error)||!row?.values[job.fieldId]?.some(a=>a.url===report.result?.url);
}
export function generationReceipt(job,previous){
 const history=structuredClone(previous?.history||[]);
 if(previous?.input&&previous.requestId!==job.requestId&&!history.some(item=>item.requestId===previous.requestId))history.push({requestId:previous.requestId,input:previous.input,phase:previous.phase,...(previous.result?{result:previous.result}:{})});
 return {requestId:job.requestId,input:structuredClone(job.input),forceNew:job.forceNew===true,stamp:inputStamp(job.input),phase:'waiting',...(history.length?{history}: {})};
}
export function recoveryJob(receipt){
 if(!receipt?.input)throw new Error('Original task snapshot is missing');
 return {requestId:receipt.requestId,input:receipt.input,forceNew:receipt.forceNew===true,recovery:true};
}
