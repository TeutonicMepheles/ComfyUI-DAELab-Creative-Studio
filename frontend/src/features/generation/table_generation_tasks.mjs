import {generationTaskSnapshots,trackTaskCompletion} from './task_snapshots.mjs';
import {createTableButton as button,tableIcon} from '../../ui/table_controls.mjs';
import {GenerationSession,generationInputDigest} from './generation_session.js';
import {request,modelCapabilities} from './table_generation_api.mjs';
import {generationReportNeedsApply,generationReceipt,recoveryJob,isLocalGenerationModel,needsGenerationProject,isGeneration,generationRows,generationInput,applyGenerationResult,appendGenerationResult} from './table_generation_model.mjs';
const el=(tag,parent,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;parent?.append(node);return node;};
const phaseNames={waiting:'等待提交',running:'生成中',pausing:'暂停中',paused:'已暂停',stopped:'已停止后续提交',failed:'生成失败',needs_input:'待补充',needs_recovery:'待恢复',complete:'已完成',stale:'输入已变化'};
const stageNames={local_queued:'本机排队',local_generating:'本机生成',preparing:'准备中',submitting:'提交平台',writing_back:'等待写回',verifying:'核对原任务',downloading:'下载中'};
export function stageText(report,phase){
 if(phase==='pausing')return '正在中断本地任务';
 if(phase==='waiting'||!report?.stage)return phase==='running'?'启动中':'排队中';
 if(report.stage==='generating')return Number.isFinite(report.progress)?`平台生成 ${report.progress}%`:'平台生成';
 return stageNames[report.stage]||'生成中';
}
export function liveLabel(report,phase,now=Date.now()){
 const age=report?.updatedAt?Math.max(0,Math.round((now-report.updatedAt)/1000)):null;
 return [stageText(report,phase),report?.taskId&&'任务 '+report.taskId,report?.detail,age!==null&&`最近确认 ${age} 秒前`].filter(Boolean).join(' · ');
}
export const generationTaskStyle=`
.dae-ui .generation-cell-state{position:absolute;right:8px;top:8px;z-index:3;display:flex;gap:4px;align-items:center;width:max-content;padding:4px;border-radius:22px;background:var(--dae-surface,#242424);color:var(--dae-text,#fff);box-shadow:0 1px 5px #0005}
.dae-ui .generation-cell-state :is(button,.generation-state-icon){display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:32px!important;height:32px!important;min-width:32px!important;min-height:32px!important;padding:6px!important;border:0!important;border-radius:50%!important;background:transparent!important}
.dae-ui .generation-cell-state button:is(:hover,:focus-visible){background:var(--dae-surface-high,#383838)!important}
.dae-ui .generation-cell-state .dae-table-icon{display:block;width:20px;height:20px;background:currentColor;mask:var(--table-icon) center/contain no-repeat}
.dae-ui .generation-cell-state[data-error=true]{color:var(--dae-error,#ffb4ab)}
.dae-ui .generation-cell-state[data-phase=complete] .generation-state-icon{color:var(--dae-success,#98d7ad)}
.dae-ui .generation-cell-state{max-width:calc(100% - 16px);box-sizing:border-box}
.dae-ui .generation-stage{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 8px 0 2px;font:500 12px/1.5 var(--dae-font-family,inherit);font-variant-numeric:tabular-nums}
.dae-ui .generation-progress{flex:none;margin-left:6px;box-sizing:border-box;width:20px;height:20px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:dae-generation-spin 1s linear infinite}
@keyframes dae-generation-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.dae-ui .generation-progress{animation:none;border-style:dashed}}
`;

