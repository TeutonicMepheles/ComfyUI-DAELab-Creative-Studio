import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../../frontend/src/integrations/comfyui/canvas/canvas_host_bounds.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {bindCanvasHostBounds}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

test('host bounds recover from a missing region, coalesce layout changes and release observers',()=>{
  const keys=['ResizeObserver','MutationObserver','requestAnimationFrame','cancelAnimationFrame','document','window','innerWidth','innerHeight'];
  const saved=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const frames=new Map(),listeners=new Map(),observers=[];let id=0;
  class Observer{constructor(callback){this.callback=callback;this.targets=new Set();observers.push(this);}observe(target){this.targets.add(target);}disconnect(){this.targets.clear();}}
  Object.assign(globalThis,{ResizeObserver:Observer,MutationObserver:Observer,requestAnimationFrame:callback=>{frames.set(++id,callback);return id;},cancelAnimationFrame:key=>frames.delete(key),document:{body:{}},window:{addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:name=>listeners.delete(name)},innerWidth:1440,innerHeight:1000});
  const values=new Map(),attributes=new Map();
  const root={style:{getPropertyValue:key=>values.get(key)||'',setProperty:(key,value)=>values.set(key,value),removeProperty:key=>values.delete(key)},hasAttribute:key=>attributes.has(key),setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key),contains:node=>node===root};
  let region=null;
  const rect={top:38,left:56,right:1440,bottom:1000,width:1384,height:962};
  const element={isConnected:true,parentElement:null,getBoundingClientRect:()=>rect};
  const toolbar={isConnected:true,getBoundingClientRect:()=>({bottom:90})};
  const flush=()=>{const current=[...frames.values()];frames.clear();current.forEach(callback=>callback());};
  let binding;
  try{
    binding=bindCanvasHostBounds(root,()=>region,()=>toolbar);
    assert.equal(values.size,0,'unavailable host geometry is not guessed');
    region=element;observers[1].callback([{target:{}}]);flush();
    assert.equal(values.get('--dae-host-canvas-top'),'38px');
    assert.equal(values.get('--dae-host-toolbar-offset'),'52px');
    rect.left=372;rect.width=1068;
    observers[0].callback();observers[0].callback();listeners.get('resize')();
    assert.equal(frames.size,1,'one layout read per frame');flush();
    assert.equal(values.get('--dae-host-canvas-left'),'372px');
    observers[1].callback([{target:root}]);assert.equal(frames.size,0,'own writes do not loop');
    const replacement={...element};region=replacement;binding.sync();
    assert.ok(observers[0].targets.has(replacement));assert.ok(!observers[0].targets.has(element));
    observers[0].callback();binding.destroy();assert.equal(frames.size,0);flush();
    assert.equal(values.size,0);assert.equal(attributes.size,0);assert.equal(listeners.size,0);
    assert.ok(observers.every(observer=>observer.targets.size===0));
  }finally{
    binding?.destroy();
    for(const [key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
});
