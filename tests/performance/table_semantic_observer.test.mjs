import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TABLE_FIXTURES,readTableSemanticFixture,createTableSemanticObserver,mountTableSemanticObserver} from '../host_fixture/web/performance_table_semantic.js';

const base=new URL('../fixtures/performance/',import.meta.url);
const bytes=fs.readFileSync(new URL('FX-PERF-M-no-video.json',base));
const fixture=await readTableSemanticFixture(bytes,globalThis.crypto);
const buildFingerprint='a'.repeat(64);
class Hub{
 listeners=new Map();
 addEventListener(type,fn,options={}){const list=this.listeners.get(type)||new Set();list.add(fn);this.listeners.set(type,list);options.signal?.addEventListener('abort',()=>this.removeEventListener(type,fn),{once:true});}
 removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
 emit(type,event={}){return [...(this.listeners.get(type)||[])].map(fn=>fn({type,isTrusted:true,timeStamp:100,target:this,...event}));}
 count(){return [...this.listeners.values()].reduce((sum,list)=>sum+list.size,0);}
}
class Element extends Hub{
 constructor(tag,kind=''){super();this.tagName=tag.toUpperCase();this.kind=kind;this.children=[];this.dataset={};this.style={};this.attributes=new Map();this.parentElement=null;this.hidden=false;this.value='';this.textContent='';this.innerText='';this.contentEditable='false';this.rect={left:20,top:100,right:320,bottom:200,width:300,height:100};}
 get isConnected(){return this.base||Boolean(this.parentElement?.isConnected);}
 append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
 remove(){if(this.parentElement){this.parentElement.children.splice(this.parentElement.children.indexOf(this),1);this.parentElement=null;}}
 setAttribute(name,value){this.attributes.set(name,String(value));}
 getAttribute(name){return this.attributes.get(name)??null;}
 matches(selector){return ({'.content-display':this.kind==='editor','td[data-record][data-field]':this.kind==='cell'&&!!this.dataset.record&&!!this.dataset.field,'tr[data-record-id]':this.kind==='row'&&!!this.dataset.recordId,'.dae-table':this.kind==='table','.dae-creative-card[data-node-id]':this.kind==='card'&&!!this.dataset.nodeId,'.dae-creative':this.kind==='canvas'})[selector]||false;}
 closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
 querySelector(){return this.structured?{}:null;}
 getBoundingClientRect(){return this.rect;}
 checkVisibility(){return !this.hidden;}
 click(){this.clicked=true;}
}
function harness(options={}){
 let time=100,next=0;const frames=new Map(),timers=new Map(),observers=[],blobs=[];
 const body=new Element('body');body.base=true;
 const document=Object.assign(new Hub(),{body,visibilityState:'visible',createElement:tag=>new Element(tag),getElementById:id=>{const walk=node=>node.id===id?node:node.children.map(walk).find(Boolean);return walk(body);}});
 const window=Object.assign(new Hub(),{performance:{now:()=>time,timeOrigin:100000},innerWidth:1920,innerHeight:1080,devicePixelRatio:1,navigator:{userAgent:'synthetic-unit-harness'},crypto:globalThis.crypto,
  requestAnimationFrame(fn){frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),setTimeout(fn,delay){timers.set(++next,{fn,at:time+delay});return next;},clearTimeout:id=>timers.delete(id),
  getComputedStyle:element=>({display:'block',visibility:'visible',opacity:'1',overflowX:'visible',overflowY:'visible',...element.computed}),
  MutationObserver:class{constructor(fn){this.fn=fn;this.active=false;this.targets=[];observers.push(this);}observe(target,settings){this.active=true;this.targets.push({target,settings});}disconnect(){this.active=false;}},
  URL:{createObjectURL(blob){blobs.push(blob);return 'blob:unit';},revokeObjectURL(){}}
 });
 const canvas=new Element('section','canvas'),world=new Element('div');canvas.rect={left:0,top:0,right:1920,bottom:1080,width:1920,height:1080};body.append(canvas);canvas.append(world);
 function add(nodeId='1',recordId=fixture.tables[nodeId].records[0],fieldId='field-00'){
  const card=new Element('article','card'),table=new Element('section','table'),tbody=new Element('tbody'),row=new Element('tr','row'),cell=new Element('td','cell'),editor=new Element('div','editor');
  card.dataset.nodeId=nodeId;row.dataset.recordId=recordId;cell.dataset.record=recordId;cell.dataset.field=fieldId;cell.dataset.inlineEditing='true';editor.contentEditable='true';editor.innerText='合成初值';
  world.append(card);card.append(table);table.append(tbody);tbody.append(row);row.append(cell);cell.append(editor);return {card,table,tbody,row,cell,editor};
 }
 const a=add(),b=add('2'),recorder=createTableSemanticObserver(document,window,options);
 const emit=(type,target=a.editor,extra={})=>document.emit(type,{target,timeStamp:time,...extra});
 const frame=(ms=16)=>{time+=ms;const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(time);};
 const mutate=(records=[{type:'attributes',target:a.cell,attributeName:'data-inline-editing'}])=>{for(const observer of observers)if(observer.active)observer.fn(records);};
 const advance=ms=>{time+=ms;for(const [id,timer] of [...timers])if(timer.at<=time){timers.delete(id);timer.fn();}};
 const start=()=>recorder.start({isTrusted:true},{fixture,buildFingerprint});
 const exitEdit=(item=a)=>{emit('blur',item.editor);delete item.cell.dataset.inlineEditing;item.editor.contentEditable='false';mutate([{type:'attributes',target:item.cell,attributeName:'data-inline-editing'}]);};
 return {document,window,canvas,world,a,b,add,recorder,emit,frame,mutate,advance,start,exitEdit,frames,timers,observers,blobs};
}

