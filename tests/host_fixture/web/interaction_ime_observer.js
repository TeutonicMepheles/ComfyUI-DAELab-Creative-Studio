/** Test-only four-field IME evidence. No graph/model access, synthetic input or network. */
export const IME_FIXTURE_SHA256='65ae4671b8fc4fb4079fe27283cd400803106a708d348927fa1921eeaf432566';
const WORKFLOW='116b5960-ef87-5730-82c9-654ee756124f';
const ROW='22cf8395-6fb2-4a29-9f99-0d22850d9e82',FIELD='b08eb083-bb48-4110-9446-eeda2f5a47b1';
export const IME_FIELDS=Object.freeze([
 {nodeId:'1',kind:'table',recordId:ROW,fieldId:FIELD,initial:'PROMPT-A 第1行：仅编辑与配置，不提交。 | PROMPT-A-V2 | SAVE-F6-A'},
 {nodeId:'2',kind:'table',recordId:ROW,fieldId:FIELD,initial:'PROMPT-B 第1行：仅编辑与配置，不提交。 | PROMPT-B-V2'},
 {nodeId:'3',kind:'instruction',recordId:null,fieldId:'instruction',initial:'LLM-A X处理要求：仅本地界面回归，保留中文 English；不点击生成。 | INSTRUCTION-A-V2 | F6-LLM-A'},
 {nodeId:'4',kind:'instruction',recordId:null,fieldId:'instruction',initial:'LLM-B Y处理要求：仅本地界面回归，保留中文 English；不点击生成。 | INSTRUCTION-B-V2 | F6-LLM-B | SAVE-F6-B'},
].map(Object.freeze));
const proofs=new WeakSet();
export async function readInteractionImeFixture(bytes,crypto){
 if(!bytes||!Number.isSafeInteger(bytes.byteLength)||bytes.byteLength<1||bytes.byteLength>262144)throw Error('fixture-size');
 // Hash and parse the same detached byte copy even if the caller mutates its buffer.
 const input=ArrayBuffer.isView(bytes)?Uint8Array.from(new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength)):bytes instanceof ArrayBuffer?new Uint8Array(bytes.slice(0)):null;
 if(!input)throw Error('fixture-bytes');
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',input))].map(x=>x.toString(16).padStart(2,'0')).join('');
 if(sha256!==IME_FIXTURE_SHA256)throw Error('fixture-hash');
 let graph;try{graph=JSON.parse(new TextDecoder().decode(input));}catch{throw Error('fixture-json');}
 if(graph.id!==WORKFLOW||!Array.isArray(graph.nodes)||graph.nodes.length!==4)throw Error('fixture-shape');
 for(const field of IME_FIELDS){
  const nodes=graph.nodes.filter(node=>String(node.id)===field.nodeId),node=nodes[0];
  if(nodes.length!==1||node.type!==(field.kind==='table'?'DAELAB.Table':'DAELAB.LLMStylePreviewB'))throw Error('fixture-node');
  let initial;
  try{
   if(field.kind==='table'){
    const table=JSON.parse(node.widgets_values[0]),row=table.records.find(r=>r.id===field.recordId),value=row.values[field.fieldId];
    if(!table.fields.some(f=>f.id===field.fieldId)||value.kind!=='column-template'||value.segments.some(s=>s.type!=='text'))throw Error();
    initial=value.segments.map(s=>s.text).join('');
   }else initial=node.properties.llmStylePreview.instruction;
  }catch{throw Error('fixture-field');}
  if(initial!==field.initial)throw Error('fixture-initial-value');
 }
 const result=Object.freeze({sha256,bytes:input.byteLength,workflowId:WORKFLOW,fields:IME_FIELDS});proofs.add(result);return result;
}

