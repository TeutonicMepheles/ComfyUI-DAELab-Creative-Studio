import {effectivePrompt,toColumnPrompt} from '../prompt/table_prompt_template.mjs';
import {LOCAL_VIDEO_MODEL,rowGenerationConfig,setRowGenerationConfig,syncGenerationFrameTags} from './table_generation_model.mjs';
import {generationInputRole} from './generation_input.js';

export function linkedTaskTexts(state,recordId){
 return Object.values(state.inputs||{}).filter(input=>input.recordId===recordId&&input.texts).sort((a,b)=>(a.order||0)-(b.order||0)).flatMap(input=>input.texts);
}

export function clearLinkedTaskInput(state,name){
 const row=state.table.records.find(row=>row.id===state.inputs[name].recordId);
 delete state.inputs[name];
 if(!row)return;
 const field=state.table.fields.find(field=>field.id===state.fieldId),config=rowGenerationConfig(row,state.fieldId,field.generation);
 const doc=toColumnPrompt(effectivePrompt(state.table,row,config.promptFieldId),row);
 if(['text_input','group'].includes(generationInputRole(name)))doc.segments=[...doc.segments.filter(segment=>segment.type==='frame'||segment.type==='column'),{type:'text',text:linkedTaskTexts(state,row.id).join('\n')}];
 if(generationInputRole(name)!=='text_input'){
  const column=state.table.fields.find(field=>field.videoInput===name);
  if(column){
   row.values[column.id]=[];
   if(row.meta?.generationReferences?.[state.fieldId])row.meta.generationReferences[state.fieldId]=row.meta.generationReferences[state.fieldId].filter(ref=>ref.fieldId!==column.id);
   doc.segments=doc.segments.filter(segment=>segment.type!=='column'||segment.fieldId!==column.id);
   const frames=row.meta?.generationFrames?.[state.fieldId];
   for(const role of Object.keys(frames||{}))if(frames[role].fieldId===column.id)delete frames[role];
  }
 }
 row.values[config.promptFieldId]=doc;row.values[state.fieldId]=[];
 row.meta||={};row.meta.generationPreviewAfter||={};row.meta.generationPreviewAfter[state.fieldId]=Date.now();
 syncGenerationFrameTags(state.table,state.fieldId,field.generation,row.id);
}

export function replaceLinkedTaskText(table,row,config,texts){
 const doc=toColumnPrompt(effectivePrompt(table,row,config.promptFieldId),row);
 doc.segments=[...doc.segments.filter(s=>s.type==='frame'||s.type==='column'),{type:'text',text:texts.join('\n')}];
 row.values[config.promptFieldId]=doc;
}

export function bindLinkedTaskReference(table,row,fieldId,config,column,{preserveMode=false}={}){
 if(!preserveMode&&config.model===LOCAL_VIDEO_MODEL&&(row.values[column.id]?.length||0)>0)throw new Error('本地 H3 FL 不支持多图或视频参考，请使用首帧／尾帧接口，或点击提示词中的帧标签选择图片');
 const columns=table.fields.filter(f=>preserveMode?!f.readonly&&['content','assets'].includes(f.type):f.id===column.id||['first_frame','last_frame','reference_images','reference_video','group'].includes(generationInputRole(f.videoInput||'')));
 row.meta||={};row.meta.generationReferences||={};
 row.meta.generationReferences[fieldId]=columns.flatMap(f=>(row.values[f.id]||[]).map(a=>({fieldId:f.id,assetId:a.id})));
 if(preserveMode||config.kind!=='video')return;
 const hasVideo=columns.some(f=>row.values[f.id]?.some?.(a=>a.kind==='video'));
 const next={...config,mode:hasVideo?'mixed2video':columns.some(f=>row.values[f.id]?.length)?'image2video':'text2video'};
 setRowGenerationConfig(row,fieldId,next);
 delete row.meta?.generationFrames?.[fieldId];
 syncGenerationFrameTags(table,fieldId,table.fields.find(f=>f.id===fieldId).generation,row.id);
}

// Reconcile legacy body-drop copies with their connected source without losing @/frame choices.
export function mergeLinkedTaskDuplicates(table,row,column){
 const key=asset=>{try{const url=new URL(asset.url,'http://local');if(url.pathname==='/view'){if(!url.searchParams.has('type'))url.searchParams.set('type','input');if(!url.searchParams.has('subfolder'))url.searchParams.set('subfolder','');}url.searchParams.sort();return url.pathname+url.search;}catch{return asset.url;}};
 const linked=new Map((row.values[column.id]||[]).map(asset=>[key(asset),asset]));
 for(const field of table.fields){
  if(field.videoInput||field.readonly||!['content','assets'].includes(field.type)||!Array.isArray(row.values[field.id]))continue;
  row.values[field.id]=row.values[field.id].filter(asset=>{
   const replacement=asset.sourceNodeId&&linked.get(key(asset));if(!replacement)return true;
   const remap=ref=>{if(ref?.fieldId===field.id&&ref.assetId===asset.id){ref.fieldId=column.id;ref.assetId=replacement.id;}};
   for(const refs of Object.values(row.meta?.generationReferences||{}))for(const ref of refs)remap(ref);
   for(const frames of Object.values(row.meta?.generationFrames||{}))for(const ref of Object.values(frames))remap(ref);
   for(const value of Object.values(row.values))for(const segment of value?.segments||[])remap(segment);
   return false;
  });
 }
}
