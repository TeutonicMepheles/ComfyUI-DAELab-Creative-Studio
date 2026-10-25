import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {IME_FIXTURE_SHA256,IME_FIELDS,readInteractionImeFixture,createInteractionImeObserver,mountInteractionImeObserver} from '../host_fixture/web/interaction_ime_observer.js';

// Public synthetic shape, not a copy of the private saved workflow. The digest
// double tests the reader boundary; actual65ae bytes are separately checked offline.
const initial=[
 'PROMPT-A 第1行：仅编辑与配置，不提交。 | PROMPT-A-V2 | SAVE-F6-A',
 'PROMPT-B 第1行：仅编辑与配置，不提交。 | PROMPT-B-V2',
 'LLM-A X处理要求：仅本地界面回归，保留中文 English；不点击生成。 | INSTRUCTION-A-V2 | F6-LLM-A',
 'LLM-B Y处理要求：仅本地界面回归，保留中文 English；不点击生成。 | INSTRUCTION-B-V2 | F6-LLM-B | SAVE-F6-B',
];
const row='22cf8395-6fb2-4a29-9f99-0d22850d9e82',field='b08eb083-bb48-4110-9446-eeda2f5a47b1';
const graph={id:'116b5960-ef87-5730-82c9-654ee756124f',nodes:initial.map((text,i)=>i<2?{id:i+1,type:'DAELAB.Table',widgets_values:[JSON.stringify({fields:[{id:field}],records:[{id:row,values:{[field]:{kind:'column-template',segments:[{type:'text',text}]}}}]})]}:{id:i+1,type:'DAELAB.LLMStylePreviewB',properties:{llmStylePreview:{instruction:text}}})};
const bytes=new TextEncoder().encode(JSON.stringify(graph));
const digestCrypto={subtle:{async digest(algorithm,input){assert.equal(algorithm,'SHA-256');assert(input.byteLength>0);return Uint8Array.from(IME_FIXTURE_SHA256.match(/../g),x=>parseInt(x,16)).buffer;}}};
const fixture=await readInteractionImeFixture(bytes,digestCrypto),buildFingerprint='a'.repeat(64);

