import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTableEditor} from '../../frontend/src/features/table/data_table_editor.mjs';
import {createBusinessDocument} from '../../frontend/src/application/business_document.ts';
import {attachGenerationColumns} from '../../frontend/src/features/generation/table_generation_panel.mjs';
import {LOCAL_IMAGE_MODEL} from '../../frontend/src/features/generation/table_generation_model.mjs';

// Production editor, inline event, document and generation panel with a bounded
// DOM double. Counts prove JS traversal only, not browser layout or latency.
function dom(t){
 const saved=new Map(),queries=[],cleanups=[];let selection;
 const dataKey=name=>name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
 class Text {constructor(value){this.nodeType=3;this.nodeName='#text';this.nodeValue=String(value);this.parentNode=null;}get textContent(){return this.nodeValue;}set textContent(v){this.nodeValue=String(v);}get parentElement(){return this.parentNode;}}
 class Element {
  constructor(tag){this.nodeType=1;this.tagName=this.nodeName=tag.toUpperCase();this.childNodes=[];this.parentNode=null;this.dataset={};this.attrs=new Map();this.listeners=new Map();this.className='';this.title='';this.contentEditable='inherit';this.scrollLeft=this.scrollTop=0;this.style={setProperty(n,v){this[n]=String(v);},removeProperty(n){delete this[n];}};this.classList={contains:n=>this.className.split(/\s+/).includes(n),add:(...ns)=>ns.forEach(n=>this.classList.toggle(n,true)),remove:(...ns)=>ns.forEach(n=>this.classList.toggle(n,false)),toggle:(n,on)=>{const names=new Set(this.className.split(/\s+/).filter(Boolean));on??=!names.has(n);on?names.add(n):names.delete(n);this.className=[...names].join(' ');return on;}};}
  get parentElement(){return this.parentNode;}get children(){return this.childNodes.filter(n=>n.nodeType===1);}get firstChild(){return this.childNodes[0]??null;}get firstElementChild(){return this.children[0]??null;}get lastChild(){return this.childNodes.at(-1)??null;}get isConnected(){return this===document.body||this===document.head||!!this.parentNode?.isConnected;}get isContentEditable(){return this.contentEditable==='true';}
  get textContent(){return this.childNodes.map(n=>n.textContent).join('');}set textContent(v){this.replaceChildren(...(v==null||String(v)===''?[]:[new Text(v)]));}
  append(...nodes){for(let n of nodes){if(typeof n==='string')n=new Text(n);n.remove?.();n.parentNode=this;this.childNodes.push(n);}}prepend(...nodes){for(const n of nodes.reverse()){n.parentNode=this;this.childNodes.unshift(n);}}
  insertBefore(node,before){node.remove?.();node.parentNode=this;const index=this.childNodes.indexOf(before);this.childNodes.splice(index<0?this.childNodes.length:index,0,node);return node;}
  replaceChildren(...nodes){for(const n of this.childNodes)n.parentNode=null;this.childNodes=[];this.append(...nodes);}remove(){if(this.parentNode)this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this),1);this.parentNode=null;}
  contains(n){return n===this||this.childNodes.some(c=>c===n||c.contains?.(n));}add(n){this.append(n);}setAttribute(n,v){if(n.startsWith('data-'))this.dataset[dataKey(n)]=String(v);else if(n==='contenteditable')this.contentEditable=String(v);else this.attrs.set(n,String(v));}getAttribute(n){return n.startsWith('data-')?this.dataset[dataKey(n)]??null:n==='contenteditable'?this.contentEditable:this.attrs.get(n)??null;}hasAttribute(n){return this.getAttribute(n)!==null;}removeAttribute(n){if(n.startsWith('data-'))delete this.dataset[dataKey(n)];else this.attrs.delete(n);}
  matches(selector){return selector.split(',').some(part=>{let s=part.trim();const not=[...s.matchAll(/:not\(([^)]+)\)/g)];s=s.replace(/:not\([^)]+\)/g,'');if(not.some(m=>this.matches(m[1])))return false;const tag=s.match(/^[a-z]+/i)?.[0];if(tag&&this.tagName!==tag.toUpperCase())return false;for(const m of s.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(m[1]))return false;for(const m of s.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)){const v=this.getAttribute(m[1]);if(v==null||m[2]!==undefined&&v!==m[2])return false;}return true;});}
  querySelectorAll(selector){const result=[];const walk=node=>{for(const child of node.children){if(child.matches(selector))result.push(child);walk(child);}};walk(this);queries.push({element:this,selector,count:result.length});return result;}querySelector(s){return this.querySelectorAll(s)[0]??null;}closest(s){for(let n=this;n;n=n.parentElement)if(n.matches(s))return n;return null;}
  addEventListener(type,fn){const all=this.listeners.get(type)||new Set();all.add(fn);this.listeners.set(type,all);}removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}dispatchEvent(event){const e=event instanceof Event?{type:event.type,detail:event.detail,target:this,bubbles:event.bubbles,preventDefault(){},stopPropagation(){this.stopped=true;}}:event;e.target??=this;for(const fn of [...this.listeners.get(e.type)||[]])fn(e);if(e.bubbles&&!e.stopped)this.parentNode?.dispatchEvent(e);return !e.defaultPrevented;}emit(type,props={}){const e={type,target:this,bubbles:true,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...props};this.dispatchEvent(e);return e;}focus(){document.activeElement=this;this.emit('focus',{bubbles:false});}scrollIntoView(){}hasPointerCapture(){return false;}
 }
 class Range{constructor(){this.collapsed=true;}selectNodeContents(n){this.startContainer=this.endContainer=n;this.startOffset=0;this.endOffset=n.nodeType===3?n.textContent.length:n.childNodes.length;}collapse(start){if(!start)this.startOffset=this.endOffset;this.endOffset=this.startOffset;this.collapsed=true;}cloneRange(){return Object.assign(new Range(),this);}}
 selection={rangeCount:0,anchorNode:null,removeAllRanges(){this.rangeCount=0;},addRange(r){this.range=r;this.rangeCount=1;this.anchorNode=r.startContainer;},getRangeAt(){return this.range;}};
 const doc={activeElement:null,createElement:tag=>new Element(tag),createTextNode:v=>new Text(v),createRange:()=>new Range(),addEventListener(){},removeEventListener(){},getElementById(id){return [...this.head.children,...this.body.children].find(n=>n.id===id)||null;}};
 const globals={document:doc,window:{addEventListener(){},removeEventListener(){}},Option:class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}},MutationObserver:class{constructor(callback){this.callback=callback;}observe(){}disconnect(){}},setInterval:()=>1,clearInterval(){},fetch(){throw Error('network not allowed');},ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},getSelection:()=>selection};
 for(const [key,value]of Object.entries(globals)){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}doc.body=new Element('body');doc.head=new Element('head');
 t.after(()=>{for(const fn of cleanups.reverse())fn();for(const [key,value]of saved)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 return {queries,Element,cleanups,reset(){queries.length=0;},traversal(){return {rows:queries.filter(q=>q.selector==='tr[data-record-id]').reduce((n,q)=>n+q.count,0),cells:queries.filter(q=>q.selector==='td[data-field]'&&q.element.tagName==='TR').reduce((n,q)=>n+q.count,0)};}};
}

const fixture=JSON.parse(readFileSync(new URL('../fixtures/performance/FX-PERF-M-no-video.json',import.meta.url),'utf8'));
function generationField(){return {id:'gen',name:'Image',type:'content',readonly:true,presentation:'generation',generation:{version:1,kind:'image',model:LOCAL_IMAGE_MODEL,promptFieldId:'field-00',mode:'text2image',settings:{width:1024,height:1024,seed:-1}}};}
function harness(t,env,{index=0,small=false,generated=false,onRefresh=()=>{}}={}){
 let table=JSON.parse(fixture.nodes.filter(n=>n.type==='DAELAB.Table')[index].widgets_values[0]),stamp=0,prior,countMaps=false,mapRows=0,refreshes=0;const errors=[],events=[],undo=[];
 if(small){table.fields=table.fields.slice(0,2);table.records=table.records.slice(0,2);for(const row of table.records)row.values=Object.fromEntries(table.fields.map(f=>[f.id,row.values[f.id]]));}
 if(generated){table.fields.push(generationField());for(const row of table.records)row.values.gen=[];}
 const history={begin(){events.push('begin');prior=table;},end(){events.push('end');undo.push(prior);},amend(fn){events.push('amend');fn();},undo(){table=undo.pop();stamp++;},redo(){}};
 const editor=createTableEditor({getTable:()=>table,setTable:next=>{table=next;stamp++;events.push('write');},documentFactory:(read,write)=>createBusinessDocument({read,write,current:()=>true,identity:()=>({workflowSession:'test',epoch:0,documentId:'doc-'+index}),history,historyStamp:()=>stamp}),getRowState:()=>({issues:[],hint:''}),isRowStateEmpty:value=>!value.meta.prompt_config,promptColumnsOnly:true,upload(){throw Error('not exercised');},notify:e=>errors.push(e)});
 document.body.append(editor.root);env.cleanups.push(()=>editor.destroy());
 // Count only records.map requested by the real generation panel, not editor
 // normalization/history. Values and native Array.map behavior are unchanged.
 const getTable=()=>countMaps?new Proxy(table,{get(target,key){if(key!=='records')return Reflect.get(target,key);return new Proxy(target.records,{get(rows,key){if(key!=='map')return Reflect.get(rows,key);return (...args)=>{mapRows+=rows.length;return Array.prototype.map.apply(rows,args);};}});}}):table;
 const panel=attachGenerationColumns({editor,getTable,notify:e=>errors.push(e),editPromptTemplate(){throw Error('not exercised');},onRefresh(){refreshes++;onRefresh(table);}});
 env.cleanups.push(()=>panel.destroy());
 const target=(rowIndex=0)=>editor.root.querySelectorAll('td[data-field]').find(c=>c.dataset.record===table.records[rowIndex].id&&c.dataset.field==='field-00');
 const header=()=>editor.root.querySelectorAll('th[data-column]').find(h=>h.dataset.column==='field-00');
 function enter(){const cell=target();cell.emit('keydown',{key:'Enter'});return cell.firstChild;}
 function measure(action){mapRows=0;refreshes=0;events.length=0;env.reset();countMaps=true;try{action();}finally{countMaps=false;}return {mappedRows:mapRows,scannedCells:env.queries.filter(q=>q.element===editor.root&&q.selector==='td[data-field]').reduce((n,q)=>n+q.count,0),refreshes};}
 function input(box,value){box.textContent=value;return measure(()=>box.emit('input'));}
 return {editor,panel,events,errors,target,header,enter,input,measure,get table(){return table;}};
}
const bar=cell=>cell.querySelector('.generation-prompt-settings-list');

test('real 500x10 no-generation input skips the panel row map and full TD scan, preserving owner/history',t=>{
 const env=dom(t),a=harness(t,env),b=harness(t,env,{index:1}),box=a.enter(),peer=JSON.stringify(b.table);a.table.future={unknown:{kept:true}};
 const measured=a.input(box,'changed');
 assert.deepEqual(measured,{mappedRows:0,scannedCells:0,refreshes:1});
 assert.equal(a.table.records[0].values['field-00'],'changed');assert.equal(JSON.stringify(b.table),peer);assert.deepEqual(a.table.future,{unknown:{kept:true}});assert.deepEqual(a.events,['begin','write','end']);assert.deepEqual(a.errors,[]);assert.equal(document.activeElement,box);assert.equal(box.contentEditable,'true');
 a.editor.nativeDocument.undo();assert.notEqual(a.table.records[0].values['field-00'],'changed');
 assert.deepEqual(b.input(b.enter(),'peer changed'),{mappedRows:0,scannedCells:0,refreshes:1});assert.notEqual(a.table.records[0].values['field-00'],'peer changed');
});

test('configured inputs retain full updates; removed configuration cleans bars, markers, styles and prompt headers',t=>{
 const env=dom(t),a=harness(t,env,{small:true,generated:true}),b=harness(t,env,{index:1,small:true,generated:true}),cell=a.target(),peerBar=bar(b.target()),box=a.enter();
 assert.ok(bar(cell));assert.ok(a.header().querySelector('[data-generation-prompt-header]'));assert.equal(cell.dataset.generationSettings,'true');assert.equal(cell.style['--generation-settings-height'],'38px');
 a.table.records[0].meta??={};a.table.records[0].meta.generationSettings={'field-00':{gen:{...generationField().generation,settings:{width:512,height:512}}}};
 assert.deepEqual(a.input(box,'configured'),{mappedRows:2,scannedCells:6,refreshes:1});assert.match(bar(cell).textContent,/512/);assert.doesNotMatch(peerBar.textContent,/512/);
 a.table.fields=a.table.fields.filter(f=>f.id!=='gen');a.measure(()=>a.editor.root.emit('input'));
 assert.equal(bar(cell),null);assert.equal(cell.dataset.generationSettings,undefined);assert.equal(cell.style['--generation-settings-height'],undefined);assert.equal(a.header().querySelector('[data-generation-prompt-header]'),null);assert.ok(a.header().querySelector('.field-title'));assert.equal(bar(b.target()),peerBar);
 // A formerly configured instance conservatively keeps its original scan; it
 // may still have WeakMap-owned cells temporarily detached by a render.
 assert.deepEqual(a.measure(()=>a.editor.root.emit('input')),{mappedRows:2,scannedCells:6,refreshes:1});
 a.table.fields.push(generationField());a.measure(()=>a.editor.root.emit('input'));assert.ok(bar(cell));assert.match(bar(cell).textContent,/512/);
});

test('a detached old cell reinserted after configuration removal still receives original WeakMap cleanup',t=>{
 const env=dom(t),a=harness(t,env,{small:true,generated:true}),cell=a.target(),row=cell.parentNode,existing=bar(cell);cell.remove();a.table.fields=a.table.fields.filter(f=>f.id!=='gen');
 a.measure(()=>a.editor.root.emit('input'));assert.equal(bar(cell),existing);
 row.append(cell);a.measure(()=>a.editor.root.emit('input'));assert.equal(bar(cell),null);assert.equal(cell.dataset.generationSettings,undefined);assert.equal(cell.style['--generation-settings-height'],undefined);
});

test('onRefresh stays before field inspection and may enable generation; callback/config failures remain visible',t=>{
 const env=dom(t);let enable=false,fail=false;const a=harness(t,env,{small:true,onRefresh:table=>{if(fail)throw Error('refresh rejected');if(enable&&!table.fields.some(f=>f.id==='gen'))table.fields.push(generationField());}}),box=a.enter();
 enable=true;assert.deepEqual(a.input(box,'enable'),{mappedRows:2,scannedCells:4,refreshes:1});assert.ok(bar(a.target()));
 fail=true;assert.throws(()=>a.editor.root.emit('input'),/refresh rejected/);fail=false;
 a.table.fields.find(f=>f.id==='gen').generation=undefined;assert.throws(()=>a.editor.root.emit('input'),TypeError);
});

test('empty initial tables still clean stale prompt header wrappers and destroy removes the input listener',t=>{
 const env=dom(t),a=harness(t,env,{small:true}),header=a.header(),title=header.querySelector('.field-title'),wrapper=document.createElement('div');wrapper.dataset.generationPromptHeader='true';wrapper.append(title);header.append(wrapper);
 a.measure(()=>a.editor.root.emit('input'));assert.equal(wrapper.isConnected,false);assert.equal(title.parentNode,header);
 a.panel.destroy();assert.deepEqual(a.measure(()=>a.editor.root.emit('input')),{mappedRows:0,scannedCells:0,refreshes:0});
});
