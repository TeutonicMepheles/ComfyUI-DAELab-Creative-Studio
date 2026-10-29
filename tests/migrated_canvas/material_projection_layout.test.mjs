import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const text=readFileSync(new URL('../../frontend/src/canvas/creative_canvas_view.mjs',import.meta.url),'utf8');
const tree=ts.createSourceFile('view.mjs',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let source;
function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='projectMaterialPorts')source=node.getText(tree);ts.forEachChild(node,visit);}visit(tree);assert(source);

// Executes the owning closure. Traces native-like IDL reads/writes rather than
// simulating layout duration; a count reduction is not browser acceptance.
function fixture(){
 const events=[],ports=[],state={viewport:{zoom:.5}},portStarts=new WeakMap();
 function element(id,owner,rect={left:20,top:80,width:180,height:40}){
  const attrs=new Map(),classes=new Set(),values={hidden:false,disabled:false,title:''},style={},priorities={};
  const e={id,owner,dataset:{},children:[],rect:{...rect},attached:true,inert:false};
  const log=(kind,key,value)=>events.push({owner:e.owner,id,kind,key,value});
  for(const key of Object.keys(values))Object.defineProperty(e,key,{get:()=>values[key],set:v=>{log('write',key,v);values[key]=key==='title'?String(v):!!v;}});
  e.style={getPropertyPriority:key=>priorities[key]||'',setProperty(key,value,priority=''){this[key]=value;priorities[key]=priority;}};
  for(const key of ['left','top'])Object.defineProperty(e.style,key,{get:()=>style[key]||'',set:v=>{log('write','style.'+key,v);style[key]=String(v);priorities[key]='';}});
  e.classList={contains:k=>classes.has(k),add(k){log('class.add',k);classes.add(k);},remove(k){log('class.remove',k);classes.delete(k);}};
  e.getAttribute=k=>attrs.get(k)??null;e.setAttribute=(k,v)=>{log('write','attribute.'+k,v);attrs.set(k,String(v));};
  e.getBoundingClientRect=()=>{log('rect','getBoundingClientRect');e.onRect?.();const r=e.rect;return {...r,right:r.left+r.width,bottom:r.top+r.height};};
  e.closest=selector=>selector==='th'?e.head||null:null;e.contains=x=>{if(x?.attached===false)return false;for(let p=x;p;p=p.parentElement)if(p===e)return true;return false;};
  e.append=x=>{x.owner=owner;e.children.push(x);x.parentElement=e;log('append',x.id);};e.remove=()=>{e.removed=true;if(e.parentElement)e.parentElement.children=e.parentElement.children.filter(x=>x!==e);log('remove',id);};
  e.addEventListener=(key,fn)=>{e[key]=fn;};e.focus=()=>{e.focused=true;};return e;
 }
 const api=new Function('adapterFor','button','state','portStarts','select','getComputedStyle',`const visible=true,wires={getScreenCTM:()=>({a:state.viewport.zoom})};let magneticPort=null;function setMagnet(value){magneticPort=value;} ${source};return {run:projectMaterialPorts,setMagnet,get magnet(){return magneticPort;}};`)(n=>n.adapter,()=>{const p=element('port'+ports.length,null);ports.push(p);return p;},state,portStarts,()=>{},()=>({overflowX:'visible'}));
 function card(id,count=10){
  const clip=element('clip'+id,id,{left:0,top:0,width:4000,height:800}),heads=Array.from({length:count},(_,i)=>element('head'+id+'-'+i,id,{left:20+i*180,top:80,width:180,height:40}));
  const targets=heads.map((e,i)=>({element:e,key:'field-'+i,label:'列'+i,clipElement:clip,unknown:{kept:true}}));
  const c={node:{id,title:'Table'+id,adapter:{materialTargets:()=>targets,materialSources:()=>[]}},element:element('card'+id,id,{left:0,top:0,width:1768,height:800}),body:element('body'+id,id)};
  c.element.append(c.body);c.body.append(clip);for(const head of heads)clip.append(head);
  return Object.assign(c,{heads,clip,targets});
 }
 return {api,events,ports,state,element,card,reset(){events.length=0;},writes(){return events.filter(e=>e.kind==='write');}};
}

test('two stable ten-column owners measure all geometry before painting their ports',()=>{
 const f=fixture(),a=f.card(1),b=f.card(2);f.api.run(a);f.api.run(b);f.reset();
 for(const c of [a,b]){c.heads[0].rect.left+=7;f.api.run(c);}
 assert.equal(f.events.filter(e=>e.kind==='rect').length,42,'no cross-call geometry cache or suppressed clip reads');
 for(const owner of [1,2]){const events=f.events.filter(e=>e.owner===owner),lastRead=events.findLastIndex(e=>e.kind==='rect'),firstWrite=events.findIndex(e=>e.kind==='write');assert(firstWrite>lastRead,'all owner geometry must precede its first projected DOM write');}
});

