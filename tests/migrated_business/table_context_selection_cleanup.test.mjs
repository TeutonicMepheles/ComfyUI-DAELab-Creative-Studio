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
  constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.attrs=new Map();this.className='';this.style={setProperty(name,value){this[name]=value;}};this.hidden=false;this.parentElement=null;this.elementListeners=new Map();
   this.dataset=new Proxy({}, {set:(target,name,value)=>{if(name==='columnSelected')writes.push({element:this,from:target[name],to:String(value)});target[name]=String(value);return true;},deleteProperty:(target,name)=>{if(name==='columnSelected'&&name in target)writes.push({element:this,from:target[name],to:undefined});delete target[name];return true;}});
   const owner=this;this.classList={add(...names){const values=new Set(owner.className.split(/\s+/).filter(Boolean));names.forEach(name=>values.add(name));owner.className=[...values].join(' ');},remove(...names){const removed=new Set(names);owner.className=owner.className.split(/\s+/).filter(name=>name&&!removed.has(name)).join(' ');},contains:name=>owner.className.split(/\s+/).includes(name)};
  }
  addEventListener(type,fn){const set=this.elementListeners.get(type)??new Set();set.add(fn);this.elementListeners.set(type,set);}
  removeEventListener(type,fn){this.elementListeners.get(type)?.delete(fn);}
  fire(type,more={}){const event={type,target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...more};for(const fn of [...this.elementListeners.get(type)??[]])fn(event);return event;}
  focus(){document.activeElement=this;}
  get isConnected(){return this===document.body||!!this.parentElement?.isConnected;}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}add(node){this.append(node);}
  prepend(...nodes){for(const node of nodes)node.parentElement=this;this.children.unshift(...nodes);}
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
 return {Element,writes,contexts,releases,tick(){for(const fn of timers)fn();},flush(){while(microtasks.length)microtasks.shift()();},emit(type,target,more={}){const event={type,target,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...more};for(const fn of [...listeners.get(type)??[]])fn(event);return event;},reset(){writes.length=0;}};
}

