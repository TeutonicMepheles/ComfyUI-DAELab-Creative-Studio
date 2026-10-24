import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createZoomDiagnostic,mountZoomDiagnostic} from '../host_fixture/web/performance_zoom_diagnostic.js';

class Style{
  values=new Map();
  getPropertyValue(name){return this.values.get(name)?.value??'';}
  getPropertyPriority(name){return this.values.get(name)?.priority??'';}
  setProperty(name,value,priority=''){this.values.set(name,{value:String(value),priority});}
  [Symbol.iterator](){return this.values.keys();}
}
class Element extends EventTarget{
  constructor(tag,kind=''){super();this.tagName=tag;this.kind=kind;this.children=[];this.attributes=new Map();this.style=new Style();this.hidden=false;this.textContent='';}
  get isConnected(){return this.base===true||!!this.parentElement?.isConnected;}
  append(element){element.remove();element.parentElement=this;this.children.push(element);}
  remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.parentElement=null;}}
  hasAttribute(name){return this.attributes.has(name);}
  getAttribute(name){return this.attributes.get(name)??null;}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  removeAttribute(name){this.attributes.delete(name);}
  querySelectorAll(selector){
    const all=this.children.flatMap(child=>[child,...child.querySelectorAll('*')]);
    const kinds={'.dae-creative':'canvas','.dae-creative-card':'card','.dae-table[data-structure]':'table','td[data-field]':'cell','.dae-table[data-structure] button.table-row-resize':'row'};
    return selector==='*'?all:all.filter(x=>x.kind===kinds[selector]);
  }
  get sheet(){return this.tagName==='style'?{cssRules:this.textContent?[{}]:[]}:undefined;}
  click(){this.clicked=true;}
}
function dom({rowCount=3}={}){
  const body=new Element('body'),head=new Element('head');body.base=head.base=true;
  const document=Object.assign(new EventTarget(),{body,head,readyState:'complete',createElement:tag=>new Element(tag),querySelectorAll:s=>body.querySelectorAll(s),getElementById:id=>[...body.querySelectorAll('*'),...head.querySelectorAll('*')].find(x=>x.id===id)});
  const roots=[],observers=[],blobs=[];let clock=10;
  const addRoot=()=>{
    const root=new Element('section','canvas');body.append(root);roots.push(root);
    root.style.setProperty('--dae-canvas-zoom','.5');root.style.setProperty('--dae-canvas-inverse-zoom','2');
    const card=new Element('article','card'),table=new Element('table','table');root.append(card);card.append(table);
    for(let i=0;i<rowCount;i++){const row=new Element('button','row');table.append(row);const cell=new Element('td','cell');table.append(cell);}
    return root;
  };
  const root=addRoot();
  const getComputedStyle=element=>{
    const owner=element.kind==='canvas'?element:roots.find(root=>root.querySelectorAll('*').includes(element));
    const rootValues=Object.fromEntries(['--dae-canvas-zoom','--dae-canvas-inverse-zoom'].map(p=>[p,owner.style.getPropertyValue(p)]));
    let height=element.style.getPropertyValue('height');
    for(const style of head.children){
      const token=owner.getAttribute('data-studio-zoom-diagnostic');
      if(!token||!style.textContent.includes(`[data-studio-zoom-diagnostic="${token}"]`))continue;
      for(const property of Object.keys(rootValues)){
        const match=style.textContent.match(new RegExp(property+':([0-9.]+)!important'));
        if(match)rootValues[property]=match[1];
      }
      const rowToken=element.getAttribute('data-studio-zoom-diagnostic-row');
      if(rowToken){const match=style.textContent.match(new RegExp('data-studio-zoom-diagnostic-row="'+rowToken+'"\\]\\{height:([0-9.]+px)!important'));if(match)height=match[1];}
    }
    return {getPropertyValue:p=>rootValues[p]??'',height:height||(8/Number(rootValues['--dae-canvas-zoom'])+'px')};
  };
  class Observer{constructor(callback){this.callback=callback;this.connected=false;observers.push(this);}observe(_element,options){this.connected=true;this.options=options;}disconnect(){this.connected=false;}emit(){if(this.connected)this.callback([]);}}
  const window=Object.assign(new EventTarget(),{MutationObserver:Observer,getComputedStyle,performance:{now:()=>clock},URL:{createObjectURL(blob){blobs.push(blob);return 'blob:test';},revokeObjectURL(){}}});
  return {root,roots,document,window,body,head,observers,blobs,getComputedStyle,addRoot,setTime:value=>{clock=value;},
    controller:()=>createZoomDiagnostic({document,getComputedStyle,MutationObserver:Observer,now:()=>clock}),
    rows:root=>root.querySelectorAll('.dae-table[data-structure] button.table-row-resize'),zoom(root,value){root.style.setProperty('--dae-canvas-zoom',String(value));root.style.setProperty('--dae-canvas-inverse-zoom',String(1/value));}};
}

