import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createBusinessDocument} from '../../frontend/src/application/business_document.js';
import {snapshotJson} from '../../frontend/src/contracts/json_snapshot.js';
import {bindIOPanel} from '../../frontend/src/features/prompt/llm_io_panel.mjs';
import {slotSignature} from '../../frontend/src/features/prompt/llm_slot_model.mjs';
import {bindBusinessService} from '../../frontend/src/contracts/business.js';
import {generationInputDigest} from '../../frontend/src/features/generation/generation_session.js';

const json=value=>JSON.parse(JSON.stringify(value));
function reactive(value,cache=new WeakMap()){
  if(!value||typeof value!=='object')return value;
  if(!cache.has(value))cache.set(value,new Proxy(value,{get(target,key,receiver){return reactive(Reflect.get(target,key,receiver),cache);}}));
  return cache.get(value);
}
function documentFor(initial,id='node-a'){
  let value=initial,before,steps=0;const undo=[],redo=[];
  const history={begin(){steps++;before=json(value);},end(){undo.push(before);redo.length=0;},amend(change){change();},
    undo(){if(undo.length){redo.push(value);value=undo.pop();}},redo(){if(redo.length){undo.push(value);value=redo.pop();}}};
  const doc=createBusinessDocument({read:()=>reactive(value),write:next=>{value=next;},current:()=>true,
    identity:()=>({workflowSession:'native',epoch:0,documentId:id}),history});
  return {doc,get value(){return value;},get steps(){return steps;}};
}

test('JSON snapshots detach nested proxies and preserve every native JSON key',()=>{
  const raw=JSON.parse('{"__proto__":{"future":true},"unknown":{"数组":[null,false,0,"",{"id":"asset-A"}]},"constructor":"saved"}');
  const copy=snapshotJson(reactive(raw));assert.deepEqual(copy,raw);assert.equal(Object.hasOwn(copy,'__proto__'),true);
  copy.unknown.数组[4].id='changed';assert.equal(raw.unknown.数组[4].id,'asset-A');
  for(const value of [NaN,Infinity,1n,()=>{},Symbol('invalid')])assert.throws(()=>snapshotJson(reactive({deep:{value}})),/不可保存/);
});

test('native proxy document read/edit/replace/undo retains unknown JSON and isolates owners',()=>{
  const initial={version:1,instruction:'原文',future:{assetId:'asset-A',values:[null,false,{opaque:'保留'}]}};
  const a=documentFor(json(initial)),b=documentFor(json(initial),'node-b');
  a.doc.edit('修改要求',draft=>{draft.instruction='修改后';});assert.equal(a.steps,1);assert.equal(b.value.instruction,'原文');
  assert.deepEqual(a.value.future,initial.future);a.doc.undo();assert.deepEqual(a.value,initial);a.doc.redo();assert.equal(a.value.instruction,'修改后');
  const replacement=JSON.parse('{"version":2,"instruction":"替换","__proto__":{"saved":true},"future":{"id":"reference-A"}}');
  a.doc.replace(reactive(replacement));assert.deepEqual(a.value,replacement);assert.equal(Object.hasOwn(a.value,'__proto__'),true);
  a.doc.undo();assert.equal(a.value.instruction,'修改后');assert.deepEqual(a.value.future,initial.future);
  const ticket=a.doc.beginRequest('result');assert.equal(a.doc.replaceResults([ticket],reactive(replacement)),true);
  assert.deepEqual(a.value,replacement);assert.equal(a.doc.canApply(ticket),false);a.doc.undo();assert.equal(a.value.instruction,'修改后');
});

test('invalid edits fail before native history and a failed write rolls back every JSON field',()=>{
  const initial=JSON.parse('{"instruction":"原文","__proto__":{"opaque":true},"future":{"id":"asset-A"}}');
  const a=documentFor(initial);
  for(const invalid of [NaN,Infinity,1n,()=>{},Symbol('invalid')]){
    assert.throws(()=>a.doc.edit('无效修改',draft=>{draft.future.value=invalid;}),/不可保存/);
    assert.deepEqual(a.value,initial);assert.equal(a.steps,0);
  }
  assert.throws(()=>a.doc.edit('循环引用',draft=>{draft.future.circular=draft;}),/circular/i);
  assert.deepEqual(a.value,initial);assert.equal(a.steps,0);
  let value=initial,begins=0,ends=0,writes=0;
  const doc=createBusinessDocument({read:()=>reactive(value),write:next=>{value=next;if(++writes===1)throw new Error('host write failed');},
    current:()=>true,identity:()=>({workflowSession:'native',epoch:0,documentId:'rollback'}),
    history:{begin(){begins++;},end(){ends++;},amend(change){change();},undo(){},redo(){}}});
  assert.throws(()=>doc.edit('失败写入',draft=>{draft.instruction='不应保存';}),/host write failed/);
  assert.deepEqual(value,initial);assert.equal(Object.hasOwn(value,'__proto__'),true);assert.equal(begins,1);assert.equal(ends,1);assert.equal(writes,2);
});

