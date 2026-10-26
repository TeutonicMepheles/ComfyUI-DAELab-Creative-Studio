import test from 'node:test';
import assert from 'node:assert/strict';
import {attachColumnSplitters,resizeColumnPair,swapColumns} from '../../frontend/src/features/table/table_column_splitters.mjs';

test('splitter conserves pair width and clamps both columns to persisted limits',()=>{
    assert.deepEqual(resizeColumnPair(180,240,35),[215,205]);
    assert.deepEqual(resizeColumnPair(580,130,200),[600,110]);
    assert.deepEqual(resizeColumnPair(120,590,-200),[110,600]);
    assert.deepEqual(resizeColumnPair(100,100,100),[100,100]);
    for(const delta of [-10000,-60,0,70,10000]){
        const widths=resizeColumnPair(230,440,delta);
        assert.equal(widths[0]+widths[1],670);
        assert(widths.every(w=>w>=100&&w<=600));
    }
});

test('swapping visible neighbors preserves hidden positions, values and stable field bindings',()=>{
    const table={fields:[{id:'a',width:180},{id:'hidden',hidden:true},{id:'b',width:240}],records:[{values:{a:'Prompt',b:[{id:'asset-1',url:'/view?filename=a.png'}]}}],meta:{prompt_config:{bindings:{image_prompt:'a',image_url:'b'}}}};
    const original=structuredClone(table);
    swapColumns(table,'a','b');
    assert.deepEqual(table.fields.map(f=>f.id),['b','hidden','a']);
    assert.deepEqual(table.records,original.records);assert.deepEqual(table.meta,original.meta);
    assert.equal(table.fields[0].width,240);
    swapColumns(table,'b','a');assert.deepEqual(table,original);
    swapColumns(table,'absent','a');assert.deepEqual(table,original);
});

test('generation minimum is respected on either side of the divider',()=>{
 assert.deepEqual(resizeColumnPair(400,200,-200,400,100),[400,200]);
 assert.deepEqual(resizeColumnPair(200,400,200,100,400),[200,400]);
});