test('fixed M fixture hashes and stable identity contract match actual native fixture bytes',async()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',base),'utf8'));
 for(const [hash,file] of Object.entries(TABLE_FIXTURES)){
  assert.equal(manifest.workflows.find(item=>item.file===file).sha256,hash);
  const parsed=await readTableSemanticFixture(fs.readFileSync(new URL(file,base)),globalThis.crypto);
  assert.equal(Object.keys(parsed.tables).length,2);
  for(const table of Object.values(parsed.tables)){assert.equal(table.records.length,500);assert.equal(table.fields.length,10);}
 }
 await assert.rejects(readTableSemanticFixture(new TextEncoder().encode('{}'),globalThis.crypto),/固定/);
 const editor=fs.readFileSync(new URL('../../frontend/src/features/table/editor_runtime.mjs',import.meta.url),'utf8');
 assert.match(editor,/cell\.dataset\.field=f\.id;cell\.dataset\.record=r\.id/);
 assert.match(editor,/row\.dataset\.recordId=r\.id/);
 const inline=fs.readFileSync(new URL('../../frontend/src/ui/inline_editor.mjs',import.meta.url),'utf8');
 assert.match(inline,/cell\.dataset\.inlineEditing='true'/);
 assert.match(inline,/box\.contentEditable='false';delete cell\.dataset\.inlineEditing/);
 const view=fs.readFileSync(new URL('../../frontend/src/canvas/creative_canvas_view.mjs',import.meta.url),'utf8');
 assert.match(view,/element\.dataset\.nodeId=String\(node\.id\)/);
});