// Inert DOM for the actual IO panel lifecycle; it does not claim visual acceptance.
class Element extends EventTarget{
  constructor(tag='div'){super();this.tagName=tag.toUpperCase();this.children=[];this.className='';this.dataset={};this.value='';this.style={setProperty(){}};this.isConnected=true;this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:name=>this.classList.toggle(name,true),toggle:(name,force)=>{const names=new Set(this.className.split(/\s+/).filter(Boolean)),enabled=force??!names.has(name);if(enabled)names.add(name);else names.delete(name);this.className=[...names].join(' ');return enabled;}};}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  get parentElement(){return this.parentNode;}
  get lastChild(){return this.children.at(-1);}
  get lastElementChild(){return this.lastChild;}
  setAttribute(key,value){this[key]=String(value);}
  getAttribute(key){return this[key]??null;}
  removeAttribute(key){delete this[key];}
  hasAttribute(key){return this.getAttribute(key)!==null;}
  toggleAttribute(key,on){const enabled=on??!this.hasAttribute(key);if(enabled)this.setAttribute(key,'');else this.removeAttribute(key);return enabled;}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);}
  before(node){node.remove();const parent=this.parentNode;node.parentNode=parent;parent.children.splice(parent.children.indexOf(this),0,node);}
  after(node){const parent=this.parentNode;node.parentNode=parent;parent.children.splice(parent.children.indexOf(this)+1,0,node);}
  matches(selector){return selector==='[data-mode]'?this.dataset.mode!==undefined:selector.startsWith('.')&&this.className.split(' ').includes(selector.slice(1));}
  querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){return this.matches(selector)?this:this.parentNode?.closest(selector);}
  add(node){this.append(node);}
}
function dom(t){
  const saved={document:globalThis.document,Option:globalThis.Option,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
  Object.assign(globalThis,{document:{createElement:tag=>new Element(tag)},Option:class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}},setInterval:()=>1,clearInterval(){}});
  t.after(()=>Object.assign(globalThis,saved));
  const root=new Element(),source=new Element('textarea'),instruction=new Element('textarea'),select=new Element('select'),run=new Element('button'),upload=new Element('button'),result=new Element('section'),materialHint=new Element();
  const sourceSection=new Element('section'),heading=new Element(),materials=new Element();sourceSection.className='llm-style-source';heading.className='llm-style-result-head';
  sourceSection.append(source);materials.append(materialHint);result.append(heading);root.append(sourceSection,materials,result);run.append(new Element('span'));
  return {root,source,instruction,select,run,upload,result,materialHint};
}
test('actual LLM panel mounts the imported fixture with nested proxies and applies/undoes restored proposals',t=>{
  const elements=dom(t),fixture=JSON.parse(fs.readFileSync(new URL('../fixtures/performance/FX-PERF-S-no-video.json',import.meta.url)));
  const seed=fixture.nodes.find(node=>node.type==='DAELAB.LLMStylePreviewB');
  const a=documentFor({...seed.properties.llmStylePreview,future:{ids:['asset-A','reference-A'],nested:{opaque:true}}});
  const node={id:seed.id,mode:0,inputs:[],outputs:[{},{}],properties:{},graph:{change(){}}};
  Object.defineProperty(node.properties,'llmStylePreview',{get:()=>a.doc.read()});
  a.value.ioResult={version:1,requestId:'saved-result',signature:slotSignature(node),provider:'qwen',complete:true,rows:[{id:'stable-row',result:'已保存建议',future:{preserve:[null,3]}}]};
  const release=bindIOPanel({node,nativeDocument:a.doc,...elements});t.after(release);
  assert.equal(a.steps,0,'mounting preserves the native load without an edit');
  const apply=elements.result.querySelector('.llm-style-result-actions').children[0];assert.equal(apply.disabled,false);
  apply.onclick({preventDefault(){},stopPropagation(){}});
  assert.equal(a.value.appliedIO.requestId,'saved-result');assert.equal(a.steps,1);assert.deepEqual(a.value.appliedIO.rows[0].future,{preserve:[null,3]});
  assert.deepEqual(a.value.future,{ids:['asset-A','reference-A'],nested:{opaque:true}});
  a.doc.undo();release.sync();assert.equal(a.value.appliedIO,undefined);assert.equal(a.value.ioResult.requestId,'saved-result');
  a.doc.redo();release.sync();assert.equal(a.value.appliedIO.requestId,'saved-result');
});