export function attachGenerationTasks({editor,getTable,notify,prepareGeneration,getConfig,onUpdate=()=>{},onPrepared=()=>{},onReports=()=>{},canGenerate=()=>true}){
 let alive=true,polling=false,submitting=false,epoch=0;
 const live=new Map(),localErrors=new Map(),discovered=new Map(),discoveredByTarget=new Map(),editGroups=new Map(),missingRequests=new Set();
 const targetKey=(recordId,fieldId)=>JSON.stringify([recordId,fieldId]);
 const targetReferences=(row,fieldId)=>[...new Map([...(row?.meta?.studioGenerationRefs?.[fieldId]||[]),...(discoveredByTarget.get(targetKey(row?.id,fieldId))?.values()||[])].map(ref=>[ref.requestId,ref])).values()].sort((a,b)=>(a.source.createdAt||0)-(b.source.createdAt||0));
 const reference=(row,fieldId)=>{const stable=identity(),refs=targetReferences(row,fieldId).filter(ref=>ref.source?.recordId===row?.id&&ref.source?.fieldId===fieldId&&(!stable||ref.source.documentId===stable.documentId&&ref.source.tableId===stable.tableId&&ref.source.nodeId===stable.nodeId));return refs.at(-1);};
 const allReferences=()=>{const table=getTable(),stable=identity(),owned=new Set(table.fields.filter(field=>isGeneration(field)&&!Object.hasOwn(table.meta?.liveSource?.fields||{},field.id)).map(field=>field.id));const refs=[...table.records.flatMap(row=>Object.values(row.meta?.studioGenerationRefs||{}).flat()),...discovered.values()];return [...new Map(refs.filter(ref=>owned.has(ref.source?.fieldId)&&table.records.some(row=>row.id===ref.source.recordId)&&(!stable||ref.source.documentId===stable.documentId&&ref.source.tableId===stable.tableId&&ref.source.nodeId===stable.nodeId)).map(ref=>[ref.requestId,ref])).values()];};
 const identity=()=>editor.taskIdentity;
 const session=new GenerationSession({
  begin:(requestId,target)=>editor.beginAsync(target,requestId),current:ticket=>editor.canAsync(ticket),release:ticket=>editor.releaseAsync(ticket),
  apply:(ticket,report)=>editor.applyAsync([ticket],table=>{const row=table.records.find(row=>row.id===ticket.recordId),ref=allReferences().find(ref=>ref.requestId===report.requestId);if(!row||!ref)throw new Error('原任务目标已删除');row.meta||={};row.meta.studioGenerationRefs||={};row.meta.studioGenerationRefs[ticket.fieldId]||=[];if(!row.meta.studioGenerationRefs[ticket.fieldId].some(item=>item.requestId===ref.requestId))row.meta.studioGenerationRefs[ticket.fieldId].push(structuredClone(ref));appendGenerationResult(table,row,ticket.fieldId,report.requestId,report.result,ref.model);},{group:editGroups.get(report.requestId)})!==false,
 });
 function stateFor(row,fieldId){
  const ref=reference(row,fieldId);
  if(!ref){const old=row?.meta?.generationColumns?.[fieldId];return old?{...old,phase:old.result?.url?'stale':'needs_recovery',legacy:true,error:'旧回执仅供查看；不会恢复旧执行通道'}:null;}
  const report=live.get(ref.requestId);
  return {...ref,...report,phase:report?.preparation&&['rejected','fenced'].includes(report.preparation)&&!session.canReplace(ref.requestId)?'needs_recovery':report?.phase||'needs_recovery',needsOriginalFence:missingRequests.has(ref.requestId),...(localErrors.has(ref.requestId)?{error:localErrors.get(ref.requestId)}:{}),history:targetReferences(row,fieldId).filter(item=>item.requestId!==ref.requestId).map(item=>({...item,...live.get(item.requestId)}))};
 }
 const projectTable=source=>{const table=structuredClone(source);for(const row of table.records){row.meta||={};row.meta.generationColumns=Object.fromEntries(table.fields.filter(isGeneration).map(field=>[field.id,stateFor(row,field.id)]).filter(([,value])=>value));}return table;};
 const projectedTable=()=>projectTable(getTable());
 // No generation columns means no generation capsules; preserve the public full projection.
 const taskSnapshots=()=>{const table=getTable();return table.fields.some(field=>field.presentation==='generation')?generationTaskSnapshots(projectTable(table),live):[];};
 function ingest(response){
  const accepted=[];
  for(const report of response.jobs||[])if(session.ingest(report)){live.set(report.requestId,report);missingRequests.delete(report.requestId);localErrors.delete(report.requestId);session.apply(report.requestId);accepted.push(report);}
  if(accepted.length)onReports(accepted);
  for(const status of editor.root.querySelectorAll('.generation-cell-state'))status.remove();decorate();
 }
 async function fenceOriginal(fieldId,recordId){
  if(!alive||submitting)return;const captured=epoch,row=getTable().records.find(row=>row.id===recordId),ref=reference(row,fieldId),stable=identity();
  if(!ref||!stable||!['documentId','tableId','nodeId'].every(key=>ref.source?.[key]===stable[key])||ref.inputDigest!==ref.source.inputDigest){notify('原请求身份不完整，不能封存');return;}
  submitting=true;decorate();
  try{session.watch(ref);const response=await request('fence-unsubmitted',{requestId:ref.requestId,source:ref.source,inputDigest:ref.inputDigest,model:ref.model});
   if(!alive||captured!==epoch)return;ingest(response);
   notify(session.canReplace(ref.requestId)?'原请求已封存且不会执行；再次选择重新生成将创建新请求':'原任务已有提交事实，不能作为未提交请求封存；请查询原任务');
  }catch(error){if(alive&&captured===epoch)notify(error.message);}finally{submitting=false;if(alive)decorate();}
 }
 async function generate(fieldId,recordId=null,recover=false,unsubmittedOnly=false){
  if(!alive||submitting||!canGenerate())return;const captured=epoch;submitting=true;decorate();
  const guards=[];let prepared=[];
  try{
   if(!editor.nativeDocument||!identity())throw new Error('原生编辑会话尚未就绪，未提交');
   if(recover){const refs=getTable().records.filter(row=>!recordId||row.id===recordId).map(row=>reference(row,fieldId)).filter(Boolean);if(!refs.length)throw new Error('旧回执只读；没有新任务账本引用');const existing=[];
    for(const ref of refs){session.watch(ref);try{ingest(await request('status',{requestIds:[ref.requestId]}));existing.push(ref.requestId);}catch(error){if(error.status===404&&error.code==='record_not_found'){missingRequests.add(ref.requestId);localErrors.set(ref.requestId,'暂未查到原请求；可能仍在预检。请继续查询，或明确封存原请求');notify('暂未查到原请求，尚不能重新生成；可明确封存原请求后再创建新请求');}else throw error;}}
    if(existing.length)ingest(await request('recover',{requestIds:existing}));return;}
   if(unsubmittedOnly)await poll(true);
   await prepareGeneration(fieldId,recordId);
   if(!alive||captured!==epoch||!canGenerate())return;
   const table=getTable(),candidates=unsubmittedOnly?table.records:recordId?table.records.filter(row=>row.id===recordId):generationRows(table,fieldId),rows=unsubmittedOnly?candidates.filter(row=>!reference(row,fieldId)&&!stateFor(row,fieldId)&&!row.values[fieldId]?.length):candidates,jobs=[];
   for(const row of rows){
    const old=stateFor(row,fieldId);if(old&&!old.legacy&&['waiting','running','pausing','needs_recovery'].includes(old.phase))throw new Error('请先核对原任务，未知状态不能直接创建新任务');
    const input=generationInput(table,fieldId,row.id),requestId=crypto.randomUUID(),guard=editor.beginAsync({recordId:row.id,fieldId},requestId);guards.push(guard);
    jobs.push({requestId,input,inputDigest:await generationInputDigest(input)});
   }
   if(!jobs.length)throw new Error('没有可生成的行，请补充提示词或检查任务状态');
   for(const config of new Map(jobs.map(job=>[job.input.config.model,job.input.config])).values())await modelCapabilities(config);
   await poll(true);if(unsubmittedOnly&&rows.some(row=>reference(row,fieldId)||stateFor(row,fieldId)||row.values[fieldId]?.length))throw new Error('任务状态已变化，请重新检查尚未生成的任务');if(rows.some(row=>['waiting','running','pausing','needs_recovery'].includes(stateFor(row,fieldId)?.phase)))throw new Error('账本中仍有原任务，请先恢复查询');
   if(!alive||captured!==epoch||!canGenerate()||guards.some(ticket=>!editor.canAsync(ticket)))throw new Error('预检期间输入或工作流已变化，未提交');
   const stable=identity(),group='generation:'+crypto.randomUUID(),createdAt=Date.now();for(const job of jobs)editGroups.set(job.requestId,group);
   editor.change(table=>{for(const job of jobs){const row=table.records.find(row=>row.id===job.input.recordId);row.meta||={};row.meta.studioGenerationRefs||={};row.meta.studioGenerationRefs[fieldId]||=[];
    const guard=guards.find(ticket=>ticket.requestId===job.requestId);const source={...stable,nodeId:guard.documentId,workflowSession:guard.workflowSession,epoch:guard.epoch,recordId:row.id,fieldId,inputVersion:guard.inputVersion+1,inputDigest:job.inputDigest,model:job.input.config.model,createdAt};
    row.meta.studioGenerationRefs[fieldId].push({requestId:job.requestId,inputDigest:job.inputDigest,source,model:job.input.config.model});
   }},{group});
   prepared=jobs.map(job=>({...job,source:getTable().records.find(row=>row.id===job.input.recordId).meta.studioGenerationRefs[fieldId].find(ref=>ref.requestId===job.requestId).source}));
   onPrepared(prepared);
   for(const ticket of guards)editor.releaseAsync(ticket);
   for(const job of jobs){const ref=getTable().records.find(row=>row.id===job.input.recordId).meta.studioGenerationRefs[fieldId].find(ref=>ref.requestId===job.requestId),ticket=editor.beginAsync({recordId:job.input.recordId,fieldId},job.requestId);if(ref.source.inputVersion!==ticket.inputVersion)throw new Error('输入版本已变化，未提交');session.watch(ref,ticket);job.source=ref.source;}
   const response=await request('submit',{jobs:jobs.map(({requestId,input,source})=>({requestId,input,source}))});
   if(alive&&captured===epoch)ingest(response);
  }catch(error){if(alive&&captured===epoch){notify(error.message);if(prepared.length)onReports(prepared.map(job=>({requestId:job.requestId,source:job.source,phase:'needs_recovery',error:error.message})));}}finally{for(const ticket of guards)editor.releaseAsync(ticket);submitting=false;decorate();}
 }
 async function pause(states){try{ingest(await request('pause',{requestIds:states.filter(state=>!state.legacy).map(state=>state.requestId)}));}catch(error){notify(error.message);}}
 async function reviewResult(fieldId,recordId,requestId){
  const row=getTable().records.find(row=>row.id===recordId),ref=requestId?targetReferences(row,fieldId).find(ref=>ref.requestId===requestId):reference(row,fieldId);if(!ref)throw new Error('没有可审阅的新任务引用');
  const ticket=editor.beginAsync({recordId,fieldId},crypto.randomUUID());
  try{session.watch(ref);const response=await request('status',{requestIds:[ref.requestId]}),report=response.jobs.find(report=>report.requestId===ref.requestId);if(!report||!session.ingest(report))throw new Error('原任务身份不匹配');
   const digest=await generationInputDigest(generationInput(getTable(),fieldId,recordId));if(!alive||!editor.canAsync(ticket))throw new Error('输入或工作流已变化，结果只供查看');editor.releaseAsync(ticket);
   if(!session.review(ref.requestId,digest,{...identity(),nodeId:ticket.documentId}))throw new Error('原结果与当前输入不匹配或尚未完成');return true;
  }finally{editor.releaseAsync(ticket);}
 }
 async function resume(fieldId){return generate(fieldId,null,true);}
 async function poll(whileSubmitting=false){
  if(!alive||submitting&&!whileSubmitting)return;if(polling){if(whileSubmitting)throw new Error('任务查询尚未完成，请稍后重试');return;}const captured=epoch;let refs=allReferences();polling=true;
  try{const stable=identity();if(stable){let offset=0;do{const response=await request('status',{source:{documentId:stable.documentId,tableId:stable.tableId,nodeId:stable.nodeId},limit:500,offset});if(!alive||captured!==epoch)return;for(const report of response.jobs||[])if(report.source?.documentId===stable.documentId&&report.source.tableId===stable.tableId&&report.source.nodeId===stable.nodeId&&/^[a-f0-9]{64}$/.test(report.source.inputDigest||'')){const ref={requestId:report.requestId,inputDigest:report.source.inputDigest,source:report.source,model:report.source.model};discovered.set(ref.requestId,ref);const key=targetKey(ref.source.recordId,ref.source.fieldId),bucket=discoveredByTarget.get(key)||new Map();bucket.set(ref.requestId,ref);discoveredByTarget.set(key,bucket);session.watch(ref);}ingest(response);offset=response.nextOffset;}while(Number.isSafeInteger(offset)&&offset>0);}refs=allReferences();for(const ref of refs)session.watch(ref);const ids=[...new Set(refs.map(ref=>ref.requestId))];for(let offset=0;offset<ids.length;offset+=500){const response=await request('status',{requestIds:ids.slice(offset,offset+500)});if(!alive||captured!==epoch)return;ingest(response);}}
  catch(error){if(whileSubmitting)throw error;if(alive&&captured===epoch){for(const ref of refs)localErrors.set(ref.requestId,'无法同步任务状态：'+error.message);onReports(refs.map(ref=>({...ref,phase:'needs_recovery',error:'无法同步任务状态：'+error.message})));decorate();}}
  finally{polling=false;}
 }
 function refreshLive(){
  for(const status of editor.root.querySelectorAll('.generation-cell-state[data-request-id]')){
   const chip=status.querySelector('.generation-stage');if(!chip)continue;
   const phase=status.dataset.phase,report=live.get(status.dataset.requestId),text=stageText(report,phase),label=(phaseNames[phase]||'')+' · '+liveLabel(report,phase);
   if(chip.textContent!==text)chip.textContent=text;
   status.title=label;status.setAttribute('aria-label',label);
   const ring=status.querySelector('.generation-progress');
   if(ring){ring.setAttribute('aria-label',label);if(Number.isFinite(report?.progress)&&report.stage==='generating')ring.setAttribute('aria-valuenow',String(report.progress));else ring.removeAttribute('aria-valuenow');}
  }
 }
 function decorate(headers){
  if(!alive)return;
  onUpdate();
  for(const run of editor.root.querySelectorAll('[data-generation-run]'))run.disabled=submitting;
  const table=getTable(),fields=table.fields.filter(isGeneration);if(!fields.length)return;
  headers||=new Map([...editor.root.querySelectorAll('th[data-column]')].map(h=>[h.dataset.column,h]));
  const rows=new Map(table.records.map(row=>[row.id,row])),cells=new Map(fields.map(f=>[f.id,[]]));
  for(const cell of editor.root.querySelectorAll('td[data-field]'))cells.get(cell.dataset.field)?.push(cell);
  let refresh=false;
  for(const field of fields){
   const header=headers.get(field.id);
   const actions=header?.querySelector('.generation-actions');
   if(actions){
    const states=table.records.map(r=>stateFor(r,field.id)),active=states.filter(s=>['waiting','running'].includes(s?.phase));
    const pausing=states.some(s=>s?.phase==='pausing'),paused=states.some(s=>s?.phase==='paused');
    const action=active.length?'pause':pausing?'pausing':paused?'resume':'';
    const previous=actions.querySelector('[data-generation-control]');
    if(previous?.dataset.generationControl!==action){
     previous?.remove();
     if(action){
      const label=action==='pause'?'暂停本列生成':action==='pausing'?'正在暂停':'继续本列生成';
      const control=tableIcon(button(label,()=>action==='resume'?resume(field.id):pause(getTable().records.map(r=>stateFor(r,field.id)).filter(s=>['waiting','running'].includes(s?.phase)))),action==='resume'?'play-line':'pause-fill',label);
      control.dataset.generationControl=action;control.classList.add('generation-settings');control.disabled=action==='pausing';
      control.title=label+'；本地当前行中断后会重新生成，Comfy 已提交任务继续完成';
      actions.insertBefore(control,actions.querySelector('[data-generation-source]'));
     }
    }
   }
   for(const cell of cells.get(field.id))if(!cell.querySelector('.generation-cell-state')){
    const row=rows.get(cell.dataset.record),state=stateFor(row,field.id);
    const preview=cell.querySelector('.content-display')||cell;
    const phase=state?.phase||'idle',busy=['waiting','running','pausing'].includes(phase);
    const label=(phaseNames[phase]||'尚未生成')+(state?.error?' · '+state.error:'');
    const status=el('div',preview);status.className='generation-cell-state';status.dataset.phase=phase;status.dataset.error=String(Boolean(state?.error)&&!busy);status.setAttribute('role','status');status.setAttribute('aria-label',label);status.title=label;
    if(busy&&state?.error?.startsWith('无法同步任务状态：')){
     status.append(tableIcon(button(label,()=>notify(label)),'error-warning-line',label),tableIcon(button('刷新任务状态',()=>poll(true)),'restart-line','刷新任务状态'));
    }
    else if(busy){
     status.dataset.requestId=state.requestId;
     const ring=el('span',status);ring.className='generation-progress';ring.setAttribute('role','progressbar');ring.setAttribute('aria-valuemin','0');ring.setAttribute('aria-valuemax','100');ring.setAttribute('aria-label',label);
     el('span',status,stageText(live.get(state.requestId),phase)).className='generation-stage';
    }
    else if(state){const indicator=tableIcon(button(label,()=>notify(label)),phase==='complete'?'check-line':phase==='paused'?'pause-fill':'error-warning-line',label);indicator.classList.add('generation-state-icon');status.append(indicator);}
    if(busy&&phase!=='pausing')status.append(tableIcon(button('暂停此行',()=>pause([state])),'pause-fill','暂停此行；本地中断后从头生成，Comfy 已提交任务继续完成'));
    if(!busy){const recover=!state?.legacy&&(phase==='needs_recovery'||phase==='stopped'||phase==='paused'),retry=Boolean(state);const actionLabel=phase==='paused'?'查询原任务':recover?'恢复原任务':retry?'重新生成':'生成此行';status.append(tableIcon(button(actionLabel,()=>generate(field.id,row.id,recover)),retry&&phase!=='paused'?'restart-line':'play-line',actionLabel));
    }
    if(state?.needsOriginalFence&&!state?.legacy)status.append(tableIcon(button('封存原请求',()=>fenceOriginal(field.id,row.id)),'stop-line','明确阻止原请求以后提交；已执行的任务不会被覆盖'));
    if(phase==='paused'&&!state?.legacy)status.append(tableIcon(button('按当前输入重新生成',()=>generate(field.id,row.id,false)),'play-line','明确创建新的本地任务；原任务回执保留'));
    const completedHistory=[...(state?.history||[]),...(['stale','complete'].includes(phase)&&state?.result?[state]:[])].filter(s=>s.result?.url&&!s.legacy);
    if(completedHistory.length)status.append(tableIcon(button('已有生成结果',()=>{
     const dialog=editor.openDialog('已有生成结果');el('p',dialog,'将此前已完成的结果追加到本行，已有素材和当前任务保留；同一结果不会重复添加。');
     for(const old of completedHistory){const model=old.input?.config?.model||'原任务';dialog.append(button('添加 '+model+' · '+old.result.name,async()=>{
      const ticket=editor.beginAsync({recordId:row.id,fieldId:field.id},crypto.randomUUID());
      try{const response=await request('status',{requestIds:[old.requestId]}),report=response.jobs.find(s=>s.requestId===old.requestId);if(report?.phase!=='complete'||!report.result?.url)throw new Error(report?.error||'原结果暂不可用，请恢复原任务');
       if(!alive||!dialog.isConnected)return;
       session.ingest(report);if(!editor.canAsync(ticket))throw new Error('输入或工作流已变化');const digest=await generationInputDigest(generationInput(getTable(),field.id,row.id));if(!editor.canAsync(ticket))throw new Error('输入或工作流已变化');editor.releaseAsync(ticket);if(!session.review(old.requestId,digest,{...identity(),nodeId:ticket.documentId}))throw new Error('结果与当前输入不匹配，仅供查看');dialog.remove();
      }catch(error){notify(error.message);}finally{editor.releaseAsync(ticket);}
     }));}dialog.append(button('关闭',()=>dialog.remove()));
    }),'folder-image-line','已有生成结果'));
    status.onpointerdown=e=>e.stopPropagation();status.onmousedown=e=>e.stopPropagation();status.ondblclick=e=>e.stopPropagation();
    if(busy)refresh=true;
   }
  }
  if(refresh)refreshLive();
 }
 const timer=setInterval(()=>void poll(),3000);
 return {reviewResult,fenceOriginal,stateFor,projectedTable,tasks:trackTaskCompletion(taskSnapshots),generate,pause,resume,decorate,get submitting(){return submitting;},invalidate(){epoch++;session.invalidate();},destroy(){alive=false;epoch++;session.dispose();clearInterval(timer);live.clear();localErrors.clear();discovered.clear();discoveredByTarget.clear();editGroups.clear();missingRequests.clear();}};
}