const EVENTS=['compositionstart','compositionupdate','compositionend','beforeinput','input','blur','focusin','focusout','keydown'];
const KEYS=new Set(['Enter','Escape','Tab','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Process','Unidentified']);
const INPUTS=new Set(['insertText','insertCompositionText','insertFromComposition','deleteCompositionText','deleteByComposition','deleteContentBackward','deleteContentForward','insertLineBreak','insertParagraph','historyUndo','historyRedo','insertFromPaste']);
const STOP_REASONS=new Set(['operator-stop','report-byte-capacity','event-capacity','identity-lost','scope-value-invalid','page-hidden','page-release','duration-limit','observer-start-failed','disposed']);
const finite=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
const copy=x=>JSON.parse(JSON.stringify(x));
const one=(root,selector)=>{const found=root.querySelectorAll(selector);if(found.length!==1)throw Error('identity-lost');return found[0];};

/** No active listeners, graph access or polling at construction. One report per instance. */
export function createInteractionImeObserver(document,window,{onChange=()=>{},maxEvents=800,maxReportBytes=2097152,maxDurationMs=120000}={}){
 for(const [n,lo,hi] of [[maxEvents,1,800],[maxReportBytes,4096,2097152],[maxDurationMs,1,120000]])if(!Number.isSafeInteger(n)||n<lo||n>hi)throw Error('invalid-capacity');
 let active=false,disposed=false,report=null,owners=null,mutation=null,timer=null,epoch=0,pending=0,storedBytes=0,nextToken=0,nextComposition=0,lastError=null;
 const tokens=new WeakMap(),sessions=new Map();
 const token=value=>{if(!tokens.has(value))tokens.set(value,++nextToken);return tokens.get(value);};
 const clock=()=>({at:finite(window.performance.now()),dateNow:Date.now()});
 const notify=()=>{try{onChange({active,events:report?.events.length??0,checkpoints:report?.checkpoints.length??0,stopReason:report?.stopReason??null,error:lastError});}catch{/* Own UI failure cannot alter product input. */}};
 const reject=reason=>{if(report)report.rejected[reason]=Math.min(1000000,(report.rejected[reason]||0)+1);};
 function locate(){
  const canvas=one(document,'.dae-creative'),cards=canvas.querySelectorAll('.dae-creative-card[data-node-id]');
  if(cards.length!==4)throw Error('identity-lost');
  return IME_FIELDS.map(spec=>{
   const matches=[...cards].filter(card=>card.dataset.nodeId===spec.nodeId);
   if(matches.length!==1)throw Error('identity-lost');const card=matches[0];
   if(spec.kind==='table'){
    const table=one(card,'.dae-table'),row=one(table,`tr[data-record-id="${spec.recordId}"]`),cell=one(row,`td[data-record="${spec.recordId}"][data-field="${spec.fieldId}"]`),container=one(cell,'.dae-prompt-cell'),editor=one(container,'.dae-prompt-preview');
    // This prompt presentation keeps the same DIV through preview/inline edit/
    // blur; only its attributes and text children change. Lease both exact layers.
    if(container.tagName!=='DIV'||editor.tagName!=='DIV'||container.parentElement!==cell||editor.parentElement!==container)throw Error('identity-lost');return {spec,canvas,card,table,row,cell,container,editor};
   }
   const panel=one(card,'.llm-style-B'),section=one(panel,'.llm-style-instruction'),editor=one(section,'textarea');
   if(editor.getAttribute('aria-label')!=='B 处理要求')throw Error('identity-lost');return {spec,canvas,card,panel,section,editor};
  });
 }
 const refs=owner=>Object.entries(owner).filter(([key])=>key!=='spec').map(([,value])=>value);
 function current(){
  const found=locate();
  return owners&&owners.every((owner,i)=>refs(owner).every(node=>node.isConnected)&&Object.keys(owner).filter(k=>k!=='spec').every(k=>found[i][k]===owner[k]));
 }
 const identity=owner=>({nodeId:owner.spec.nodeId,kind:owner.spec.kind,recordId:owner.spec.recordId,fieldId:owner.spec.fieldId,...Object.fromEntries(Object.entries(owner).filter(([k])=>k!=='spec').map(([k,v])=>[k,token(v)]))});
 function text(owner){
  const box=owner.editor;
  if(owner.spec.kind==='table'){
   // Inspect only the admitted editor subtree; never flatten reference chips/media.
   let count=0;
   function plain(node,depth){
    if(++count>256||depth>8)throw Error('scope-value-invalid');
    if(node.nodeType===3)return;
    if(node.nodeType!==1||!['DIV','P','BR','SPAN'].includes(node.tagName)||node!==box&&node.getAttribute('contenteditable')==='false'||node.className?.split?.(' ').includes('dae-prompt-ref'))throw Error('scope-value-invalid');
    for(const child of node.childNodes)plain(child,depth+1);
   }
   plain(box,0);
  }
  const value=owner.spec.kind==='table'?box.textContent:box.value;
  if(typeof value!=='string'||value.length>512)throw Error('scope-value-invalid');return value;
 }
 function selection(owner,value){
  const box=owner.editor;
  try{
   if(owner.spec.kind==='instruction'){
    const start=box.selectionStart,end=box.selectionEnd;
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>value.length)return null;
    return {start,end,direction:['forward','backward','none'].includes(box.selectionDirection)?box.selectionDirection:null};
   }
   const s=window.getSelection?.();if(!s||!box.contains(s.anchorNode)||!box.contains(s.focusNode))return null;
   const path=node=>{const result=[];for(let n=node;n!==box;n=n.parentNode){if(!n?.parentNode||result.length>=8)return null;const index=[...n.parentNode.childNodes].indexOf(n);if(index<0)return null;result.unshift(index);}return result;};
   const valid=(node,offset)=>Number.isInteger(offset)&&offset>=0&&offset<=(node.nodeType===3?node.textContent.length:node.childNodes.length);
   if(!valid(s.anchorNode,s.anchorOffset)||!valid(s.focusNode,s.focusOffset))return null;
   const anchorPath=path(s.anchorNode),focusPath=path(s.focusNode);if(!anchorPath||!focusPath)return null;
   return {anchorPath,focusPath,anchorOffset:s.anchorOffset,focusOffset:s.focusOffset,collapsed:typeof s.isCollapsed==='boolean'?s.isCollapsed:null};
  }catch{return null;}
 }
 function fields(){
  if(!current())throw Error('identity-lost');
  // Validate all four values before making any of them observable in a report.
  const values=owners.map(text);
  return owners.map((owner,i)=>({identity:identity(owner),value:values[i],textBasis:owner.spec.kind==='table'?'textContent-not-visible-layout':'textarea.value',active:document.activeElement===owner.editor||document.activeElement===owner.cell,contenteditable:owner.spec.kind==='table'?owner.editor.getAttribute('contenteditable'):null,inlineEditing:owner.spec.kind==='table'?owner.cell.dataset.inlineEditing==='true':null,disabled:!!owner.editor.disabled,readOnly:!!owner.editor.readOnly,selection:selection(owner,values[i])}));
 }
 function cleanup(){
  for(const type of EVENTS)document.removeEventListener(type,onEvent,true);
  document.removeEventListener('visibilitychange',onVisibility,true);window.removeEventListener('pagehide',onPageHide,true);
  window.clearTimeout(timer);timer=null;mutation?.disconnect();mutation=null;pending=0;
 }
 function stop(reason='operator-stop'){
  if(!active)return;active=false;epoch++;cleanup();report.stoppedAt=clock();report.stopReason=STOP_REASONS.has(reason)?reason:'operator-stop';report.complete=false;notify();
 }
 function fail(error){const reason=error?.message==='scope-value-invalid'?'scope-value-invalid':'identity-lost';reject(reason);stop(reason);}
 function onMutation(records){
  if(!active)return;
  try{
   if(records.length>256)throw Error('identity-lost');
   const leased=owners.flatMap(refs);
   if(records.some(record=>record.type==='childList'&&[...(record.removedNodes||[])].some(removed=>leased.some(node=>removed===node||removed.contains?.(node)))))throw Error('identity-lost');
   if(records.some(record=>record.type==='attributes'&&leased.includes(record.target)))throw Error('identity-lost');
   if(!current())throw Error('identity-lost');
  }catch(error){fail(error);}
 }
 function ready(){
  if(!active)return false;
  onMutation(mutation?.takeRecords()||[]);if(!active)return false;
  try{if(!current())throw Error('identity-lost');return true;}catch(error){fail(error);return false;}
 }
 function append(list,item){
  const size=new TextEncoder().encode(JSON.stringify(item)).length+1;
  if(storedBytes+size>maxReportBytes){reject('report-byte-capacity');stop('report-byte-capacity');return false;}
  storedBytes+=size;list.push(item);return true;
 }
 function checkpoint(eventId){
  const capturedEpoch=epoch;pending++;
  window.queueMicrotask(()=>{
   if(!active||capturedEpoch!==epoch)return;pending=Math.max(0,pending-1);
   if(!ready())return;
   try{append(report.checkpoints,{...clock(),eventId,allListenersCompleted:false,fields:fields()});}catch(error){fail(error);}
  });
 }
 function onEvent(event){
  if(!active)return;
  if(event.isTrusted!==true){reject('untrusted-event');return;}
  if(!ready())return;
  const owner=owners.find(o=>event.target===o.editor||event.type==='keydown'&&event.target===o.cell);
  if(!owner){reject('outside-scope');return;}
  if(report.events.length>=maxEvents){reject('event-capacity');stop('event-capacity');return;}
  let state;try{state=fields();}catch(error){fail(error);return;}
  let session=sessions.get(owner.editor);
  if(event.type==='compositionstart'){
   if(session?.active)reject('composition-start-while-active');
   else{session={id:++nextComposition,active:true};sessions.set(owner.editor,session);}
  }else if(event.type==='compositionupdate'&&!session?.active){reject('composition-update-without-start');}
  else if(event.type==='compositionend'){
   if(!session?.active){reject('composition-end-without-start');return;}session.active=false;
  }
  const item={id:report.events.length+1,...clock(),type:event.type,eventTimeStamp:finite(event.timeStamp),eventPhase:[0,1,2,3].includes(event.eventPhase)?event.eventPhase:null,trusted:true,owner:identity(owner),compositionId:session?.id??null,compositionActive:session?.active??false,compositionRelation:session?(session.active?'active':'previous-composition-not-commit-proof'):null,commitProven:false,isComposing:typeof event.isComposing==='boolean'?event.isComposing:null,inputType:['input','beforeinput'].includes(event.type)?(INPUTS.has(event.inputType)?event.inputType:'other'):null,key:event.type==='keydown'?(KEYS.has(event.key)?event.key:null):null,keyCode229:event.type==='keydown'?event.keyCode===229:null,ctrlKey:!!event.ctrlKey,metaKey:!!event.metaKey,shiftKey:!!event.shiftKey,altKey:!!event.altKey,cancelable:!!event.cancelable,defaultPrevented:!!event.defaultPrevented,dataLength:typeof event.data==='string'?Math.min(513,event.data.length):null,fields:state};
  if(append(report.events,item))checkpoint(item.id);
 }
 function onVisibility(){if(active&&document.visibilityState!=='visible')stop('page-hidden');}
 function onPageHide(){stop('page-release');}
 function start(event,{fixture,buildFingerprint,enabled=false}={}){
  if(disposed||active||report)return false;
  if(event?.isTrusted!==true||enabled!==true||!proofs.has(fixture)||!/^[a-f0-9]{64}$/.test(buildFingerprint||'')){lastError='explicit-fixture-build-enable-required';notify();return false;}
  try{
   if(document.visibilityState!=='visible')throw Error('page-hidden');owners=locate();
   const initial=fields();
   if(initial.some((f,i)=>f.value!==IME_FIELDS[i].initial||f.disabled||f.readOnly))throw Error('initial-DOM-mismatch');
   report={schemaVersion:1,kind:'passive-four-field-real-IME-evidence',fixture:{sha256:fixture.sha256,bytes:fixture.bytes,workflowId:fixture.workflowId},buildFingerprint,buildIdentity:'operator-supplied-not-loaded-module-attestation',operatorEnabled:true,startedAt:clock(),timeOrigin:finite(window.performance.timeOrigin),environment:{width:finite(window.innerWidth),height:finite(window.innerHeight),dpr:finite(window.devicePixelRatio),visibility:document.visibilityState},initial,events:[],checkpoints:[],manualSnapshots:[],rejected:{},stoppedAt:null,stopReason:null,complete:false,productAcceptance:false,formalBudgetEvaluated:false,limits:{maxEvents,maxReportBytes,maxDurationMs,maxFieldChars:512},limitations:['Only four admitted DOM fields are observed; picked file SHA does not attest current host graph identity.','Event isTrusted proves browser-dispatched events, not a human or a specific OS input method. Candidate windows and physical input require independent manual/screenshots evidence.','compositionend, Escape and empty data do not independently prove commit/cancel semantics; compare full event sequence, DOM values and later native saved/reopened data.','Capture and microtask checkpoints may precede some handlers/default actions or asynchronous work; not atomic or completed-history snapshots.','No input latency/physical paint/IME performance acceptance is computed. Reads and the own status UI have overhead.','Table textContent is bounded plain DOM text, not a rendered-layout, reference, model or persisted-workflow proof.','No arbitrary target text, raw event.data, URL, graph, model, queue or clipboard content is collected.']};
   // Reserve bounded space for fixed stop/rejection names, capped counters
   // and final clocks; never export arbitrary caller-supplied reason strings.
   storedBytes=new TextEncoder().encode(JSON.stringify(report)).length+1024;
   if(storedBytes>maxReportBytes){report.stopReason='report-byte-capacity';report.stoppedAt=clock();notify();return false;}
   epoch++;active=true;lastError=null;
   mutation=new window.MutationObserver(onMutation);mutation.observe(owners[0].canvas,{subtree:true,childList:true,attributes:true,attributeFilter:['data-node-id','data-record','data-field','data-record-id']});
   for(const type of EVENTS)document.addEventListener(type,onEvent,{capture:true,passive:true});
   document.addEventListener('visibilitychange',onVisibility,{capture:true,passive:true});window.addEventListener('pagehide',onPageHide,{capture:true,passive:true});
   timer=window.setTimeout(()=>stop('duration-limit'),maxDurationMs);notify();return true;
  }catch(error){lastError=['initial-DOM-mismatch','page-hidden'].includes(error?.message)?error.message:'DOM-qualification-failed';if(active)stop('observer-start-failed');else cleanup();notify();return false;}
 }
 function snapshot(event){
  if(event?.isTrusted!==true||!ready())return false;
  try{return append(report.manualSnapshots,{...clock(),reason:'trusted-manual-checkpoint',fields:fields()});}catch(error){fail(error);return false;}
 }
 function destroy(){if(disposed)return;stop('disposed');cleanup();disposed=true;owners=null;sessions.clear();}
 return {start,stop,snapshot,destroy,report:()=>report?copy(report):null,resources:()=>({active,listeners:active?EVENTS.length+2:0,observers:mutation?1:0,timers:timer===null?0:1,pendingCheckpoints:pending})};
}

