import test from 'node:test';
import assert from 'node:assert/strict';
import {createOptimizationComposer,optimizationCostSummary} from '../../frontend/src/features/prompt/prompt_optimization_composer.mjs';
import {COMFY_GPT_MODEL,OPTIMIZATION_MODELS,optimizationProvider} from '../../frontend/src/features/prompt/prompt_optimization_model.mjs';
import {getModelCatalog,resetModelCatalogForTests} from '../../frontend/src/features/models/model_catalog.mjs';
import {installDom,Element} from './prompt_optimization_dom.mjs';
const find=(root,test)=>test(root)?root:root.children.map(e=>find(e,test)).find(Boolean);

test('aggregate applied label follows undo and redo without offering a second application',t=>{
 const dom=installDom(t);t.after(()=>dom.restore());let notify;
 let state={provider:'comfy',model:COMFY_GPT_MODEL,batchId:'retained',range:{total:3},rows:Array.from({length:3},()=>({status:'succeeded',suggestionStatus:'applied',canApply:false})),permissions:{canApplyAll:false}};
 const controller={getState:()=>state,subscribe(fn){notify=fn;fn(state);return()=>{};}};
 const container=new Element('div'),view=createOptimizationComposer({controller,container,fieldName:'最终提示词'});t.after(()=>view.destroy());
 const progress=find(container,e=>e.className==='opt-progress-label'),apply=find(container,e=>e.tagName==='button'&&e['aria-label']==='应用结果'),message=find(container,e=>e.className==='opt-message');
 assert.equal(progress.children[1].textContent,'已应用 3 行');
 state={...state,rows:state.rows.map(r=>({...r,suggestionStatus:'reverted'}))};notify(state);
 assert.equal(progress.children[1].textContent,'已撤销 3 行');assert.match(message.textContent,/重做/);assert.equal(apply.disabled,true);
 state={...state,rows:state.rows.map(r=>({...r,suggestionStatus:'applied'}))};notify(state);
 assert.equal(progress.children[1].textContent,'已应用 3 行');assert.equal(message.hidden,true);
});

test('retired DeepSeek does not expose key settings or password inputs',t=>{
 const dom=installDom(t);t.after(()=>dom.restore());const state={provider:'deepseek',model:'deepseek-flash',range:{total:1},rows:[],permissions:{canChangeProvider:true}};
 const controller={getState:()=>state,subscribe(fn){fn(state);return()=>{};}};const container=new Element('div'),view=createOptimizationComposer({controller,container,fieldName:'Historical'});t.after(()=>view.destroy());
 assert.equal(find(container,e=>e.type==='password'),undefined);assert.equal(find(container,e=>e.className==='opt-key-panel'),undefined);
});

test('Comfy GPT is a real native-credit model and prices cannot be labelled as USD',()=>{
 assert.equal(OPTIMIZATION_MODELS.find(m=>m.id===COMFY_GPT_MODEL).label,'GPT-6 Luna（Comfy）');assert.equal(optimizationProvider(COMFY_GPT_MODEL),'comfy');
 assert.equal(optimizationCostSummary({provider:'comfy',quote:{status:'ready',estimatedCredits:1.2,budgetUpperCredits:2.3,expiresAt:Date.now()+5000}}),'预计 1.2 积分 · 预算上界 2.3 积分');
});
test('optimization model menu rebuilds from the backend catalog with stable display labels',t=>{
 const dom=installDom(t);resetModelCatalogForTests();t.after(()=>{dom.restore();resetModelCatalogForTests();});
 const catalog=getModelCatalog();catalog.replaceDefinitions([{id:'backend-opt-a',label:'Server Model A',family:'optimization',kind:'text',provider:'qwen'}]);
 let notify,state={provider:'qwen',model:'backend-opt-a',range:{total:1},rows:[],permissions:{canChangeProvider:true}};
 const controller={getState:()=>state,subscribe(fn){notify=fn;fn(state);return()=>{};},setModel(){return true;}};
 const container=new Element('div'),view=createOptimizationComposer({controller,container,fieldName:'画面'});t.after(()=>view.destroy());
 assert.ok(find(container,e=>e.tagName==='button'&&e.textContent.includes('Server Model A')));
 catalog.replaceDefinitions([{id:'backend-opt-b',label:'Server Model B',family:'optimization',kind:'text',provider:'qwen'}]);
 state={...state,provider:'deepseek',model:'backend-opt-b'};notify(state);
 assert.equal(find(container,e=>e.tagName==='button'&&e.textContent.includes('Server Model A')),undefined);
 assert.ok(find(container,e=>e.tagName==='button'&&e.textContent.includes('Server Model B')));
});

test('actual composer exposes explicit original-batch fencing only on the controller permission',async t=>{
 const dom=installDom(t);t.after(()=>dom.restore());let notify,calls=0;
 let state={provider:'qwen',model:'qwen3.5:9b-q4_K_M',batchId:'original',paused:true,error:'暂未查到原批次',range:{total:1},rows:[],permissions:{canChangeProvider:false,canFence:true}};
 const controller={getState:()=>state,subscribe(fn){notify=fn;fn(state);return()=>{};},async fenceOriginalBatch(){calls++;}};
 const container=new Element('div'),view=createOptimizationComposer({controller,container,fieldName:'画面'});t.after(()=>view.destroy());
 const fence=find(container,e=>e.tagName==='button'&&e.textContent==='封存原批次');assert.ok(fence);assert.equal(fence.hidden,false);await fence.onclick({preventDefault(){},stopPropagation(){}});assert.equal(calls,1);
 state={...state,permissions:{...state.permissions,canFence:false}};notify(state);assert.equal(fence.hidden,true);
});
