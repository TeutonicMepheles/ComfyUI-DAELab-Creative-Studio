/** Test-only, passive PERF-02 semantic observer. Importing does not mount/start it.
 * DOM equality plus two rAF boundaries is a paint opportunity, NOT compositor proof,
 * persisted-workflow validation, or native load-to-editable measurement.
 */
export const TABLE_FIXTURES=Object.freeze({
 '79ecd59cf5bbd3022abda73c2368e3e45e3b9fed824494f813cd6109e381cc79':'FX-PERF-M-no-video.json',
 '1cffbe4755b2e4b65c79c8b2256ab2c59effa3d5b61cc89c6d0038a0a14fed8d':'FX-PERF-M-video.json',
});
const HEX=/^[a-f0-9]{64}$/;
const copy=value=>JSON.parse(JSON.stringify(value));
const EVENT_TYPES=['input','compositionstart','compositionupdate','compositionend','blur'];
export async function readTableSemanticFixture(bytes,crypto){
 if(bytes.byteLength>8*1024*1024)throw Error('夹具超过 8 MiB');
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
 if(!TABLE_FIXTURES[sha256])throw Error('只接受固定 FX-PERF-M 合成夹具');
 const workflow=JSON.parse(new TextDecoder().decode(bytes)),tables={};
 for(const node of workflow.nodes.filter(node=>node.type==='DAELAB.Table')){
  const table=JSON.parse(node.widgets_values[0]);
  tables[String(node.id)]={records:table.records.map(row=>row.id),fields:table.fields.filter(field=>field.type==='content').map(field=>field.id)};
 }
 return {file:TABLE_FIXTURES[sha256],sha256,bytes:bytes.byteLength,workflowId:workflow.id,tables};
}