test('construction/nonexplicit start are inert; modes are exclusive and another root stays independent',()=>{
  const d=dom(),a=d.controller(),b=d.controller(),other=d.addRoot();
  assert.equal(a.start(d.root,'root-variables'),false);assert.equal(d.head.children.length,0);assert.equal(d.observers.length,0);
  assert(a.start(d.root,'root-variables',{explicit:true}));assert.equal(a.start(d.root,'row-handles',{explicit:true}),false);
  assert.equal(b.start(d.root,'row-handles',{explicit:true}),false);assert(b.start(other,'row-handles',{explicit:true}));
  a.stop();assert(b.active);assert.equal(d.head.children.length,1);b.destroy();assert.equal(d.head.children.length,0);
});

test('root variable freeze preserves original inline and restores the latest product values, never stale viewport values',()=>{
  const d=dom(),c=d.controller();d.root.setAttribute('data-studio-zoom-diagnostic','preexisting');
  d.root.style.setProperty('--dae-canvas-zoom','.5','important');
  assert(c.start(d.root,'root-variables',{explicit:true}));d.zoom(d.root,.625);
  assert.equal(d.getComputedStyle(d.root).getPropertyValue('--dae-canvas-zoom'),'0.5');
  assert.equal(d.root.style.getPropertyValue('--dae-canvas-zoom'),'0.625');c.stop();
  assert.equal(d.getComputedStyle(d.root).getPropertyValue('--dae-canvas-zoom'),'0.625');assert.equal(d.root.getAttribute('data-studio-zoom-diagnostic'),'preexisting');
  const run=c.report().runs[0];assert.equal(run.original.rootVariables['--dae-canvas-zoom'].inline.priority,'important');
  assert(run.inlineUntouchedDuringRestore);assert.equal(run.returnedToStartingInline,false);assert(run.overrideRemoved&&run.scopeRestored);
  assert.equal(c.report().productAcceptance,false);
});

test('100 row handles freeze only their heights and restore absent inline properties and all prior scope attributes',()=>{
  const d=dom({rowCount:100}),c=d.controller(),rows=d.rows(d.root);rows[0].setAttribute('data-studio-zoom-diagnostic-row','original-row');
  assert(c.start(d.root,'row-handles',{explicit:true}));d.zoom(d.root,.625);
  assert.equal(d.getComputedStyle(d.root).getPropertyValue('--dae-canvas-zoom'),'0.625');
  assert(rows.every(row=>d.getComputedStyle(row).height==='16px'));assert(rows.every(row=>row.style.getPropertyValue('height')===''));
  c.stop();assert(rows.every(row=>d.getComputedStyle(row).height==='12.8px'));assert.equal(rows[0].getAttribute('data-studio-zoom-diagnostic-row'),'original-row');
  assert(rows.slice(1).every(row=>!row.hasAttribute('data-studio-zoom-diagnostic-row')));
  const run=c.report().runs[0];assert.equal(run.original.rowCount,100);assert.equal(run.override.rowHeights.length,100);assert(run.rowScopesRestored&&run.sameRowsAtStop&&run.inlineUntouchedDuringRestore);
});