class Hub{
 listeners=new Map();
 addEventListener(type,fn,options={}){const items=this.listeners.get(type)||new Set();items.add(fn);this.listeners.set(type,items);options.signal?.addEventListener('abort',()=>this.removeEventListener(type,fn),{once:true});}
 removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
 emit(type,extra={}){return [...(this.listeners.get(type)||[])].map(fn=>fn({type,target:this,isTrusted:true,timeStamp:100,eventPhase:1,...extra}));}
 count(){return [...this.listeners.values()].reduce((n,s)=>n+s.size,0);}
}
class Text{
 constructor(text){this.nodeType=3;this.textContent=text;this.parentElement=null;}
 get parentNode(){return this.parentElement;}
 get isConnected(){return Boolean(this.parentElement?.isConnected);}
 contains(node){return node===this;}
}
class Element extends Hub{
 constructor(tag){super();this.nodeType=1;this.tagName=tag.toUpperCase();this.className='';this.dataset={};this.attributes=new Map();this.style={};this.childNodes=[];this.parentElement=null;this.hidden=false;this.disabled=false;this.readOnly=false;this.value='';this.selectionStart=0;this.selectionEnd=0;this.selectionDirection='none';}
 get children(){return this.childNodes.filter(n=>n.nodeType===1);}
 get parentNode(){return this.parentElement;}
 get isConnected(){return this.base||Boolean(this.parentElement?.isConnected);}
 get textContent(){return this.childNodes.map(n=>n.textContent).join('');}
 set textContent(value){this.childNodes=[new Text(String(value))];this.childNodes[0].parentElement=this;}
 append(...nodes){for(const n of nodes){if(n.parentElement)n.parentElement.childNodes.splice(n.parentElement.childNodes.indexOf(n),1);n.parentElement=this;this.childNodes.push(n);}}
 remove(){if(this.parentElement){this.parentElement.childNodes.splice(this.parentElement.childNodes.indexOf(this),1);this.parentElement=null;}}
 contains(node){return node===this||this.childNodes.some(n=>n.contains(node));}
 setAttribute(key,value){this.attributes.set(key,String(value));}
 getAttribute(key){if(key==='class')return this.className;if(key.startsWith('data-')){const k=key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return this.dataset[k]??null;}return this.attributes.get(key)??null;}
 matches(selector){
  const tag=selector.match(/^[a-z]+/i)?.[0];if(tag&&this.tagName!==tag.toUpperCase())return false;
  for(const [,cls]of selector.matchAll(/\.([\w-]+)/g))if(!this.className.split(' ').includes(cls))return false;
  for(const [,key,value]of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)){const a=this.getAttribute(key);if(a===null||(value!==undefined&&a!==value))return false;}
  return true;
 }
 closest(selector){for(let p=this;p;p=p.parentElement)if(p.matches(selector))return p;return null;}
 querySelectorAll(selector){const result=[],parts=selector.split(' ');const visit=n=>{for(const c of n.children){if(c.matches(parts.at(-1))&&(parts.length===1||c.parentElement?.closest(parts[0])))result.push(c);visit(c);}};visit(this);return result;}
 querySelector(s){return this.querySelectorAll(s)[0]??null;}
 click(){this.clicked=true;}
}
function harness(options={}){
 let at=100,seq=0;const microtasks=[],timers=new Map(),observers=[],blobs=[];
 const body=new Element('body');body.base=true;
 const document=Object.assign(new Hub(),{body,visibilityState:'visible',activeElement:body,createElement:tag=>new Element(tag),querySelectorAll:s=>body.querySelectorAll(s),getElementById:id=>{const walk=n=>n.id===id?n:n.children.map(walk).find(Boolean);return walk(body)||null;}});
 const window=Object.assign(new Hub(),{crypto:digestCrypto,performance:{now:()=>at,timeOrigin:100000},innerWidth:1920,innerHeight:1080,devicePixelRatio:1,
  getSelection:()=>window.selection??null,queueMicrotask:fn=>microtasks.push(fn),setTimeout:(fn,ms)=>{timers.set(++seq,{fn,at:at+ms});return seq;},clearTimeout:id=>timers.delete(id),
  MutationObserver:class{constructor(fn){this.fn=fn;this.records=[];this.active=false;observers.push(this);}observe(){this.active=true;}disconnect(){this.active=false;this.records=[];}takeRecords(){return this.records.splice(0);}},
  URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:test';},revokeObjectURL(){}},
 });
 const canvas=new Element('section');canvas.className='dae-creative';body.append(canvas);
 const owners=initial.map((text,i)=>{
  const card=new Element('article');card.className='dae-creative-card';card.dataset.nodeId=String(i+1);canvas.append(card);
  let box,cell,table,tr,panel,section;
  if(i<2){table=new Element('section');table.className='dae-table';tr=new Element('tr');tr.dataset.recordId=row;cell=new Element('td');cell.dataset.record=row;cell.dataset.field=field;box=new Element('div');box.className='content-display';box.setAttribute('contenteditable','false');box.textContent=text;card.append(table);table.append(tr);tr.append(cell);cell.append(box);}
  else{panel=new Element('section');panel.className='llm-style llm-style-B';panel.dataset.variant='B';section=new Element('label');section.className='llm-style-instruction';box=new Element('textarea');box.setAttribute('aria-label','B 处理要求');box.value=text;card.append(panel);panel.append(section);section.append(box);}
  return {card,box,cell,table,tr,panel,section};
 });
 const recorder=createInteractionImeObserver(document,window,options);
 const start=extra=>recorder.start({isTrusted:true,type:'click'},{fixture,buildFingerprint,enabled:true,...extra});
 const set=(i,value)=>{if(i<2)owners[i].box.textContent=value;else owners[i].box.value=value;};
 const emit=(type,i=0,extra={})=>{const target=owners[i].box;document.activeElement=target;if(i<2){target.setAttribute('contenteditable','true');owners[i].cell.dataset.inlineEditing='true';}document.emit(type,{target,timeStamp:at,eventPhase:1,...extra});};
 const flush=()=>{while(microtasks.length)microtasks.shift()();};
 const advance=ms=>{at+=ms;for(const [id,t]of [...timers])if(t.at<=at){timers.delete(id);t.fn();}};
 const mutate=records=>{for(const o of observers)if(o.active){o.records.push(...records);o.fn(o.takeRecords());}};
 return {document,window,body,canvas,owners,recorder,start,set,emit,flush,advance,mutate,microtasks,timers,observers,blobs};
}

