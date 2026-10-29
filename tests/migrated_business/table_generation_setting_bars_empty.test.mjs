import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createTableEditor} from '../../frontend/src/features/table/data_table_editor.mjs';
import {createBusinessDocument} from '../../frontend/src/application/business_document.ts';
import {attachGenerationColumns} from '../../frontend/src/features/generation/table_generation_panel.mjs';
import {LOCAL_IMAGE_MODEL} from '../../frontend/src/features/generation/table_generation_model.mjs';

// Production editor, inline event, document and generation panel with a bounded
// DOM double. Counts prove JS traversal only, not browser layout or latency.
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
  addEventListener(type,fn){const all=this.listeners.get(type)||new Set();all.add(fn);this.listeners.set(type,all);}removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}dispatchEvent(event){const e=event instanceof Event?{type:event.type,detail:event.detail,target:this,bubbles:event.bubbles,preventDefault(){},stopPropagation(){this.stopped=true;}}:event;e.target??=this;for(const fn of [...this.listeners.get(e.type)||[]])fn(e);if(e.bubbles&&!e.stopped)this.parentNode?.dispatchEvent(e);return !e.defaultPrevented;}emit(type,props={}){const e={type,target:this,bubbles:true,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...props};this.dispatchEvent(e);return e;}focus(){document.activeElement=this;this.emit('focus',{bubbles:false});}scrollIntoView(){}hasPointerCapture(){return false;}
 }
 class Range{constructor(){this.collapsed=true;}selectNodeContents(n){this.startContainer=this.endContainer=n;this.startOffset=0;this.endOffset=n.nodeType===3?n.textContent.length:n.childNodes.length;}collapse(start){if(!start)this.startOffset=this.endOffset;this.endOffset=this.startOffset;this.collapsed=true;}cloneRange(){return Object.assign(new Range(),this);}}
 selection={rangeCount:0,anchorNode:null,removeAllRanges(){this.rangeCount=0;},addRange(r){this.range=r;this.rangeCount=1;this.anchorNode=r.startContainer;},getRangeAt(){return this.range;}};
 const doc={activeElement:null,createElement:tag=>new Element(tag),createDocumentFragment:()=>{const fragment=new Element('fragment');fragment.nodeType=11;return fragment;},createTextNode:v=>new Text(v),createRange:()=>new Range(),addEventListener(){},removeEventListener(){},getElementById(id){return [...this.head.children,...this.body.children].find(n=>n.id===id)||null;}};
 const globals={document:doc,window:{addEventListener(){},removeEventListener(){}},Option:class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}},MutationObserver:class{constructor(callback){this.callback=callback;this.records=[];observers.add(this);}observe(root){this.root=root;}disconnect(){observers.delete(this);this.records=[];}},setInterval:()=>1,clearInterval(){},fetch(){throw Error('network not allowed');},ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},getSelection:()=>selection};
 for(const [key,value]of Object.entries(globals)){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}doc.body=new Element('body');doc.head=new Element('head');
 t.after(()=>{for(const fn of cleanups.reverse())fn();for(const [key,value]of saved)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 return {queries,writes,Element,cleanups,flushMutations(){let calls=0;for(const observer of observers){const records=observer.records.splice(0);if(records.length){calls++;observer.callback(records);}}return calls;},reset(){queries.length=0;writes.length=0;for(const observer of observers)observer.records.length=0;},traversal(){return {rows:queries.filter(q=>q.selector==='tr[data-record-id]').reduce((n,q)=>n+q.count,0),cells:queries.filter(q=>q.selector==='td[data-field]'&&q.element.tagName==='TR').reduce((n,q)=>n+q.count,0)};}};
}

const fixture=JSON.parse(readFileSync(new URL('../fixtures/performance/FX-PERF-M-no-video.json',import.meta.url),'utf8'));
function generationField(){return {id:'gen',name:'Image',type:'content',readonly:true,presentation:'generation',generation:{version:1,kind:'image',model:LOCAL_IMAGE_MODEL,promptFieldId:'field-00',mode:'text2image',settings:{width:1024,height:1024,seed:-1}}};}
function harness(t,env,{index=0,small=false,generated=false,material=true,onRefresh=()=>{},onWrite=()=>{}}={}){
 let table=JSON.parse(fixture.nodes.filter(n=>n.type==='DAELAB.Table')[index].widgets_values[0]),stamp=0,prior,countMaps=false,mapRows=0,valueReads=0,refreshes=0,panel;const errors=[],events=[],undo=[];
 if(small){table.fields=table.fields.slice(0,2);table.records=table.records.slice(0,2);for(const row of table.records)row.values=Object.fromEntries(table.fields.map(f=>[f.id,row.values[f.id]]));}
 table.meta.material_columns=material;
 if(generated){table.fields.push(generationField());for(const row of table.records)row.values.gen=[];}
 const history={begin(){events.push('begin');prior=table;},end(){events.push('end');undo.push(prior);},amend(fn){events.push('amend');fn();},undo(){table=undo.pop();stamp++;},redo(){}};
 const editor=createTableEditor({getTable:()=>table,setTable:next=>{panel?.syncPromptChanges(next,table);table=next;stamp++;events.push('write');onWrite(next);},documentFactory:(read,write)=>createBusinessDocument({read,write,current:()=>true,identity:()=>({workflowSession:'test',epoch:0,documentId:'doc-'+index}),history,historyStamp:()=>stamp}),getRowState:()=>({issues:[],hint:''}),isRowStateEmpty:value=>!value.meta.prompt_config,promptColumnsOnly:true,upload(){throw Error('not exercised');},notify:e=>errors.push(e)});
 document.body.append(editor.root);env.cleanups.push(()=>editor.destroy());
 // Count only records.map requested by the real generation panel, not editor
 // normalization/history. Values and native Array.map behavior are unchanged.
 const instrument=value=>new Proxy(value,{get(target,key){if(key!=='records')return Reflect.get(target,key);return new Proxy(target.records,{get(rows,key,receiver){if(key==='map')return (...args)=>{mapRows+=rows.length;return Array.prototype.map.apply(receiver,args);};const row=Reflect.get(rows,key,receiver);if(typeof key!=='string'||!/^\d+$/.test(key)||!row||typeof row!=='object')return row;return new Proxy(row,{get(record,name){if(name!=='values')return Reflect.get(record,name);return new Proxy(record.values,{get(values,id){if(typeof id==='string'&&id.startsWith('field-'))valueReads++;return Reflect.get(values,id);}});}});}});}});
 const getTable=()=>countMaps?instrument(table):table;
 panel=attachGenerationColumns({editor,getTable,notify:e=>errors.push(e),editPromptTemplate(){throw Error('not exercised');},onRefresh(){refreshes++;onRefresh(table);}});
 env.cleanups.push(()=>panel.destroy());
 const target=(rowIndex=0)=>editor.root.querySelectorAll('td[data-field]').find(c=>c.dataset.record===table.records[rowIndex].id&&c.dataset.field==='field-00');
 const header=()=>editor.root.querySelectorAll('th[data-column]').find(h=>h.dataset.column==='field-00');
 function enter(){const cell=target();cell.emit('keydown',{key:'Enter'});return cell.firstChild;}
 function measure(action){mapRows=0;valueReads=0;refreshes=0;events.length=0;env.reset();countMaps=true;try{action();}finally{countMaps=false;}return {mappedRows:mapRows,scannedCells:env.queries.filter(q=>q.element===editor.root&&q.selector==='td[data-field]').reduce((n,q)=>n+q.count,0),refreshes};}
 function input(box,value){box.textContent=value;return measure(()=>box.emit('input'));}
 return {editor,panel,events,errors,target,header,enter,input,measure,instrument,get valueReads(){return valueReads;},get table(){return table;}};
}
const bar=cell=>cell.querySelector('.generation-prompt-settings-list');

test('material tables keep configured headers and frame tags without cell-bottom settings or reserved height',t=>{
 const env=dom(t),a=harness(t,env,{small:true,generated:true}),b=harness(t,env,{index:1,small:true,generated:true});
 const before=JSON.stringify(b.table),gen=a.table.fields.find(f=>f.id==='gen');gen.generation.kind='video';gen.generation.mode='singleImage2video';a.panel.refresh();
 assert.equal(bar(a.target()),null);assert.equal(a.target().dataset.generationSettings,undefined);assert.equal(a.target().style['--generation-settings-height'],undefined);
 assert.ok(a.header().querySelector('.table-prompt-toggle'));assert.ok(a.table.records[0].meta.generationFrameTags.gen);assert.equal(JSON.stringify(b.table),before);
});

test('real 500x10 no-generation input skips the panel row map and full TD scan, preserving owner/history',t=>{
 const env=dom(t),a=harness(t,env),b=harness(t,env,{index:1}),box=a.enter(),peer=JSON.stringify(b.table);a.table.future={unknown:{kept:true}};
 const measured=a.input(box,'changed');
 assert.deepEqual(measured,{mappedRows:0,scannedCells:0,refreshes:1});
 assert.equal(a.table.records[0].values['field-00'],'changed');assert.equal(JSON.stringify(b.table),peer);assert.deepEqual(a.table.future,{unknown:{kept:true}});assert.deepEqual(a.events,['begin','write','end']);assert.deepEqual(a.errors,[]);assert.equal(document.activeElement,box);assert.equal(box.contentEditable,'true');
 a.editor.nativeDocument.undo();assert.notEqual(a.table.records[0].values['field-00'],'changed');
 assert.deepEqual(b.input(b.enter(),'peer changed'),{mappedRows:0,scannedCells:0,refreshes:1});assert.notEqual(a.table.records[0].values['field-00'],'peer changed');
});

test('configured inputs retain full updates; removed configuration cleans bars, markers, styles and prompt headers',t=>{
 const env=dom(t),a=harness(t,env,{small:true,generated:true,material:false}),b=harness(t,env,{index:1,small:true,generated:true,material:false}),cell=a.target(),peerBar=bar(b.target()),box=a.enter();
 assert.ok(bar(cell));assert.ok(a.header().querySelector('.table-prompt-toggle'));assert.equal(cell.dataset.generationSettings,'true');assert.equal(cell.style['--generation-settings-height'],'38px');
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
 const env=dom(t),a=harness(t,env,{small:true,generated:true,material:false}),cell=a.target(),row=cell.parentNode,existing=bar(cell);cell.remove();a.table.fields=a.table.fields.filter(f=>f.id!=='gen');
 a.measure(()=>a.editor.root.emit('input'));assert.equal(bar(cell),existing);
 row.append(cell);a.measure(()=>a.editor.root.emit('input'));assert.equal(bar(cell),null);assert.equal(cell.dataset.generationSettings,undefined);assert.equal(cell.style['--generation-settings-height'],undefined);
});

test('onRefresh stays before field inspection and may enable generation; callback failures remain visible and removed config cleans controls',t=>{
 const env=dom(t);let enable=false,fail=false;const a=harness(t,env,{small:true,material:false,onRefresh:table=>{if(fail)throw Error('refresh rejected');if(enable&&!table.fields.some(f=>f.id==='gen'))table.fields.push(generationField());}}),box=a.enter();
 enable=true;assert.deepEqual(a.input(box,'enable'),{mappedRows:2,scannedCells:4,refreshes:1});assert.ok(bar(a.target()));
 fail=true;assert.throws(()=>a.editor.root.emit('input'),/refresh rejected/);fail=false;
 a.table.fields.find(f=>f.id==='gen').generation=undefined;assert.doesNotThrow(()=>a.editor.root.emit('input'));assert.equal(bar(a.target()),null);
});

test('empty initial tables still clean stale prompt header wrappers and destroy removes the input listener',t=>{
 const env=dom(t),a=harness(t,env,{small:true}),header=a.header(),title=header.querySelector('.field-title'),wrapper=document.createElement('div');wrapper.dataset.generationPromptHeader='true';wrapper.append(title);header.append(wrapper);
 a.measure(()=>a.editor.root.emit('input'));assert.equal(wrapper.isConnected,false);assert.equal(title.parentNode,header);
 a.panel.destroy();assert.deepEqual(a.measure(()=>a.editor.root.emit('input')),{mappedRows:0,scannedCells:0,refreshes:0});
});


// Compile the owning updateSummary expression, rather than reproducing its
// branching in the test. It runs inside the real editor write callback below.
function summaryFactory(){
 const source=readFileSync(new URL('../../frontend/src/integrations/comfyui/business/data_table_nodes.mjs',import.meta.url),'utf8'),syntax=ts.createSourceFile('nodes.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let expression;
 function visit(node){if(ts.isBinaryExpression(node)&&node.left.getText(syntax)==='updateSummary'&&ts.isArrowFunction(node.right))expression=node.right.getText(syntax);ts.forEachChild(node,visit);}visit(syntax);assert.ok(expression);
 return new Function('node','tools','parseButton','mapping','status','isGeneric','selectedTaskSummary','document','button','show','editor',`return (${expression});`);
}
function summaryUI(a,{configured=false}={}){
 const node={type:'DAELAB.Table',__dataTable:a.table},tools=a.editor.selectionActions,parseButton=document.createElement('button'),mapping=document.createElement('button'),status=document.createElement('div'),outer=document.createElement('div');tools.append(parseButton);outer.append(mapping,status);document.body.append(outer);
 const summaries=[];const update=summaryFactory()(node,tools,parseButton,mapping,status,n=>n.type==='DAELAB.Table',table=>{summaries.push(table);return {selected:1,ready:0,invalid:1,issues:[{record:table.records[0].id,field:'field-00'}]};},document,(label,action)=>{const button=document.createElement('button');button.textContent=label;button.onclick=action;return button;},()=>{},a.editor);
 if(configured)a.table.meta.prompt_config={};update();return {node,tools,parseButton,mapping,status,update,summaries,owned:new Set([parseButton,mapping,status])};
}

test('real input plus owning summary creates no same-label childList delivery or no-generation qualification scan',t=>{
 const env=dom(t);let summary;const a=harness(t,env,{onWrite:table=>{if(summary){summary.node.__dataTable=table;summary.update();}}}),b=harness(t,env,{index:1,small:true}),box=a.enter();summary=summaryUI(a);const peer=JSON.stringify(b.table);env.reset();
 // Native typing in an existing plain Text node is characterData. The scoped
 // generation observer listens only for childList; summary setters must not
 // create extra childList work when their actual label is already correct.
 box.firstChild.nodeValue='typed';const result=a.measure(()=>{box.emit('input');env.flushMutations();});
 assert.equal(env.writes.filter(w=>summary.owned.has(w.element)).length,0);
 assert.equal(a.valueReads,0);assert.equal(result.scannedCells,0);assert.equal(a.table.records[0].values['field-00'],'typed');assert.equal(JSON.stringify(b.table),peer);assert.equal(document.activeElement,box);assert.deepEqual(a.errors,[]);
});

test('no-generation refresh and pre-save synchronization avoid qualification reads while preserving unknown data',t=>{
 const env=dom(t),a=harness(t,env),unknown={staleFrames:{keep:true}};a.table.future=unknown;a.table.records[0].meta={generationFrames:{retired:{first:{assetId:'keep'}}}};
 const before=JSON.stringify(a.table);a.measure(()=>a.panel.refresh());const refreshReads=a.valueReads;assert.equal(JSON.stringify(a.table),before);
 a.measure(()=>a.panel.syncPromptChanges(a.instrument(a.table),a.table));const preSaveReads=a.valueReads;assert.equal(JSON.stringify(a.table),before);assert.deepEqual({refreshReads,preSaveReads},{refreshReads:0,preSaveReads:0});
});

test('summary guards still update changed labels/configuration and repair externally changed text; configured issues retain controls',t=>{
 const env=dom(t),a=harness(t,env,{small:true}),summary=summaryUI(a);env.reset();summary.update();assert.equal(env.writes.filter(w=>summary.owned.has(w.element)).length,0);
 a.table.records[0].selected=true;summary.update();assert.equal(summary.parseButton.textContent,'解析选中行 (1)');assert.equal(summary.tools.hidden,false);assert.equal(summary.parseButton.disabled,true);
 summary.parseButton.textContent='external';env.reset();summary.update();assert.equal(summary.parseButton.textContent,'解析选中行 (1)');assert.equal(env.writes.filter(w=>w.element===summary.parseButton).length,1);
 a.table.meta.prompt_config={};summary.update();assert.equal(summary.mapping.textContent,'字段映射');assert.equal(summary.parseButton.disabled,false);assert.equal(summary.summaries.length,1);assert.ok(summary.status.querySelector('button'));
 const previous=summary.status.querySelector('button');summary.update();assert.notEqual(summary.status.querySelector('button'),previous);assert.equal(summary.summaries.length,2);
 delete a.table.meta.prompt_config;summary.update();assert.equal(summary.mapping.textContent,'配置字段映射');assert.equal(summary.status.querySelector('button'),null);
});

test('real configured frame sync remains active, and malformed outer table/field shapes preserve failures',t=>{
 const env=dom(t),a=harness(t,env,{small:true,generated:true,material:false}),gen=a.table.fields.find(f=>f.id==='gen');gen.generation.kind='video';gen.generation.mode='singleImage2video';a.panel.refresh();assert.ok(a.table.records[0].meta?.generationFrameTags?.gen);assert.ok(a.table.records[0].values['field-00'].segments.some(s=>s.type==='frame'));
 const b=harness(t,env,{index:1,small:true});b.table.fields.push(null);assert.doesNotThrow(()=>b.panel.refresh());b.table.fields.pop();const fields=b.table.fields;b.table.fields={};assert.throws(()=>b.panel.refresh(),TypeError);b.table.fields=fields;
 const rows=b.table.records;b.table.records=null;assert.throws(()=>b.panel.refresh(),TypeError);assert.throws(()=>b.panel.syncPromptChanges(b.table,b.table),TypeError);b.table.records=rows;
});
