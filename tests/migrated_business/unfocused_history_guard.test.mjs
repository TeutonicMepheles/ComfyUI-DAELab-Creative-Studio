import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createBusinessDocument} from '../../frontend/src/application/business_document.ts';

const panelURL=new URL('../../frontend/src/features/prompt/llm_style_preview_panel.mjs',import.meta.url);
const dataURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
// Run the complete owning panel, including its field factories and listener
// ordering. Only unrelated IO presentation/buttons are injected as public ports.
const stubs=new Map([
 ['./llm_io_panel.mjs',dataURL('export function bindIOPanel(){const off=()=>{};off.sync=()=>{};return off;}')],
 ['../../ui/table_controls.mjs',dataURL('export function tableTheme(){} export function createTableButton(label,fn){const b=document.createElement("button");b.textContent=label;b.onclick=fn;return b;}')],
]);
const dependency=path=>{const url=new URL(path,panelURL),source=new URL(url.href.replace(/\.js$/,'.ts'));return stubs.get(path)||(!existsSync(url)&&existsSync(source)?source.href:url.href);};
const panelSource=readFileSync(panelURL,'utf8').replace(/from\s+(['"])([^'"]+)\1/g,(_,quote,path)=>'from '+JSON.stringify(dependency(path))).replaceAll('import.meta.url',JSON.stringify(panelURL.href));
const {createLLMStylePanel,STYLE_VARIANTS}=await import(dataURL(panelSource));

function environment(t){
 const oldDocument=globalThis.document,oldOption=globalThis.Option,timers=[];
 class Element extends EventTarget {
  constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes=new Map();this.isConnected=true;this.disabled=false;this.readOnly=false;this.value='';this.style={setProperty(){}};this.classList={add(){}};this.ownerDocument=doc;this.listenerCounts=new Map();}
  addEventListener(type,fn,options){super.addEventListener(type,fn,options);this.listenerCounts.set(type,(this.listenerCounts.get(type)||0)+1);}
  removeEventListener(type,fn,options){super.removeEventListener(type,fn,options);this.listenerCounts.set(type,(this.listenerCounts.get(type)||0)-1);}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  prepend(child){child.parentElement=this;this.children.unshift(child);}
  add(option){this.append(option);}
  setAttribute(k,v){this.attributes.set(k,String(v));}
  getAttribute(k){return this.attributes.get(k)??null;}
  removeAttribute(k){this.attributes.delete(k);}
  toggleAttribute(k,on){if(on)this.attributes.set(k,'');else this.attributes.delete(k);}
  querySelectorAll(){return [];}
  closest(){return null;}
  getRootNode(){return this.rootNode||doc;}
  get lastElementChild(){return this.children.at(-1);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.disconnect();}
  disconnect(){this.isConnected=false;for(const child of this.children)child.disconnect();}
  focus(){doc.activeElement=this;this.dispatchEvent(new Event('focus'));}
  blur(){doc.activeElement=null;this.dispatchEvent(new Event('blur'));}
 }
 const doc={activeElement:null,createElement:tag=>new Element(tag),getElementById:()=>true};
 globalThis.document=doc;globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
 t.mock.method(globalThis,'setInterval',(fn,delay)=>{const timer={fn,delay};timers.push(timer);return timer;});
 t.mock.method(globalThis,'clearInterval',timer=>{timer.cleared=true;});
 t.after(()=>{globalThis.document=oldDocument;if(oldOption===undefined)delete globalThis.Option;else globalThis.Option=oldOption;});
 return {doc,Element,timers};
}
function beforeInput(field,inputType='historyUndo',options={}){
 const e=new Event('beforeinput',{cancelable:options.cancelable??true,bubbles:true});
 Object.defineProperties(e,{inputType:{value:inputType},isComposing:{value:options.isComposing??false}});
 field.dispatchEvent(e);return e;
}
function nativeTextChange(field,next,inputType='historyUndo',options={}){
 const e=beforeInput(field,inputType,options);
 if(!e.defaultPrevented){field.value=next;field.dispatchEvent(new Event('input'));}
 return e;
}
function owner(t,id,{native=true}={}){
 let active=true,before;const undo=[],redo=[],calls=[];
 const initial={version:1,mode:'polish',source:'source '+id,instruction:'instruction '+id,unknown:{retained:id}};
 const node={id,mode:0,properties:{llmStylePreview:structuredClone(initial)},graph:{change(){calls.push('change');}}};
 const history={begin(){calls.push('begin');before=structuredClone(node.properties.llmStylePreview);},end(){calls.push('end');undo.push(before);redo.length=0;},amend(fn){calls.push('amend');fn();},undo(){calls.push('undo');if(undo.length){redo.push(node.properties.llmStylePreview);node.properties.llmStylePreview=undo.pop();}},redo(){calls.push('redo');if(redo.length){undo.push(node.properties.llmStylePreview);node.properties.llmStylePreview=redo.pop();}}};
 const binding=createBusinessDocument({read:()=>node.properties.llmStylePreview,write:next=>{calls.push('write');node.properties.llmStylePreview=next;},current:()=>active,identity:()=>({workflowSession:'test',documentId:String(id),epoch:0}),history,historyStamp:()=>JSON.stringify(node.properties.llmStylePreview)});
 const panel=createLLMStylePanel(node,STYLE_VARIANTS.find(v=>v.id==='B'),{nativeDocument:native?binding:null});
 t.after(()=>panel.destroy());
 return {node,panel,binding,calls,undo,redo,initial,source:panel.fields[0],instruction:panel.fields[1],detach(){active=false;}};
}

test('blurred controlled source/instruction on two real panels do not insert a browser-undo transaction before native undo',t=>{
 environment(t);
 for(const id of [3,4])for(const key of ['source','instruction']){
  const o=owner(t,id),field=o[key],initial=o.initial[key];field.focus();
  nativeTextChange(field,initial+' X','insertText');nativeTextChange(field,initial+' XY','insertText');field.blur();
  assert.equal(o.undo.length,1);assert.equal(o.node.properties.llmStylePreview[key],initial+' XY');
  const calls=o.calls.length,e=nativeTextChange(field,initial+' X');
  assert.equal(e.defaultPrevented,true);assert.equal(field.value,initial+' XY');assert.equal(o.calls.length,calls,'guard must not mutate history or node data');assert.equal(o.undo.length,1);
  o.binding.undo();o.panel.sync();assert.equal(field.value,initial);assert.equal(o.undo.length,0);assert.equal(o.redo.length,1);
  o.binding.redo();o.panel.sync();assert.equal(field.value,initial+' XY');assert.deepEqual(o.node.properties.llmStylePreview.unknown,{retained:id});
 }
});

test('focused text undo/redo and panels without native document keep the existing input path',t=>{
 environment(t);const o=owner(t,3);o.instruction.focus();nativeTextChange(o.instruction,'typed','insertText');
 assert.equal(nativeTextChange(o.instruction,'instruction 3').defaultPrevented,false);assert.equal(o.node.properties.llmStylePreview.instruction,'instruction 3');
 assert.equal(nativeTextChange(o.instruction,'typed','historyRedo').defaultPrevented,false);assert.equal(o.node.properties.llmStylePreview.instruction,'typed');
 const legacy=owner(t,4,{native:false});assert.equal(nativeTextChange(legacy.instruction,'legacy').defaultPrevented,false);assert.equal(legacy.node.properties.llmStylePreview.instruction,'legacy');
});

test('business current query is cheap, tracks detach and disposal, and never reads document/history',()=>{
 let current=true,currentReads=0;const forbidden=()=>{throw Error('not a lifecycle query');};
 const binding=createBusinessDocument({read:forbidden,write:forbidden,current:()=>{currentReads++;return current;},identity:forbidden,historyStamp:forbidden,history:{begin:forbidden,end:forbidden,amend:forbidden,undo:forbidden,redo:forbidden}});
 assert.equal(binding.isCurrent(),true);current=false;assert.equal(binding.isCurrent(),false);current=true;binding.dispose();const reads=currentReads;assert.equal(binding.isCurrent(),false);assert.equal(currentReads,reads);
});

test('field-local guard leaves unrelated, noncancelable, inactive, composing and read-only events untouched',async t=>{
 const {doc,Element}=environment(t),{bindUnfocusedHistoryGuard}=await import('../../frontend/src/ui/unfocused_history_guard.ts');
 const field=new Element('textarea');let current=true,currentReads=0;
 const release=bindUnfocusedHistoryGuard(field,{isCurrent:()=>{currentReads++;return current;}});
 assert.equal(beforeInput(field).defaultPrevented,true);assert.equal(beforeInput(field,'historyRedo').defaultPrevented,true);
 for(const type of ['insertText','insertCompositionText','deleteContentBackward',''])assert.equal(beforeInput(field,type).defaultPrevented,false);
 assert.equal(beforeInput(field,'historyUndo',{cancelable:false}).defaultPrevented,false);
 doc.activeElement=field;assert.equal(beforeInput(field).defaultPrevented,false);doc.activeElement=null;
 for(const key of ['disabled','readOnly']){field[key]=true;assert.equal(beforeInput(field).defaultPrevented,false);field[key]=false;}
 field.isConnected=false;assert.equal(beforeInput(field).defaultPrevented,false);field.isConnected=true;
 current=false;assert.equal(beforeInput(field).defaultPrevented,false);current=true;
 assert.equal(beforeInput(field,'historyUndo',{isComposing:true}).defaultPrevented,false);
 field.dispatchEvent(new Event('compositionstart'));assert.equal(beforeInput(field).defaultPrevented,false);field.dispatchEvent(new Event('compositionend'));assert.equal(beforeInput(field).defaultPrevented,true);
 const shadowRoot={activeElement:field};field.rootNode=shadowRoot;assert.equal(beforeInput(field).defaultPrevented,false);field.rootNode=doc;
 // No global capture/undo dispatch. A modal's separate active textarea remains unrelated.
 doc.activeElement=new Element('textarea');assert.equal(beforeInput(field).defaultPrevented,true);
 release();release();const reads=currentReads;assert.equal(beforeInput(field).defaultPrevented,false);assert.equal(currentReads,reads);
 assert.deepEqual([...field.listenerCounts.values()],[0,0,0]);
});

test('current-query failure does not hijack a field, and panel teardown releases both guarded fields',async t=>{
 const {Element}=environment(t),{bindUnfocusedHistoryGuard}=await import('../../frontend/src/ui/unfocused_history_guard.ts');
 const field=new Element('textarea'),release=bindUnfocusedHistoryGuard(field,{isCurrent:()=>{throw Error('stale');}});
 assert.equal(beforeInput(field).defaultPrevented,false);release();
 const a=owner(t,3),b=owner(t,4);a.detach();assert.equal(beforeInput(a.instruction).defaultPrevented,false);assert.equal(beforeInput(b.instruction).defaultPrevented,true);
 b.panel.destroy();for(const f of [b.source,b.instruction]){assert.equal(beforeInput(f).defaultPrevented,false);for(const type of ['beforeinput','compositionstart','compositionend'])assert.equal(f.listenerCounts.get(type),0);}
});