test('unchanged twenty ports have zero redundant writes; reads and external repairs remain live',t=>{
 const f=fixture(),a=f.card(1),b=f.card(2);f.api.run(a);f.api.run(b);const pa=a.materialPorts.get(a.heads[0]).port;
 pa.focus();f.reset();f.api.run(a);f.api.run(b);t.diagnostic('unchanged two-table projection writes: '+f.writes().length);assert.equal(f.writes().length,0);
 assert.equal(f.events.filter(e=>e.kind==='rect').length,42);assert(pa.focused);assert.equal(f.ports.length,20);
 pa.hidden=true;pa.disabled=true;pa.style.left='999px';pa.style.top='-9px';pa.title='foreign';pa.setAttribute('aria-label','foreign');f.reset();f.api.run(a);
 assert.equal(pa.hidden,false);assert.equal(pa.disabled,false);assert.equal(pa.style.left,'204px');assert.equal(pa.style.top,'106px');assert.equal(pa.title,'列0');assert.equal(pa.getAttribute('aria-label'),'列0');
 pa.style.setProperty('left','204px','important');f.reset();f.api.run(a);assert.equal(pa.style.getPropertyPriority('left'),'','equal value must not preserve an external priority');
 assert.equal(a.materialPorts.get(a.heads[0]).port,pa);assert.equal(f.ports.length,20);
});

test('changed clips, modes, labels, coordinates and removals retain owner isolation and port order',()=>{
 const f=fixture(),a=f.card(1,2),b=f.card(2,2);f.api.run(a);f.api.run(b);const [pa,pb]=a.heads.map(e=>a.materialPorts.get(e).port),other=b.materialPorts.get(b.heads[0]).port;
 f.state.viewport.zoom=1.5;a.heads[0].rect.left=-300;a.heads[1].disabled=true;a.targets[1].label='变更';f.api.run(a);
 assert.equal(pa.hidden,true);assert.equal(pb.disabled,true);assert.equal(pb.getAttribute('aria-label'),'变更');assert.equal(pb.style.left,`${(200+90)/1.5-16}px`);assert.equal(other.disabled,false);
 a.body.inert=true;f.api.run(a);assert(pb.hidden);a.body.inert=false;a.body.hidden=true;f.api.run(a);assert(pb.hidden);
 a.body.hidden=false;a.heads[0].rect.left=20;f.api.run(a);assert.equal(pa.hidden,false);
 f.api.setMagnet(pa);a.targets.shift();f.api.run(a);assert(pa.removed);assert.equal(f.api.magnet,null);assert.equal(a.materialPorts.get(a.heads[1]).port,pb);
 assert.deepEqual(a.element.children.filter(x=>x.id.startsWith('port')),[pb],'surviving DOM objects are never reordered');
});

test('first creation, newly added ports and output source hiding retain sequential geometry semantics',()=>{
 const f=fixture(),a=f.card(1,2);let first;
 a.heads[1].onRect=()=>{first=a.materialPorts.get(a.heads[0]).port;assert.equal(first.style.left,'204px','previous initial port was painted before the next anchor read');};f.api.run(a);delete a.heads[1].onRect;
 const extra=f.element('extra',1);a.clip.append(extra);a.targets.push({element:extra,key:'extra',clipElement:a.clip});extra.onRect=()=>assert.equal(first.style.left,'224px');a.heads[0].rect.left+=10;f.api.run(a);
 const source=f.element('source',1),anchor=f.element('source-anchor',1);a.body.append(source);source.head=anchor;a.node.adapter.materialSources=()=>[{element:source,key:'out'}];anchor.onRect=()=>assert(source.classList.contains('dae-projected-source'),'display:none must happen before measuring its anchor');f.api.run(a);
 assert.equal(a.materialPorts.get(source).entry.side,'output');assert(source.classList.contains('dae-projected-source'));
});

test('geometry failure keeps prior completed paints and rethrows the original error',()=>{
 const f=fixture(),a=f.card(1,2);f.api.run(a);const pa=a.materialPorts.get(a.heads[0]).port,error=new Error('anchor unavailable');
 a.heads[0].rect.left+=12;a.heads[1].onRect=()=>{throw error;};assert.throws(()=>f.api.run(a),e=>e===error);assert.equal(pa.style.left,'228px');
 delete a.heads[1].onRect;f.api.run(a);assert.equal(a.materialPorts.size,2);
});

test('duplicate originals and geometry outside the body retain sequential projection',()=>{
 for(const mode of ['duplicate','outside-anchor','outside-clip']){
  const f=fixture(),a=f.card(1,2);f.api.run(a);const first=a.materialPorts.get(a.heads[0]).port;
  if(mode==='duplicate'){a.targets.splice(1,1,{...a.targets[0],key:'duplicate'});let calls=0;a.heads[0].onRect=()=>{if(++calls===2)assert.equal(first.style.left,'230px');};}
  else if(mode==='outside-anchor'){const outside=f.element('outside',1);outside.onRect=()=>assert.equal(first.style.left,'230px');a.targets[1].anchorElement=outside;}
  else{const outside=f.element('outside-clip',1);outside.onRect=()=>assert.equal(first.style.left,'230px');a.targets[1].clipElement=outside;}
  a.heads[0].rect.left+=13;f.api.run(a);
 }
});
