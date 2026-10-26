import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessDocument} from '../../web/application/business_document.js';
import {tableInputStamp} from '../../web/integrations/comfyui/business/business_document_host.js';
import {createPromptEditor} from '../../web/features/prompt/table_prompt_editor.mjs';
import {newStoryboardTable,importRows} from '../../web/features/storyboard/storyboard_table_adapter.mjs';
import {promptField} from '../../web/features/prompt/table_prompt_model.mjs';
import {bindIOPanel} from '../../web/features/prompt/llm_io_panel.mjs';
import {slotSignature} from '../../web/features/prompt/llm_slot_model.mjs';

class Element extends EventTarget {
  constructor(){super();this.children=[];this.dataset={};this.style={setProperty(){}};this.classList={contains:name=>(this.className||'').split(/\s+/).includes(name),add:name=>this.classList.toggle(name,true),toggle:(name,force)=>{const names=new Set((this.className||'').split(/\s+/).filter(Boolean)),enabled=force??!names.has(name);if(enabled)names.add(name);else names.delete(name);this.className=[...names].join(' ');return enabled;}};this.isConnected=true;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  setAttribute(key,value){this[key]=value;}
  getAttribute(key){return this[key]??null;}
  hasAttribute(key){return Object.hasOwn(this,key);}
  removeAttribute(key){delete this[key];}
  toggleAttribute(key,force){const enabled=force??!this.hasAttribute(key);if(enabled)this.setAttribute(key,'');else this.removeAttribute(key);return enabled;}
  querySelector(){return null;}
  querySelectorAll(){return [];}
  remove(){this.isConnected=false;}
  before(){} after(){}
  closest(){return new Element();}
  get lastChild(){return this.children.at(-1)||this;}
}
function dom(){
  globalThis.document=Object.assign(new EventTarget(),{createElement:()=>new Element(),createTextNode:text=>({textContent:text}),head:new Element(),querySelectorAll:()=>[]});
  globalThis.Option=class extends Element{constructor(text,value){super();this.textContent=text;this.value=value;}};
}
function documentFor(read,write,stamp){
  let epoch=0,before,steps=0;const undo=[];
  const history={begin(){before=structuredClone(read());steps++;},end(){undo.push(before);},amend(fn){fn();},undo(){write(undo.pop());},redo(){}};
  const doc=createBusinessDocument({read,write,current:()=>true,identity:()=>({workflowSession:'native',epoch,documentId:'node'}),history,stamp,historyStamp:()=>JSON.stringify(read())});
  return {doc,invalidate(){epoch++;},get steps(){return steps;}};
}
function promptFixture(){
  dom();let table=newStoryboardTable();importRows(table,{shots:[{id:'a',image_prompt:'甲'},{id:'b',image_prompt:'乙'}]},'append');
  const binding=documentFor(()=>table,next=>{table=next;},tableInputStamp);let resolve;const states=[];
  const editor={beginAsync:target=>binding.doc.beginRequest(crypto.randomUUID(),target),canAsync:binding.doc.canApply,releaseAsync:binding.doc.releaseRequest,
    change(fn,{tickets}={}){if(tickets){assert.equal(binding.doc.controller.applyResults(tickets,'解析审阅',fn),true);}else binding.doc.edit('编辑',fn);},openDialog:()=>new Element(),focusCell(){}};
  const panel=createPromptEditor({getTable:()=>table,editor,request:()=>new Promise(done=>{resolve=done;}),notify(){},onStatus:s=>states.push(s)});
  const results=['a','b'].map(recordId=>({recordId,document:{version:1,compilerVersion:1,segments:[{type:'text',text:`结果${recordId}`}],references:[],sourceFingerprint:'synthetic',editOrigin:'parsed'}}));
  return {binding,panel,states,results,complete(){resolve({results});},get table(){return table;}};
}
test('actual prompt parse applies a multi-row response through one native transaction',async()=>{
  const f=promptFixture();try{const pending=f.panel.parse(['a','b']);f.complete();await pending;
    assert.equal(f.binding.steps,1);const field=promptField(f.table);assert.equal(f.table.records[0].values[field].segments[0].text,'结果a');assert.equal(f.table.records[1].values[field].segments[0].text,'结果b');
    f.binding.doc.undo();assert.notEqual(f.table.meta.prompt_mode,'reviewed');
  }finally{f.panel.destroy();}
});
test('actual prompt parse rejects old completion after workflow epoch change, even with identical table JSON',async()=>{
  const f=promptFixture();try{const before=JSON.stringify(f.table),pending=f.panel.parse(['a','b']);f.binding.invalidate();f.complete();await pending;
    assert.equal(JSON.stringify(f.table),before);assert.equal(f.binding.steps,0);assert.match(f.states.at(-1).message,/过期 2/);
  }finally{f.panel.destroy();}
});
test('actual prompt parse releases its request after panel close without applying a delayed response',async()=>{
  const f=promptFixture();try{const before=JSON.stringify(f.table),pending=f.panel.parse(['a']);f.panel.close();f.complete();await pending;
    assert.equal(JSON.stringify(f.table),before);assert.equal(f.binding.steps,0);
  }finally{f.panel.destroy();}
});
test('actual LLM review apply and undo use native document history and retain the proposal',async()=>{
  dom();const upstream={id:1,type:'PrimitiveString',widgets:[{name:'value',value:'合成测试文字'}]};
  const node={id:2,inputs:[{link:1}],outputs:[{},{}],properties:{llmStylePreview:{version:1,mode:'polish',model:'qwen',instruction:''}},graph:{links:{1:{origin_id:1,origin_slot:0}},getNodeById:()=>upstream,change(){}},setOutputData(){}};
  node.properties.llmStylePreview.ioResult={version:1,requestId:'synthetic-review',complete:true,provider:'qwen',signature:slotSignature(node),rows:[{id:'r',text:'合成测试文字',result:'经显式审阅的文本'}]};
  const binding=documentFor(()=>node.properties.llmStylePreview,next=>{node.properties.llmStylePreview=next;},value=>[value.mode,value.model,value.instruction]);
  const root=new Element(),source=new Element(),instruction=new Element(),select=new Element(),run=new Element(),result=new Element(),heading=new Element(),materialHint=new Element();materialHint.parentElement=new Element();result.querySelector=()=>heading;select.add=option=>select.append(option);
  const release=bindIOPanel({node,nativeDocument:binding.doc,root,source,instruction,select,run,result,materialHint});
  try{
    const actions=result.children[2],apply=actions.children[0],undo=actions.children[1],event={preventDefault(){},stopPropagation(){}};
    assert.equal(apply.disabled,false);await apply.onclick(event);assert.equal(binding.steps,1);assert.equal(node.properties.llmStylePreview.appliedIO.requestId,'synthetic-review');
    await undo.onclick(event);assert.equal(node.properties.llmStylePreview.appliedIO,undefined);assert.equal(node.properties.llmStylePreview.ioResult.requestId,'synthetic-review');assert.equal(binding.steps,1);
  }finally{release();binding.doc.dispose();}
});
