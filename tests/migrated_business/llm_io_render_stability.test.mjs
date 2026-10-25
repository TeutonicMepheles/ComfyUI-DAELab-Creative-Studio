import test from 'node:test';
import assert from 'node:assert/strict';
import {bindIOPanel} from '../../frontend/src/features/prompt/llm_io_panel.mjs';
import {slotSignature} from '../../frontend/src/features/prompt/llm_slot_model.mjs';
import {createBusinessDocument} from '../../frontend/src/application/business_document.js';
import {bindBusinessService} from '../../frontend/src/contracts/business.js';

const API=Symbol.for('DAELAB.CreativeCanvas.API.v1');
// Count DOM write attempts (including equal assignments), not browser layout or
// elapsed time. Normalized IDL defaults make guards compare actual DOM values.
function environment(t){
 const writes=[],elements=[],timers=[],reads=new Map(),previous=new Map();
 class Element {
  constructor(tag='div'){
   this.tagName=tag;this.children=[];this.dataset={};this.attributes=new Map();this.values={};this.listeners=new Map();this.isConnected=true;
   this.style={setProperty(){}};this.classList={
    contains:name=>this.className.split(/\s+/).includes(name),
    add:name=>this.classList.toggle(name,true),
    toggle:(name,force)=>{writes.push({element:this,property:'class',value:[name,force]});const values=new Set(this.className.split(/\s+/).filter(Boolean));const enabled=force??!values.has(name);if(enabled)values.add(name);else values.delete(name);this.values.className=[...values].join(' ');return enabled;},
   };
   elements.push(this);
  }
  append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this;}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  before(){} after(node){this.afterNode=node;}
  remove(){this.isConnected=false;}
  closest(){return this.section;}
  querySelector(selector){return this.queries?.[selector]??null;}
  querySelectorAll(selector){return selector==='[data-mode]'?this.modes||[]:[];}
  setAttribute(name,value){writes.push({element:this,property:'attribute:'+name,value});this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.get(name)??null;}
  hasAttribute(name){return this.attributes.has(name);}
  removeAttribute(name){writes.push({element:this,property:'attribute:'+name,value:null});this.attributes.delete(name);}
  toggleAttribute(name,force){writes.push({element:this,property:'toggle:'+name,value:force});const enabled=force??!this.attributes.has(name);if(enabled)this.attributes.set(name,'');else this.attributes.delete(name);return enabled;}
  addEventListener(name,callback){const callbacks=this.listeners.get(name)||[];callbacks.push(callback);this.listeners.set(name,callbacks);}
  removeEventListener(name,callback){this.listeners.set(name,(this.listeners.get(name)||[]).filter(item=>item!==callback));}
  async emit(name){const event={preventDefault(){},stopPropagation(){}};const callbacks=[...(this.listeners.get(name)||[])];if(name==='click'&&this.onclick)callbacks.push(this.onclick);await Promise.all(callbacks.map(callback=>callback(event)));}
  click(){return this.emit('click');}
  add(option){this.append(option);}
  get lastChild(){return this.children.at(-1)||null;}
 }
 for(const property of ['hidden','disabled','readOnly','value','textContent','title','alt','src','className'])Object.defineProperty(Element.prototype,property,{
  get(){return this.values[property]??(['hidden','disabled','readOnly'].includes(property)?false:'');},
  set(value){const normalized=['hidden','disabled','readOnly'].includes(property)?Boolean(value):(property==='textContent'&&value==null||property==='value'&&value===null)?'':String(value);writes.push({element:this,property,value:normalized});this.values[property]=normalized;if(property==='src')this.attributes.set('src',normalized);if(property==='textContent')this.children=[];},
 });
 for(const [key,value] of [['document',{createElement:tag=>new Element(tag)}],['Option',class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}}],[API,{inputSnapshot(upstream){reads.set(upstream,(reads.get(upstream)||0)+1);return structuredClone(upstream.snapshot);}}]]){previous.set(key,globalThis[key]);globalThis[key]=value;}
 t.mock.method(globalThis,'setInterval',(callback,delay)=>{const timer={callback,delay,cleared:false};timers.push(timer);return timer;});
 t.mock.method(globalThis,'clearInterval',timer=>{timer.cleared=true;});
 t.after(()=>{for(const [key,value] of previous){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 return {writes,reads,timers,Element,reset(){writes.length=0;},tick(){for(const timer of timers)if(!timer.cleared)timer.callback();}};
}

function panel(t,env,id,{proposal=false}={}){
 const {Element}=env,upstream={id:id*10,type:'TestSyntheticInput',snapshot:{version:1,texts:[`输入 ${id}`]}},outputs=[];
 const node={id,type:'DAELAB.LLMStylePreviewB',mode:0,inputs:[{link:1}],outputs:[{},{}],properties:{llmStylePreview:{version:1,mode:'polish',model:'qwen',instruction:'手动要求',unknown:{kept:id}}},setOutputData(slot,value){outputs.push([slot,value]);}};
 node.graph={id:`llm-dom-${id}`,links:{1:{origin_id:upstream.id,origin_slot:0}},getNodeById:()=>upstream,change(){}};
 const state=()=>node.properties.llmStylePreview;
 if(proposal)state().ioResult={version:1,requestId:`review-${id}`,provider:'qwen',complete:true,signature:slotSignature(node),rows:[{id:'input-1',text:`输入 ${id}`,result:`结果 ${id}`} ]};
 const history={begins:0,amends:0,undo:[]};let before;
 const nativeDocument=createBusinessDocument({read:state,write:value=>{node.properties.llmStylePreview=value;},current:()=>true,identity:()=>({workflowSession:`session-${id}`,epoch:0,documentId:`node-${id}`}),stamp:value=>[value.mode,value.model,value.instruction],historyStamp:()=>JSON.stringify(state()),history:{begin(){history.begins++;before=structuredClone(state());},end(){history.undo.push(before);},amend(fn){history.amends++;fn();},undo(){node.properties.llmStylePreview=history.undo.pop();},redo(){}}});
 const root=new Element(),source=new Element('textarea'),instruction=new Element('textarea'),select=new Element('select'),run=new Element('button'),result=new Element(),heading=new Element(),materialHint=new Element(),sourceSection=new Element();
 root.modes=['polish','reverse'].map(mode=>{const button=new Element('button');button.dataset.mode=mode;return button;});
 source.section=sourceSection;instruction.value=state().instruction;run.append(new Element('span'));result.queries={'.llm-style-result-head':heading};materialHint.parentElement=new Element();
 const release=bindIOPanel({node,nativeDocument,root,source,instruction,select,run,result,materialHint});
 t.after(()=>{release();nativeDocument.dispose();});
 const [paragraph,status,actions]=result.children,[apply,undo,regenerate,recover]=actions.children,imageSection=sourceSection.afterNode,imageBox=imageSection.children[1],[image,imageText]=imageBox.children;
 return {node,upstream,state,outputs,history,nativeDocument,root,source,instruction,select,run,paragraph,status,apply,undo,regenerate,recover,sourceSection,imageSection,imageBox,image,imageText,release};
}

test('two unchanged panels perform no repeated DOM writes while polling fresh inputs and native outputs',t=>{
 const env=environment(t),a=panel(t,env,1),b=panel(t,env,2),before=[JSON.stringify(a.state()),JSON.stringify(b.state())];
 const initialReads=[env.reads.get(a.upstream),env.reads.get(b.upstream)],initialOutputs=[a.outputs.length,b.outputs.length];
 env.reset();for(let i=0;i<3;i++){a.release.sync();b.release.sync();}env.tick();
 assert.deepEqual(env.timers.map(timer=>timer.delay),[500,500]);
 assert.equal(a.outputs.length-initialOutputs[0],4);assert.equal(b.outputs.length-initialOutputs[1],4);
 assert.equal(env.reads.get(a.upstream)-initialReads[0],8);assert.equal(env.reads.get(b.upstream)-initialReads[1],8);
 assert.deepEqual([JSON.stringify(a.state()),JSON.stringify(b.state())],before);assert.equal(a.history.begins+b.history.begins+a.history.amends+b.history.amends,0);
 assert.equal(env.writes.length,0,JSON.stringify(env.writes.map(({property,value})=>({property,value}))));
 // Actual DOM is authoritative for reconciliation, not a remembered render key.
 a.source.value='external drift';a.run.disabled=true;a.root.modes[0].setAttribute('aria-pressed','false');a.root.modes[0].toggleAttribute('data-primary',false);a.status.textContent='external drift';
 env.reset();a.release.sync();assert.equal(a.source.value,'输入 1');assert.equal(a.run.disabled,false);assert.equal(a.root.modes[0].getAttribute('aria-pressed'),'true');assert.equal(a.root.modes[0].hasAttribute('data-primary'),true);assert.equal(a.status.textContent,'1 项输入 · 等待生成');assert.ok(env.writes.length>0);
 env.reset();a.release.sync();b.release.sync();assert.equal(env.writes.length,0);
 a.release();const count=a.outputs.length;env.reset();env.tick();a.release.sync();assert.equal(a.outputs.length,count);assert.equal(env.writes.length,0);
});

test('fresh input, derived instructions, mode/error/waiting and image changes still reconcile independently',async t=>{
 const env=environment(t),a=panel(t,env,3),b=panel(t,env,4),bBefore=JSON.stringify(b.state());
 a.upstream.snapshot={version:1,inputMode:'image-instructions',texts:['连线要求'],assets:[{kind:'image',filename:'first.png',name:'首图'}]};a.release.sync();
 assert.equal(a.state().mode,'reverse');assert.equal(a.instruction.value,'连线要求');assert.equal(a.instruction.readOnly,true);assert.equal(a.sourceSection.hidden,true);assert.equal(a.imageSection.hidden,false);assert.equal(a.image.alt,'首图');assert.match(a.image.src,/first.png/);assert.equal(a.imageBox.classList.contains('has-image'),true);assert.equal(a.history.amends,1);assert.equal(a.history.begins,0);
 a.upstream.snapshot.assets[0]={kind:'image',filename:'second.png',name:'次图'};a.release.sync();assert.match(a.image.src,/second.png/);assert.equal(a.image.alt,'次图');
 a.upstream.snapshot={version:1,texts:['新输入']};a.release.sync();assert.equal(a.state().mode,'polish');assert.equal(a.instruction.value,'手动要求');assert.equal(a.instruction.readOnly,false);assert.equal(a.source.value,'新输入');assert.equal(a.image.hidden,true);assert.equal(a.imageText.hidden,false);assert.equal(a.imageBox.classList.contains('has-image'),false);
 for(const mode of [2,4,0]){a.node.mode=mode;a.release.sync();assert.equal(a.run.disabled,!!mode);assert.equal(a.instruction.disabled,!!mode);assert.equal(a.root.modes[0].disabled,!!mode);}
 a.upstream.mode=2;a.release.sync();assert.match(a.status.textContent,/停用/);assert.equal(a.release.tasks()[0].state,'error');assert.equal(a.run.disabled,true);
 a.upstream.mode=0;a.upstream.snapshot={version:1,ready:false,texts:[]};a.release.sync();assert.match(a.status.textContent,/等待上游/);assert.equal(a.release.tasks()[0].state,'queued');
 a.upstream.snapshot={version:1,texts:['恢复输入']};a.release.sync();assert.equal(a.run.disabled,false);assert.deepEqual(a.release.tasks(),[]);
 a.state().instruction='用户编辑';a.instruction.value='用户编辑';await a.instruction.emit('input');a.state().model='deepseek';a.select.value='deepseek';await a.select.emit('change');assert.equal(a.instruction.value,'用户编辑');assert.equal(a.select.value,'deepseek');
 b.release.sync();assert.equal(JSON.stringify(b.state()),bBefore);assert.equal(b.source.value,'输入 4');assert.equal(b.instruction.value,'手动要求');assert.deepEqual(a.state().unknown,{kept:3});
 env.reset();a.release.sync();b.release.sync();assert.equal(env.writes.length,0);
});

test('saved proposal, apply/undo history and stale native output preserve their existing behavior',async t=>{
 const env=environment(t),a=panel(t,env,5,{proposal:true}),b=panel(t,env,6);
 assert.equal(a.paragraph.textContent,'结果 5');assert.equal(a.apply.disabled,false);assert.match(a.status.textContent,/待应用/);
 await a.apply.click();assert.equal(a.history.begins,1);assert.equal(a.state().appliedIO.requestId,'review-5');assert.equal(a.apply.hidden,true);assert.equal(a.undo.hidden,false);assert.deepEqual(a.outputs.at(-1),[0,'结果 5']);assert.match(a.status.textContent,/已应用/);
 env.reset();a.release.sync();b.release.sync();assert.equal(env.writes.length,0);
 await a.undo.click();a.release.sync();assert.equal(a.state().appliedIO,undefined);assert.equal(a.state().ioResult.requestId,'review-5');assert.equal(a.undo.hidden,true);assert.deepEqual(a.outputs.at(-1),[0,null]);assert.equal(a.history.begins,1);
 a.upstream.snapshot.texts[0]='changed';a.release.sync();assert.equal(a.apply.disabled,true);assert.match(a.status.textContent,/输入已改变/);assert.deepEqual(a.outputs.at(-1),[0,null]);assert.equal(b.paragraph.textContent,'');
});

test('nullable result text and normalized boolean controls retain DOM assignment semantics',t=>{
 const env=environment(t),a=panel(t,env,9,{proposal:true});
 for(const result of [null,undefined,'']){
  a.state().ioResult.rows[0].result=result;a.release.sync();assert.equal(a.paragraph.textContent,'');
  env.reset();a.release.sync();assert.equal(env.writes.length,0);
 }
 // Native textContent null/undefined normalize to empty; no redundant clear.
 a.paragraph.textContent=null;assert.equal(a.paragraph.textContent,'');a.paragraph.textContent=undefined;assert.equal(a.paragraph.textContent,'');
 env.reset();a.release.sync();assert.equal(env.writes.length,0);
 // IDL booleans are read as booleans even when another control wrote a raw
 // truthy value. Reconciliation still restores the current product state.
 a.instruction.readOnly='false';assert.equal(a.instruction.readOnly,true);a.source.disabled=1;a.image.hidden=null;a.imageBox.classList.toggle('has-image',true);
 env.reset();a.release.sync();assert.equal(a.instruction.readOnly,false);assert.equal(a.source.disabled,false);assert.equal(a.image.hidden,true);assert.equal(a.imageBox.classList.contains('has-image'),false);assert.ok(env.writes.length>0);
 env.reset();a.release.sync();assert.equal(env.writes.length,0);
});

test('delayed service success and failure update busy/result/task states without crossing panel ownership',async t=>{
 const env=environment(t),a=panel(t,env,7),b=panel(t,env,8);let resolveRequest,submitted,notify;
 const requests=[];const waitRequest=()=>new Promise(resolve=>{notify=resolve;});
 const releaseGeneration=bindBusinessService('generation',{request:async()=>new Response(JSON.stringify({jobs:[],nextOffset:null}))});
 const releaseOptimization=bindBusinessService('optimization',{request(action,options){assert.equal(action,'polish');const body=JSON.parse(options.body);requests.push(body);notify();return new Promise(resolve=>{resolveRequest=resolve;});}});
 t.after(()=>{releaseOptimization();releaseGeneration();});
 submitted=waitRequest();const running=a.run.emit('click');assert.equal(a.run.disabled,true);assert.equal(a.run.lastChild.textContent,'生成中…');assert.equal(a.run.getAttribute('aria-busy'),'true');assert.equal(b.run.disabled,false);await submitted;
 assert.equal(a.release.tasks()[0].state,'running');const body=requests[0];env.reset();a.release.sync();b.release.sync();assert.equal(env.writes.length,0);
 resolveRequest(new Response(JSON.stringify({requestId:body.requestId,result:'服务结果',source:body.sourceScope,state:'succeeded',receipt:{kind:'text',text:'服务结果'},inputFingerprint:'a'.repeat(64)})));await running;
 assert.equal(a.run.disabled,false);assert.equal(a.run.getAttribute('aria-busy'),'false');assert.equal(a.run.lastChild.textContent,'生成');assert.equal(a.paragraph.textContent,'服务结果');assert.equal(a.apply.disabled,false);assert.equal(a.release.tasks()[0].state,'success');assert.equal(a.state().ioResult,undefined);assert.equal(a.state().studioTextRequests.requests.length,1);assert.equal(b.paragraph.textContent,'');
 submitted=waitRequest();const failing=b.run.emit('click');await submitted;resolveRequest(new Response(JSON.stringify({error:'确定性测试失败'}),{status:503}));await failing;
 assert.equal(b.run.disabled,false);assert.match(b.status.textContent,/确定性测试失败/);assert.equal(b.release.tasks()[0].state,'error');assert.equal(a.paragraph.textContent,'服务结果');
 env.reset();a.release.sync();b.release.sync();assert.equal(env.writes.length,0);
});
