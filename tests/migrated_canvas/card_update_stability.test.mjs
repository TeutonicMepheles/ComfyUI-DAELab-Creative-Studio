import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {isPanelActive} from '../../frontend/src/ui/creative_panel_state.mjs';
import {GROUP_TYPE,suppressGroupSlots} from '../../frontend/src/features/groups/material_group_model.mjs';

const source=readFileSync(new URL('../../frontend/src/canvas/creative_canvas_view.mjs',import.meta.url),'utf8');
const syntax=ts.createSourceFile('creative_canvas_view.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const functions=new Map();
function visit(node){
 if(ts.isFunctionDeclaration(node)&&['update','compactCard','setViewProperty','setViewAttribute','paintSelection','select'].includes(node.name?.text)){
  assert(!functions.has(node.name.text));functions.set(node.name.text,node.getText(syntax));
 }
 ts.forEachChild(node,visit);
}
visit(syntax);assert(functions.has('update'));assert(functions.has('compactCard'));

// Run the production closure with traced DOM IDL setters. Count attempted
// writes, including equal ones; this is not browser layout/latency measurement.
// Adapter/port/task operations remain observable collaborators, not suppressed.
function fixture({groups=false}={}){
 const events=[],document={activeElement:null},selected=new Set(),state={viewport:{zoom:1}},graph={nodes:[]},cards=new Map();
 function element(owner,name,tag='div'){
  const values={hidden:false,inert:false,disabled:false,checked:false,value:'',textContent:''},attributes=new Map(),classes=new Set();
  const e={owner,name,tag,children:[],type:'text',selectionStart:0,selectionEnd:0,offset:{top:24,height:180}};
  const write=(key,value)=>events.push({kind:'write',owner,name,key,value});
  for(const key of Object.keys(values))Object.defineProperty(e,key,{get:()=>values[key],set:value=>{
   write(key,value);
   if(['hidden','inert','disabled','checked'].includes(key))values[key]=Boolean(value);
   else if(key==='value'){
    const text=`${value}`;values[key]=e.type==='number'&&text!==''&&!Number.isFinite(Number(text))?'':text;
    e.selectionStart=e.selectionEnd=values[key].length;
   }else values[key]=value==null?'':`${value}`;
  }});
  e.dataset=new Proxy({}, {set(o,k,v){write('dataset.'+String(k),v);o[k]=`${v}`;return true;}});
  e.style=new Proxy({}, {get:(o,k)=>o[k]??'',set(o,k,v){
   write('style.'+String(k),v);const text=`${v}`;
   // CSSOM serializes equivalent numeric lengths; model IDL defaults too.
   o[k]=/^-?\d+(?:\.\d+)?px$/.test(text)?Number.parseFloat(text)+'px':text;return true;
  }});
  e.setAttribute=(key,value)=>{write('attribute.'+key,value);attributes.set(key,`${value}`);};
  e.getAttribute=key=>attributes.get(key)??null;
  e.classList={contains:key=>classes.has(key),add:key=>{write('class.add',key);classes.add(key);},
   remove:key=>{write('class.remove',key);classes.delete(key);},
   toggle(key,enabled){write('class.toggle',[key,enabled]);if(enabled)classes.add(key);else classes.delete(key);return enabled;}};
  for(const key of ['offsetTop','offsetHeight'])Object.defineProperty(e,key,{get(){
   events.push({kind:'read',owner,name,key});return key==='offsetTop'?e.offset.top:e.offset.height;
  }});
  e.querySelector=selector=>e.queries?.[selector]??null;e.contains=other=>e===other||e.children.includes(other);
  e.replaceChildren=(...children)=>{write('replaceChildren',children.length);e.children=children;};
  e.append=child=>{write('append',child.tag);e.children.push(child);};
  e.pause=()=>events.push({kind:'media',owner,name,key:'pause'});
  e.load=()=>events.push({kind:'media',owner,name,key:'load'});
  e.removeAttribute=key=>{write('removeAttribute',key);attributes.delete(key);};
  return e;
 }
 const call=(name,owner)=>events.push({kind:'call',name,owner});
 const globals={document,selected,state,graph,cards,isPanelActive,UPLOAD_TYPE:'DAELAB.MediaUpload',raise:node=>call('raise',node.id),
   host:{nodes:g=>{if(groups)call('host.nodes',null);return g.nodes;}},suppressGroupSlots:(nodes,node,selection)=>{if(groups){call('suppressGroupSlots',node.id);return suppressGroupSlots(nodes,node,selection);}return Boolean(node.suppressed);},
  adapterFor:node=>node.adapter,cardWidth:()=>320,
  value:(node,name)=>node.widgets?.find(w=>w.name===name)?.value,
  previewFor:node=>node.adapter?.preview?.(node)||{},
  ports:c=>call('ports',c.node.id),projectMaterialPorts:c=>call('projectMaterialPorts',c.node.id),
  materialSources:c=>call('materialSources',c.node.id),queueLayout:()=>call('queueLayout',null),
  el:tag=>element('preview','preview',tag),location:{href:'http://127.0.0.1:8249/'},URL,
 };
 const api=new Function(...Object.keys(globals),`let workspace=null,selectedLink='previous-wire';${[...functions.values()].join('\n')}
   return {update,paintSelection,select,get selectedLink(){return selectedLink;},setWorkspace(c){workspace=c?{c}:null;}};`)(...Object.values(globals));
 function card(id){
  const node={id,type:'Fixture.Adapter',title:'节点 '+id,mode:0,inputs:[],widgets:[],properties:{unknown:{kept:true}}};graph.nodes.push(node);
  const c={node,layout:{x:id*100,y:30,width:640,expanded:true},
   element:element(id,'card'),title:element(id,'title'),body:element(id,'body'),media:element(id,'media'),summary:element(id,'summary'),
   panel:element(id,'panel'),widthHandle:element(id,'widthHandle'),minimumWidth:()=>640,fieldBindings:[],mediaURL:undefined};
  c.surface=element(id,'surface');c.panel.children.push(c.surface);
  node.adapter={presentation:'content',fullHeight:true,compactWidth:400,selectionSurface:()=>c.surface,
   tasks:()=>{call('tasks',id);return node.taskSnapshots??[];},refresh:()=>{call('refresh',id);node.onRefresh?.(c);},summary:()=>node.summary??'三行记录'};
  c.tasks={update:value=>{call('tasks.update',id);c.lastTasks=value;}};
  function field(name,value,type='text'){
   const w={name,value},input=element(id,'input.'+name,'input');input.type=type;node.widgets.push(w);c.fieldBindings.push({w,input});return {w,input};
  }
  c.text=field('text','正文 '+id);c.number=field('number',12,'number');c.toggle=field('toggle',false,'checkbox');
   cards.set(id,c);return c;
 }
 return {api,events,document,selected,state,graph,element,card,reset:()=>{events.length=0;},
  writes:()=>events.filter(e=>e.kind==='write'),calls:()=>events.filter(e=>e.kind==='call').map(e=>e.name)};
}
const stableCalls=['tasks','tasks.update','refresh','ports','projectMaterialPorts','materialSources','queueLayout'];

test('two initialized cards repeat every refresh/port/layout call with zero same-value DOM writes',t=>{
 const f=fixture(),a=f.card(1),b=f.card(2);f.api.update(a);f.api.update(b);
 const native=JSON.stringify(f.graph.nodes.map(n=>({id:n.id,properties:n.properties,widgets:n.widgets})));
 f.reset();for(let i=0;i<3;i++){f.api.update(a);f.api.update(b);}
 t.diagnostic('same-value update DOM write attempts across two cards × three polls: '+f.writes().length);
 assert.deepEqual(f.calls(),Array.from({length:6},()=>stableCalls).flat());
 assert.deepEqual(f.events.filter(e=>e.kind==='read').map(e=>[e.owner,e.key]),Array.from({length:3},()=>[[1,'offsetTop'],[1,'offsetHeight'],[2,'offsetTop'],[2,'offsetHeight']]).flat());
 assert.equal(f.writes().length,0,'initialization is excluded; repeated identical IDL writes can invalidate style/layout');
 assert.equal(JSON.stringify(f.graph.nodes.map(n=>({id:n.id,properties:n.properties,widgets:n.widgets}))),native);
});

test('mode, layout, summary and resize accessibility changes update only their owner and still read fresh geometry',()=>{
 const f=fixture(),a=f.card(1),b=f.card(2);f.api.update(a);f.api.update(b);f.reset();
 a.node.mode=2;a.node.title='已更名';a.node.summary='新摘要';a.node.suppressed=true;a.layout.x=112.5;a.layout.y=41;a.layout.width=720;
 a.node.onRefresh=c=>{c.body.offset.top=31;c.body.offset.height=205;};f.api.update(a);f.api.update(b);
 assert.equal(a.element.dataset.inactive,'true');assert.equal(a.element.dataset.slotsSuppressed,'true');assert.equal(a.body.hidden,true);assert.equal(a.body.inert,true);
 assert.equal(a.title.textContent,'已更名');assert.equal(a.summary.textContent,'新摘要');assert.equal(a.summary.hidden,false);
 assert.equal(a.element.style.left,'112.5px');assert.equal(a.element.style.top,'41px');assert.equal(a.element.style.width,'720px');
 assert.equal(a.widthHandle.getAttribute('aria-valuenow'),'720');assert.equal(a.widthHandle.getAttribute('aria-valuetext'),'720 像素');
 assert.equal(a.widthHandle.getAttribute('aria-valuemin'),'640');assert.equal(a.widthHandle.getAttribute('aria-valuemax'),'3600');
 assert.equal(a.widthHandle.hidden,true);assert.equal(a.widthHandle.style.top,'31px');assert.equal(a.widthHandle.style.height,'205px');
 assert.equal(f.writes().filter(e=>e.owner===2).length,0);
 const boundary=f.events.filter(e=>e.kind==='read'||e.kind==='write'&&e.name==='widthHandle'&&e.key.startsWith('style.'));
 assert.deepEqual(boundary.slice(0,4).map(e=>[e.kind,e.key]),[['read','offsetTop'],['write','style.top'],['read','offsetHeight'],['write','style.height']]);
 for(const mode of [4,0]){a.node.mode=mode;f.api.update(a);assert.equal(a.body.hidden,mode!==0);assert.equal(a.body.inert,mode!==0);}
 f.reset();f.api.update(a);f.api.update(b);assert.equal(f.writes().length,0);
});

test('real DOM string/boolean coercions and focus ownership preserve field drafts while external values still reconcile',()=>{
 const f=fixture(),a=f.card(1),b=f.card(2);f.api.update(a);f.api.update(b);
 f.document.activeElement=a.text.input;a.text.input.value='正在编辑';a.text.input.selectionStart=a.text.input.selectionEnd=2;
 a.text.w.value='外部新值';a.node.inputs=[{name:'text',link:5}];a.number.w.value=0;a.toggle.w.value=true;b.text.w.value=null;
 f.reset();f.api.update(a);f.api.update(b);
 assert.equal(a.text.input.value,'正在编辑');assert.deepEqual([a.text.input.selectionStart,a.text.input.selectionEnd],[2,2]);assert.equal(a.text.input.disabled,true);
 assert.equal(a.number.input.value,'0');assert.equal(a.number.input.checked,false);assert.equal(a.toggle.input.value,'true');assert.equal(a.toggle.input.checked,true);
 assert.equal(b.text.input.value,'');assert.equal(b.text.input.checked,false);
 f.reset();f.api.update(a);f.api.update(b);assert.equal(f.writes().length,0,'numeric and Boolean widget values compare against normalized DOM strings');
 f.document.activeElement=null;delete a.node.inputs;f.api.update(a);assert.equal(a.text.input.value,'外部新值');assert.equal(a.text.input.disabled,false);
 a.text.input.value='foreign DOM write';a.element.dataset.presentation='foreign';a.element.style.left='999px';
 f.api.update(a);assert.equal(a.text.input.value,'外部新值');assert.equal(a.element.dataset.presentation,'content');assert.equal(a.element.style.left,'100px');
 f.reset();f.api.update(a);assert.equal(f.writes().length,0,'guards compare actual DOM, not cached business data');
});

test('compact/workspace and selection surface changes retain independent live adapter semantics',()=>{
 const f=fixture(),a=f.card(1),b=f.card(2);f.api.update(a);f.api.update(b);f.state.viewport.zoom=.5;f.selected.add(1);
 f.api.update(a);f.api.update(b);assert.equal(a.body.hidden,true);assert.equal(b.body.hidden,true);assert(a.surface.classList.contains('dae-creative-selection-active'));
 f.api.setWorkspace(a);f.api.update(a);f.api.update(b);assert.equal(a.body.hidden,false);assert.equal(a.panel.dataset.canvasWorkspace,'true');assert.equal(b.body.hidden,true);
 const old=a.surface,next=f.element(1,'new-surface');a.panel.children.push(next);a.node.adapter.selectionSurface=()=>next;
 a.node.adapter.presentation=()=> 'card';a.node.adapter.fullHeight=()=>false;f.api.update(a);
 assert.equal(old.classList.contains('dae-creative-selection-active'),false);assert.equal(a.surface,next);assert(next.classList.contains('dae-creative-selection-active'));
 assert.equal(a.element.dataset.presentation,'card');assert.equal(a.element.dataset.fullHeight,'false');assert.equal(a.panel.dataset.canvasFullHeight,'false');
 f.selected.delete(1);f.api.setWorkspace(null);f.state.viewport.zoom=1.5;f.api.update(a);f.api.update(b);
 assert.equal(next.classList.contains('dae-creative-selection-active'),false);assert.equal(a.body.hidden,false);assert.equal(b.body.hidden,false);
 f.reset();f.api.update(a);f.api.update(b);assert.equal(f.writes().length,0);
});

test('preview, broken task provider and refreshed content still run without skipping other boundaries',()=>{
 const f=fixture(),a=f.card(1),b=f.card(2);a.node.adapter.tasks=()=>{throw new Error('fixture unavailable');};
 a.node.adapter.preview=()=>({kind:'image',url:'/view?filename=fixture.png'});f.api.update(a);f.api.update(b);
 assert.deepEqual(a.lastTasks,[]);assert.equal(a.media.children.length,1);assert.equal(a.media.children[0].tag,'img');
 const original=a.media.children[0];f.reset();f.api.update(a);f.api.update(b);assert.equal(a.media.children[0],original);assert.equal(f.writes().length,0);
 a.panel.queries={'video[src],img[src]':{}};f.api.update(a);assert.equal(a.media.hidden,true);assert.deepEqual(a.media.children,[]);
 a.panel.queries={};a.node.mode=4;f.api.update(a);assert.equal(a.media.hidden,true);a.node.mode=0;f.api.update(a);assert.equal(a.media.hidden,false);
 a.node.type='DAELAB.MediaUpload';a.layout.width=900;f.api.update(a);assert.equal(a.layout.width,640,'existing resize minimum is still applied after upload width');
 assert.equal(a.summary.hidden,true);assert.equal(a.layout.expanded,true);
});

test('selecting one of 300 cards only paints changed selection while preserving raise, projection and layout calls',()=>{
 const f=fixture({groups:true}),cards=Array.from({length:300},(_,i)=>f.card(i+1));f.api.paintSelection();f.reset();
 f.api.select(cards[0].node,{preserve:true});
 assert.deepEqual([...f.selected],[1]);assert.equal(f.api.selectedLink,null);
 assert.deepEqual(f.writes().map(event=>[event.owner,event.key]),[[1,'dataset.selected'],[1,'class.toggle']]);
 assert.equal(cards[0].element.dataset.selected,'true');assert(cards[0].surface.classList.contains('dae-creative-selection-active'));
 assert.equal(f.calls().filter(name=>name==='host.nodes').length,300);assert.equal(f.calls().filter(name=>name==='suppressGroupSlots').length,300);
 assert.deepEqual(f.events.filter(event=>event.kind==='call'&&['raise','queueLayout'].includes(event.name)).map(event=>[event.name,event.owner]),[['raise',1],['queueLayout',null]]);
 f.reset();f.api.select(cards[0].node,{preserve:true});
 assert.equal(f.writes().length,0);assert.equal(f.calls().filter(name=>name==='host.nodes').length,300);
 assert.equal(f.calls().filter(name=>name==='raise').length,1);assert.equal(f.calls().filter(name=>name==='queueLayout').length,1);
 f.api.select(cards[1].node,{toggle:true});assert.deepEqual([...f.selected],[1,2]);
 f.api.select(cards[0].node,{toggle:true});assert.deepEqual([...f.selected],[2]);assert.equal(cards[0].element.dataset.selected,'false');
 f.api.select(null);assert.equal(f.selected.size,0);assert.equal(cards[1].element.dataset.selected,'false');
});

test('selection paint reads current group membership and collapse state without caching unchanged selection',()=>{
 const f=fixture({groups:true}),a=f.card(1),b=f.card(2),group=f.card(3);group.node.type=GROUP_TYPE;group.node.properties.members=[1,2];group.node.properties.collapsed=false;
 f.selected.add(1);f.api.paintSelection();
 assert.deepEqual([a,b,group].map(card=>card.element.dataset.slotsSuppressed),['false','true','true']);
 group.node.properties.collapsed=true;const native=JSON.stringify(f.graph.nodes.map(node=>({id:node.id,type:node.type,properties:node.properties})));
 f.reset();f.api.paintSelection();
 assert.deepEqual([a,b,group].map(card=>card.element.dataset.slotsSuppressed),['true','true','false']);
 assert.deepEqual(f.writes().map(event=>[event.owner,event.key]),[[1,'dataset.slotsSuppressed'],[3,'dataset.slotsSuppressed']]);
 assert.equal(JSON.stringify(f.graph.nodes.map(node=>({id:node.id,type:node.type,properties:node.properties}))),native);
 group.node.properties.members=[1];f.reset();f.api.paintSelection();
 assert.equal(b.element.dataset.slotsSuppressed,'false');assert.deepEqual(f.writes().map(event=>[event.owner,event.key]),[[2,'dataset.slotsSuppressed']]);
 assert.deepEqual(f.events.filter(event=>event.kind==='call'&&event.name==='suppressGroupSlots').map(event=>event.owner),[1,2,3]);
});

test('selection paint repairs externally changed DOM and replaced surfaces then becomes write-free again',()=>{
 const f=fixture({groups:true}),a=f.card(1),b=f.card(2);f.selected.add(1);f.api.paintSelection();
 a.element.dataset.selected='foreign';delete b.element.dataset.slotsSuppressed;b.surface.classList.add('dae-creative-selection-active');
 a.surface=f.element(1,'replacement-surface');f.reset();f.api.paintSelection();
 assert.equal(a.element.dataset.selected,'true');assert.equal(b.element.dataset.slotsSuppressed,'false');
 assert(a.surface.classList.contains('dae-creative-selection-active'));assert.equal(b.surface.classList.contains('dae-creative-selection-active'),false);
 assert.deepEqual(f.writes().map(event=>[event.owner,event.key]),[[1,'dataset.selected'],[1,'class.toggle'],[2,'class.toggle'],[2,'dataset.slotsSuppressed']]);
 a.surface=null;f.reset();f.api.paintSelection();assert.equal(f.writes().length,0);assert.equal(f.calls().filter(name=>name==='queueLayout').length,1);
});
