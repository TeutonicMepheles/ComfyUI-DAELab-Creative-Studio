import {optimizationTaskSnapshots,trackTaskCompletion} from '../generation/task_snapshots.mjs';
import {canonical,OptimizationRevisions,freezeSnapshot,matchesSnapshot,restoreSuggestion,applySuggestions,appliedSuggestionStatus,inspectTarget,displaySuggestion,NAMESPACE,optimizationProvider,OPTIMIZATION_MODELS} from './prompt_optimization_model.mjs';
import {createPromptOptimizationApi} from './prompt_optimization_api.mjs';
import {createOptimizationComposer,createOptimizationSourceView} from './prompt_optimization_composer.mjs';
import {createSettingsPopover} from './table_prompt_settings.mjs';
import {describeTableSource,focusTableSource} from '../table/table_exchange.mjs';


const activeStatuses=new Set(['submitting','submitted','polling']);
const terminal=new Set(['succeeded','failed','skipped','stopped','unknown']);
const uuid=()=>crypto.randomUUID();
export function createOptimizationController({getTable,identity,revisions,persist,change,api,scope,fieldId,recordId,isActive=()=>true,onBatch=()=>{},onApplied=()=>{},onMissingBatch=()=>{},getAppliedRequestIds=()=>[],instanceId=uuid(),preferences={},onPreferences=()=>{},edits=null,persistIntent=null}){
 let dead=false,epoch=0,lifecycle=0,lease=null,batch=null,timer=null,prepared=[],running=false,requiresContinue=false,continuationQuoteId=null,acknowledgeUnknownRequestIds=[];
 const listeners=new Set(),items=new Map();
 let blockingOperations=0,estimateEpoch=null,capabilityEpoch=0,submissionIntent=null,missingBatch=false;
 const operations=new Map();
 const state={scope,fieldId,recordId,requirements:preferences.requirements||'',model:preferences.model||'qwen3.5:9b-q4_K_M',models:[],range:{total:0,processable:0,skipped:[]},quote:null,busy:false,error:'',rows:[],batchId:null,permissions:{},deepseekKeyConfigured:false,pageDeepSeekKeyConfigured:false};
 const batchProvider=()=>optimizationProvider(batch?.rows?.[0]?.snapshot?.model||state.model);
 const providerLocked=()=>missingBatch||blockingOperations>0||[...items.values()].some(i=>activeStatuses.has(i.status)||['queued','preparing'].includes(i.status));
 const unknownIds=()=> (state.unknownRequests||[]).map(r=>r.requestId);
 function setUnknownRequests(rows){
  const next=[...new Map(rows.map(r=>[r.requestId,r])).values()].sort((a,b)=>a.requestId.localeCompare(b.requestId));
  if(JSON.stringify(next.map(r=>r.requestId))!==JSON.stringify(unknownIds()))acknowledgeUnknownRequestIds=[];
  state.unknownRequests=next;
 }
 function update(){
  if(dead)return;state.busy=blockingOperations>0||estimateEpoch===epoch;revisions.observe(getTable());persist();state.inactiveReason=isActive()?'':'节点处于停用模式或视图已释放，请恢复 Active 后继续';
  state.paused=Boolean(requiresContinue||batch?.paused);state.stopped=Boolean(batch?.stopped);
  state.operationName=[...operations.values()].at(-1)||'';
  state.provider=optimizationProvider(state.model);state.pageDeepSeekKeyConfigured=Boolean(api.hasDeepSeekKey?.());
  state.deepseekKeyRequired=state.provider==='deepseek'&&!state.pageDeepSeekKeyConfigured&&!state.deepseekKeyConfigured;
  const rowNumbers=new Map(getTable().records.map((row,index)=>[row.id,index+1]));
  state.rows=[...items.values()].map(item=>{const s=item.frozen?.wire||item.snapshot;const match=(!edits||item.editTicket&&edits.can(item.editTicket))&&item.frozen&&matchesSnapshot(getTable(),identity,revisions,item.frozen,{observed:true});const suggestionStatus=item.applied?appliedSuggestionStatus(getTable(),item):item.suggestion?.status==='valid'&&!match?'stale':item.suggestion?.status;
   const provider=optimizationProvider(s?.model),currency=provider==='qwen'?'local':provider==='deepseek'?'USD':'credits';
   return {requestId:item.requestId,recordId:s?.target.recordId,label:`第 ${rowNumbers.get(s?.target.recordId)||0} 行`,before:s?.input?displaySuggestion({wire:s},s.input.prompt_text):'',after:s?.input?displaySuggestion({wire:s},item.suggestion?.text||''):'',status:item.status,suggestionStatus,reason:suggestionStatus==='applied'?'':suggestionStatus==='reverted'?'本次应用已撤销，可使用重做恢复结果':suggestionStatus==='stale'?'目标或依赖已变化，建议仅供查看':item.suggestion?.reason||item.error||'',canApply:suggestionStatus==='valid'&&match&&isActive(),provider,currency,actualCredits:provider==='deepseek'?null:item.actualCredits??null,usageCostUSD:provider==='deepseek'?item.usageCostUSD??null:null};});
  state.unknownRequests=(state.unknownRequests||[]).map(r=>({...r,label:rowNumbers.has(r.target?.recordId)?`第 ${rowNumbers.get(r.target.recordId)} 行`:'历史目标'}));
  const inFlight=Boolean(state.requestActivity)||[...items.values()].some(i=>activeStatuses.has(i.status)),queued=[...items.values()].some(i=>['queued','preparing'].includes(i.status));
  const resumable=[...items.values()].some(i=>['queued','preparing','stopped'].includes(i.status));
  const quoteValid=state.quote?.status==='ready'&&state.quote.expiresAt>Date.now();
  state.continuationReady=Boolean(quoteValid&&state.quote.quoteId===continuationQuoteId&&state.quote.quoteId!==batch?.quoteId);
  state.permissions={canChangeProvider:!providerLocked(),canEstimate:!missingBatch&&!state.busy&&!inFlight&&!queued,canSubmit:!missingBatch&&!state.busy&&quoteValid&&prepared.length>0&&!inFlight&&!queued&&isActive()&&!state.deepseekKeyRequired,canStop:!!batch&&(inFlight||queued)&&!batch.stopped,canContinue:!!batch&&!inFlight&&resumable&&(requiresContinue||batch.paused||batch.stopped)&&isActive(),canRecover:!!state.batchId,canFence:missingBatch&&submissionIntent?.batchId===state.batchId&&(submissionIntent.references||submissionIntent.rows).every(row=>row.source),canApplyAll:state.rows.some(i=>i.canApply)};
  for(const listener of listeners)listener(state);
 }
 async function operation(fn,name='processing'){if(dead)return;const token={};operations.set(token,name);blockingOperations++;state.error='';update();try{return await fn();}catch(e){state.error=e.message||String(e);}finally{operations.delete(token);blockingOperations--;update();}}
 function releasePrepared(){for(const item of prepared)if(item.editTicket)edits?.release(item.editTicket);prepared=[];}
 function observe(){if(!isActive()){requiresContinue=true;lifecycle++;}update();}
 async function estimate(){
  if(dead||blockingOperations>0||missingBatch)return;
  state.draftActive=true;const e=++epoch,model=state.model,requirements=state.requirements;estimateEpoch=e;state.error='';state.quote={status:'estimating'};releasePrepared();update();
  try{
  const table=getTable(),rows=scope==='cell'?table.records.filter(r=>r.id===recordId):table.records;
  const pending=[],skipped=[];const temporary=new OptimizationRevisions(revisions.serialize());
  for(const row of rows)try{const target={...identity,recordId:row.id,fieldId},editTicket=edits?.begin(target,uuid());const frozen=await freezeSnapshot(table,target,temporary,{model,requirements,begin:true});pending.push({...frozen,editTicket});}catch(error){skipped.push({recordId:row.id,reason:error.message});}
  if(dead||e!==epoch){for(const item of pending)if(item.editTicket)edits?.release(item.editTicket);return;}prepared=pending;state.range={total:rows.length,processable:pending.length,skipped};update();
  const quote=pending.length?await api.estimate({rows:pending.map(p=>p.wire),skipped,model,maxOutputTokens:1024}):{status:'unavailable',reason:'当前范围没有可优化的提示词'};
   if(dead||e!==epoch)return;prepared=pending;state.range={total:rows.length,processable:pending.length,skipped};state.quote=quote;
   setUnknownRequests(quote.unknownRequests||[...items.values()].filter(i=>i.status==='unknown').map(i=>({requestId:i.requestId,target:(i.frozen?.wire||i.snapshot)?.target,model:(i.frozen?.wire||i.snapshot)?.model})));
  }catch(error){if(!dead&&e===epoch){state.error=error.message||String(error);state.quote={status:'unavailable',reason:state.error};}}
  finally{if(e===epoch){estimateEpoch=null;update();}}
 }
 async function controlLease(){lease=await api.lease({target:identity,instanceId,leaseId:lease?.leaseId});return lease;}
 function schedule(){clearTimeout(timer);if(!dead&&batch&&[...items.values()].some(i=>!terminal.has(i.status)))timer=setTimeout(()=>void tick(),1200);}
 function ingest(value){
  batch=value;state.batchId=value.batchId;
  state.batchModel=value.rows?.[0]?.snapshot?.model||state.model;state.batchProvider=optimizationProvider(state.batchModel);
  state.batchPrice=value.price||null;state.batchCurrency=value.currency||value.price?.currency||(state.batchProvider==='deepseek'?'USD':'credits');
  const currentIds=new Set((value.rows||[]).map(row=>row.requestId));for(const id of items.keys())if(!currentIds.has(id)){if(items.get(id).editTicket)edits?.release(items.get(id).editTicket);items.delete(id);}
  if(!state.draftActive||!prepared.length)setUnknownRequests(value.unknownRequests||[...(state.unknownRequests||[]),...(value.rows||[]).filter(r=>r.status==='unknown').map(r=>({requestId:r.requestId,batchId:value.batchId,target:r.snapshot.target,model:r.snapshot.model}))]);
  for(const row of value.rows||[]){let item=items.get(row.requestId);if(!item){item={...row};items.set(row.requestId,item);}if(item.frozen&&(row.snapshot?.snapshotDigest!==item.frozen.wire.snapshotDigest||canonical(row.snapshot.target)!==canonical(item.frozen.wire.target))){item.status='unknown';item.error='回执与冻结输入身份不一致';if(item.editTicket)edits?.release(item.editTicket);continue;}Object.assign(item,row);item.applied=Boolean(item.applied||getAppliedRequestIds(value.batchId).includes(row.requestId));
   if(row.suggestion&&item.frozen){try{item.suggestion={...row.suggestion,...restoreSuggestion(item.frozen,row.suggestion.text,{status:row.status==='succeeded'?'completed':'incomplete'})};}catch(e){item.suggestion={...row.suggestion,status:'invalid',reason:e.message};}}
  }update();
 }
 async function tick(){
  if(dead||running||!batch)return;running=true;const life=lifecycle;
  try{
   ingest(await api.query({batchId:batch.batchId,provider:batchProvider()}));
   if(dead||life!==lifecycle)return;if(!isActive()){requiresContinue=true;return;}
   if(!requiresContinue&&!batch.paused&&!batch.stopped){await controlLease();if(dead||life!==lifecycle||!isActive())return;}
   const current=[...items.values()].find(i=>activeStatuses.has(i.status));
   if(current){ingest(await api.recover({batchId:batch.batchId,provider:batchProvider()}));return;}
   if(requiresContinue||batch.stopped||batch.paused)return;
   const next=batch.rows.map(r=>items.get(r.requestId)).find(i=>['queued','preparing'].includes(i.status));if(!next)return;
   await controlLease();if(dead||life!==lifecycle||!isActive()){requiresContinue=true;return;}
   if(edits&&(!next.editTicket||!edits.can(next.editTicket))||!next.frozen||!matchesSnapshot(getTable(),identity,revisions,next.frozen)){ingest(await api.skip({batchId:batch.batchId,requestId:next.requestId,leaseId:lease.leaseId,reason:'发送前目标或依赖已变化'}));return;}
   state.requestActivity={phase:'prepare',requestId:next.requestId,label:state.rows.find(r=>r.requestId===next.requestId)?.label||'当前行',startedAt:Date.now()};update();
   const s=next.frozen.wire;const permit=await api.permit({batchId:batch.batchId,requestId:next.requestId,leaseId:lease.leaseId,snapshotDigest:s.snapshotDigest,revision:s.revision,requestSeq:s.requestSeq});
   // Recheck after awaiting permit: UI edits/close must not race an old approval.
   if(dead||life!==lifecycle||requiresContinue||!isActive()||edits&&!edits.can(next.editTicket)||!matchesSnapshot(getTable(),identity,revisions,next.frozen)){requiresContinue=true;return;}
   state.requestActivity.phase='request';update();
   ingest(await api.advance({batchId:batch.batchId,requestId:next.requestId,leaseId:lease.leaseId,permitId:permit.permitId,provider:optimizationProvider(s.model)},{beforeSend:()=>!dead&&life===lifecycle&&!requiresContinue&&isActive()&&(!edits||edits.can(next.editTicket))&&matchesSnapshot(getTable(),identity,revisions,next.frozen)}));
  }catch(e){state.error=e.message;requiresContinue=true;}finally{state.requestActivity=null;running=false;update();schedule();}
 }
 async function submit({acknowledgeUnknown=false}={}){const life=lifecycle;const canSubmit=state.permissions.canSubmit;return operation(async()=>{
  if(state.deepseekKeyRequired)throw new Error('请先保存本页 DeepSeek API 密钥，或配置服务器 DEEPSEEK_API_KEY');
  if(!canSubmit)throw new Error('请先取得当前范围的有效费用估算');
  const risks=unknownIds();
  if(acknowledgeUnknown)acknowledgeUnknownRequestIds=risks;
  if(risks.some(id=>!acknowledgeUnknownRequestIds.includes(id)))throw new Error('请先确认全部历史未知请求可能已计费，再开始新的优化请求');
  for(const p of prepared){if(edits&&!edits.can(p.editTicket))throw new Error('输入或工作流已变化，请重新估算');const s=p.wire,now=revisions.current(getTable(),s.target.recordId,s.target.fieldId);if(now.revision!==s.revision||now.requestSeq+1!==s.requestSeq||inspectTarget(getTable(),s.target.recordId,s.target.fieldId).stamp!==p.local.stamp)throw new Error('估算后目标已变化，请重新估算');}
  await controlLease();if(dead||life!==lifecycle||!isActive())throw new Error('当前视图不可提交');
  for(const p of prepared){if(edits&&!edits.can(p.editTicket))throw new Error('输入或工作流已变化，请重新估算');const s=p.wire,now=revisions.current(getTable(),s.target.recordId,s.target.fieldId);if(now.revision!==s.revision||now.requestSeq+1!==s.requestSeq||inspectTarget(getTable(),s.target.recordId,s.target.fieldId).stamp!==p.local.stamp)throw new Error('取得控制权期间目标已变化，请重新估算');}
  const rows=prepared.map(frozen=>{const requestId=uuid();if(frozen.editTicket)edits?.release(frozen.editTicket);const editTicket=edits?.begin(frozen.wire.target,requestId),source=editTicket?.workflowSession?{...frozen.wire.target,nodeId:editTicket.documentId,workflowSession:editTicket.workflowSession,epoch:editTicket.epoch,inputVersion:editTicket.inputVersion+(persistIntent?1:0),inputDigest:frozen.wire.snapshotDigest,model:frozen.wire.model}:undefined;return {requestId,snapshot:frozen.wire,frozen,editTicket,...(source?{source}:{})};}),batchId=uuid();
  const range=scope==='cell'?{scope,fieldId,recordId}:{scope,fieldId};
  for(const row of rows)items.set(row.requestId,{...row,status:'queued'});state.batchId=batchId;
  submissionIntent={quoteId:state.quote.quoteId,batchId,range,rows:rows.map(({requestId,snapshot,source})=>({requestId,snapshot,...(source?{source}:{})})),leaseId:lease.leaseId,budgetCredits:state.quote.budgetUpperCredits,acknowledgeUnknownRequestIds};
  if(persistIntent){persistIntent(fenceReference(submissionIntent));for(const row of rows){edits?.release(row.editTicket);row.editTicket=edits?.begin(row.snapshot.target,row.requestId);if(row.source?.inputVersion!==row.editTicket?.inputVersion)throw new Error('保存请求引用后输入已变化，未提交');items.set(row.requestId,{...row,status:'queued'});}}
  missingBatch=false;const value=await api.submit(structuredClone(submissionIntent));
  if(dead){for(const row of rows)edits?.release(row.editTicket);return;}
  if(value.reusedExisting){
   const authoritative=value.range||{scope:value.rows.length===1?'cell':'column',fieldId:value.rows[0]?.snapshot.target.fieldId,...(value.rows.length===1?{recordId:value.rows[0].snapshot.target.recordId}:{})};
   if(authoritative.scope!==scope||authoritative.fieldId!==fieldId||(scope==='cell'&&authoritative.recordId!==recordId))throw new Error('已有任务范围与当前请求不同，请打开原任务查看；未创建新任务。');
   onBatch(value.batchId,authoritative);await recover(value.batchId);return;
  }
  for(const r of rows){revisions.begin(getTable(),r.snapshot.target.recordId,r.snapshot.target.fieldId);items.set(r.requestId,{...r,status:'queued'});}persist();
  onBatch(value.batchId,{scope,fieldId,recordId});state.draftActive=false;requiresContinue=life!==lifecycle||!isActive();ingest(value);schedule();
 },'submit');}
 async function recover(batchId=state.batchId){return operation(async()=>{
  const recoveryTicket=edits?.begin({...identity,fieldId,...(recordId?{recordId}:{})},uuid());try{
  if(!batchId)return;missingBatch=true;state.draftActive=false;state.batchId=batchId;state.quote=null;releasePrepared();continuationQuoteId=null;epoch++;
  // Discover the frozen provider without reading native credentials first.
  // Subsequent Comfy polling retains native auth; DeepSeek remains local-only.
  let value;
  try{value=await api.recover({batchId},{localOnly:true});}catch(error){
   if(error?.message!=='找不到优化任务'&&!(error?.status===404&&error?.code==='record_not_found'))throw error;
   missingBatch=true;requiresContinue=true;throw new Error('暂未查到原批次，可能仍在预检；请继续查询，或明确封存原批次后重新估算。');
  }missingBatch=false;if(dead||edits&&!edits.can(recoveryTicket))throw new Error('恢复期间工作流或输入已变化，原结果仅供查看');requiresContinue=true;
  const restored=value.rows?.[0]?.snapshot;if(restored){state.model=restored.model;state.requirements=restored.requirements??state.requirements;}
  const skipped=value.preflightSkipped||[];
  state.range={total:value.rows.length+skipped.length,processable:value.rows.length,skipped};
  for(const row of value.rows||[]){if(items.has(row.requestId))continue;let frozen,editTicket;try{const s=row.snapshot,nonce=s.input.protected_tokens[0]?.match(/^⟦DAE_REF_(.+)_\d+⟧$/)?.[1];const entry={stamp:inspectTarget(getTable(),s.target.recordId,s.target.fieldId).stamp,revision:s.revision,requestSeq:s.requestSeq},temporary=edits?new OptimizationRevisions({[revisions.key(s.target.recordId,s.target.fieldId)]:entry}):revisions;frozen=await freezeSnapshot(getTable(),s.target,temporary,{model:s.model,requirements:s.requirements,maxOutputTokens:s.maxOutputTokens,...(nonce?{nonce}:{})});if(frozen.wire.snapshotDigest!==s.snapshotDigest)frozen=null;else if(dead||edits&&!edits.can(recoveryTicket))frozen=null;else{revisions.merge(temporary.serialize());editTicket=edits?.begin(s.target,row.requestId);}}catch{}items.set(row.requestId,{...row,frozen,editTicket});}
  ingest(value);schedule();
  }finally{if(recoveryTicket)edits?.release(recoveryTicket);}
 },'recover');}
 function fenceReference(intent){return intent.references?structuredClone({batchId:intent.batchId,quoteId:intent.quoteId,range:intent.range,references:intent.references}):{batchId:intent.batchId,quoteId:intent.quoteId,range:structuredClone(intent.range),references:intent.rows.map(row=>({requestId:row.requestId,source:structuredClone(row.source),revision:row.snapshot.revision,requestSeq:row.snapshot.requestSeq}))};}
 async function fenceOriginalBatch(){return operation(async()=>{
  const intent=submissionIntent;if(!missingBatch||!intent||intent.batchId!==state.batchId||!(intent.references||intent.rows).every(row=>row.source)||!isActive())throw new Error('缺少可核对的原提交身份，不能封存');
  const reference=fenceReference(intent),value=await api.fence(reference,{localOnly:true});if(dead)return;
  if(value.batchId!==intent.batchId||value.rows?.length!==reference.references.length||!reference.references.every(expected=>{const row=value.rows.find(row=>row.requestId===expected.requestId);return row?.replacementAllowed===true&&row.status==='skipped'&&row.snapshot?.snapshotDigest===expected.source.inputDigest&&Object.entries(expected.source).every(([key,item])=>row.source?.[key]===item);}))throw new Error('原批次已有提交事实或身份不匹配，尚不能新建请求');
  for(const item of items.values())if(item.editTicket)edits?.release(item.editTicket);items.clear();releasePrepared();onMissingBatch(intent.batchId);batch=null;missingBatch=false;submissionIntent=null;requiresContinue=false;state.batchId=null;state.quote=null;state.draftActive=true;state.error='原批次已封存且不会执行；请重新估算并明确创建新请求。';
 },'fence');}
 function apply(ids){return operation(()=>{if(!isActive())throw new Error('当前模式不可应用');const selected=[...items.values()].filter(i=>ids.includes(i.requestId));if(edits&&selected.some(item=>!item.editTicket||!edits.can(item.editTicket)))throw new Error('输入或工作流已变化，建议只供查看');const result=applySuggestions({table:getTable(),identity,revisions,items:selected,change:edits?update=>edits.apply(selected.map(item=>item.editTicket),update,selected.map(item=>({requestId:item.requestId,batchId:state.batchId,...item.frozen.wire.target}))):change});for(const id of result.applied)items.get(id).applied=true;if(result.applied.length)onApplied(state.batchId,result.applied);state.error=result.conflicts.map(c=>c.reason).join('；');observe();return result;},'apply');}
 function setModel(id){
  if(providerLocked()){state.error='任务进行中，请先停止剩余行再切换服务或模型';update();return false;}
  state.draftActive=true;state.model=id;state.quote=null;releasePrepared();continuationQuoteId=null;epoch++;state.error='';
  onPreferences({model:id,requirements:state.requirements});update();void loadCapabilities();return true;
 }
 const controller={getState:()=>state,subscribe(fn){listeners.add(fn);fn(state);return()=>listeners.delete(fn);},setRequirements(text){if(providerLocked())return false;state.draftActive=true;state.requirements=text;onPreferences({model:state.model,requirements:text});state.quote=null;epoch++;update();return true;},setModel,
 setProvider(provider){return setModel(provider==='qwen'?'qwen3.5:9b-q4_K_M':provider==='deepseek'?'deepseek-flash':'gpt-4.1-mini');},
 setDeepSeekKey(value){const configured=Boolean(api.setDeepSeekKey?.(value));state.error='';update();return configured;},
 clearDeepSeekKey(){api.clearDeepSeekKey?.();update();return false;},restoreIntent(value){if(dead||submissionIntent)return;submissionIntent=structuredClone(value);state.batchId=value.batchId;missingBatch=true;update();},estimate,submit,fenceOriginalBatch,stop:()=>operation(async()=>{requiresContinue=true;await controlLease();ingest(await api.stop({batchId:state.batchId,leaseId:lease.leaseId}));},'stop'),recover,continue:()=>operation(async()=>{
  const life=lifecycle;
  if(!state.quote||state.quote.status!=='ready'||state.quote.quoteId!==continuationQuoteId||state.quote.expiresAt<=Date.now()||state.quote.quoteId===batch.quoteId){
   prepared=[];
   const e=++epoch,rows=batch.rows.map(i=>i.snapshot),quote=await api.estimate({rows,skipped:[],model:rows[0].model,maxOutputTokens:rows[0].maxOutputTokens});
   if(dead||e!==epoch||life!==lifecycle)return;
   state.quote=quote;continuationQuoteId=quote.quoteId;state.model=rows[0].model;
   if(quote.status!=='ready'){state.error=quote.reason||'剩余任务暂无法估算';return;}
   return;
  }
  await controlLease();ingest(await api.continue({batchId:state.batchId,leaseId:lease.leaseId,quoteId:state.quote.quoteId,budgetCredits:state.quote.budgetUpperCredits}));state.draftActive=false;requiresContinue=life!==lifecycle||!isActive();schedule();
 },'continue'),retry:({acknowledgeUnknown=false}={})=>{
  const unknown=state.unknownRequests||[];
  if(unknown.length&&!acknowledgeUnknown){state.error='原请求结果未知，可能已产生费用；请明确确认新请求可能重复收费。';update();return;}
  acknowledgeUnknownRequestIds=unknown.map(i=>i.requestId);return estimate();
 },apply:id=>apply([id]),applyAll:()=>apply(state.rows.filter(r=>r.canApply).map(r=>r.requestId)),observe,pause(){requiresContinue=true;lifecycle++;update();},destroy(){submissionIntent=null;dead=true;epoch++;clearTimeout(timer);unsubscribeKey?.();for(const item of [...items.values(),...prepared])if(item.editTicket)edits?.release(item.editTicket);listeners.clear();}};
 const unsubscribeKey=api.subscribeDeepSeekKey?.(()=>update());
 async function loadCapabilities(){
  const c=++capabilityEpoch,model=state.model;
  try{const caps=await api.capabilities({model});if(dead||c!==capabilityEpoch||model!==state.model)return;
   state.models=(caps.models||[]).map(m=>typeof m==='string'?{id:m,label:m,provider:optimizationProvider(m)}:{...m,provider:m.provider||optimizationProvider(m.id)});state.deepseekKeyConfigured=Boolean(caps.deepseekKeyConfigured);if(!caps.available)state.error=caps.reason||'当前服务暂不可用';
  }catch(error){if(!dead&&c===capabilityEpoch&&model===state.model)state.error=error.message||String(error);}
  finally{if(!dead&&c===capabilityEpoch&&model===state.model)update();}
 }
 update();void loadCapabilities();
 return controller;
}

