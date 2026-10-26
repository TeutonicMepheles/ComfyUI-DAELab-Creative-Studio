import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTableEditor} from '../../frontend/src/features/table/data_table_editor.mjs';
import {createBusinessDocument} from '../../frontend/src/application/business_document.ts';
import {createPromptEditor} from '../../frontend/src/features/prompt/table_prompt_editor.mjs';
import {PromptRequests,promptField} from '../../frontend/src/features/prompt/table_prompt_model.mjs';
import {OptimizationRevisions} from '../../frontend/src/features/prompt/prompt_optimization_model.mjs';

// Real owning editor, inline events, document and prompt UI; a bounded DOM double
// proves scan/lifecycle semantics, not browser rendering or input latency.
function dom(t){
 const saved=new Map(),queries=[],cleanups=[],writes=[],observers=new Set();let selection;
 const mutation=target=>{for(const observer of observers)for(let owner=target;owner;owner=owner.parentNode)if(owner===observer.root){observer.records.push({type:'childList',target});break;}};
 const dataKey=name=>name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
 class Text {constructor(value){this.nodeType=3;this.nodeName='#text';this.nodeValue=String(value);this.parentNode=null;}get textContent(){return this.nodeValue;}set textContent(v){this.nodeValue=String(v);}get parentElement(){return this.parentNode;}}
 class Element {
  constructor(tag){this.nodeType=1;this.tagName=this.nodeName=tag.toUpperCase();this.childNodes=[];this.parentNode=null;this.dataset={};this.attrs=new Map();this.listeners=new Map();this.className='';this.title='';this.contentEditable='inherit';this.scrollLeft=this.scrollTop=0;this.style={setProperty(n,v){this[n]=String(v);},removeProperty(n){delete this[n];}};this.classList={contains:n=>this.className.split(/\s+/).includes(n),add:(...ns)=>ns.forEach(n=>this.classList.toggle(n,true)),remove:(...ns)=>ns.forEach(n=>this.classList.toggle(n,false)),toggle:(n,on)=>{const names=new Set(this.className.split(/\s+/).filter(Boolean));on??=!names.has(n);on?names.add(n):names.delete(n);this.className=[...names].join(' ');return on;}};}
  get parentElement(){return this.parentNode;}get children(){return this.childNodes.filter(n=>n.nodeType===1);}get firstChild(){return this.childNodes[0]??null;}get firstElementChild(){return this.children[0]??null;}get lastChild(){return this.childNodes.at(-1)??null;}get isConnected(){return this===document.body||this===document.head||!!this.parentNode?.isConnected;}get isContentEditable(){return this.contentEditable==='true';}
  get textContent(){return this.childNodes.map(n=>n.textContent).join('');}set textContent(v){writes.push({element:this,value:String(v??'')});this.replaceChildren(...(v==null||String(v)===''?[]:[new Text(v)]));}
  append(...nodes){for(let n of nodes){if(typeof n==='string')n=new Text(n);n.remove?.();n.parentNode=this;this.childNodes.push(n);}}prepend(...nodes){for(const n of nodes.reverse()){n.parentNode=this;this.childNodes.unshift(n);}}
  insertBefore(node,before){node.remove?.();node.parentNode=this;const index=this.childNodes.indexOf(before);this.childNodes.splice(index<0?this.childNodes.length:index,0,node);return node;}
  replaceChildren(...nodes){for(const n of this.childNodes)n.parentNode=null;this.childNodes=[];this.append(...nodes);mutation(this);}remove(){if(this.parentNode)this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this),1);this.parentNode=null;}
  replaceWith(...nodes){const parent=this.parentNode;if(!parent)return;for(const node of nodes)for(const item of node.nodeType===11?[...node.childNodes]:[node])parent.insertBefore(item,this);this.remove();mutation(parent);}
  contains(n){return n===this||this.childNodes.some(c=>c===n||c.contains?.(n));}add(n){this.append(n);}setAttribute(n,v){if(n.startsWith('data-'))this.dataset[dataKey(n)]=String(v);else if(n==='contenteditable')this.contentEditable=String(v);else this.attrs.set(n,String(v));}getAttribute(n){return n.startsWith('data-')?this.dataset[dataKey(n)]??null:n==='contenteditable'?this.contentEditable:this.attrs.get(n)??null;}hasAttribute(n){return this.getAttribute(n)!==null;}removeAttribute(n){if(n.startsWith('data-'))delete this.dataset[dataKey(n)];else this.attrs.delete(n);}
  matches(selector){return selector.split(',').some(part=>{let s=part.trim();const not=[...s.matchAll(/:not\(([^)]+)\)/g)];s=s.replace(/:not\([^)]+\)/g,'');if(not.some(m=>this.matches(m[1])))return false;const tag=s.match(/^[a-z]+/i)?.[0];if(tag&&this.tagName!==tag.toUpperCase())return false;for(const m of s.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(m[1]))return false;for(const m of s.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)){const v=this.getAttribute(m[1]);if(v==null||m[2]!==undefined&&v!==m[2])return false;}return true;});}
  querySelectorAll(selector){const result=[];const walk=node=>{for(const child of node.children){if(child.matches(selector))result.push(child);walk(child);}};walk(this);queries.push({element:this,selector,count:result.length});return result;}querySelector(s){return this.querySelectorAll(s)[0]??null;}closest(s){for(let n=this;n;n=n.parentElement)if(n.matches(s))return n;return null;}
  addEventListener(type,fn){const all=this.listeners.get(type)||new Set();all.add(fn);this.listeners.set(type,all);}removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}dispatchEvent(event){const e=event instanceof Event?{type:event.type,detail:event.detail,target:this,bubbles:event.bubbles,preventDefault(){},stopPropagation(){this.stopped=true;}}:event;e.target??=this;for(const fn of [...this.listeners.get(e.type)||[]])fn(e);if(e.bubbles&&!e.stopped)this.parentNode?.dispatchEvent(e);return !e.defaultPrevented;}emit(type,props={}){const e={type,target:this,bubbles:true,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...props};this.dispatchEvent(e);return e;}focus(){document.activeElement=this;this.emit('focus',{bubbles:false});}showModal(){this.open=true;}getClientRects(){return this.isConnected?[{}]:[];}scrollIntoView(){}hasPointerCapture(){return false;}
 }
 class Range{constructor(){this.collapsed=true;}selectNodeContents(n){this.startContainer=this.endContainer=n;this.startOffset=0;this.endOffset=n.nodeType===3?n.textContent.length:n.childNodes.length;}collapse(start){if(!start)this.startOffset=this.endOffset;this.endOffset=this.startOffset;this.collapsed=true;}cloneRange(){return Object.assign(new Range(),this);}}
 selection={rangeCount:0,anchorNode:null,removeAllRanges(){this.rangeCount=0;},addRange(r){this.range=r;this.rangeCount=1;this.anchorNode=r.startContainer;},getRangeAt(){return this.range;}};
 const documentListeners=new Map();const doc={activeElement:null,querySelectorAll(s){return [...this.head.querySelectorAll(s),...this.body.querySelectorAll(s)];},querySelector(s){return this.querySelectorAll(s)[0]??null;},dispatchEvent(e){for(const fn of [...documentListeners.get(e.type)||[]])fn(e);return true;},createElement:tag=>new Element(tag),createDocumentFragment:()=>{const fragment=new Element('fragment');fragment.nodeType=11;return fragment;},createTextNode:v=>new Text(v),createRange:()=>new Range(),addEventListener(type,fn){const all=documentListeners.get(type)||new Set();all.add(fn);documentListeners.set(type,all);},removeEventListener(type,fn){documentListeners.get(type)?.delete(fn);},getElementById(id){return [...this.head.children,...this.body.children].find(n=>n.id===id)||null;}};
 const globals={Node:{TEXT_NODE:3},document:doc,window:{addEventListener(){},removeEventListener(){}},Option:class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}},MutationObserver:class{constructor(callback){this.callback=callback;this.records=[];observers.add(this);}observe(root){this.root=root;}disconnect(){observers.delete(this);this.records=[];}},setInterval:()=>1,clearInterval(){},fetch(){throw Error('network not allowed');},ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},getSelection:()=>selection};
 for(const [key,value]of Object.entries(globals)){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}doc.body=new Element('body');doc.head=new Element('head');
 t.after(()=>{for(const fn of cleanups.reverse())fn();for(const [key,value]of saved)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 return {queries,writes,Element,cleanups,flushMutations(){let calls=0;for(const observer of observers){const records=observer.records.splice(0);if(records.length){calls++;observer.callback(records);}}return calls;},reset(){queries.length=0;writes.length=0;for(const observer of observers)observer.records.length=0;},traversal(){return {rows:queries.filter(q=>q.selector==='tr[data-record-id]').reduce((n,q)=>n+q.count,0),cells:queries.filter(q=>q.selector==='td[data-field]'&&q.element.tagName==='TR').reduce((n,q)=>n+q.count,0)};}};
}

const fixture=JSON.parse(readFileSync(new URL('../fixtures/performance/FX-PERF-M-no-video.json',import.meta.url),'utf8'));
const clone=value=>JSON.parse(JSON.stringify(value));
const documentFor=text=>({version:1,compilerVersion:1,segments:[{type:'text',text}],references:[],sourceFingerprint:'fixture',editOrigin:'parsed'});
const response=(id,text='parsed result')=>({results:[{recordId:id,document:documentFor(text)}]});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function observationCounts(t){
 const original=PromptRequests.prototype.observe,calls=[];
 t.mock.method(PromptRequests.prototype,'observe',function(table){
  const item={receiver:this,visits:0};calls.push(item);
  const rows=new Proxy(table.records,{get(target,key,receiver){if(key===Symbol.iterator)return function*(){for(const row of target){item.visits++;yield row;}};return Reflect.get(target,key,receiver);}});
  return original.call(this,new Proxy(table,{get(target,key){return key==='records'?rows:Reflect.get(target,key);}}));
 });
 return {calls,reset(){calls.length=0;}};
}
function harness(t,env,{index=0,small=true,configured=false,parsed=false,request=async body=>response(body.recordIds[0])}={}){
 let table=JSON.parse(fixture.nodes.filter(n=>n.type==='DAELAB.Table')[index].widgets_values[0]),stamp=0,prior,prompt,tableReads=0,revisionPasses=0;
 const events=[],errors=[],requests=[],statuses=[],undo=[],revisions=new OptimizationRevisions();
 if(small){table.fields=table.fields.slice(0,2);table.records=table.records.slice(0,2);for(const row of table.records)row.values=Object.fromEntries(table.fields.map(f=>[f.id,row.values[f.id]]));}
 if(configured||parsed)table.meta.prompt_config={bindings:{image_prompt:'field-00'}};
 if(parsed){table.fields.push({id:'prompt',name:'Final',type:'json',presentation:'prompt',width:360});table.meta.prompt_config.bindings.final_prompt='prompt';table.records[0].values.prompt=documentFor('original parsed');}
 const getTable=()=>{tableReads++;return table;};
 const history={begin(){events.push('begin');prior=table;},end(){events.push('end');undo.push(prior);},amend(fn){events.push('amend');fn();},undo(){table=undo.pop();stamp++;prompt?.observe();},redo(){}};
 const editor=createTableEditor({getTable,setTable:next=>{table=next;stamp++;events.push('write');prompt?.observe();},documentFactory:(read,write)=>createBusinessDocument({read,write,current:()=>true,identity:()=>({workflowSession:'test',epoch:0,documentId:'doc-'+index}),history,historyStamp:()=>stamp}),getRowState:()=>({issues:[],hint:''}),isRowStateEmpty:value=>!value.meta.prompt_config,promptColumnsOnly:true,upload(){throw Error('not exercised');},notify:e=>errors.push(e)});
 document.body.append(editor.root);env.cleanups.push(()=>editor.destroy());
 // PromptRequests must independently reject stale results; a native ticket
 // would otherwise mask its own ABA or close invalidation in these tests.
 editor.beginAsync=()=>null;
 prompt=createPromptEditor({getTable,editor,request:body=>{requests.push(body);return request(body);},notify:(...args)=>errors.push(args),onStatus:state=>statuses.push(state)});env.cleanups.push(()=>prompt.destroy());
 editor.onTableChange(()=>{revisionPasses++;revisions.observe(table);});
 const target=(rowIndex=0)=>editor.root.querySelectorAll('td[data-field]').find(c=>c.dataset.record===table.records[rowIndex].id&&c.dataset.field==='field-00');
 function enter(){const cell=target();cell.emit('keydown',{key:'Enter'});return cell.firstChild;}
 function input(box,value){box.textContent=value;box.emit('input');}
 const change=fn=>editor.change(fn,{render:false});
 const setSource=value=>change(t=>{t.records[0].values['field-00']=value;});
 return {editor,prompt,events,errors,statuses,requests,revisions,target,enter,input,change,setSource,get table(){return table;},get revisionPasses(){return revisionPasses;},get reads(){return tableReads;},reset(){events.length=0;tableReads=0;}};
}
const findButton=(parent,label)=>{const button=parent.querySelectorAll('button').find(b=>b.textContent===label);assert.ok(button,`missing button ${label}`);return button;};
const click=button=>button.onclick({preventDefault(){},stopPropagation(){}});
const finalValue=a=>a.table.records[0].values[promptField(a.table)];

test('real two-owner 500x10 inputs retain initial validation, document writes and revision observers without passive request scans',t=>{
 const env=dom(t),counts=observationCounts(t),a=harness(t,env,{small:false}),b=harness(t,env,{index:1,small:false});
 assert.deepEqual(counts.calls.map(c=>c.visits),[500,500]);assert.notEqual(counts.calls[0].receiver,counts.calls[1].receiver);
 a.table.future={unknown:{preserved:true}};const peer=JSON.stringify(b.table),box=a.enter();counts.reset();a.reset();
 a.input(box,'first text');a.input(box,'second text');
 assert.equal(counts.calls.length,0);assert.equal(a.revisionPasses,2);assert.equal(a.revisions.entries.size,5000);
 assert.deepEqual(a.events,['begin','write','end','amend','write']);assert.equal(a.table.records[0].values['field-00'],'second text');assert.equal(JSON.stringify(b.table),peer);assert.deepEqual(a.table.future,{unknown:{preserved:true}});assert.equal(document.activeElement,box);assert.deepEqual(a.errors,[]);
 a.reset();a.prompt.observe();a.prompt.close();a.prompt.observe();assert.equal(a.reads,0);assert.equal(counts.calls.length,0);
 b.input(b.enter(),'independent text');assert.equal(counts.calls.length,0);assert.equal(b.revisionPasses,1);assert.equal(a.table.records[0].values['field-00'],'second text');
});

test('first parse begins from the latest passive edits and never returns to the dormant path after completion',async t=>{
 const env=dom(t),counts=observationCounts(t),a=harness(t,env,{configured:true}),id=a.table.records[0].id;
 a.setSource('latest source');counts.reset();await a.prompt.parse([id]);
 assert.equal(a.requests[0].table.records[0].values['field-00'],'latest source');assert.equal(finalValue(a).segments[0].text,'parsed result');assert.equal(a.statuses.at(-1).error,false);
 assert.ok(counts.calls.length>=3);counts.reset();a.prompt.observe();assert.equal(counts.calls.length,1);a.prompt.close();a.prompt.observe();assert.equal(counts.calls.length,2);a.prompt.invalidate();a.prompt.observe();assert.equal(counts.calls.length,3);
});

test('request in flight rejects source ABA and deleted/reinserted row even when final JSON returns to the same value',async t=>{
 const env=dom(t),counts=observationCounts(t);
 for(const kind of ['source','row']){
  const pending=deferred(),a=harness(t,env,{configured:true,request:()=>pending.promise}),id=a.table.records[0].id,original=clone(a.table.records[0]);
  const run=a.prompt.parse([id]);counts.reset();
  if(kind==='source'){a.setSource('intermediate');a.setSource(original.values['field-00']);}else{a.change(t=>t.records.shift());a.change(t=>t.records.unshift(original));}
  assert.equal(counts.calls.length,2);pending.resolve(response(id));await run;assert.equal(finalValue(a),undefined);assert.equal(a.statuses.at(-1).error,true);assert.match(a.errors.at(-1)[0],/过期丢弃 1/);
 }
});

test('retained comparison token stays observed after parse settles and refuses ABA while another owner can apply',async t=>{
 const env=dom(t),a=harness(t,env,{configured:true}),b=harness(t,env,{index:1,configured:true}),id=a.table.records[0].id,original=a.table.records[0].values['field-00'];
 await a.prompt.parse([id],true);const comparison=document.body.querySelector('dialog');assert.ok(comparison);
 a.setSource('temporary');a.setSource(original);await b.prompt.parse([b.table.records[0].id]);assert.equal(finalValue(b).segments[0].text,'parsed result');
 click(findButton(comparison,'替换解析结果'));assert.equal(finalValue(a),undefined);assert.match(comparison.querySelector('.dae-prompt-error').textContent,/比较期间数据已变化/);assert.equal(comparison.isConnected,true);
 click(findButton(comparison,'取消'));assert.equal(comparison.isConnected,false);
});

test('rich side-panel begin establishes the latest baseline, and validates before and after the await',async t=>{
 const env=dom(t),counts=observationCounts(t),pending=deferred(),a=harness(t,env,{parsed:true,request:()=>pending.promise}),id=a.table.records[0].id;
 a.setSource('before side-panel begin');counts.reset();a.prompt.edit(id);assert.equal(counts.calls.length,1);
 const side=document.body.querySelector('.table-text-side-body');assert.ok(side);const save=click(findButton(side,'保存'));assert.equal(a.requests.length,1);assert.equal(a.requests[0].operation,'validate');assert.equal(a.requests[0].table.records[0].values['field-00'],'before side-panel begin');
 a.setSource('during await');a.setSource('before side-panel begin');pending.resolve(response(id,'must not apply'));await save;
 assert.equal(finalValue(a).segments[0].text,'original parsed');assert.match(side.querySelector('.dae-prompt-error').textContent,/保存期间表格已变化/);
 const calls=a.requests.length;await click(findButton(side,'保存'));assert.equal(a.requests.length,calls);assert.match(side.querySelector('.dae-prompt-error').textContent,/编辑期间表格已变化/);
 counts.reset();click(findButton(side,'取消'));a.prompt.observe();assert.equal(counts.calls.length,1);
});

test('rich side-panel unchanged request still saves through the original validation and document path',async t=>{
 const env=dom(t),a=harness(t,env,{parsed:true}),id=a.table.records[0].id;a.prompt.edit(id);
 const side=document.body.querySelector('.table-text-side-body');await click(findButton(side,'保存'));
 assert.equal(a.requests[0].operation,'validate');assert.equal(finalValue(a).editOrigin,'edited');assert.equal(finalValue(a).segments[0].text,'parsed result');assert.equal(side.isConnected,false);assert.ok(a.events.includes('write'));
});

test('close, explicit invalidate and destroy preserve late-result rejection without affecting the other owner',async t=>{
 const env=dom(t);
 for(const action of ['close','invalidate','destroy']){
  const pending=deferred(),a=harness(t,env,{configured:true,request:()=>pending.promise}),b=harness(t,env,{index:1,configured:true}),id=a.table.records[0].id;
  const run=a.prompt.parse([id]);a.prompt[action]();await b.prompt.parse([b.table.records[0].id]);pending.resolve(response(id,'late result'));await run;
  assert.equal(finalValue(a),undefined);assert.equal(finalValue(b).segments[0].text,'parsed result');
 }
});

test('failed begin and failed request permanently enable observation; initialization remains strict',async t=>{
 const env=dom(t),counts=observationCounts(t),a=harness(t,env,{configured:true}),id=a.table.records[0].id,original=PromptRequests.prototype.begin;
 t.mock.method(PromptRequests.prototype,'begin',function(...args){if(this.seq===0)throw Error('injected begin failure');return original.apply(this,args);});
 await a.prompt.parse([id]);assert.match(a.errors.at(-1)[0],/injected begin failure/);counts.reset();a.prompt.observe();assert.equal(counts.calls.length,1);
 t.mock.restoreAll();const counts2=observationCounts(t),b=harness(t,env,{configured:true,request:async()=>{throw Error('request rejected');}});await b.prompt.parse([b.table.records[0].id]);assert.match(b.errors.at(-1)[0],/request rejected/);counts2.reset();b.prompt.observe();assert.equal(counts2.calls.length,1);
 assert.throws(()=>createPromptEditor({getTable:()=>({records:null}),editor:{},request(){},notify(){}}),TypeError);
});
