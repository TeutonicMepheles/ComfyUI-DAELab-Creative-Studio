// Business-owned mapping to the optional Canvas tasks v1 protocol.
// No Canvas imports, DOM, polling, requests, or task execution.
import {optimizationStatus} from '../prompt/prompt_optimization_status.mjs';
import {generationErrorText} from './control_labels.js';
const active=new Set(['waiting','running','pausing','interrupting']);
const confirmedStop=row=>row.state==='cancelled'&&['interrupted','paused'].includes(row.phase);
const stages={local_queued:'本机排队',local_generating:'本机生成',preparing:'准备中',submitting:'提交平台',writing_back:'等待写回',verifying:'核对原任务',downloading:'下载中',generating:'平台生成'};
export function generationTaskSnapshots(table,live=new Map()){
 const groups=new Map();
 for(const field of table.fields.filter(f=>f.presentation==='generation')){
  for(const row of table.records){const receipt=row.meta?.generationColumns?.[field.id];if(!receipt?.requestId)continue;
   const report=live.get(receipt.requestId),config=report?.input?.config||receipt.input?.config||row.meta?.generationSettings?.[field.generation?.promptFieldId]?.[field.id]||field.generation;
   const kind=config?.kind==='video'?'video':'image',list=groups.get(kind)||[];list.push({...receipt,...report,phase:receipt.phase==='stale'?'stale':report?.phase||receipt.phase,unverified:!report&&active.has(receipt.phase)});groups.set(kind,list);}
 }
 return [...groups].map(([kind,rows])=>{
  const latest=Math.max(...rows.map(row=>Number(row.source?.createdAt)||0));
  const scoped=rows.filter(row=>(Number(row.source?.createdAt)||0)===latest);
  const stopped=scoped.filter(confirmedStop);
  const unverifiedStop=scoped.some(r=>['paused','interrupted','stopped'].includes(r.phase)&&!confirmedStop(r));
  const running=scoped.filter(r=>active.has(r.phase)),failed=scoped.filter(r=>['failed','needs_input','needs_recovery'].includes(r.phase)||r.error&&!confirmedStop(r));
  const stopping=running.some(r=>!r.unverified&&(['pausing','interrupting'].includes(r.phase)||r.controlIntent==='interrupt'))||stopped.length>0&&running.length>0;
  const current=running.find(r=>r.phase==='running')||running[0];
  const completed=scoped.filter(r=>r.phase==='complete').length,total=Math.max(scoped.length,...scoped.map(row=>Number(row.source?.groupCount)||1)),grouped=total>1;
  const state=running.length?(stopping?'running':running.every(r=>r.phase==='waiting'||r.unverified)?'queued':'running'):failed.length||unverifiedStop?'recovery':stopped.length?'cancelled':scoped.some(r=>r.phase==='stale')?'recovery':'success';
  const reason=state==='recovery'&&failed.find(r=>r.error)?.error;
  const detail=stopping?'中止中':state==='cancelled'?'已中止':reason?generationErrorText(reason):unverifiedStop?'执行状态待核实':grouped?(running.length?`处理中 ${running.length}/${total}`:state==='success'?`已完成 ${completed}/${total}`:'部分任务待处理'):current?(current.unverified?'核对任务状态':stages[current.stage]||(current.phase==='waiting'?'等待提交':'启动中')):state==='recovery'?'任务待处理':'生成完成';
  return {id:'generation:'+kind,label:kind==='image'?'图片生成':'视频生成',order:kind==='image'?20:30,state,done:completed,total,countLabel:'已完成',unit:'行',
   detail:detail+(failed.length?` · 异常 ${failed.length}`:''),
   progress:!grouped&&current?.stage==='generating'&&Number.isFinite(current.progress)?current.progress:undefined};
 });
}
export function optimizationTaskSnapshots(states){
 const present=states.filter(s=>s.batchId||s.requestActivity||s.operationName==='submit');if(!present.length)return [];
 const rows=[...new Map(present.flatMap(s=>s.rows||[]).filter(r=>r.requestId).map(r=>[r.requestId,r])).values()];
 const views=present.map(s=>optimizationStatus(s)),current=views.find(v=>['running','submit','recover','stop','continue','apply'].includes(v.phase));
 const ended=rows.filter(r=>['succeeded','failed','skipped','stopped','unknown'].includes(r.status)).length;
 const attention=views.find(v=>['disconnected','unknown','attention','error','acknowledge'].includes(v.phase));
 const paused=views.find(v=>['paused','stopped'].includes(v.phase));
 const state=current?'running':views.some(v=>v.phase==='queued')?'queued':attention?'recovery':paused?'paused':'success';
 const request=present.find(s=>s.requestActivity)?.requestActivity;
 return [{id:'prompt-optimization',label:'提示词优化',order:10,state,done:ended,total:rows.length,countLabel:'已结束',unit:'行',
  detail:current?(request?.phase==='request'?'等待模型响应':current.title):attention?.title||paused?.title||(state==='queued'?'等待提交':'优化完成'),
  startedAt:request?.startedAt,elapsed:Boolean(request)}];
}
// Only announce a completion observed in this live owner. Historical successes
// never reappear after workflow reload; timestamps are not serialized.
export function trackTaskCompletion(read){
 const previous=new Map();
 return ()=>read().map(task=>{
  const old=previous.get(task.id);let finishedAt=task.finishedAt;
  if(['success','cancelled'].includes(task.state))finishedAt??=old?.state===task.state?old.finishedAt:old?Date.now():undefined;
  const next={...task,finishedAt};previous.set(task.id,next);return next;
 });
}