test('actual LLM recovery detaches nested Slot proxies, stays read-only until review and preserves history',async t=>{
  const elements=dom(t),a=documentFor({instruction:'保持主体',mode:'polish',model:'qwen',future:{opaque:['keep']},ioResult:{complete:false,requestId:'old-read-only',rows:[],future:{preserve:true}}});
  const upstream={id:10,type:'DAELAB.MaterialGroup',mode:0};
  const graph={links:{1:{origin_id:10,origin_slot:0}},getNodeById:()=>upstream,change(){}};
  const node={id:11,mode:0,inputs:[{link:1}],outputs:[{},{}],properties:{},graph};
  Object.defineProperty(node.properties,'llmStylePreview',{get:()=>a.doc.read()});
  const snapshot={version:1,rows:[{id:'row-A',text:'原始提示词',future:{stable:'row-meta'},image:{kind:'image',filename:'synthetic.png',type:'input',assetId:'asset-A',referenceId:'reference-A',future:{opaque:[null,{stable:true}]}}}]};
  const symbol=Symbol.for('DAELAB.CreativeCanvas.API.v1'),previous=globalThis[symbol];globalThis[symbol]={inputSnapshot:()=>reactive(snapshot)};
  t.after(()=>{if(previous===undefined)delete globalThis[symbol];else globalThis[symbol]=previous;});
  const inputDigest=await generationInputDigest(slotSignature(node)),requests=[];
  t.after(bindBusinessService('generation',{async request(action,options){
    const payload=JSON.parse(options.body);requests.push({action,payload});
    assert.equal(action,'status');assert.equal(options.method,'POST');
    return Response.json({jobs:[{requestId:'original-row-request',state:'succeeded',result:'已恢复建议',receipt:{kind:'text',text:'已恢复建议'},
      source:{...payload.source,fieldId:'instruction',operation:'standalone-optimization',inputDigest,createdAt:1,groupId:'original-group',rowIndex:0,rowCount:1,recordId:'row-A'}}]});
  }}));
  const release=bindIOPanel({node,nativeDocument:a.doc,...elements});t.after(release);
  const actions=elements.result.querySelector('.llm-style-result-actions');
  actions.children[3].onclick({preventDefault(){},stopPropagation(){}});
  for(let n=0;n<100&&elements.result.children[0].textContent!=='已恢复建议';n++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.result.children[0].textContent,'已恢复建议');assert.equal(requests.length,1);assert.equal(a.steps,0);
  assert.equal(a.value.appliedIO,undefined);assert.deepEqual(a.value.ioResult,{complete:false,requestId:'old-read-only',rows:[],future:{preserve:true}});
  assert.equal(actions.children[0].disabled,false);actions.children[0].onclick({preventDefault(){},stopPropagation(){}});
  assert.equal(a.steps,1);assert.equal(a.value.appliedIO.requestId,'original-group');
  assert.deepEqual(a.value.appliedIO.rows[0].future,snapshot.rows[0].future);
  assert.deepEqual(a.value.appliedIO.rows[0].image.future,snapshot.rows[0].image.future);
  assert.equal(a.value.appliedIO.rows[0].image.assetId,'asset-A');assert.equal(a.value.appliedIO.rows[0].image.referenceId,'reference-A');
  assert.equal(a.value.ioResult.requestId,'old-read-only');assert.equal(snapshot.rows[0].image.future.opaque[1].stable,true);
  a.doc.undo();release.sync();assert.equal(a.value.appliedIO,undefined);assert.equal(a.value.ioResult.requestId,'old-read-only');
  a.doc.redo();release.sync();assert.equal(a.value.appliedIO.requestId,'original-group');assert.equal(requests.length,1);
});
