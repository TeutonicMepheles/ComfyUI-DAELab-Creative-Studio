import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installContentPresentation} from '../../frontend/src/features/table/table_context_menu.mjs';
import {attachCellSelection} from '../../frontend/src/features/table/table_cell_selection.mjs';

// Run the real menu and selection controllers. This DOM double counts selection
// attribute mutations; it makes no browser layout, paint or latency claim.
function dom(t){
 const writes=[],timers=new Set(),microtasks=[],contexts=new Map(),listeners=new Map(),releases=[];
 const key=name=>name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
 class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.attrs=new Map();this.className='';this.style={};this.hidden=false;this.parentElement=null;
   this.dataset=new Proxy({}, {set:(target,name,value)=>{if(name==='columnSelected')writes.push({element:this,from:target[name],to:String(value)});target[name]=String(value);return true;},deleteProperty:(target,name)=>{if(name==='columnSelected'&&name in target)writes.push({element:this,from:target[name],to:undefined});delete target[name];return true;}});
  }
  get isConnected(){return this===document.body||!!this.parentElement?.isConnected;}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}add(node){this.append(node);}
  replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this.append(...nodes);}
  remove(){if(this.parentElement)this.parentElement.children.splice(this.parentElement.children.indexOf(this),1);this.parentElement=null;}
  setAttribute(name,value){if(name.startsWith('data-'))this.dataset[key(name)]=value;else this.attrs.set(name,String(value));}
  getAttribute(name){return name.startsWith('data-')?this.dataset[key(name)]??null:this.attrs.get(name)??null;}
  removeAttribute(name){if(name.startsWith('data-'))delete this.dataset[key(name)];else this.attrs.delete(name);}
  matches(selector){return selector.split(',').some(part=>{const s=part.trim(),tag=s.match(/^[a-z]+/i)?.[0];if(tag&&this.tagName!==tag.toUpperCase())return false;for(const m of s.matchAll(/\.([\w-]+)/g))if(!this.className.split(/\s+/).includes(m[1]))return false;for(const m of s.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)){const value=this.getAttribute(m[1]);if(value==null||m[2]!==undefined&&value!==m[2])return false;}return true;});}
  querySelectorAll(selector){const found=[];for(const child of this.children){if(child.matches(selector))found.push(child);found.push(...child.querySelectorAll(selector));}return found;}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  getBoundingClientRect(){return {left:100,top:100,right:500,bottom:200,width:400,height:100};}
  hasPointerCapture(){return false;}
 }
 const document={body:null,documentElement:{clientWidth:1200,clientHeight:800},createElement:tag=>new Element(tag),addEventListener(type,fn){const set=listeners.get(type)??new Set();set.add(fn);listeners.set(type,set);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);}};
 const globals={document,window:new EventTarget(),addEventListener(){},removeEventListener(){},CSS:{escape:value=>String(value)},Option:class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}},setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn),queueMicrotask:fn=>microtasks.push(fn)};
 const before=new Map();for(const [name,value]of Object.entries(globals)){before.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});}
 const api=Symbol.for('DAELAB.CreativeCanvas.API.v1'),prior=globalThis[api];globalThis[api]={getPanelContext:root=>contexts.get(root)};document.body=new Element('body');
 t.after(()=>{for(const release of releases.reverse())release();for(const [name,value]of before)value?Object.defineProperty(globalThis,name,value):delete globalThis[name];if(prior===undefined)delete globalThis[api];else globalThis[api]=prior;});
 return {Element,writes,contexts,releases,tick(){for(const fn of timers)fn();},flush(){while(microtasks.length)microtasks.shift()();},emit(type,target,more={}){const event={type,target,preventDefault(){},stopPropagation(){},...more};for(const fn of [...listeners.get(type)??[]])fn(event);},reset(){writes.length=0;}};
}

