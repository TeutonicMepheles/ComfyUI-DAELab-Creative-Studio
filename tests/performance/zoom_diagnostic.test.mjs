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
    const chrome={':scope > .dae-creative-world > .dae-creative-card > .dae-creative-heading':'heading',':scope > .dae-creative-world > .dae-creative-card > .dae-creative-width-handle':'width-handle'};
    if(chrome[selector])return this.children.filter(x=>x.kind==='world').flatMap(world=>world.children.filter(x=>x.kind==='card').flatMap(card=>card.children.filter(x=>x.kind===chrome[selector])));
    const kinds={'.dae-creative':'canvas','.dae-creative-card':'card','.dae-table[data-structure]':'table','td[data-field]':'cell','.dae-table[data-structure] button.table-row-resize':'row','.dae-upload-stage[data-review-index]':'group-badge','.dae-creative-card[data-compact=true] > .dae-creative-summary':'compact-summary'};
    return selector==='*'?all:all.filter(x=>x.kind===kinds[selector]);
  }
  get sheet(){return this.tagName==='style'?{cssRules:this.textContent?[{}]:[]}:undefined;}
  click(){this.clicked=true;}
}
function dom({rowCount=3}={}){
  const body=new Element('body'),head=new Element('head');body.base=head.base=true;
  const document=Object.assign(new EventTarget(),{body,head,readyState:'complete',createElement:tag=>new Element(tag),querySelectorAll:s=>body.querySelectorAll(s),getElementById:id=>[...body.querySelectorAll('*'),...head.querySelectorAll('*')].find(x=>x.id===id)});
  const roots=[],observers=[],blobs=[];let clock=10;
  const addChromeCard=(root,width=700)=>{
    const world=root.children.find(child=>child.kind==='world'),card=new Element('article','card'),heading=new Element('header','heading'),handle=new Element('div','width-handle');
    heading.baseWidth=width;world.append(card);card.append(heading);card.append(handle);return {card,heading,handle};
  };
  const addRoot=()=>{
    const root=new Element('section','canvas');body.append(root);roots.push(root);
    root.style.setProperty('--dae-canvas-zoom','.5');root.style.setProperty('--dae-canvas-inverse-zoom','2');
    const world=new Element('div','world');root.append(world);const {card}=addChromeCard(root),table=new Element('table','table');card.append(table);
    for(let i=0;i<rowCount;i++){const row=new Element('button','row');table.append(row);const cell=new Element('td','cell');table.append(cell);}
    return root;
  };
  const root=addRoot();
  const getComputedStyle=(element,pseudo=null)=>{
    const owner=element.kind==='canvas'?element:roots.find(root=>root.querySelectorAll('*').includes(element));
    const rootValues=Object.fromEntries(['--dae-canvas-zoom','--dae-canvas-inverse-zoom'].map(p=>[p,owner.style.getPropertyValue(p)]));
    let height=element.style.getPropertyValue('height'),chromeOverride={};
    for(const style of head.children){
      const token=owner.getAttribute('data-studio-zoom-diagnostic');
      if(!token||!style.textContent.includes(`[data-studio-zoom-diagnostic="${token}"]`))continue;
      for(const property of Object.keys(rootValues)){
        const match=style.textContent.match(new RegExp(property+':([0-9.]+)!important'));
        if(match)rootValues[property]=match[1];
      }
      const rowToken=element.getAttribute('data-studio-zoom-diagnostic-row');
      if(rowToken){const match=style.textContent.match(new RegExp('data-studio-zoom-diagnostic-row="'+rowToken+'"\\]\\{height:([0-9.]+px)!important'));if(match)height=match[1];}
      const chromeToken=element.getAttribute('data-studio-zoom-diagnostic-chrome');
      if(chromeToken){const match=style.textContent.match(new RegExp('data-studio-zoom-diagnostic-chrome="'+chromeToken+'"\\]'+(pseudo||'')+'\\{([^}]*)\\}'));if(match)chromeOverride=Object.fromEntries(match[1].split(';').filter(Boolean).map(value=>{const at=value.indexOf(':');return [value.slice(0,at),value.slice(at+1).replace(/!important$/,'')];}));}
    }
    const z=Number(rootValues['--dae-canvas-zoom']);let properties={};
    if(element.kind==='heading')properties={width:(element.baseWidth||700)*z+'px','margin-bottom':4/z+'px',transform:`matrix(${1/z}, 0, 0, ${1/z}, 0, 0)`,zoom:'1',left:'0px',top:(-24-4/z)+'px',bottom:'500px'};
    if(element.kind==='width-handle')properties=pseudo==='::before'?{top:12/z+'px',width:6/z+'px',height:20/z+'px','border-left-width':2/z+'px','border-right-width':2/z+'px'}:pseudo==='::after'?{width:2/z+'px'}:{right:-8/z+'px',width:16/z+'px'};
    if(!pseudo)for(const key of Object.keys(properties))if(element.style.getPropertyValue(key))properties[key]=element.style.getPropertyValue(key);
    for(const [key,value] of Object.entries(chromeOverride))if(pseudo||element.style.getPropertyPriority(key)!=='important')properties[key]=value;
    return {getPropertyValue:p=>rootValues[p]??properties[p]??'',height:height||(8/z+'px')};
  };
  class Observer{constructor(callback){this.callback=callback;this.connected=false;observers.push(this);}observe(_element,options){this.connected=true;this.options=options;}disconnect(){this.connected=false;}emit(){if(this.connected)this.callback([]);}}
  const window=Object.assign(new EventTarget(),{MutationObserver:Observer,getComputedStyle,performance:{now:()=>clock},URL:{createObjectURL(blob){blobs.push(blob);return 'blob:test';},revokeObjectURL(){}}});
  return {root,roots,document,window,body,head,observers,blobs,getComputedStyle,addRoot,addChromeCard,setTime:value=>{clock=value;},
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

test('chrome freezes each owned heading and width-handle pseudo geometry while root and rows stay live',()=>{
  const d=dom({rowCount:100}),c=d.controller(),second=d.addChromeCard(d.root,900),other=d.addRoot();
  assert(c.start(d.root,'chrome-consumers',{explicit:true}));
  const css=d.head.children[0].textContent;assert(!css.includes('--dae-canvas-'));assert(!css.includes('height:16px'));
  d.zoom(d.root,.625);
  assert.equal(d.getComputedStyle(d.root).getPropertyValue('--dae-canvas-zoom'),'0.625');
  assert.equal(d.getComputedStyle(second.heading).getPropertyValue('width'),'450px');
  assert.equal(d.getComputedStyle(second.heading).getPropertyValue('transform'),'matrix(2, 0, 0, 2, 0, 0)');
  assert.equal(d.getComputedStyle(second.handle).getPropertyValue('width'),'32px');
  assert.equal(d.getComputedStyle(second.handle,'::before').getPropertyValue('border-left-width'),'4px');
  assert.equal(d.getComputedStyle(second.handle,'::after').getPropertyValue('width'),'4px');
  assert.equal(d.rows(d.root)[0].style.getPropertyValue('height'),'');assert.equal(d.getComputedStyle(d.rows(d.root)[0]).height,'12.8px');
  assert(!other.hasAttribute('data-studio-zoom-diagnostic'));c.stop();
  assert.equal(d.getComputedStyle(second.heading).getPropertyValue('width'),'562.5px');
  assert.equal(d.getComputedStyle(second.handle,'::before').getPropertyValue('width'),'9.6px');
  const run=c.report().runs[0];assert.equal(run.counts.chromeHeadings,2);assert.equal(run.counts.chromeWidthHandles,2);
  assert.equal(run.original.chromeTargets.length,4);assert.equal(run.override.chromeTargets.length,4);assert(run.appliedChromeValuesMatch);
  assert.equal(run.original.excludedConsumers.rowHandles,100);assert.equal(run.override.customPropertiesFrozen,false);
  assert(run.chromeScopesRestored&&run.sameChromeTargetsAtStop&&run.chromeInlineUntouchedDuringRestore&&run.chromeReturnedToStartingInline);
  assert.equal(run.beforeRestore.rootVariables['--dae-canvas-zoom'].computed,'0.625');assert.equal(run.restored.chromeTargets[3].computed['::after'].width,'3.2px');
});

test('chrome excludes nested adapter lookalikes and reports replacement rather than freezing a new owner',()=>{
  const d=dom(),c=d.controller(),foreign=new Element('div','adapter'),fakeHeading=new Element('header','heading'),fakeHandle=new Element('div','width-handle');
  d.root.children[0].children[0].append(foreign);foreign.append(fakeHeading);foreign.append(fakeHandle);
  const badge=new Element('div','group-badge'),compact=new Element('div','compact-summary');d.root.append(badge);d.root.append(compact);
  assert(c.start(d.root,'chrome-consumers',{explicit:true}));assert(!fakeHeading.hasAttribute('data-studio-zoom-diagnostic-chrome'));assert(!fakeHandle.hasAttribute('data-studio-zoom-diagnostic-chrome'));
  const old=d.root.children[0].children[0].children.find(x=>x.kind==='heading');old.remove();
  const replacement=new Element('header','heading');d.root.children[0].children[0].append(replacement);c.stop();
  const run=c.report().runs[0];assert.equal(run.counts.chromeHeadings,1);assert.equal(run.sameChromeTargetsAtStop,false);
  assert.deepEqual(run.original.excludedConsumers,{rowHandles:3,groupNumberBadges:1,compactSummaries:1});
  assert(!replacement.hasAttribute('data-studio-zoom-diagnostic-chrome'));assert(run.chromeScopesRestored);
});

test('chrome restores every scope, preserves latest inline priorities and records conflicts without overwriting them',()=>{
  const d=dom(),c=d.controller(),card=d.root.children[0].children[0],heading=card.children.find(x=>x.kind==='heading'),handle=card.children.find(x=>x.kind==='width-handle');
  heading.setAttribute('data-studio-zoom-diagnostic-chrome','original');heading.style.setProperty('left','5px','important');
  assert(c.start(d.root,'chrome-consumers',{explicit:true}));heading.style.setProperty('width','520px');handle.style.setProperty('right','-20px','important');
  assert.equal(d.getComputedStyle(heading).getPropertyValue('width'),'350px');
  handle.setAttribute('data-studio-zoom-diagnostic-chrome','another-owner');c.stop();
  assert.equal(heading.getAttribute('data-studio-zoom-diagnostic-chrome'),'original');assert.equal(handle.getAttribute('data-studio-zoom-diagnostic-chrome'),'another-owner');
  assert.equal(d.getComputedStyle(heading).getPropertyValue('width'),'520px');assert.equal(handle.style.getPropertyValue('right'),'-20px');assert.equal(handle.style.getPropertyPriority('right'),'important');
  const run=c.report().runs[0];assert.equal(run.original.chromeTargets[0].inline.left.priority,'important');
  assert.deepEqual(run.chromeScopeRestorations.map(x=>x.restored),[true,false]);assert(!run.chromeScopesRestored);
  assert(run.chromeInlineUntouchedDuringRestore);assert.equal(run.chromeReturnedToStartingInline,false);assert.equal(d.head.children.length,0);
});

test('chrome validation is bounded and rejects unsafe computed values without leaving overrides',()=>{
  for(const value of ['url(private-value)','matrix(1,0,0,1,0,Infinity)','matrix(1,0,0,1,0,0);color:red']){
    const d=dom(),computed=(element,pseudo)=>{const actual=d.getComputedStyle(element,pseudo);return {...actual,getPropertyValue:p=>element.kind==='heading'&&p==='transform'?value:actual.getPropertyValue(p)};};
    const c=createZoomDiagnostic({document:d.document,getComputedStyle:computed,MutationObserver:d.window.MutationObserver});
    assert.equal(c.start(d.root,'chrome-consumers',{explicit:true}),false);assert.equal(d.head.children.length,0);assert.equal(d.observers.length,0);assert(!JSON.stringify(c.report()).includes('private-value'));
    assert(d.root.querySelectorAll('*').every(element=>!element.hasAttribute('data-studio-zoom-diagnostic-chrome')));
  }
  const d=dom(),bounded=createZoomDiagnostic({document:d.document,getComputedStyle:d.getComputedStyle,MutationObserver:d.window.MutationObserver,maxChromeTargets:1});
  assert.equal(bounded.start(d.root,'chrome-consumers',{explicit:true}),false);
  const c=d.controller();d.head.append=()=>{throw new Error('blocked');};assert.equal(c.start(d.root,'chrome-consumers',{explicit:true}),false);
  assert.equal(c.active,false);assert(d.root.querySelectorAll('*').every(element=>!element.hasAttribute('data-studio-zoom-diagnostic-chrome')));assert(c.report().runs[0].setupFailed);
});

test('chrome requires trusted UI activation, is exclusive, and releases on Canvas hide or page exit',()=>{
  const d=dom(),ui=mountZoomDiagnostic(d.document,d.window),button=text=>d.body.querySelectorAll('*').find(e=>e.tagName==='button'&&e.textContent===text);
  const chrome=button('冻结标题/宽度柄'),row=button('仅冻结行柄高度'),root=button('冻结根缩放变量');
  chrome.onclick({isTrusted:false});assert.equal(d.head.children.length,0);chrome.onclick({isTrusted:true});assert.equal(d.head.children.length,1);assert(row.disabled&&root.disabled);
  row.onclick({isTrusted:true});root.onclick({isTrusted:true});assert.equal(ui.report().runs.length,1);
  d.root.dispatchEvent(new Event('dae-canvas-hide'));assert.equal(d.head.children.length,0);assert(ui.report().runs[0].chromeScopesRestored);
  chrome.onclick({isTrusted:true});d.window.dispatchEvent(new Event('pagehide'));assert.equal(d.head.children.length,0);assert.equal(chrome.onclick,null);
  assert.deepEqual(ui.resources(),{styles:0,mutationObservers:0,canvasListeners:0});assert(ui.report().runs[1].chromeScopesRestored);
});

test('chrome exact property/DOM scope matches product consumers without reading a workflow or styling content',()=>{
  const source=fs.readFileSync(new URL('../host_fixture/web/performance_zoom_diagnostic.js',import.meta.url),'utf8');
  const view=fs.readFileSync(new URL('../../frontend/src/canvas/creative_canvas_view.mjs',import.meta.url),'utf8');
  assert.match(view,/world=el\('div','dae-creative-world'\)/);assert.match(view,/heading=el\('header','dae-creative-heading'\)/);
  assert.match(view,/element\.append\(heading,media,summary,body,typeLabel,portBox\);world\.append\(element\)/);
  assert.match(view,/c\.widthHandle=handle;element\.append\(handle\)/);
  assert(!/fetch\(|setInterval\(|requestAnimationFrame\(|\/scripts\/app|rootGraph|api\.fetch/.test(source));
  const d=dom(),c=d.controller();assert(c.start(d.root,'chrome-consumers',{explicit:true}));c.stop();
  const run=c.report().runs[0];assert.deepEqual(run.override.scopeSelectors.map(x=>x.properties),[
    {element:['width','margin-bottom','transform','zoom','left','top','bottom']},
    {element:['right','width'],'::before':['top','width','height','border-left-width','border-right-width'],'::after':['width']},
  ]);assert.equal(run.diagnosticOnly,true);assert.equal(run.productAcceptance,false);
  assert.equal(run.override.css.split('{').length-1,4);assert(!run.override.css.includes('opacity:'));assert(!run.override.css.includes('contain:'));
});

test('chrome root removal restores detached targets and releases every diagnostic resource',()=>{
  const d=dom(),c=d.controller(),targets=d.root.querySelectorAll('*').filter(x=>['heading','width-handle'].includes(x.kind));
  assert(c.start(d.root,'chrome-consumers',{explicit:true}));d.root.remove();d.observers.at(-1).emit();
  assert.equal(c.active,false);assert.equal(d.head.children.length,0);assert(targets.every(target=>!target.hasAttribute('data-studio-zoom-diagnostic-chrome')));
  const run=c.report().runs[0];assert.equal(run.stopReason,'canvas-detached');assert(run.chromeScopesRestored);assert.equal(run.sameChromeTargetsAtStop,false);
  assert.deepEqual(c.resources(),{styles:0,mutationObservers:0,canvasListeners:0});
});

test('a browser that does not apply a frozen pseudo-property is refused and restored with raw mismatch evidence',()=>{
  const d=dom(),computed=(element,pseudo)=>{const actual=d.getComputedStyle(element,pseudo);return {...actual,getPropertyValue:p=>d.head.children.length&&pseudo==='::after'&&p==='width'?'999px':actual.getPropertyValue(p)};};
  const c=createZoomDiagnostic({document:d.document,getComputedStyle:computed,MutationObserver:d.window.MutationObserver});
  assert.equal(c.start(d.root,'chrome-consumers',{explicit:true}),false);assert.equal(c.active,false);assert.equal(d.head.children.length,0);
  const run=c.report().runs[0];assert.equal(run.appliedChromeValuesMatch,false);assert(run.setupFailed&&run.chromeScopesRestored&&run.overrideRemoved);
  assert.equal(run.original.chromeTargets[1].computed['::after'].width,'4px');assert.equal(run.applied.chromeTargets[1].computed['::after'].width,'999px');assert.equal(run.restored.chromeTargets[1].computed['::after'].width,'4px');
});