test('fixture reader hashes before admission, verifies all four identities/initials and rejects arbitrary bytes',async()=>{
 assert.deepEqual(IME_FIELDS.map(f=>f.initial),initial);assert.equal(fixture.sha256,IME_FIXTURE_SHA256);assert(Object.isFrozen(fixture));
 await assert.rejects(readInteractionImeFixture(bytes,globalThis.crypto),/fixture-hash/);
 await assert.rejects(readInteractionImeFixture(new Uint8Array(262145),digestCrypto),/fixture-size/);
 const wrong=structuredClone(graph);wrong.nodes[3].properties.llmStylePreview.instruction='other';
 await assert.rejects(readInteractionImeFixture(new TextEncoder().encode(JSON.stringify(wrong)),digestCrypto),/fixture-initial/);
});

test('fixture parsing uses the same detached bytes that were hashed across an async digest',async()=>{
 const changing=bytes.slice();const crypto={subtle:{async digest(algorithm,input){assert.notEqual(input,changing);changing.fill(32);return digestCrypto.subtle.digest(algorithm,input);}}};
 const admitted=await readInteractionImeFixture(changing,crypto);assert.equal(admitted.sha256,IME_FIXTURE_SHA256);assert.deepEqual(admitted.fields.map(f=>f.initial),initial);
});

test('inert construction and trusted explicit opt-in require genuine reader proof plus all four DOM initial values',()=>{
 const h=harness();assert.equal(h.document.count(),0);assert.equal(h.timers.size,0);
 assert.equal(h.recorder.start({isTrusted:false},{fixture,buildFingerprint,enabled:true}),false);
 assert.equal(h.start({enabled:false}),false);assert.equal(h.start({buildFingerprint:'bad'}),false);assert.equal(h.start({fixture:{...fixture}}),false);
 h.set(3,'wrong initial');assert.equal(h.start(),false);assert.equal(h.recorder.resources().active,false);
 h.set(3,initial[3]);assert.equal(h.start(),true);assert.equal(h.recorder.report().productAcceptance,false);h.recorder.destroy();
});

test('all four owners preserve true composition sequence and intermediate/committed values without inventing acceptance',()=>{
 const h=harness();assert(h.start());
 for(let i=0;i<4;i++){
  h.emit('compositionstart',i,{data:''});h.set(i,initial[i]+'zhong');h.emit('compositionupdate',i,{data:'zhong'});h.emit('beforeinput',i,{inputType:'insertCompositionText',isComposing:true,data:'zhong'});h.emit('input',i,{inputType:'insertCompositionText',isComposing:true});
  h.set(i,initial[i]+'中文');h.emit('compositionend',i,{data:'中文'});h.emit('input',i,{inputType:'insertText',isComposing:false});h.flush();
 }
 const r=h.recorder.report();assert.equal(r.events.length,24);assert.deepEqual(r.events.filter(e=>e.type==='compositionstart').map(e=>e.owner.nodeId),['1','2','3','4']);
 for(let i=0;i<4;i++){const end=r.events.find(e=>e.type==='compositionend'&&e.owner.nodeId===String(i+1));assert.equal(end.fields[i].value,initial[i]+'中文');assert.equal(end.compositionId,i+1);assert.equal(end.commitProven,false);}
 assert.equal(r.formalBudgetEvaluated,false);assert.equal(r.events.filter(e=>e.type==='input').length,8);h.recorder.destroy();
});

test('shared row/label identifiers do not merge owners; only fixed synthetic field contents can be read',()=>{
 const h=harness();assert(h.start());const foreign=new Element('textarea');Object.defineProperty(foreign,'value',{get(){throw Error('privacy leak');}});h.body.append(foreign);
 h.document.emit('input',{target:foreign,inputType:'insertText'});h.emit('input',0,{isTrusted:false});
 const wrong=new Element('div');wrong.className='content-display';Object.defineProperty(wrong,'textContent',{get(){throw Error('wrong row leak');}});h.owners[0].table.append(wrong);h.document.emit('compositionstart',{target:wrong});
 h.set(1,initial[1]+'乙');h.emit('input',1);const e=h.recorder.report().events[0];assert.equal(e.owner.nodeId,'2');assert.equal(e.fields[0].value,initial[0]);assert.equal(e.fields[1].value,initial[1]+'乙');assert.notEqual(e.fields[0].identity.editor,e.fields[1].identity.editor);
 assert.equal(h.recorder.report().rejected['outside-scope'],2);assert.equal(h.recorder.report().rejected['untrusted-event'],1);h.recorder.destroy();
});

