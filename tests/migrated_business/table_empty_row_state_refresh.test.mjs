import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createTableEditor} from '../../frontend/src/features/table/data_table_editor.mjs';
import {createBusinessDocument} from '../../frontend/src/application/business_document.ts';
import {captureEmptyRowStateScope,matchesEmptyRowStateScope} from '../../frontend/src/features/table/empty_row_state_scope.ts';

// Actual editor/inline input/document code, with a bounded DOM double. Counters
// measure traversals, never browser layout, paint, or performance acceptance.
function dom(t){
 const saved=new Map(),queries=[],cleanups=[];let selection;
 const dataKey=name=>name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
 class Text {constructor(value){this.nodeType=3;this.nodeName='#text';this.nodeValue=String(value);this.parentNode=null;}get textContent(){return this.nodeValue;}set textContent(v){this.nodeValue=String(v);}get parentElement(){return this.parentNode;}}
 class Element {
  constructor(tag){this.nodeType=1;this.tagName=this.nodeName=tag.toUpperCase();this.childNodes=[];this.parentNode=null;this.dataset={};this.attrs=new Map();this.listeners=new Map();this.className='';this.title='';this.contentEditable='inherit';this.scrollLeft=this.scrollTop=0;this.style={setProperty(n,v){this[n]=String(v);},removeProperty(n){delete this[n];}};this.classList={contains:n=>this.className.split(/\s+/).includes(n),add:(...ns)=>ns.forEach(n=>this.classList.toggle(n,true)),remove:(...ns)=>ns.forEach(n=>this.classList.toggle(n,false)),toggle:(n,on)=>{const names=new Set(this.className.split(/\s+/).filter(Boolean));on??=!names.has(n);on?names.add(n):names.delete(n);this.className=[...names].join(' ');return on;}};}
  get parentElement(){return this.parentNode;}get children(){return this.childNodes.filter(n=>n.nodeType===1);}get firstChild(){return this.childNodes[0]??null;}get lastChild(){return this.childNodes.at(-1)??null;}get isConnected(){return this===document.body||this===document.head||!!this.parentNode?.isConnected;}get isContentEditable(){return this.contentEditable==='true';}
  get textContent(){return this.childNodes.map(n=>n.textContent).join('');}set textContent(v){this.replaceChildren(...(v==null||String(v)===''?[]:[new Text(v)]));}
  append(...nodes){for(let n of nodes){if(typeof n==='string')n=new Text(n);n.remove?.();n.parentNode=this;this.childNodes.push(n);}}prepend(...nodes){for(const n of nodes.reverse()){n.parentNode=this;this.childNodes.unshift(n);}}
  replaceChildren(...nodes){for(const n of this.childNodes)n.parentNode=null;this.childNodes=[];this.append(...nodes);}remove(){if(this.parentNode)this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this),1);this.parentNode=null;}
  contains(n){return n===this||this.childNodes.some(c=>c===n||c.contains?.(n));}add(n){this.append(n);}setAttribute(n,v){if(n.startsWith('data-'))this.dataset[dataKey(n)]=String(v);else if(n==='contenteditable')this.contentEditable=String(v);else this.attrs.set(n,String(v));}getAttribute(n){return n.startsWith('data-')?this.dataset[dataKey(n)]??null:n==='contenteditable'?this.contentEditable:this.attrs.get(n)??null;}hasAttribute(n){return this.getAttribute(n)!==null;}removeAttribute(n){if(n.startsWith('data-'))delete this.dataset[dataKey(n)];else this.attrs.delete(n);}
  matches(selector){return selector.split(',').some(part=>{let s=part.trim();const not=[...s.matchAll(/:not\(([^)]+)\)/g)];s=s.replace(/:not\([^)]+\)/g,'');if(not.some(m=>this.matches(m[1])))return false;const tag=s.match(/^[a-z]+/i)?.[0];if(tag&&this.tagName!==tag.toUpperCase())return false;for(const m of s.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(m[1]))return false;for(const m of s.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)){const v=this.getAttribute(m[1]);if(v==null||m[2]!==undefined&&v!==m[2])return false;}return true;});}
  querySelectorAll(selector){const result=[];const walk=node=>{for(const child of node.children){if(child.matches(selector))result.push(child);walk(child);}};walk(this);queries.push({element:this,selector,count:result.length});return result;}querySelector(s){return this.querySelectorAll(s)[0]??null;}closest(s){for(let n=this;n;n=n.parentElement)if(n.matches(s))return n;return null;}
  addEventListener(type,fn){const all=this.listeners.get(type)||new Set();all.add(fn);this.listeners.set(type,all);}removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}dispatchEvent(event){const e=event instanceof Event?{type:event.type,detail:event.detail,target:this,bubbles:event.bubbles,preventDefault(){},stopPropagation(){this.stopped=true;}}:event;e.target??=this;for(const fn of [...this.listeners.get(e.type)||[]])fn(e);if(e.bubbles&&!e.stopped)this.parentNode?.dispatchEvent(e);return !e.defaultPrevented;}emit(type,props={}){const e={type,target:this,bubbles:true,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...props};this.dispatchEvent(e);return e;}focus(){document.activeElement=this;this.emit('focus',{bubbles:false});}scrollIntoView(){}hasPointerCapture(){return false;}
 }
 class Range{constructor(){this.collapsed=true;}selectNodeContents(n){this.startContainer=this.endContainer=n;this.startOffset=0;this.endOffset=n.nodeType===3?n.textContent.length:n.childNodes.length;}collapse(start){if(!start)this.startOffset=this.endOffset;this.endOffset=this.startOffset;this.collapsed=true;}cloneRange(){return Object.assign(new Range(),this);}}
 selection={rangeCount:0,anchorNode:null,removeAllRanges(){this.rangeCount=0;},addRange(r){this.range=r;this.rangeCount=1;this.anchorNode=r.startContainer;},getRangeAt(){return this.range;}};
 const doc={activeElement:null,createElement:tag=>new Element(tag),createTextNode:v=>new Text(v),createRange:()=>new Range(),addEventListener(){},removeEventListener(){},getElementById(id){return [...this.head.children,...this.body.children].find(n=>n.id===id)||null;}};
 const globals={document:doc,window:{addEventListener(){},removeEventListener(){}},Option:class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}},ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},getSelection:()=>selection};
 for(const [key,value]of Object.entries(globals)){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}doc.body=new Element('body');doc.head=new Element('head');
 t.after(()=>{for(const fn of cleanups.reverse())fn();for(const [key,value]of saved)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 return {queries,Element,cleanups,reset(){queries.length=0;},traversal(){return {rows:queries.filter(q=>q.selector==='tr[data-record-id]').reduce((n,q)=>n+q.count,0),cells:queries.filter(q=>q.selector==='td[data-field]'&&q.element.tagName==='TR').reduce((n,q)=>n+q.count,0)};}};
}

const fixture=JSON.parse(readFileSync(new URL('../fixtures/performance/FX-PERF-M-no-video.json',import.meta.url),'utf8'));
function harness(t,env,{index=0,optIn=true,validate=()=>{},state=null,afterWrite=()=>{}}={}){
 let table=JSON.parse(fixture.nodes.filter(n=>n.type==='DAELAB.Table')[index].widgets_values[0]),stamp=0,prior;const errors=[],states=[],events=[],undo=[];
 const getRowState=(value,row)=>{states.push(row.id);return state?state(value,row):{issues:[],hint:''};};
 const history={begin(){events.push('begin');prior=table;},end(){events.push('end');undo.push(prior);},amend(fn){events.push('amend');fn();},undo(){table=undo.pop();stamp++;},redo(){}};
 const editor=createTableEditor({getTable:()=>table,setTable:next=>{table=next;stamp++;events.push('write');afterWrite(table);},documentFactory:(read,write)=>createBusinessDocument({read,write,current:()=>true,identity:()=>({workflowSession:'test',epoch:0,documentId:'doc-'+index}),history,historyStamp:()=>stamp}),getRowState,isRowStateEmpty:optIn?value=>!value.meta.prompt_config:null,validateChange:validate,promptColumnsOnly:true,upload(){throw Error('not exercised');},notify:e=>errors.push(e)});
 document.body.append(editor.root);env.cleanups.push(()=>editor.destroy());
 const target=()=>editor.root.querySelectorAll('td[data-field]').find(c=>c.dataset.record===table.records[0].id&&c.dataset.field===table.fields[0].id);
 function enter(){const cell=target();cell.emit('keydown',{key:'Enter'});return cell.firstChild;}
 function input(box,value){box.textContent=value;states.length=0;events.length=0;env.reset();box.emit('input');return env.traversal();}
 return {editor,states,events,errors,enter,input,get table(){return table;},replace(next){table=next;},get undo(){return undo;}};
}

test('real 500x10 Enter/input refreshes only its known-empty row and preserves the peer/history',t=>{
 const env=dom(t),a=harness(t,env),b=harness(t,env,{index:1}),box=a.enter(),peer=JSON.stringify(b.table),unknown=JSON.parse('{"__proto__":{"preserved":true}}');a.table.future=unknown;
 const result=a.input(box,'changed');
 assert.deepEqual(result,{rows:0,cells:10});assert.deepEqual(a.states,[a.table.records[0].id]);assert.equal(a.table.records[0].values['field-00'],'changed');assert.equal(JSON.stringify(b.table),peer);assert.equal(a.table.future.__proto__.preserved,true);assert.deepEqual(a.events,['begin','write','end']);assert.deepEqual(a.errors,[]);assert.equal(box.contentEditable,'true');assert.equal(document.activeElement,box);
 a.editor.nativeDocument.undo();assert.notEqual(a.table.records[0].values['field-00'],'changed');
});

test('unknown/global-dependent callback retains every row in original order and updates other-row issues',t=>{
 const env=dom(t),a=harness(t,env,{optIn:false,state:(table,row)=>({issues:table.records[0].values['field-00']==='bad'&&row===table.records[1]?[{field:'field-00',message:'cross-row'}]:[],hint:''})}),box=a.enter();
 assert.deepEqual(a.input(box,'bad'),{rows:500,cells:5000});assert.deepEqual(a.states,a.table.records.map(r=>r.id));const other=a.editor.root.querySelectorAll('td[data-field]').find(c=>c.dataset.record===a.table.records[1].id&&c.dataset.field==='field-00');assert.equal(other.title,'cross-row');assert.equal(other.dataset.invalid,'true');
});

test('configuration/structure changes made by validation or write callbacks force full refresh',t=>{
 const env=dom(t);
 for(const mutation of [t=>{t.meta.prompt_config={enabled:true};},t=>{t.fields[1].name='changed';},t=>{t.records.reverse();}]){
  const a=harness(t,env,{validate:(_,next)=>mutation(next)}),box=a.enter();assert.deepEqual(a.input(box,'changed'),{rows:500,cells:5000});assert.equal(a.states.length,500);
 }
 const a=harness(t,env,{afterWrite:t=>{t.meta.prompt_config={late:true};}}),box=a.enter();assert.deepEqual(a.input(box,'changed'),{rows:500,cells:5000});
});

test('public change, derived/ticket results, full render and replaced DOM use full refresh',t=>{
 const env=dom(t),a=harness(t,env);a.enter();
 for(const settings of [{render:false},{render:false,derived:true}]){env.reset();a.editor.change(table=>{table.records[0].values['field-00']='direct';},settings);assert.deepEqual(env.traversal(),{rows:500,cells:5000});}
 const ticket=a.editor.beginAsync();env.reset();a.editor.applyAsync(ticket,table=>{table.records[0].values['field-00']='async';},{render:false});assert.deepEqual(env.traversal(),{rows:500,cells:5000});
 env.reset();a.editor.render();assert.equal(env.traversal().cells,5000);
 const box=a.enter(),cell=box.parentElement,row=cell.parentElement;row.dataset.recordId='external-replaced-identity';assert.deepEqual(a.input(box,'changed'),{rows:500,cells:4990});
});

test('validation/write failures keep rollback and error behavior with no scoped refresh',t=>{
 const env=dom(t),a=harness(t,env,{validate:()=>{throw Error('validation denied');}}),box=a.enter(),before=JSON.stringify(a.table);assert.deepEqual(a.input(box,'changed'),{rows:0,cells:0});assert.equal(JSON.stringify(a.table),before);assert.deepEqual(a.errors,['validation denied']);assert.equal(box.getAttribute('aria-invalid'),'true');
 const b=harness(t,env,{index:1,afterWrite:table=>{if(table.records[0].values['field-00']==='changed')throw Error('write denied');}}),other=b.enter(),prior=JSON.stringify(b.table);assert.deepEqual(b.input(other,'changed'),{rows:0,cells:0});assert.equal(JSON.stringify(b.table),prior);assert.deepEqual(b.errors,['write denied']);
});

test('afterWrite observers changing configuration or replacing DOM invalidate the pending row scope',t=>{
 const env=dom(t),a=harness(t,env),box=a.enter();a.editor.onTableChange(()=>{a.table.meta.prompt_config={lateObserver:true};});assert.deepEqual(a.input(box,'changed'),{rows:500,cells:5000});
 const b=harness(t,env,{index:1}),other=b.enter();b.editor.onTableChange(()=>b.editor.render());const result=b.input(other,'changed');assert.equal(result.rows,1000);assert.equal(result.cells,10000);assert.equal(other.isConnected,false);
});

test('structure proof never reads cell values and only accepts unchanged metadata/ordered identities',()=>{
 const table={view:'table',fields:[{id:'field'}],meta:{future:{kept:true}},records:[{id:'row',get values(){throw Error('must not read cell values');}}]},empty=()=>true;
 const scope=captureEmptyRowStateScope(table,table,'row',empty);assert.ok(scope);assert.equal(matchesEmptyRowStateScope(scope,table,empty),true);assert.equal(matchesEmptyRowStateScope(scope,table,()=>false),false);
 for(const changed of [{...table,meta:{future:{kept:false}}},{...table,fields:[{id:'changed'}]},{...table,records:[{id:'new'}]},{...table,view:'cards'}])assert.equal(matchesEmptyRowStateScope(scope,changed,empty),false);
 assert.equal(captureEmptyRowStateScope({...table,records:[{id:'row'},{id:'row'}]},table,'row',empty),null);
});

test('actual built-in provider opts in only for generic tables in its constant empty-state branch',()=>{
 const source=readFileSync(new URL('../../frontend/src/integrations/comfyui/business/data_table_nodes.mjs',import.meta.url),'utf8'),syntax=ts.createSourceFile('data_table_nodes.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let owner;
 function visit(node){if(ts.isObjectLiteralExpression(node)&&node.properties.some(p=>p.name?.getText(syntax)==='isRowStateEmpty')&&node.properties.some(p=>p.name?.getText(syntax)==='getRowState'))owner=node;ts.forEachChild(node,visit);}visit(syntax);assert.ok(owner);
 const expression=name=>owner.properties.find(p=>p.name?.getText(syntax)===name).initializer.getText(syntax),node={type:'DAELAB.Table'},calls=[];
 const provider=new Function('node','isGeneric','storyboardTaskState',`return {empty:${expression('isRowStateEmpty')},state:${expression('getRowState')}};`)(node,node=>node.type==='DAELAB.Table',(...args)=>{calls.push(args);return {issues:[{field:'x',message:'configured'}],hint:'configured'};});
 const table={meta:{}},row={id:'r'};assert.equal(provider.empty(table),true);assert.deepEqual(provider.state(table,row),{issues:[],hint:''});assert.equal(calls.length,0);
 table.meta.prompt_config={};assert.equal(provider.empty(table),false);assert.equal(provider.state(table,row).hint,'configured');assert.equal(calls.length,1);
 delete table.meta.prompt_config;node.type='DAELAB.StoryboardImport';assert.equal(provider.empty(table),false);provider.state(table,row);assert.equal(calls.length,2);
});