/** Visible, folded and disabled by default. The picker reads bytes; it never opens a host graph. */
export function mountInteractionImeObserver(document,window){
 const id='studio-interaction-ime-observer';if(document.getElementById(id))return null;
 const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const panel=make('details');panel.id=id;panel.style.cssText='position:fixed;left:8px;top:200px;z-index:2147483002;width:350px;max-height:65vh;overflow:auto;background:#182027;color:#eee;border:1px solid #71858f;padding:10px;font:12px/1.5 sans-serif';
 panel.append(make('summary','四字段真实 IME 观察（仅隔离测试）'),make('p','人工使用中文输入法。选择固定65ae文件只校验字节，不打开工作流；先在宿主打开同一夹具。仅观察两表提示词与两LLM处理要求，不生成输入或任务。'));
 const picker=make('input');picker.type='file';picker.accept='.json';picker.setAttribute('aria-label','固定四实例夹具');
 const build=make('input');build.type='text';build.setAttribute('aria-label','构建指纹');
 const enabled=make('input');enabled.type='checkbox';enabled.checked=false;enabled.setAttribute('aria-label','确认合成夹具已在宿主打开并启用四字段观察');
 const status=make('output','未启用；等待固定文件、构建指纹和显式确认');
 const button=text=>{const e=make('button',text);e.type='button';return e;};
 const start=button('开始 IME 观察'),sample=button('读取四字段状态'),stop=button('停止 IME 观察'),download=button('下载 IME 原始记录');
 panel.append(picker,build,enabled,status,start,sample,stop,download);document.body.append(panel);
 let fixture=null,disposed=false,pickerEpoch=0;
 const observer=createInteractionImeObserver(document,window,{onChange:state=>{
  status.textContent=state.active?'观察中；请人工输入。计数在停止或显式读取时显示，不推断提交成功。':`${state.error||state.stopReason||'未启用'} · ${state.events} 事件 / ${state.checkpoints} 检查点；不是验收通过`;
  picker.disabled=build.disabled=enabled.disabled=state.active;start.disabled=state.active||observer.report()!==null;stop.disabled=sample.disabled=!state.active;
 }});
 const picked=async()=>{
  if(disposed||observer.resources().active)return;const thisEpoch=++pickerEpoch;fixture=null;
  try{const file=picker.files?.[0];if(!file||Number.isFinite(file.size)&&file.size>262144)throw Error('fixture-size');const candidate=await readInteractionImeFixture(await file.arrayBuffer(),window.crypto);if(disposed||thisEpoch!==pickerEpoch)return;fixture=candidate;status.textContent='固定65ae文件已核；仍需实际宿主初值与显式确认。';}
  catch{if(!disposed&&thisEpoch===pickerEpoch)status.textContent='文件未通过固定SHA/形状校验；未启用。';}
 };
 picker.addEventListener('change',picked);
 start.onclick=event=>{if(!disposed)observer.start(event,{fixture,buildFingerprint:build.value.trim(),enabled:enabled.checked===true});};
 sample.onclick=event=>{if(!disposed&&observer.snapshot(event)){const r=observer.report();status.textContent=`观察中 · ${r.events.length} 事件 / ${r.checkpoints.length} 检查点；已记录显式状态。`;}};
 stop.onclick=event=>{if(!disposed&&event?.isTrusted===true)observer.stop();};
 download.onclick=event=>{
  if(disposed||event?.isTrusted!==true||observer.resources().active)return;const report=observer.report();if(!report)return;
  // Keep the downloaded representation within the same compact byte budget.
  const url=window.URL.createObjectURL(new Blob([JSON.stringify(report)+'\n'],{type:'application/json'}));
  try{const link=make('a');link.href=url;link.download='interaction-ime-observer-raw.json';panel.append(link);link.click();link.remove();}finally{window.URL.revokeObjectURL(url);}
 };
 function destroy(){if(disposed)return;disposed=true;pickerEpoch++;observer.destroy();picker.removeEventListener('change',picked);start.onclick=sample.onclick=stop.onclick=download.onclick=null;window.removeEventListener('pagehide',destroy,true);panel.remove();}
 window.addEventListener('pagehide',destroy,{capture:true,once:true});stop.disabled=sample.disabled=true;
 return {destroy,report:observer.report,resources:observer.resources};
}

if(typeof document!=='undefined'&&typeof window!=='undefined'){
 const mount=()=>mountInteractionImeObserver(document,window);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
}
