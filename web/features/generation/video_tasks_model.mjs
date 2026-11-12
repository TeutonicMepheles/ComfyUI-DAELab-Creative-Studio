import {createMaterialTable} from '../../application/table_material_columns.mjs';
import {addField,uid,normalizeTable} from '../../application/table_model.mjs';
import {LOCAL_VIDEO_MODEL,LOCAL_IMAGE_MODEL,mergeTaskGenerationConfig,isGeneration,addGenerationColumn,promptColumns,rowGenerationConfig,setRowGenerationConfig,promptGenerationOwner,syncGenerationFrameTags,applyPromptContent} from './table_generation_model.mjs';
import {effectivePrompt,toColumnPrompt,promptContent} from '../prompt/table_prompt_template.mjs';
import {generationMaterials} from '../../application/table_material_output.mjs';
import {videoTaskResultPreviews} from './video_task_results.js';
import {promptSourceId,requirePromptSource,setPromptSource} from '../prompt/table_prompt_source.mjs';
import {tableAssets} from '../prompt/table_prompt_model.mjs';

export function syncVideoTaskReferences(state){
 const fields=new Set(state.table.fields.filter(field=>!field.readonly&&field.id!==state.fieldId).map(field=>field.id));
 for(const row of [...state.table.records,...(state.archivedTasks||[])]){
  row.meta||={};row.meta.generationReferences||={};
  row.meta.generationReferences[state.fieldId]=tableAssets(state.table,row).filter(asset=>fields.has(asset.fieldId)).map(asset=>({fieldId:asset.fieldId,assetId:asset.id}));
 }
}

export const activeVideoTask=row=>Object.values(row?.meta?.generationColumns||{}).some(s=>['waiting','running','pausing'].includes(s.phase));
// Selection controls the next submission; submitted requests remain reachable.
export function videoTaskHistoryRows(state){
 const current=new Set(state.table.records.map(row=>row.id)),seen=new Set();
 return [...state.table.records,...(state.archivedTasks||[])].filter(row=>{
  if(seen.has(row.id))return false;seen.add(row.id);
  return row.meta?.studioGenerationRefs?.[state.fieldId]?.length||row.meta?.generationColumns?.[state.fieldId]||row.values[state.fieldId]?.length;
 }).map(row=>({row,archived:!current.has(row.id)}));
}
export function taskConfig(config={},promptFieldId){
 if(config.model&&config.kind)return {...structuredClone(config),promptFieldId};
 return {version:1,kind:'video',model:LOCAL_VIDEO_MODEL,promptFieldId,mode:'omni2video',settings:{width:512,height:288,duration:2,turbo:false,seed:-1}};
}