const fixture=JSON.parse(readFileSync(new URL('../fixtures/performance/FX-PERF-M-no-video.json',import.meta.url),'utf8'));
test('panel activity avoids geometry reads while idle or editing and follows deactivation',t=>{
 const env=dom(t),a=table(env,0),b=table(env,1);
 a.context.active=true;b.context.active=true;
 a.context.getViewport=b.context.getViewport=()=>{throw new Error('unexpected layout read');};
 env.tick();a.enter();env.flush();env.tick();
 assert.equal(a.toolbar.hidden,true);assert.equal(b.root.dataset.contentPresentation,'true');
 a.context.active=false;env.tick();
 assert.equal(a.root.dataset.contentPresentation,'false');
 assert.equal(b.root.dataset.contentPresentation,'true');
 a.context.active=true;env.tick();assert.equal(a.root.dataset.contentPresentation,'true');
});
function table(env,index,options={}){
 const value=JSON.parse(fixture.nodes.filter(node=>node.type==='DAELAB.Table')[index].widgets_values[0]);
 const root=new env.Element('section'),grid=new env.Element('table'),head=new env.Element('thead'),body=new env.Element('tbody');root.append(grid);grid.append(head,body);document.body.append(root);
 const headers=value.fields.map(field=>{const th=new env.Element('th');th.dataset.column=field.id;head.append(th);return th;});
 const cells=[];for(const record of value.records){const row=new env.Element('tr');row.dataset.recordId=record.id;body.append(row);for(const field of value.fields){const cell=new env.Element('td');cell.dataset.field=field.id;cell.dataset.record=record.id;row.append(cell);cells.push(cell);}}
 const selection=attachCellSelection({root,shell:root,getTable:()=>value});
 const context={presentation:'content',selected:true,contains:node=>root.contains(node),getViewport:()=>({left:0,top:0,right:1200,bottom:800,width:1200}),getBounds:()=>root.getBoundingClientRect()};env.contexts.set(root,context);
 const editor={panelContext:()=>env.contexts.get(root),clearSelection:selection.clear,selectColumn:selection.selectColumn,selection:selection.selection,render(){}};
 const presentation=installContentPresentation({root,editor,getTable:()=>value,outputTable:options.outputTable,...(options.columnOutputs===false?{columnOutputs:false}:{})});env.releases.push(()=>{presentation.destroy();selection.destroy();});
 const toolbar=document.body.children.at(-1);env.tick();
 return {root,headers,cells,selection,toolbar,value,context,presentation,enter(cell=cells[0]){cell.dataset.inlineEditing='true';env.emit('focusin',cell);},leave(cell=cells[0]){delete cell.dataset.inlineEditing;},selectColumn(index){env.emit('pointerdown',headers[index]);env.flush();},contextMenu(cell=cells[0]){root.fire('contextmenu',{clientX:420,clientY:260,target:cell});env.flush();}};
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
test('left selection keeps the menu closed; right click and keyboard open a focusable vertical menu',t=>{
 const env=dom(t),a=table(env,0),cell=a.cells[0];
 env.emit('pointerdown',cell);env.flush();
 assert.equal(a.root.dataset.contentSelected,'true');
 assert.equal(a.toolbar.hidden,true,'left selection must not open the action menu');
 a.contextMenu(cell);
 assert.equal(a.toolbar.hidden,false);
 assert.equal(a.toolbar.getAttribute('role'),'menu');
 assert.match(a.toolbar.className,/content-context/);
 assert.ok(a.toolbar.querySelector('[role=menuitem]'));
 assert.ok(a.toolbar.querySelector('.content-context-item'));
 env.emit('keydown',a.toolbar.querySelector('[role=menuitem]'),{key:'Escape',isComposing:false});
 env.flush();
 assert.equal(a.toolbar.hidden,true);
 assert.equal(document.activeElement,cell,'Escape returns focus to the triggering cell');
 assert.equal(a.root.dataset.contentSelected,'true','closing the menu keeps the table selection');
 cell.focus();a.root.fire('keydown',{target:cell,key:'F10',shiftKey:true,isComposing:false});
 env.flush();assert.equal(a.toolbar.hidden,false,'Shift+F10 opens the current object menu');
});
test('the cell menu routes output to the owning table callback',t=>{
 const env=dom(t),calls=[],a=table(env,0,{outputTable:detail=>calls.push(detail)}),cell=a.cells[0];
 a.contextMenu(cell);
 const output=a.toolbar.querySelectorAll('[role=menuitem]').find(item=>item.textContent==='输出为素材组');
 assert.ok(output);
 output.onclick({preventDefault(){},stopPropagation(){}});
 assert.deepEqual(calls.map(call=>({scope:call.scope,fieldId:call.fieldId,recordId:call.recordId})),[{scope:'cell',fieldId:a.value.fields[0].id,recordId:a.value.records[0].id}]);
});
test('native graph mode without a canvas panel still opens the table context menu',t=>{
 const env=dom(t),a=table(env,0),cell=a.cells[0];
 env.contexts.delete(a.root);
 a.contextMenu(cell);
 assert.equal(a.toolbar.hidden,false);
 assert.equal(a.toolbar.querySelector('[role=menuitem]')!=null,true);
});
test('right-clicking nested cell content returns Escape focus to the focusable cell',t=>{
 const env=dom(t),a=table(env,0),cell=a.cells[0],nested=new env.Element('span');
 cell.append(nested);
 a.root.fire('contextmenu',{clientX:420,clientY:260,target:nested});env.flush();
 env.emit('keydown',a.toolbar.querySelector('[role=menuitem]'),{key:'Escape',isComposing:false});
 assert.equal(document.activeElement,cell);
});
test('rebuilding a header without changing fields restores its output source button',t=>{
 const env=dom(t),a=table(env,0),header=a.headers[0];
 const before=header.querySelector('[data-table-source]');
 assert.ok(before);before.remove();env.tick();
 assert.ok(header.querySelector('[data-table-source]'),'missing per-header source must be rebuilt');
});

test('fixed table presentation omits output Slots through rerenders without affecting another table',t=>{
 const env=dom(t),fixed=table(env,0,{columnOutputs:false}),generic=table(env,1);
 for(let i=0;i<3;i++){
  env.tick();assert.equal(fixed.root.querySelectorAll('[data-table-source]').length,0);
  assert.equal(generic.root.querySelectorAll('[data-table-source]').length,generic.value.fields.length);
 }
 fixed.selectColumn(0);env.tick();
 assert.equal(fixed.headers[0].dataset.columnSelected,'true');
 assert.equal(fixed.root.querySelectorAll('[data-table-source]').length,0);
});
test('column output buttons have a positioned header containing block',()=>{
 const css=readFileSync(new URL('../../frontend/src/features/table/table_ui.css',import.meta.url),'utf8');
 assert.match(css,/\.dae-ui th\[data-column\]\{position:relative\}/);
});