export function createTableSemanticObserver(document,window,{onChange=()=>{},timeoutMs=5000,maxSamples=2000,maxCompositionEvents=4000}={}){
 let active=false,disposed=false,current=null,abort=null,nextToken=0,nextSample=0,nextComposition=0;
 const tokens=new WeakMap(),pending=new Map();let compositions=new WeakMap(),fixtureIdentities=new Map();
 const now=()=>window.performance.now();
 const token=element=>{if(!tokens.has(element))tokens.set(element,++nextToken);return tokens.get(element);};
 const notify=()=>onChange({active,samples:current?.samples.length||0,pending:pending.size});
 const reject=(reason)=>{if(current)current.rejected[reason]=(current.rejected[reason]||0)+1;};
 const identity=owner=>({canvas:token(owner.canvas),card:token(owner.card),table:token(owner.table),row:token(owner.row),cell:token(owner.cell),editor:token(owner.editor),nodeId:owner.card.dataset.nodeId,recordId:owner.cell.dataset.record,fieldId:owner.cell.dataset.field});
 function locate(target){
  const editor=target?.closest?.('.content-display');
  if(!editor||editor!==target)return null;
  const cell=editor.closest('td[data-record][data-field]'),row=cell?.closest('tr[data-record-id]'),table=cell?.closest('.dae-table'),card=table?.closest('.dae-creative-card[data-node-id]'),canvas=card?.closest('.dae-creative');
  if(!cell||!row||!table||!card||!canvas||editor.parentElement!==cell||row.dataset.recordId!==cell.dataset.record)return null;
  const allowed=fixtureIdentities.get(card.dataset.nodeId);
  if(!allowed?.records.has(cell.dataset.record)||!allowed.fields.has(cell.dataset.field))return null;
  return {editor,cell,row,table,card,canvas};
 }
 function same(owner,expected){
  if(Object.values(owner).some(element=>!element.isConnected))return false;
  const actual=locate(owner.editor);
  return actual&&Object.keys(owner).every(key=>actual[key]===owner[key])&&JSON.stringify(identity(actual))===JSON.stringify(expected);
 }
 function visible(owner){
  if(document.visibilityState!=='visible')return false;
  if(owner.editor.checkVisibility&&!owner.editor.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return false;
  let left=0,top=0,right=window.innerWidth,bottom=window.innerHeight;
  const rect=owner.editor.getBoundingClientRect();
  if(rect.width<=0||rect.height<=0)return false;
  // Bounded ancestry only: never scan a whole table/page on input or rAF.
  let parent=owner.editor;
  for(let depth=0;parent&&depth<24;depth++,parent=parent.parentElement){
   const style=window.getComputedStyle(parent);
   if(parent.hidden||style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false;
   if(parent===owner.canvas||/hidden|clip|auto|scroll/.test(`${style.overflowX} ${style.overflowY}`)){
    const clip=parent.getBoundingClientRect();left=Math.max(left,clip.left);top=Math.max(top,clip.top);right=Math.min(right,clip.right);bottom=Math.min(bottom,clip.bottom);
   }
   if(parent===owner.canvas)return rect.right>left&&rect.left<right&&rect.bottom>top&&rect.top<bottom;
  }
  return false;
 }
 function read(owner){
  // Structured @ chips/materials need a separate semantic contract. Do not flatten them.
  if(owner.editor.querySelector('.dae-prompt-ref,[contenteditable=false],img,video'))throw Error('unsupported-structured-content');
  const value=owner.editor.innerText;
  if(typeof value!=='string'||value.length>4096)throw Error('unsupported-or-oversized-text');
  return value;
 }
 const mode=owner=>owner.cell.dataset.inlineEditing==='true'&&owner.editor.contentEditable==='true'?'editing':owner.cell.dataset.inlineEditing!=='true'&&owner.editor.contentEditable!=='true'?'display':'inconsistent';
 function clearItem(item){
  if(item.raf!==null)window.cancelAnimationFrame(item.raf);
  window.clearTimeout(item.timer);item.observer.disconnect();pending.delete(item.owner.editor);
 }
 function finish(item,reason){
  if(pending.get(item.owner.editor)!==item)return;
  for(const phase of ['editing','display'])if(item.sample[phase].status==='pending')item.sample[phase]={...item.sample[phase],status:reason==='display-observed'?'not-observed-before-display':reason};
  item.sample.finishedAt=now();item.sample.finishReason=reason;clearItem(item);notify();
 }
 function schedule(item){if(item&&active&&pending.get(item.owner.editor)===item&&item.raf===null)item.raf=window.requestAnimationFrame(()=>check(item));}
 function check(item){
  item.raf=null;if(!active||pending.get(item.owner.editor)!==item)return;
  const started=now(),sample=item.sample;
  if(sample.checks.length>=16){finish(item,'check-capacity');return;}
  if(!same(item.owner,sample.identity)){finish(item,'stale-instance-or-identity');return;}
  let value;try{value=read(item.owner);}catch(error){finish(item,error.message);return;}
  const state=mode(item.owner),shown=visible(item.owner),invalid=item.owner.editor.getAttribute('aria-invalid')==='true';
  sample.checks.push({at:started,state,visible:shown,invalid,value,exact:value===sample.expectedValue});
  sample.observerCheckMs+=now()-started;
  if(invalid){finish(item,'application-rejected');return;}
  if(!shown){finish(item,'not-visible');return;}
  if(state==='inconsistent'){finish(item,'inconsistent-editor-state');return;}
  if(value!==sample.expectedValue){finish(item,'value-mismatch');return;}
  const phase=sample[state];
  if(phase.status==='pending'){
   if(phase.semanticAt==null){phase.semanticAt=started;phase.firstRafAt=started;schedule(item);return;}
   phase.status='observed';phase.nextFrameAt=started;phase.inputToPaintOpportunityMs=started-sample.inputAt;
   phase.exitToPaintOpportunityMs=state==='display'&&sample.editExitAt!=null?started-sample.editExitAt:null;
  }
  if(state==='display'){finish(item,'display-observed');return;}
  // After editing becomes visible, wait passively for actual blur/DOM state changes.
 }
 function begin(owner,event,kind,compositionId=null,receivedAt=now()){
  const previous=pending.get(owner.editor);if(previous)finish(previous,'superseded-by-next-input');
  if(current.samples.length>=maxSamples){stop('sample-capacity');return;}
  let expectedValue;try{expectedValue=read(owner);}catch(error){reject(error.message);return;}
  if(!visible(owner)||mode(owner)!=='editing'){reject('input-not-visible-editing');return;}
  const eventTimeStamp=Number.isFinite(event.timeStamp)?event.timeStamp:null,validClock=eventTimeStamp!==null&&eventTimeStamp>=0&&eventTimeStamp<=receivedAt&&receivedAt-eventTimeStamp<60000;
  const sample={id:++nextSample,kind,eventType:event.type,compositionId,eligibleForCommittedInputLatency:kind==='input',timingDomain:kind==='ime-commit'?'compositionend-to-frame':kind==='ime-intermediate'?'composition-intermediate-input-to-frame':kind==='ime-associated'?'composition-associated-input-to-frame':kind==='ime-ambiguous'?'ambiguous-post-composition-input-to-frame':'input-to-frame',inputAt:validClock?eventTimeStamp:receivedAt,handlerReceivedAt:receivedAt,inputAnchor:validClock?'event.timeStamp':'capture-handler-fallback',eventTimeStamp,inputType:String(event.inputType||''),isComposing:!!event.isComposing,identity:identity(owner),expectedValue,expectedBasis:'trusted-event editor DOM before application handlers',editing:{status:'pending'},display:{status:'pending'},checks:[],observerCheckMs:0,captureReadMs:now()-receivedAt};
  current.samples.push(sample);
  const item={owner,sample,raf:null,timer:null,observer:null};
  const ancestors=new Set(Object.values(owner));let ancestor=owner.editor;
  for(let depth=0;ancestor&&depth<24;depth++,ancestor=ancestor.parentElement){ancestors.add(ancestor);if(ancestor===owner.canvas)break;}
  item.observer=new window.MutationObserver(records=>{
   if(records.some(record=>(record.type==='attributes'&&['data-node-id','data-record','data-record-id','data-field'].includes(record.attributeName))||[...(record.removedNodes||[])].some(node=>ancestors.has(node)))){finish(item,'stale-instance-or-identity');return;}
   schedule(item);
  });
  item.observer.observe(owner.cell,{subtree:true,childList:true,characterData:true,attributes:true,attributeOldValue:true,attributeFilter:['data-inline-editing','contenteditable','aria-invalid','data-record','data-field']});
  for(const element of ancestors)if(element!==owner.editor&&element!==owner.cell)item.observer.observe(element,{childList:true,attributes:true,attributeFilter:['data-node-id','data-record-id']});
  item.timer=window.setTimeout(()=>{if(pending.get(owner.editor)===item)finish(item,'timed-out');},timeoutMs);
  pending.set(owner.editor,item);schedule(item);notify();return sample;
 }
 function compositionEvent(event,owner,receivedAt){
  let session=compositions.get(owner.editor);
  if(event.type==='compositionstart'){
   session={id:++nextComposition,active:true,startAt:now(),endSample:null};compositions.set(owner.editor,session);
  }
  if(current.compositions.length>=maxCompositionEvents){stop('composition-capacity');return;}
  const data=String(event.data||'');if(data.length>4096){stop('composition-text-capacity');return;}
  current.compositions.push({type:event.type,at:now(),identity:identity(owner),compositionId:session?.id||null,data});
  if(event.type==='compositionend'){
   if(!session?.active){reject('composition-end-without-start');return;}
   session.active=false;session.endSample=begin(owner,event,'ime-commit',session.id,receivedAt);session.endInputSeen=false;
  }
 }
 function receive(event){
  if(!active)return;const receivedAt=now();if(!event.isTrusted){reject('untrusted-event');return;}
  const owner=locate(event.target);if(!owner){reject('outside-supported-identity');return;}
  if(event.type.startsWith('composition')){compositionEvent(event,owner,receivedAt);return;}
  if(event.type==='blur'){
   const item=pending.get(owner.editor);if(item){item.sample.editExitAt=now();item.sample.editExitEvent='blur';schedule(item);}return;
  }
  const session=compositions.get(owner.editor);
  if(event.isComposing||session?.active){begin(owner,event,'ime-intermediate',session?.id||null,receivedAt);return;}
  // Event timestamps are not a composition identity: browsers may dispatch the
  // final input later. Retain each event as a separate raw sample, never infer a
  // duplicate or pool an explicit/ambiguous composition tail into ordinary input.
  const explicitComposition=['insertCompositionText','insertFromComposition'].includes(event.inputType);
  const firstAfterEnd=!!session?.endSample&&!session.endInputSeen;
  if(firstAfterEnd)session.endInputSeen=true;
  let ambiguous=false;
  if(firstAfterEnd&&event.inputType==='insertText'){
   let value;try{value=read(owner);}catch{value=null;}
   ambiguous=value===session.endSample.expectedValue;
  }
  if(explicitComposition||ambiguous){
   if(session?.endSample&&!same(owner,session.endSample.identity)){reject('stale-composition-identity');return;}
   if(current.compositions.length>=maxCompositionEvents){stop('composition-capacity');return;}
   const sample=begin(owner,event,explicitComposition?'ime-associated':'ime-ambiguous',session?.id||null,receivedAt);
   if(sample){
    sample.associationReason=explicitComposition?'explicit-composition-input-type':'first-post-composition-insertText-same-value-ambiguous';
    sample.relatedCommitSampleId=session?.endSample?.id||null;sample.duplicateOf=null;
    current.compositions.push({type:'post-composition-input',at:receivedAt,eventTimeStamp:sample.eventTimeStamp,identity:identity(owner),compositionId:sample.compositionId,sampleId:sample.id,inputType:event.inputType,associationReason:sample.associationReason});
   }
   return;
  }
  begin(owner,event,'input',null,receivedAt);
 }
 function stop(reason='operator-stop'){
  if(!active)return;active=false;
  for(const item of [...pending.values()])finish(item,reason);
  abort.abort();abort=null;current.stoppedAt=now();current.stopReason=reason;notify();
 }
 function start(event,{fixture,buildFingerprint}){
  if(disposed||active||!event?.isTrusted)return false;
  if(!fixture||!TABLE_FIXTURES[fixture.sha256]||!HEX.test(buildFingerprint)||document.visibilityState!=='visible')return false;
  current={schemaVersion:1,kind:'table-semantic-paint-opportunity-observation',scenario:'PERF-02',productAcceptance:false,buildFingerprint,fixture:copy(fixture),fixtureLoaded:'sampled DOM identities only; not full workflow/native-load proof',startedAt:now(),timeOrigin:window.performance.timeOrigin,environment:{userAgent:window.navigator.userAgent,viewport:{width:window.innerWidth,height:window.innerHeight},dpr:window.devicePixelRatio},samples:[],compositions:[],rejected:{},timeoutMs,maxSamples,maxChecksPerSample:16,limits:['Synthetic M plaintext content cells in creative canvas only','No documentId/tableId is invented; object tokens identify this DOM lifetime','Raw plaintext is recorded only after explicit test activation','Editing-visible and display-complete are separate; dwell time is not rendering time','Compositionend, intermediate, explicit composition tails and ambiguous first same-value inputs are separate timing domains, never pooled into ordinary input latency; no tail is claimed to be a duplicate','Commands that emit no trusted input (custom Enter/paste/reference actions) are outside this measurement','Two rAF boundaries are paint opportunities, not physical presentation proof','Visibility proves a visible target with exact DOM text, not that every clipped glyph is on screen','No graph access, model calls, persisted-value or native-load readiness claims']};
  fixtureIdentities=new Map(Object.entries(fixture.tables).map(([id,table])=>[id,{records:new Set(table.records),fields:new Set(table.fields)}]));
  compositions=new WeakMap();active=true;abort=new AbortController();
  for(const type of EVENT_TYPES)document.addEventListener(type,receive,{capture:true,passive:true,signal:abort.signal});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')stop('page-hidden');},{signal:abort.signal});notify();return true;
 }
 return {start,stop,report:()=>current?copy(current):null,resources:()=>({active,pending:pending.size,listeners:abort?EVENT_TYPES.length+1:0}),destroy(){stop('disposed');disposed=true;}};
}

export function mountTableSemanticObserver(document,window){
 if(document.getElementById('studio-table-semantic-observer'))return null;
 const make=(tag,text,parent)=>{const element=document.createElement(tag);if(text)element.textContent=text;parent?.append(element);return element;};
 const panel=make('details','',document.body);panel.id='studio-table-semantic-observer';
 panel.style.cssText='position:fixed;left:8px;top:160px;z-index:2147483000;width:350px;max-height:65vh;overflow:auto;padding:10px;background:#182027;color:#eee;border:1px solid #71858f;font:12px/1.5 sans-serif';
 make('summary','表格语义观测（仅合成测试）',panel);
 make('p','先真实打开固定 M 夹具，再选择同文件及构建指纹。开始后记录合成文本、真实输入与 IME；编辑态可见和退出编辑后显示分别计时。两帧边界不是 GPU paint 或原生加载完成。',panel);
 const picker=make('input','',panel);picker.type='file';picker.accept='.json';picker.setAttribute('aria-label','固定 M 工作流');
 const build=make('input','',panel);build.placeholder='实际构建 SHA256';build.maxLength=64;build.setAttribute('aria-label','构建指纹');
 const status=make('output','未开始',panel);status.style.display='block';
 let fixture=null,disposed=false,revision=0,downloadRequested=true;
 const observer=createTableSemanticObserver(document,window,{onChange:state=>{status.textContent=`${state.active?'观测中':'已停止'}；输入 ${state.samples}，待完成 ${state.pending}`;}});
 const button=(label,action)=>{const element=make('button',label,panel);element.type='button';element.onclick=action;return element;};
 const start=button('开始语义观测',event=>{
  if(!event?.isTrusted||disposed)return;
  if(!downloadRequested){status.textContent='先下载上一段完整原始报告。';return;}
  if(observer.start(event,{fixture,buildFingerprint:build.value.trim()}))downloadRequested=false;
  else status.textContent='需固定 M 夹具、完整构建指纹、可见页面且当前未运行。';
 });
 const stop=button('停止语义观测',event=>{if(event?.isTrusted&&!disposed)observer.stop();});
 const download=button('下载语义原始记录',event=>{
  if(!event?.isTrusted||disposed)return;
  if(observer.resources().active){status.textContent='先停止，再下载完整报告。';return;}
  const report=observer.report();if(!report)return;
  const url=window.URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  try{const link=make('a','',panel);link.href=url;link.download=`performance-table-semantic-${Date.now()}.json`;link.click();link.remove();downloadRequested=true;}finally{window.URL.revokeObjectURL(url);}
  status.textContent='已请求下载；请确认文件保存。原生图和输入未由观测器修改。';
 });
 const own=new AbortController();
 picker.addEventListener('change',async()=>{const version=++revision;fixture=null;const file=picker.files?.[0];if(!file)return;try{const next=await readTableSemanticFixture(await file.arrayBuffer(),window.crypto);if(disposed||version!==revision)return;fixture=next;status.textContent='已核对合成 M 文件；未加载或修改宿主图。';}catch(error){if(!disposed&&version===revision)status.textContent=error.message;}},{signal:own.signal});
 for(const type of ['pointerdown','keydown','dblclick','wheel'])panel.addEventListener(type,event=>event.stopPropagation(),{signal:own.signal});
 function destroy(){if(disposed)return;disposed=true;revision++;observer.destroy();own.abort();start.onclick=stop.onclick=download.onclick=null;panel.remove();}
 window.addEventListener('pagehide',destroy,{once:true,signal:own.signal});
 return {destroy,report:observer.report,resources:observer.resources};
}