test('canvas hide and removal release every owned resource; restoring one conflicting row does not abandon later rows',()=>{
  const d=dom(),c=d.controller(),rows=d.rows(d.root);c.start(d.root,'row-handles',{explicit:true});
  rows[0].setAttribute('data-studio-zoom-diagnostic-row','foreign-owner');d.root.dispatchEvent(new Event('dae-canvas-hide'));
  assert.equal(rows[0].getAttribute('data-studio-zoom-diagnostic-row'),'foreign-owner');assert(rows.slice(1).every(row=>!row.hasAttribute('data-studio-zoom-diagnostic-row')));
  assert.equal(c.report().runs[0].rowScopesRestored,false);assert.deepEqual(c.resources(),{styles:0,mutationObservers:0,canvasListeners:0});
  c.start(d.root,'root-variables',{explicit:true});assert.deepEqual(d.observers.at(-1).options,{childList:true});d.root.remove();d.observers.at(-1).emit();
  assert.equal(c.report().runs.at(-1).stopReason,'canvas-detached');assert.equal(d.head.children.length,0);assert(d.observers.every(observer=>!observer.connected));
});

test('same start/end zoom restores exact state; changed row membership is reported instead of claiming controlled comparison',()=>{
  const d=dom(),c=d.controller();d.zoom(d.root,.5);c.start(d.root,'root-variables',{explicit:true});d.zoom(d.root,.625);d.zoom(d.root,.5);c.stop();
  assert(c.report().runs[0].returnedToStartingInline);
  c.start(d.root,'row-handles',{explicit:true});d.rows(d.root)[0].remove();c.stop();assert.equal(c.report().runs[1].sameRowsAtStop,false);
});

test('unsupported geometry and blocked stylesheet leave no owned overrides',()=>{
  const d=dom(),c=d.controller();d.root.style.setProperty('--dae-canvas-zoom','invalid-private-value');assert.equal(c.start(d.root,'root-variables',{explicit:true}),false);
  assert.equal(d.head.children.length,0);assert(!JSON.stringify(c.report()).includes('private-value'));
  d.zoom(d.root,.5);d.head.append=()=>{throw new Error('blocked');};assert.equal(c.start(d.root,'row-handles',{explicit:true}),false);
  assert(!d.root.hasAttribute('data-studio-zoom-diagnostic'));assert(d.rows(d.root).every(row=>!row.hasAttribute('data-studio-zoom-diagnostic-row')));assert.equal(c.active,false);
});

test('visible UI requires trusted clicks, modes cannot overlap, download waits for restore, and pagehide removes UI/styles',()=>{
  const d=dom(),ui=mountZoomDiagnostic(d.document,d.window);assert.equal(mountZoomDiagnostic(d.document,d.window),null);
  const button=text=>d.body.querySelectorAll('*').find(e=>e.tagName==='button'&&e.textContent===text);
  const root=button('冻结根缩放变量'),row=button('仅冻结行柄高度'),restore=button('恢复产品样式'),download=button('下载诊断状态');
  root.onclick({isTrusted:false});assert.equal(d.head.children.length,0);root.onclick({isTrusted:true});assert.equal(d.head.children.length,1);assert(row.disabled);
  download.onclick({isTrusted:true});assert.equal(d.blobs.length,0);restore.onclick({isTrusted:false});assert.equal(d.head.children.length,1);
  restore.onclick({isTrusted:true});download.onclick({isTrusted:true});assert.equal(d.blobs.length,1);
  row.onclick({isTrusted:true});d.window.dispatchEvent(new Event('pagehide'));assert.equal(d.head.children.length,0);assert.equal(d.document.getElementById('studio-performance-zoom-diagnostic'),undefined);assert.equal(root.onclick,null);ui.destroy();
});

test('WEB_DIRECTORY auto-mount is idle and has no host API/network/timer dependency',()=>{
  const source=fs.readFileSync(new URL('../host_fixture/web/performance_zoom_diagnostic.js',import.meta.url),'utf8');
  assert(!/fetch\(|setInterval\(|requestAnimationFrame\(|\/scripts\/app|rootGraph|api\.fetch/.test(source));
  for(const readyState of ['loading','complete']){
    const d=dom();d.document.readyState=readyState;
    vm.runInNewContext(source.replace(/export /g,''),{document:d.document,window:d.window,AbortController,Blob});
    if(readyState==='loading')d.document.dispatchEvent(new Event('DOMContentLoaded'));
    assert(d.document.getElementById('studio-performance-zoom-diagnostic'));assert.equal(d.head.children.length,0);assert.equal(d.observers.length,0);d.window.dispatchEvent(new Event('pagehide'));
  }
});