export function attachPromptOptimization({node,graph,editor,getTable,identity,fetchApi,isActive=()=>node.mode===0||node.mode==null}){
 const saved=()=>node.properties[NAMESPACE];
 editor.taskIdentity={...identity,nodeId:String(node.id)};
 const revisions=new OptimizationRevisions();
 // Legacy properties are read-only. Current batches are discovered from SQLite.
 const references=new Map((getTable().meta?.studioOptimizationRequests||[]).map(ref=>[ref.batchId,{...ref,...ref.range}])),persist=()=>{};
 const api=createPromptOptimizationApi({fetchApi});const controllers=new Map(),instanceId=uuid();let dead=false,popover=null,view=null,visibilityTimer=null;
 const preferences=()=>getTable().meta?.studioOptimizationPreferences||saved().preferences||{};
 const defaultModel=()=>OPTIMIZATION_MODELS.some(model=>model.id===preferences().model)?preferences().model:'qwen3.5:9b-q4_K_M';
 const edits={begin:(target,id)=>{if(!editor.nativeDocument)throw new Error('原生编辑会话尚未就绪');return editor.beginAsync(target,id);},can:ticket=>editor.canAsync(ticket),release:ticket=>editor.releaseAsync(ticket),apply(tickets,update,refs){
  if(editor.applyAsync(tickets,table=>{const before=structuredClone(table);update(table);for(const ref of refs){const row=table.records.find(row=>row.id===ref.recordId),old=before.records.find(row=>row.id===ref.recordId);if(row&&JSON.stringify(row.values[ref.fieldId])!==JSON.stringify(old?.values[ref.fieldId])){row.meta||={};row.meta.studioOptimizationResults||={};row.meta.studioOptimizationResults[ref.fieldId]={requestId:ref.requestId,batchId:ref.batchId};}}})===false)throw new Error('输入或工作流已变化，建议未应用');
 }};
 const closeView=()=>{clearInterval(visibilityTimer);visibilityTimer=null;popover?.close();popover=null;view?.destroy();view=null;};
 function obtain(target){const key=JSON.stringify([target.scope,target.fieldId,target.recordId||'']);if(controllers.has(key))return controllers.get(key);
  const controller=createOptimizationController({getTable,identity,revisions,persist,change:editor.change,edits,api,...target,instanceId,preferences:{model:defaultModel(),requirements:preferences().drafts?.[key]||saved().drafts?.[key]||''},onPreferences:value=>editor.change(table=>{table.meta||={};table.meta.studioOptimizationPreferences||={};table.meta.studioOptimizationPreferences.model=value.model;table.meta.studioOptimizationPreferences.drafts||={};table.meta.studioOptimizationPreferences.drafts[key]=value.requirements;},{group:'optimization-preferences:'+key}),isActive:()=>!dead&&node.graph===graph&&isActive(),persistIntent:ref=>{editor.change(table=>{table.meta||={};table.meta.studioOptimizationRequests||=[];table.meta.studioOptimizationRequests.push(structuredClone(ref));},{group:'optimization-submit:'+ref.batchId});references.set(ref.batchId,{...ref,...ref.range});},onMissingBatch:batchId=>references.delete(batchId),getAppliedRequestIds:batchId=>getTable().records.flatMap(row=>Object.values(row.meta?.studioOptimizationResults||{}).filter(ref=>ref.batchId===batchId).map(ref=>ref.requestId)),onBatch:(batchId,range)=>references.set(batchId,{...references.get(batchId),batchId,...range})});controllers.set(key,controller);
  const last=[...references.values()].filter(b=>b.scope===target.scope&&b.fieldId===target.fieldId&&b.recordId===target.recordId).at(-1);if(last){if(last.references)controller.restoreIntent(last);void controller.recover(last.batchId);}return controller;
 }
 editor.openPromptOptimization=target=>{
  closeView();const field=getTable().fields.find(f=>f.id===target.fieldId);if(!field)return;
  const ownerRoot=editor.root,ownerDocument=editor.nativeDocument,{scope,fieldId,recordId}=target;
  let anchor=target.anchor||ownerRoot;
  // Metadata writes rebuild cells. Resolve only inside this editor and retain
  // the stable target; never attach to another instance with matching row IDs.
  const resolveAnchor=()=>{
   if(dead||node.graph!==graph||editor.root!==ownerRoot||editor.nativeDocument!==ownerDocument||!ownerRoot.isConnected||!ownerRoot.getClientRects().length)return null;
   const table=getTable();if(!table.fields.some(f=>f.id===fieldId)||scope==='cell'&&!table.records.some(r=>r.id===recordId))return null;
   const matches=element=>scope==='column'?element.dataset?.column===fieldId:element.dataset?.field===fieldId&&element.dataset?.record===recordId;
   if(anchor?.isConnected&&ownerRoot.contains(anchor)&&matches(anchor))return anchor;
   const selector=scope==='column'?'th[data-column]':'td[data-field]';
   anchor=[...(ownerRoot.querySelectorAll?.(selector)||[])].find(element=>matches(element)&&ownerRoot.contains(element))||null;
   if(!anchor&&!target.anchor)anchor=ownerRoot; // Preserve the explicit root-anchored programmatic API.
   return anchor;
  };
  const initial=resolveAnchor();if(!initial)return;
  popover=createSettingsPopover(initial,'优化'+field.name,()=>{clearInterval(visibilityTimer);visibilityTimer=null;view?.destroy();view=null;popover=null;},{placement:'above',onEscape:()=>view?.closeNested?.(),resolveAnchor});
  visibilityTimer=setInterval(()=>{if(dead||node.graph!==graph||!isActive()){closeView();for(const c of controllers.values())c.pause();}else popover?.reposition();},200);
  if(field.readonly){const source=describeTableSource(node,getTable(),field.id);view=createOptimizationSourceView({container:popover.root,source,onLocate:()=>{closeView();focusTableSource(node,source);}});return;}
  const controller=obtain(target);controller.observe();view=createOptimizationComposer({controller,container:popover.root,fieldName:field.name});
  if(!controller.getState().quote&&!controller.getState().batchId)void controller.estimate();
 };

 editor.promptOptimizationEstimate=async target=>{
  const table=getTable(),rows=target.scope==='cell'?table.records.filter(r=>r.id===target.recordId):table.records,temporary=new OptimizationRevisions(revisions.serialize()),frozen=[],skipped=[];
  for(const row of rows)try{frozen.push((await freezeSnapshot(table,{...identity,recordId:row.id,fieldId:target.fieldId},temporary,{begin:true,model:defaultModel(),requirements:preferences().drafts?.[JSON.stringify([target.scope,target.fieldId,target.recordId||''])]||''})).wire);}catch(e){skipped.push({recordId:row.id,reason:e.message});}
  return api.estimate({rows:frozen,skipped,model:defaultModel(),maxOutputTokens:1024});
 };
 void api.query({target:identity},{localOnly:true}).then(result=>{if(dead)return;for(const item of result.batches||[]){
  // A late discovery is not an edit. Keep existing stable query references;
  // mutable server counters/timestamps must not disturb native Undo/Redo.
  if(!references.has(item.batchId))references.set(item.batchId,{batchId:item.batchId,scope:item.scope,fieldId:item.fieldId,...(item.recordId?{recordId:item.recordId}:{}),updatedAt:item.updatedAt});
 }persist();
 // Restore existing targets for node-level visibility; recover is local-only and never submits.
 for(const ref of references.values())if(['cell','column'].includes(ref.scope)&&getTable().fields.some(f=>f.id===ref.fieldId)&&(ref.scope==='column'||getTable().records.some(r=>r.id===ref.recordId)))obtain({scope:ref.scope,fieldId:ref.fieldId,...(ref.scope==='cell'?{recordId:ref.recordId}:{})});
 for(const controller of controllers.values()){const state=controller.getState();if(state.batchId)continue;const last=[...references.values()].filter(b=>b.scope===state.scope&&b.fieldId===state.fieldId&&b.recordId===state.recordId).reverse().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0];if(last)void controller.recover(last.batchId);}}).catch(()=>{/* Offline ledger discovery can be retried on next mount. */});
 const unobserve=editor.onTableChange(()=>{revisions.observe(getTable());persist();for(const c of controllers.values())c.observe();});
 return {tasks:trackTaskCompletion(()=>optimizationTaskSnapshots([...controllers.values()].map(c=>c.getState()))),observe(){revisions.observe(getTable());persist();for(const c of controllers.values())c.observe();},pause(){closeView();for(const c of controllers.values())c.pause();},destroy(){dead=true;closeView();unobserve();for(const c of controllers.values())c.destroy();controllers.clear();delete editor.openPromptOptimization;delete editor.promptOptimizationEstimate;}};
}