function geometryEnvironment(t) {
 const saved=new Map(),frames=new Map(),observers=[],events=[];let frameId=0;
 function install(key,value){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
 class Element {
  constructor(id){this.id=id;this.dataset={};this.children=[];this.listeners=new Map();this.isConnected=true;this.attributes={};this.captures=new Set();
   this.style=new Proxy({setProperty:(key,value)=>{this.style[key]=value;}},{set:(target,key,value)=>{events.push({kind:'write',id:this.id,key});target[key]=value;return true;}});
  }
  append(child){child.parent=this;child.id=this.id+':'+(child.className||child.id);this.children.push(child);}
  remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(item=>item!==this);}
  set hidden(value){events.push({kind:'write',id:this.id,key:'hidden'});this._hidden=value;}get hidden(){return this._hidden;}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(name,listener){this.listeners.set(name,listener);}removeEventListener(name){this.listeners.delete(name);}
  fire(name){this.listeners.get(name)?.();}focus(){}
  setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}releasePointerCapture(id){this.captures.delete(id);}
 }
 install('document',{getElementById:()=>({}),createElement:tag=>new Element(tag)});
 install('requestAnimationFrame',callback=>{const id=++frameId;frames.set(id,callback);return id;});
 install('cancelAnimationFrame',id=>frames.delete(id));
 install('ResizeObserver',class {constructor(callback){this.callback=callback;this.targets=[];observers.push(this);}observe(target){this.targets.push(target);}disconnect(){this.targets=[];}});
 t.after(()=>{for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 function fixture(id,{scale=1,count=3,fluid=false}={}){
  const root=new Element(id),shell=new Element(id+':shell'),table=new Element(id+':table');
  const state={scroll:0,width:600,height:200,scale};const fields=Array.from({length:count},(_,i)=>({id:id+'-field-'+i,width:200}));
  const changes=[],colgroup={children:Array.from({length:count+1},(_,i)=>new Element(id+':col-'+i))};
  const read=(label,fn)=>()=>{events.push({kind:'read',id:label});return fn();};
  const viewport=()=>({left:110,top:80,width:state.width*state.scale,height:state.height*state.scale});
  root.offsetWidth=1000;root.getBoundingClientRect=read(id+':root',()=>({left:100,top:50,width:1000*state.scale,height:500*state.scale}));
  shell.getBoundingClientRect=read(id+':viewport',viewport);
  for(const [key,fn] of Object.entries({clientLeft:()=>2,clientTop:()=>3,clientWidth:()=>state.width,clientHeight:()=>state.height}))Object.defineProperty(shell,key,{get:read(id+':'+key,fn)});
  const origin=()=>viewport().left+2*state.scale;
  const headers=fields.map((_,i)=>{const header=new Element(id+':header-'+i);header.getBoundingClientRect=read(header.id,()=>({right:origin()+((fluid?50+colgroup.children.slice(1,i+2).reduce((sum,col)=>sum+parseFloat(col.style.width),0):100+140*i)-state.scroll)*state.scale,top:viewport().top+10*state.scale,height:40*state.scale,width:200*state.scale}));return header;});
  const choice={getBoundingClientRect:read(id+':choice',()=>({right:origin()+50*state.scale}))};
  table.dataset={fluid:String(fluid),choiceWidth:'100'};table.tBodies=[{rows:[]}];table.querySelectorAll=()=>headers;
  table.querySelector=selector=>selector==='colgroup'?colgroup:choice;
  root.querySelectorAll=()=>root.children.flatMap(child=>child.children);
  const controller=attachColumnSplitters({root,shell,table,fields,change:fn=>{const draft={fields:structuredClone(fields)};fn(draft);changes.push(draft);}});
  const layer=root.children[0],bars=layer.children,observer=observers.at(-1);
  return {root,shell,table,fields,state,headers,colgroup,bars,layer,observer,controller,changes};
 }
 return {fixture,events,frames,flush(){const pending=[...frames.values()];frames.clear();for(const callback of pending)callback();}};
}

test('splitter geometry uses one current rectangle per divider header at each supported zoom',t=>{
 const env=geometryEnvironment(t);
 for(const scale of [.5,1,1.5]){
  const f=env.fixture('zoom-'+scale,{scale,count:10});env.events.length=0;env.flush();
  assert.deepEqual(f.bars.map(bar=>[bar.style.left,bar.style.top,bar.style.height,bar.hidden]),Array.from({length:9},(_,i)=>[(100+140*i)+'px','10px','40px',100+140*i>595]));
  assert.equal(env.events.filter(event=>event.kind==='read'&&event.id.includes(':header-')).length,9);
  f.controller.dispose();
 }
});

test('splitter geometry finishes all header reads before painting any divider',t=>{
 const env=geometryEnvironment(t);env.fixture('ordered',{count:10});env.events.length=0;env.flush();
 const firstPaint=env.events.findIndex(event=>event.kind==='write'&&event.id.includes('dae-column-divider'));
 assert(firstPaint>=0);
 assert.equal(env.events.slice(firstPaint).some(event=>event.kind==='read'&&(event.id.includes(':header-')||event.id.endsWith(':clientWidth')||event.id.endsWith(':clientHeight'))),false);
 assert.equal(new Set(env.events.slice(0,firstPaint).filter(event=>event.kind==='read'&&event.id.includes(':header-')).map(event=>event.id)).size,9);
});

test('two splitter owners refresh scroll and resize geometry independently and dispose pending work',t=>{
 const env=geometryEnvironment(t),a=env.fixture('A'),b=env.fixture('B',{scale:1.5});env.flush();
 const bBefore=b.bars.map(bar=>({...bar.style}));
 a.state.scroll=80;a.state.height=25;a.shell.fire('scroll');a.observer.callback();a.observer.callback();
 assert.equal(env.frames.size,1);env.events.length=0;env.flush();
 assert.equal(a.bars[0].style.left,'20px');assert.equal(a.bars[0].hidden,true);assert.equal(a.bars[1].style.height,'25px');
 assert.deepEqual(b.bars.map(bar=>({...bar.style})),bBefore);assert.equal(env.events.some(event=>event.id.startsWith('B:')),false);
 b.state.scroll=20;b.observer.callback();a.observer.callback();a.controller.dispose();assert.equal(env.frames.size,1);env.flush();
 assert.equal(b.bars[0].style.left,'80px');assert.equal(a.observer.targets.length,0);assert.equal(a.shell.listeners.has('scroll'),false);
 assert.deepEqual(a.fields.map(field=>field.width),[200,200,200]);assert.equal(a.changes.length,0);assert.equal(b.changes.length,0);
 b.controller.dispose();
});

test('fluid splitter measurements follow current column projection on every resize',t=>{
 const env=geometryEnvironment(t),f=env.fixture('fluid',{fluid:true});env.events.length=0;env.flush();
 assert(Math.abs(parseFloat(f.bars[0].style.left)-216.66666666666666)<1e-9);
 const firstHeader=env.events.findIndex(event=>event.kind==='read'&&event.id.includes(':header-'));
 assert.equal(env.events.slice(firstHeader).some(event=>event.kind==='write'&&event.id.includes(':col-')),false);
 f.state.width=400;f.observer.callback();env.flush();
 assert.deepEqual(f.colgroup.children.slice(1).map(col=>col.style.width),['100px','100px','100px']);
 assert.deepEqual(f.bars.map(bar=>bar.style.left),['150px','250px']);
 assert.equal(f.changes.length,0);assert.deepEqual(f.fields.map(field=>field.width),[200,200,200]);f.controller.dispose();
});