const fixture=JSON.parse(readFileSync(new URL('../fixtures/performance/FX-PERF-M-no-video.json',import.meta.url),'utf8'));
function table(env,index){
 const value=JSON.parse(fixture.nodes.filter(node=>node.type==='DAELAB.Table')[index].widgets_values[0]);
 const root=new env.Element('section'),grid=new env.Element('table'),head=new env.Element('thead'),body=new env.Element('tbody');root.append(grid);grid.append(head,body);document.body.append(root);
 const headers=value.fields.map(field=>{const th=new env.Element('th');th.dataset.column=field.id;head.append(th);return th;});
 const cells=[];for(const record of value.records){const row=new env.Element('tr');row.dataset.recordId=record.id;body.append(row);for(const field of value.fields){const cell=new env.Element('td');cell.dataset.field=field.id;cell.dataset.record=record.id;row.append(cell);cells.push(cell);}}
 const selection=attachCellSelection({root,shell:root,getTable:()=>value});
 const context={presentation:'content',selected:true,contains:node=>root.contains(node),getViewport:()=>({left:0,top:0,right:1200,bottom:800,width:1200}),getBounds:()=>root.getBoundingClientRect()};env.contexts.set(root,context);
 const editor={clearSelection:selection.clear,selectColumn:selection.selectColumn,selection:selection.selection,render(){}};
 const presentation=installContentPresentation({root,editor,getTable:()=>value});env.releases.push(()=>{presentation.destroy();selection.destroy();});
 const toolbar=document.body.children.at(-1);env.tick();
 return {root,headers,cells,selection,toolbar,value,context,presentation,enter(cell=cells[0]){cell.dataset.inlineEditing='true';env.emit('focusin',cell);},leave(cell=cells[0]){delete cell.dataset.inlineEditing;},selectColumn(index){env.emit('pointerdown',headers[index]);env.flush();}};
}

test('500x10 unselected cells enter editing without clearing false markers, including repeated entry and a peer',t=>{
 const env=dom(t),a=table(env,0),b=table(env,1),before=JSON.stringify([a.value,b.value]);
 assert.equal(a.cells.length,5000);assert.equal(a.root.querySelectorAll('[data-column-selected=false]').length,5010);
 env.reset();a.enter();env.flush();
 assert.equal(env.writes.length,0,'unselected markers must not be rewritten when entering editing');
 assert.equal(a.toolbar.hidden,true);assert.equal(a.selection.selection().length,0);assert.equal(b.root.querySelectorAll('[data-column-selected=false]').length,5010);
 a.leave();env.reset();a.enter();env.flush();assert.equal(env.writes.length,0);
 b.enter();env.flush();assert.equal(env.writes.length,0);assert.equal(JSON.stringify([a.value,b.value]),before);
});

test('entering from a selected column clears only that column and leaves the other table selected',t=>{
 const env=dom(t),a=table(env,0),b=table(env,1);a.selectColumn(2);b.selectColumn(4);
 // Selecting a peer through a pointer is an intentional outside-click clear;
 // reselect A then select B by focus to keep independent per-instance state.
 a.selectColumn(2);env.emit('focusin',b.headers[4]);env.flush();
 assert.equal(a.root.querySelectorAll('[data-column-selected=true]').length,501);assert.equal(b.root.querySelectorAll('[data-column-selected=true]').length,501);
 assert.equal(a.selection.selection().flat().length,500);assert.equal(b.selection.selection().flat().length,500);
 env.reset();a.enter(a.cells[2]);
 assert.equal(a.root.querySelectorAll('[data-column-selected=true]').length,0);assert.equal(a.selection.selection().length,0);
 assert.equal(env.writes.length,501);assert.ok(env.writes.every(write=>write.from==='true'&&a.root.contains(write.element)),'only selected column markers are cleared');
 env.flush();assert.equal(a.headers[2].getAttribute('aria-selected'),'false');assert.equal(a.toolbar.hidden,true);
 assert.equal(b.root.querySelectorAll('[data-column-selected=true]').length,501);assert.equal(b.selection.selection().flat().length,500);
 a.leave(a.cells[2]);env.reset();a.enter(a.cells[2]);env.flush();assert.equal(env.writes.length,0);
});

test('Escape cancels a column selection, permits reselection, and the next edit has no false-marker writes',t=>{
 const env=dom(t),a=table(env,0);a.selectColumn(1);assert.equal(a.selection.selection().flat().length,500);
 env.emit('keydown',a.headers[1],{key:'Escape',isComposing:false});env.flush();
 assert.equal(a.selection.selection().length,0);assert.equal(a.root.querySelectorAll('[data-column-selected=true]').length,0);assert.equal(a.toolbar.hidden,true);
 a.selectColumn(8);assert.equal(a.root.querySelectorAll('[data-column-selected=true]').length,501);
 env.emit('keydown',a.headers[8],{key:'Escape',isComposing:false});env.flush();
 env.reset();a.enter();env.flush();assert.equal(env.writes.length,0);assert.equal(a.headers[8].getAttribute('aria-selected'),'false');
});