test('same-ID DOM replacement, duplicate cards and remove-reinsert invalidate the captured lease',()=>{
 for(const mode of ['replace','duplicate','reinsert']){
  const h=harness();assert(h.start());const old=h.owners[0].box;
  if(mode==='duplicate'){const c=new Element('article');c.className='dae-creative-card';c.dataset.nodeId='1';h.canvas.append(c);h.emit('input');}
  else if(mode==='replace'){old.remove();const next=new Element('div');next.className='content-display';next.textContent=initial[0];h.owners[0].cell.append(next);h.document.emit('input',{target:next});}
  else{old.remove();h.owners[0].cell.append(old);h.mutate([{type:'childList',removedNodes:[old]}]);}
  assert.equal(h.recorder.resources().active,false,mode);assert.equal(h.recorder.report().stopReason,'identity-lost',mode);h.recorder.destroy();
 }
});

test('identity attribute ABA cannot restore an invalidated lease before observer delivery',()=>{
 const h=harness();assert(h.start());h.owners[0].cell.dataset.record='temporary-other';h.owners[0].cell.dataset.record=row;
 h.mutate([{type:'attributes',target:h.owners[0].cell,attributeName:'data-record'}]);
 assert.equal(h.recorder.resources().active,false);assert.equal(h.recorder.report().stopReason,'identity-lost');h.recorder.destroy();
});

test('plain bounded text only, and no event/data leakage on unsupported structures or oversized values',()=>{
 for(const mode of ['rich','large']){
  const h=harness();assert(h.start());if(mode==='large')h.set(2,'x'.repeat(513));else{const chip=new Element('span');chip.setAttribute('contenteditable','false');chip.textContent='secret';h.owners[0].box.append(chip);}
  h.emit('input',0,{data:'secret'});const r=h.recorder.report();assert.equal(r.events.length,0);assert.equal(r.stopReason,'scope-value-invalid');assert(!JSON.stringify(r).includes('secret'));h.recorder.destroy();
 }
});

test('selection is scoped to editor DOM or textarea; other selection text is never read',()=>{
 const h=harness();assert(h.start());h.window.selection={anchorNode:h.owners[0].box.childNodes[0],focusNode:h.owners[0].box.childNodes[0],anchorOffset:2,focusOffset:4,isCollapsed:false};h.emit('keydown',0,{key:'ArrowRight'});
 let e=h.recorder.report().events.at(-1);assert.equal(e.fields[0].selection.anchorOffset,2);assert.deepEqual(e.fields[0].selection.anchorPath,[0]);
 h.window.selection={anchorNode:h.body,focusNode:h.body,anchorOffset:0,focusOffset:0,toString(){throw Error('outside selection');}};h.owners[2].box.selectionStart=3;h.owners[2].box.selectionEnd=5;h.emit('input',2);
 e=h.recorder.report().events.at(-1);assert.equal(e.fields[0].selection,null);assert.equal(e.fields[2].selection.start,3);h.recorder.destroy();
});

test('composition cancellation and keydown boundary remain raw facts, not an inferred committed or canceled result',()=>{
 const h=harness();assert(h.start());h.emit('compositionend',0,{data:''});assert.equal(h.recorder.report().rejected['composition-end-without-start'],1);
 h.emit('compositionstart');h.emit('keydown',0,{key:'Escape',isComposing:true,cancelable:true});h.emit('compositionend',0,{data:''});h.emit('blur');h.flush();
 const r=h.recorder.report();assert.equal(r.events.at(-2).type,'compositionend');assert.equal(r.events.at(-2).commitProven,false);assert.equal(r.events.find(e=>e.type==='keydown').key,'Escape');assert.equal(r.events.at(-1).fields[0].value,initial[0]);h.recorder.destroy();
});

test('checkpoint captures post-handler peer changes separately; stop fences queued callbacks and releases resources',()=>{
 const h=harness();assert(h.start());h.emit('input');h.set(3,initial[3]+'peer changed');h.flush();
 const r=h.recorder.report();assert.equal(r.events[0].fields[3].value,initial[3]);assert.equal(r.checkpoints[0].fields[3].value,initial[3]+'peer changed');assert.equal(r.checkpoints[0].allListenersCompleted,false);
 h.emit('input');h.recorder.stop();const frozen=JSON.stringify(h.recorder.report());h.flush();assert.equal(JSON.stringify(h.recorder.report()),frozen);
 assert.equal(h.document.count(),0);assert.equal(h.timers.size,0);assert(h.observers.every(o=>!o.active));h.recorder.destroy();
});