test('mount/start require explicit trusted action and import neither starts nor edits a graph',()=>{
 const h=harness();assert.equal(h.frames.size,0);assert.equal(h.document.count(),0);
 assert.equal(h.recorder.start({isTrusted:false},{fixture,buildFingerprint}),false);
 assert.equal(h.recorder.start({isTrusted:true},{fixture,buildFingerprint:'invalid'}),false);
 assert(h.start());h.emit('input',h.a.editor,{isTrusted:false});assert.equal(h.recorder.report().samples.length,0);
 assert.equal(h.recorder.report().rejected['untrusted-event'],1);h.recorder.destroy();assert.equal(h.document.count(),0);
 const source=fs.readFileSync(new URL('../host_fixture/web/performance_table_semantic.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\bfetch\s*\(|app\.graph|dispatchEvent\s*\(|\.value\s*=|localStorage|sessionStorage|__dataTable/);
 assert.doesNotMatch(source,/querySelectorAll/,'input observation never scans the page or all table cells');
});

test('trusted input first observes editing value; display completion waits for actual exit and two boundaries',()=>{
 const h=harness();h.start();h.a.editor.innerText='精确合成结果';h.emit('input',h.a.editor,{inputType:'insertText'});
 h.frame();assert.equal(h.recorder.report().samples[0].editing.status,'pending');
 h.frame();let sample=h.recorder.report().samples[0];assert.equal(sample.editing.status,'observed');assert.equal(sample.display.status,'pending');
 assert.equal(sample.editing.inputToPaintOpportunityMs,32);assert.equal(sample.expectedValue,'精确合成结果');
 h.advance(100);h.exitEdit();h.frame();h.frame();sample=h.recorder.report().samples[0];
 assert.equal(sample.display.status,'observed');assert.equal(sample.display.exitToPaintOpportunityMs,32);
 assert.equal(sample.display.inputToPaintOpportunityMs,164);assert.equal(sample.finishReason,'display-observed');
 assert.equal(h.recorder.resources().pending,0);assert.equal(h.b.editor.innerText,'合成初值');h.recorder.destroy();
});

test('same row and field under another node/editor cannot satisfy old pending input',()=>{
 const h=harness();h.start();h.a.editor.innerText='A期望';h.emit('input');
 h.a.editor.innerText='旧值';h.b.editor.innerText='A期望';h.frame();
 const sample=h.recorder.report().samples[0];assert.equal(sample.finishReason,'value-mismatch');assert.equal(sample.identity.nodeId,'1');
 assert.equal(sample.checks[0].value,'旧值');assert.notEqual(sample.identity.editor,h.b.editor);h.recorder.destroy();
});

test('a replacement with identical serialized IDs is rejected instead of following a new instance',()=>{
 const h=harness();h.start();h.a.editor.innerText='待显示';h.emit('input');h.a.card.remove();
 const fresh=h.add();fresh.editor.innerText='待显示';h.frame();
 assert.equal(h.recorder.report().samples[0].finishReason,'stale-instance-or-identity');assert.equal(h.recorder.resources().pending,0);h.recorder.destroy();
});

test('remove/reinsert and row identity mutation are fenced even when identities are later restored',()=>{
 for(const identityChange of [false,true]){
  const h=harness();h.start();h.emit('input');
  h.mutate(identityChange?[{type:'attributes',target:h.a.row,attributeName:'data-record-id'}]:[{type:'childList',target:h.a.table,removedNodes:[h.a.tbody]}]);
  assert.equal(h.recorder.report().samples[0].finishReason,'stale-instance-or-identity');assert.equal(h.frames.size,0);h.recorder.destroy();
 }
});

test('IME preserves intermediate raw inputs and one linked final commit without declaring interim display completion',()=>{
 const h=harness();h.start();h.emit('compositionstart',h.a.editor,{data:''});
 h.a.editor.innerText='zhong';h.emit('compositionupdate',h.a.editor,{data:'zhong'});h.emit('input',h.a.editor,{inputType:'insertCompositionText',isComposing:true});h.frame();h.frame();
 h.a.editor.innerText='中文';h.emit('compositionend',h.a.editor,{data:'中文'});h.emit('input',h.a.editor,{inputType:'insertText',isComposing:false});h.frame();h.frame();
 h.exitEdit();h.frame();h.frame();const report=h.recorder.report();
 assert.equal(report.samples.length,3);assert.equal(report.samples[0].eligibleForCommittedInputLatency,false);assert.equal(report.samples[0].display.status,'superseded-by-next-input');
 assert.equal(report.samples[1].kind,'ime-commit');assert.equal(report.samples[1].expectedValue,'中文');assert.equal(report.samples[1].display.status,'superseded-by-next-input');assert.equal(report.samples[2].display.status,'observed');assert.equal(report.samples[2].kind,'ime-ambiguous');
 assert.equal(report.samples[1].timingDomain,'compositionend-to-frame');assert.equal(report.samples[1].eligibleForCommittedInputLatency,false);
 assert.deepEqual(report.compositions.map(event=>event.type),['compositionstart','compositionupdate','compositionend','post-composition-input']);h.recorder.destroy();
});

test('different timestamp composition tails and ambiguous same-value input never enter ordinary latency',()=>{
 for(const inputType of ['insertFromComposition','insertCompositionText','insertText']){
  const h=harness();h.start();h.emit('compositionstart');h.a.editor.innerText='相同';h.emit('compositionend');h.advance(1);
  h.emit('input',h.a.editor,{inputType});let report=h.recorder.report();
  assert.equal(report.samples.length,2);const tail=report.samples[1];
  assert.equal(tail.kind,inputType==='insertText'?'ime-ambiguous':'ime-associated');assert.equal(tail.eligibleForCommittedInputLatency,false);
  assert.equal(tail.compositionId,report.samples[0].compositionId);assert.notEqual(tail.eventTimeStamp,report.samples[0].eventTimeStamp);
  assert.equal(tail.duplicateOf,null);assert.equal(report.compositions.at(-1).sampleId,tail.id);
  h.a.editor.innerText='相同!';h.advance(1);h.emit('input',h.a.editor,{inputType:'insertText'});report=h.recorder.report();
  assert.equal(report.samples[2].kind,'input');assert.equal(report.samples[2].eligibleForCommittedInputLatency,true);h.recorder.destroy();
 }
});

test('first post-composition ordinary input with a different value remains eligible',()=>{
 const h=harness();h.start();h.emit('compositionstart');h.a.editor.innerText='原';h.emit('compositionend');h.advance(1);
 h.a.editor.innerText='原a';h.emit('input',h.a.editor,{inputType:'insertText'});
 assert.equal(h.recorder.report().samples[1].kind,'input');assert.equal(h.recorder.report().samples[1].eligibleForCommittedInputLatency,true);h.recorder.destroy();
});

test('application rejection, offscreen target, rich references and visibility loss cannot pass',()=>{
 const invalid=harness();invalid.start();invalid.emit('input');invalid.a.editor.setAttribute('aria-invalid','true');invalid.frame();assert.equal(invalid.recorder.report().samples[0].finishReason,'application-rejected');invalid.recorder.destroy();
 const offscreen=harness();offscreen.start();offscreen.a.editor.rect.left=2000;offscreen.a.editor.rect.right=2300;offscreen.emit('input');assert.equal(offscreen.recorder.report().samples.length,0);offscreen.recorder.destroy();
 const rich=harness();rich.start();rich.a.editor.structured=true;rich.emit('input');assert.equal(rich.recorder.report().rejected['unsupported-structured-content'],1);rich.recorder.destroy();
 const hidden=harness();hidden.start();hidden.emit('input');hidden.document.visibilityState='hidden';hidden.document.emit('visibilitychange');assert.equal(hidden.recorder.report().stopReason,'page-hidden');assert.equal(hidden.frames.size,0);hidden.recorder.destroy();
});

test('overlapping edits retain superseded input; deadline and stop release all live observation resources',()=>{
 const h=harness({timeoutMs:50});h.start();h.emit('input');h.a.editor.innerText='后续';h.emit('input');
 let report=h.recorder.report();assert.equal(report.samples.length,2);assert.equal(report.samples[0].finishReason,'superseded-by-next-input');
 h.frame();h.frame();h.advance(50);report=h.recorder.report();assert.equal(report.samples[1].editing.status,'observed');assert.equal(report.samples[1].display.status,'timed-out');
 h.recorder.stop();assert.equal(h.document.count(),0);assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);assert(h.observers.every(observer=>!observer.active));
 h.start();h.emit('compositionend');assert.equal(h.recorder.report().rejected['composition-end-without-start'],1);h.recorder.destroy();
});

test('capacity retains raw failure and never silently drops input to make latency look complete',()=>{
 const h=harness({maxSamples:1});h.start();h.emit('input');h.emit('input');assert.equal(h.recorder.report().stopReason,'sample-capacity');assert.equal(h.recorder.report().samples.length,1);assert.equal(h.recorder.report().productAcceptance,false);h.recorder.destroy();
});

test('visible panel is inert until trusted Start, downloads only on request, and pagehide disposes',async()=>{
 const h=harness(),panel=mountTableSemanticObserver(h.document,h.window);assert.equal(h.frames.size,0);
 const element=h.document.getElementById('studio-table-semantic-observer'),picker=element.children.find(e=>e.type==='file'),build=element.children.find(e=>e.getAttribute('aria-label')==='构建指纹');
 assert.match(element.style.cssText,/left:8px;top:160px/);assert.match(element.style.cssText,/width:350px;max-height:65vh/);assert.notEqual(element.open,true);
 picker.files=[{arrayBuffer:async()=>bytes}];await Promise.all(picker.emit('change'));build.value=buildFingerprint;
 const status=element.children.find(e=>e.tagName==='OUTPUT'),text={nodeType:3,nodeValue:status.textContent};
 status.firstChild=text;
 Object.defineProperty(status,'textContent',{configurable:true,get:()=>text.nodeValue,set:()=>{throw new Error('status replaced its text node during measurement');}});
 const button=label=>element.children.find(e=>e.textContent===label);
 button('开始语义观测').onclick({isTrusted:false});assert.equal(panel.resources().active,false);
 button('开始语义观测').onclick({isTrusted:true});assert.equal(panel.resources().active,true);
 h.emit('input');h.frame();h.frame();button('停止语义观测').onclick({isTrusted:true});
 assert.equal(status.firstChild,text);assert.match(text.nodeValue,/已停止；输入 1/);
 Object.defineProperty(status,'textContent',{configurable:true,writable:true,value:text.nodeValue});
 button('下载语义原始记录').onclick({isTrusted:false});assert.equal(h.blobs.length,0);
 button('下载语义原始记录').onclick({isTrusted:true});assert.equal(h.blobs.length,1);
 const downloaded=JSON.parse(await h.blobs[0].text());assert.equal(downloaded.samples.length,1);assert.equal(downloaded.productAcceptance,false);
 h.window.emit('pagehide');assert.equal(element.isConnected,false);assert.equal(h.document.count(),0);assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);h.recorder.destroy();
});
