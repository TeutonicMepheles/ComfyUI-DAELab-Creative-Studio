import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setMaxListeners} from 'node:events';
import {attachTableStructure} from '../../frontend/src/features/table/table_structure.mjs';

// Exercise the real installer and event handlers. Geometry is an explicit test
// input; this verifies read/write order and behavior, not browser layout speed.
function environment(t){
 const saved=new Map(['document','window','innerWidth','innerHeight'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const operations=[];
 class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag;this.children=[];this.dataset={};this.attributes=new Map();this.style={setProperty(){}};this.className='';this.captures=new Set();this.baseHeight=0;this.scale=1;
   this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/),...names])].filter(Boolean).join(' ');}};
  }
  addEventListener(type,listener,options){if(options?.signal)setMaxListeners(0,options.signal);super.addEventListener(type,listener,options);}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.get(name)??null;}
  removeAttribute(name){this.attributes.delete(name);}
  append(...children){for(const child of children){child.remove();child.parentNode=this;this.children.push(child);if(child.className.split(' ').includes('table-row-resize'))operations.push(['append',this.parentNode.dataset.recordId]);}}
  prepend(...children){for(const child of children.reverse()){child.remove();child.parentNode=this;this.children.unshift(child);}}
  replaceChildren(...children){for(const child of [...this.children])child.remove();this.append(...children);}
  remove(){if(this.parentNode){const children=this.parentNode.children;children.splice(children.indexOf(this),1);this.parentNode=null;}}
  matches(selector){
   const tag=selector.match(/^[a-z]+/)?.[0];if(tag&&tag!==this.tagName)return false;
   const cls=selector.match(/\.([\w-]+)/)?.[1];if(cls&&!this.className.split(' ').includes(cls))return false;
   const attribute=selector.match(/\[data-([\w-]+)\]/)?.[1];if(attribute){const key=attribute.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());if(!(key in this.dataset))return false;}
   return true;
  }
  querySelectorAll(selector){const descendants=this.children.flatMap(child=>[child,...child.querySelectorAll('*')]);if(selector==='*')return descendants;if(selector==='tbody>tr[data-record-id]')return descendants.filter(child=>child.tagName==='tr'&&child.parentNode.tagName==='tbody'&&child.dataset.recordId);return descendants.filter(child=>child.matches(selector));}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  closest(selector){for(let node=this;node;node=node.parentNode)if(node.matches(selector))return node;return null;}
  contains(node){return node===this||this.querySelectorAll('*').includes(node);}
  get offsetHeight(){if(this.tagName==='tr')operations.push(['read',this.dataset.recordId]);return this.style.height?Number.parseFloat(this.style.height):this.baseHeight;}
  get rowIndex(){return this.parentNode.children.indexOf(this)+1;}
  getBoundingClientRect(){const height=(this.style.height?Number.parseFloat(this.style.height):this.baseHeight)*this.scale;return {top:0,bottom:height,height,left:0,right:200,width:200};}
  getClientRects(){return [this.getBoundingClientRect()];}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);}
  focus(){document.activeElement=this;}
  insertRow(){const row=new Element('tr');this.append(row);return row;}
  insertCell(){const cell=new Element('td');this.append(cell);return cell;}
  createTFoot(){const foot=new Element('tfoot');this.append(foot);return foot;}
 }
 const doc=new Element('document');doc.createElement=tag=>new Element(tag);doc.body=new Element('body');
 Object.assign(globalThis,{document:doc,window:new Element('window'),innerWidth:1920,innerHeight:1080});
 const releases=[];t.after(()=>{for(const release of releases)release();for(const [key,descriptor] of saved)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
 function fixture(id,heights){
  const root=new Element('section'),shell=new Element('div'),table=new Element('table'),head=new Element('thead'),headerRow=new Element('tr'),corner=new Element('th'),header=new Element('th'),body=new Element('tbody'),cols=new Element('colgroup');
  root.dataset.namedRows='true';root.append(shell);shell.append(table);table.append(cols,head,body);head.append(headerRow);head.rows=[headerRow];table.tHead=head;
  corner.className='table-choice';corner.append(new Element('input'));header.dataset.column='field';headerRow.append(corner,header);
  const state={fields:[{id:'field',name:'Text'}],records:heights.map((height,index)=>({id:`${id}-${index}`,values:{field:`${id} text ${index}`}}))};
  const rows=heights.map((height,index)=>{const row=new Element('tr'),gutter=new Element('td');row.dataset.recordId=state.records[index].id;row.baseHeight=height;row.scale=.5;gutter.className='table-choice';row.append(gutter);body.append(row);return row;});
  const changes=[];const install=()=>{const mounted=attachTableStructure({root,shell,table,getTable:()=>state,change(fn,options){const before=structuredClone(state);fn(state);changes.push({before,after:structuredClone(state),options});},notify:message=>assert.fail(message)});releases.push(()=>mounted.dispose());return mounted;};
  return {root,rows,state,changes,install,handles:()=>rows.map(row=>row.querySelector('.table-row-resize'))};
 }
 function send(target,type,properties={}){const event=new Event(type,{cancelable:true});Object.assign(event,properties);target.dispatchEvent(event);return event;}
 return {operations,fixture,send,doc};
}

test('initial row heights are all read before any resize handle is appended, independently per table',t=>{
 const {operations,fixture}=environment(t),a=fixture('A',[76,132,0]),b=fixture('B',[44,225]);
 const originalA=structuredClone(a.state),originalB=structuredClone(b.state);
 a.install();b.install();
 assert.deepEqual(operations,[['read','A-0'],['read','A-1'],['read','A-2'],['append','A-0'],['append','A-1'],['append','A-2'],['read','B-0'],['read','B-1'],['append','B-0'],['append','B-1']]);
 assert.deepEqual(a.handles().map(handle=>handle.getAttribute('aria-valuenow')),['76','132','0']);
 assert.deepEqual(b.handles().map(handle=>handle.getAttribute('aria-valuenow')),['44','225']);
 assert.deepEqual(a.state,originalA);assert.deepEqual(b.state,originalB);assert.equal(a.changes.length+b.changes.length,0);
 const css=readFileSync(new URL('../../frontend/src/features/table/table_ui.css',import.meta.url),'utf8');
 assert.match(css,/button\.table-row-resize\{[^}]*position:absolute/);
});

test('resize reads live geometry after installation and preserves commit, cancel, keyboard and instance ownership',t=>{
 const {fixture,send,doc}=environment(t),a=fixture('A',[76]),b=fixture('B',[132]);a.install();b.install();
 const handle=a.handles()[0],row=a.rows[0],other=structuredClone(b.state);
 row.baseHeight=108; // A post-install layout change must not use the captured 76.
 send(handle,'pointerdown',{button:0,pointerId:1,clientY:100});
 send(a.root,'pointermove',{pointerId:1,clientY:120});assert.equal(row.style.height,'148px');
 send(a.root,'pointerup',{pointerId:1});assert.equal(a.state.records[0].meta.height,148);assert.deepEqual(a.changes[0].options,{render:false});assert.equal(handle.hasPointerCapture(1),false);
 send(handle,'pointerdown',{button:0,pointerId:2,clientY:100});send(a.root,'pointermove',{pointerId:2,clientY:150});
 send(doc,'keydown',{key:'Escape'});assert.equal(row.style.height,'148px');assert.equal(a.changes.length,1);assert.equal(handle.hasPointerCapture(2),false);
 send(handle,'keydown',{key:'ArrowDown',shiftKey:true});assert.equal(row.style.height,'188px');assert.equal(a.state.records[0].meta.height,188);
 send(handle,'keydown',{key:'Home'});assert.equal(row.style.height,'');assert.equal(a.state.records[0].meta.height,undefined);assert.equal(handle.getAttribute('aria-valuenow'),'108');
 send(handle,'keydown',{key:'ArrowUp',shiftKey:false});assert.equal(a.state.records[0].meta.height,98);
 send(handle,'dblclick');assert.equal(a.state.records[0].meta.height,undefined);assert.equal(handle.getAttribute('aria-valuenow'),'108');
 assert.deepEqual(b.state,other);assert.equal(b.changes.length,0);
});