test('capacity/duration/visibility/pagehide preserve partial reports and stop collecting',()=>{
 for(const mode of ['events','bytes','duration','hidden','pagehide']){
  const h=harness(mode==='events'?{maxEvents:1}:mode==='bytes'?{maxReportBytes:8192}:mode==='duration'?{maxDurationMs:100}:{});assert(h.start(),mode);
  if(mode==='events'){h.emit('input');h.emit('input');}else if(mode==='bytes'){for(let i=0;i<30&&h.recorder.resources().active;i++){h.emit('input');h.flush();}}else if(mode==='duration')h.advance(100);else if(mode==='hidden'){h.document.visibilityState='hidden';h.document.emit('visibilitychange');}else h.window.emit('pagehide');
  assert.equal(h.recorder.resources().active,false,mode);assert.equal(h.recorder.report().complete,false);assert.equal(h.document.count(),0);h.flush();h.recorder.destroy();
 }
});

test('byte cap includes stop metadata and rejected counters, and arbitrary stop reasons are not exported',()=>{
 const h=harness({maxReportBytes:8192});assert(h.start());
 for(let i=0;i<30&&h.recorder.resources().active;i++){h.emit('input',0,{isTrusted:false});h.emit('input');h.flush();}
 assert.equal(h.recorder.resources().active,false);assert(new TextEncoder().encode(JSON.stringify(h.recorder.report())).length<=8192);h.recorder.destroy();
 const other=harness();assert(other.start());other.recorder.stop('PRIVATE-ARBITRARY-STRING');assert(!JSON.stringify(other.recorder.report()).includes('PRIVATE'));other.recorder.destroy();
});

test('stopped report cannot be overwritten by a new Start and returned report is a detached copy',()=>{
 const h=harness();assert(h.start());h.emit('input');h.recorder.stop();const r=h.recorder.report();r.events[0].fields[0].value='changed copy';assert.notEqual(h.recorder.report().events[0].fields[0].value,'changed copy');assert.equal(h.start(),false);h.recorder.destroy();
});

test('panel defaults off, picker does not load graph, trusted opt-in gates Start and only stopped data downloads',async()=>{
 const h=harness(),panel=mountInteractionImeObserver(h.document,h.window);assert(panel);const element=h.document.getElementById('studio-interaction-ime-observer');
 const picker=element.children.find(e=>e.type==='file'),build=element.children.find(e=>e.getAttribute('aria-label')==='构建指纹'),enable=element.children.find(e=>e.type==='checkbox');
 const button=t=>element.children.find(e=>e.tagName==='BUTTON'&&e.textContent===t);
 assert.equal(enable.checked,false);assert.equal(panel.resources().active,false);picker.files=[{arrayBuffer:async()=>bytes}];await Promise.all(picker.emit('change'));build.value=buildFingerprint;
 button('开始 IME 观察').onclick({isTrusted:true});assert.equal(panel.resources().active,false);enable.checked=true;button('开始 IME 观察').onclick({isTrusted:false});assert.equal(panel.resources().active,false);
 button('开始 IME 观察').onclick({isTrusted:true});assert.equal(panel.resources().active,true);button('下载 IME 原始记录').onclick({isTrusted:true});assert.equal(h.blobs.length,0);
 button('停止 IME 观察').onclick({isTrusted:true});button('下载 IME 原始记录').onclick({isTrusted:false});assert.equal(h.blobs.length,0);button('下载 IME 原始记录').onclick({isTrusted:true});assert.equal(h.blobs.length,1);assert.equal(JSON.parse(await h.blobs[0].text()).productAcceptance,false);
 h.window.emit('pagehide');assert.equal(element.isConnected,false);assert.equal(h.document.count(),0);panel.destroy();h.recorder.destroy();
});

test('scope source contains no host/model writes, event synthesis, network, timers polling graph or private hooks',()=>{
 const source=fs.readFileSync(new URL('../host_fixture/web/interaction_ime_observer.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\bfetch\s*\(|app\.graph|serialize\s*\(|dispatchEvent\s*\(|preventDefault\s*\(|\.focus\s*\(|\.click\s*\(\s*\)\s*;.*(?:input|key)|setInterval\s*\(|localStorage|sessionStorage/);
 assert.match(source,/compositionupdate/);assert.match(source,/productAcceptance:false/);
});