export function familyTaskConfig(config,promptFieldId,kind=null,fallback=null){
 if(!kind||config?.kind===kind)return taskConfig(config,promptFieldId);
 if(fallback?.kind===kind)return {...structuredClone(fallback),promptFieldId,...(config?.attempts!==undefined?{attempts:config.attempts}:{})};
 const own=kind==='image'?{version:1,kind,model:LOCAL_IMAGE_MODEL,mode:'text2image',settings:{ratio:'auto'}}:taskConfig({},promptFieldId);
 return {...own,promptFieldId,...(config?.attempts!==undefined?{attempts:config.attempts}:{})};
}
export function createVideoTasks(values={},kind=null){
 const table=createMaterialTable(),field=addGenerationColumn(table,{name:'生成结果'}),row=table.records[0];table.records=[row];
 const model=values.model||LOCAL_VIDEO_MODEL;
 field.generation=model===LOCAL_VIDEO_MODEL?taskConfig({},field.generation.promptFieldId):{version:1,kind:'video',model,promptFieldId:field.generation.promptFieldId,mode:(kind==='video'?'omni2video':values.mode)||'omni2video',settings:{duration:Number(values.duration)||5,resolution:values.resolution||(model==='Minimax H3'?'768P':'720p'),ratio:values.ratio||'16:9',...(model==='Minimax H3'?{}:{enableSound:values.sound??true})}};
 if(kind==='image')field.generation={version:1,kind:'image',model:LOCAL_IMAGE_MODEL,promptFieldId:field.generation.promptFieldId,mode:'text2image',settings:{ratio:'auto'}};
 table.meta.generationProject=values.project_uuid||'';
 row.values[field.generation.promptFieldId]=toColumnPrompt(values.prompt||'',row);
 syncGenerationFrameTags(table,field.id,field.generation);
 return {version:1,table,fieldId:field.id,currentId:row.id};
}
export function importVideoTasks(source,promptId,previous,{kind=null}={}){
 const table=normalizeTable(source),prompt=requirePromptSource(table);
 table.records=table.records.filter(row=>row.selected);
 prompt.readonly=false;setPromptSource(table,prompt.id);
 const sourceOwner=promptGenerationOwner(table,prompt.id),owner=sourceOwner&&structuredClone(sourceOwner);
 const fieldId=owner&&isGeneration(owner)?owner.id:uid(),defaults=familyTaskConfig(owner?.generation||previous?.table.fields.find(f=>f.id===previous.fieldId)?.generation,prompt.id,kind);
 for(const field of table.fields){if(isGeneration(field)){field.presentation='content';field.readonly=false;}delete field.generation;delete field.generationConfigFieldId;}
 let output=table.fields.find(f=>f.id===fieldId);
 if(!output)output=addField(table,{id:fieldId,name:'生成结果',type:'content',readonly:true});
 output.presentation='generation';output.readonly=true;output.generation=defaults;prompt.generationConfigFieldId=fieldId;
 for(const row of table.records){
  const old=source.records.find(r=>r.id===row.id),config=familyTaskConfig(owner?rowGenerationConfig(old,owner.id,owner.generation):defaults,prompt.id,kind,defaults);
  row.selected=false;row.name=old.name||`任务${source.records.indexOf(old)+1}`;
  for(const column of [prompt]){
   row.values[column.id]=toColumnPrompt(effectivePrompt(source,old,column.id),old);
   for(const segment of row.values[column.id].segments)if(segment.type==='frame')segment.generationFieldId=fieldId;
  }
  const frames=owner&&old.meta?.generationFrames?.[owner.id];
  row.meta={...(frames?{generationFrames:{[fieldId]:structuredClone(frames)}}:{})};
  setRowGenerationConfig(row,fieldId,config);row.values[fieldId]=[];
  const content=promptContent(source,old,prompt.id);
  if(content.some(s=>s.type==='frame'))applyPromptContent(table,row,prompt.id,content,fieldId);
 }
 syncGenerationFrameTags(table,fieldId,defaults);
 const state={version:1,table,fieldId,currentId:table.records[0]?.id||''};
 syncVideoTaskReferences(state);
 return state;
}
export function selectTaskPrompt(state,recordId,promptFieldId){
 if(state.table.meta?.generationInput&&promptFieldId!==promptSourceId(state.table))throw new Error('请在来源表格的列头切换提示词');
 const row=state.table.records.find(r=>r.id===recordId),field=state.table.fields.find(f=>f.id===state.fieldId);
 if(!row||!promptColumns(state.table).some(f=>f.id===promptFieldId))throw new Error('提示词来源已不存在，请重新导入表格');
 const config=rowGenerationConfig(row,field.id,field.generation);
 if(config.promptFieldId===promptFieldId)return;
 const next=row.meta?.generationSettings?.[promptFieldId]?.[field.id]||{...config,promptFieldId};
 setRowGenerationConfig(row,field.id,next);row.meta.generationPromptFields||={};row.meta.generationPromptFields[field.id]=promptFieldId;
 syncGenerationFrameTags(state.table,field.id,field.generation,row.id);
}
export function videoTaskAssets(state){
 const table={...state.table,records:state.table.records.map(row=>({...row,values:{...row.values,[state.fieldId]:videoTaskResultPreviews(row.values[state.fieldId]||[],row.meta?.generationColumns?.[state.fieldId],row.meta?.generationPreviewAfter?.[state.fieldId])}}))};
 return generationMaterials(table,state.fieldId);
}
export function syncVideoTaskInputs(state,source,previous,{skipConfig=new Set(),kind=null}={}){
 const normalized=normalizeTable(source),id=promptSourceId(normalized);
 state.table.meta.generationInput=structuredClone(normalized.meta.generationInput);
 const output=state.table.fields.find(f=>f.id===state.fieldId);
 for(const row of [...state.table.records,...(state.archivedTasks||[])])if(skipConfig.has(row.id))setRowGenerationConfig(row,state.fieldId,rowGenerationConfig(row,state.fieldId,output.generation));
 const ownConfigs=new Map([...state.table.records,...(state.archivedTasks||[])].map(row=>[row.id,structuredClone(rowGenerationConfig(row,state.fieldId,output.generation))]));
 const owner=promptGenerationOwner(normalized,id),oldOwner=promptGenerationOwner(previous,promptSourceId(previous));
 if(owner)output.generation=familyTaskConfig(owner.generation,id,kind,output.generation);
 // Selection changes membership, not the serialized task identity or receipts.
 const existing=new Map([...(state.archivedTasks||[]),...state.table.records].map(row=>[row.id,row]));
 const selected=new Set(normalized.records.filter(row=>row.selected).map(row=>row.id));
 state.archivedTasks=[...existing.values()].filter(row=>!selected.has(row.id));
 state.table.records=normalized.records.filter(row=>row.selected).map(origin=>{
  if(existing.has(origin.id))return existing.get(origin.id);
  const row={...structuredClone(origin),selected:false,meta:{}};
  row.values[state.fieldId]=[];setRowGenerationConfig(row,state.fieldId,taskConfig(output.generation,id));
  return row;
 });
 if(!state.table.records.some(row=>row.id===state.currentId))state.currentId=state.table.records[0]?.id||'';
 const incomingIds=new Set(normalized.fields.map(f=>f.id)),previousIds=new Set(previous.fields.map(f=>f.id));
 state.table.fields=state.table.fields.filter(f=>f.id===state.fieldId||!previousIds.has(f.id)||incomingIds.has(f.id));
 for(const incoming of normalized.fields){
  if(incoming.id===state.fieldId)continue;
  let field=state.table.fields.find(f=>f.id===incoming.id);
  if(!field){field=structuredClone(incoming);state.table.fields.push(field);}
  delete field.promptTemplate;Object.assign(field,structuredClone(incoming));
  if(isGeneration(field)){field.presentation='content';field.readonly=false;}delete field.generation;
 }
 if(id&&state.table.fields.some(f=>f.id===id)){
  const field=state.table.fields.find(f=>f.id===id);field.readonly=false;setPromptSource(state.table,id);
  for(const row of [...state.table.records,...state.archivedTasks]){
   if(skipConfig.has(row.id))continue;
   const config=rowGenerationConfig(row,output.id,output.generation);
   if(config.promptFieldId!==id){setRowGenerationConfig(row,output.id,{...config,promptFieldId:id});if(row.meta?.generationPromptFields)delete row.meta.generationPromptFields[output.id];}
  }
  output.generation.promptFieldId=id;
 }
 const origins=new Map(normalized.records.map(row=>[row.id,row]));
 for(const row of [...state.table.records,...state.archivedTasks]){
  if(skipConfig.has(row.id))continue;
  const origin=origins.get(row.id);
  if(!origin)continue;
  if(owner){
   const incoming=familyTaskConfig(rowGenerationConfig(origin,owner.id,owner.generation),id,kind,ownConfigs.get(row.id)||output.generation),oldRow=previous.records.find(r=>r.id===row.id),oldConfig=oldOwner&&oldRow&&rowGenerationConfig(oldRow,oldOwner.id,oldOwner.generation);
   if(!existing.has(row.id)||owner.generationConfigRevision!==oldOwner?.generationConfigRevision||oldRow&&JSON.stringify(incoming)!==JSON.stringify(oldConfig))setRowGenerationConfig(row,state.fieldId,existing.has(row.id)?{...mergeTaskGenerationConfig(ownConfigs.get(row.id),incoming),promptFieldId:id}:taskConfig(incoming,id));
  }
  if(row.meta)delete row.meta.generationSourceMissing;
  for(const key of Object.keys(row.values))if(key!==state.fieldId&&previousIds.has(key)&&!incomingIds.has(key))delete row.values[key];
  for(const field of normalized.fields){
   if(field.id===state.fieldId)continue;
   if(field.id===id)applyPromptContent(state.table,row,id,promptContent(normalized,origin,id),state.fieldId);
   else if(JSON.stringify(origin.values[field.id])!==JSON.stringify(previous.records.find(r=>r.id===row.id)?.values[field.id])||!previousIds.has(field.id)){
    if(Object.hasOwn(origin.values,field.id))row.values[field.id]=structuredClone(origin.values[field.id]);else delete row.values[field.id];
   }
  }
  row.name=origin.name||`任务${normalized.records.indexOf(origin)+1}`;
 }
 syncVideoTaskReferences(state);
}

// Prompt writeback can derive a mode on the source table from added/removed frame tags.
// That echo must not replace the generating node's model/settings for the edited rows.
export function syncVideoTaskPromptWriteback(state,source,previous,recordIds){
 const output=state.table.fields.find(field=>field.id===state.fieldId),ids=new Set(recordIds);
 const configs=new Map(state.table.records.filter(row=>ids.has(row.id)).map(row=>[row.id,structuredClone(rowGenerationConfig(row,state.fieldId,output.generation))]));
 syncVideoTaskInputs(state,source,previous);
 for(const row of state.table.records)if(configs.has(row.id))setRowGenerationConfig(row,state.fieldId,configs.get(row.id));
}
