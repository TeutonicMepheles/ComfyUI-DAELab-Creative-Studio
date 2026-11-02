import test from 'node:test';
import assert from 'node:assert/strict';
import {bindBusinessService} from '../../frontend/src/contracts/business.js';
import {createModelCatalog,getModelCatalog,MODEL_STATUS,resetModelCatalogForTests} from '../../frontend/src/features/models/model_catalog.mjs';
import {modelOptionPresentation} from '../../frontend/src/features/models/model_catalog_ui.mjs';
import {createPromptOptimizationApi} from '../../frontend/src/features/prompt/prompt_optimization_api.mjs';
import {loadModelDefinitions,refreshModelCatalog,startModelCatalogDiscovery} from '../../frontend/src/integrations/comfyui/business/model_catalog_discovery.mjs';

test('catalog definition refresh replaces added and removed model identities',async()=>{
 const catalog=createModelCatalog();
 let response={models:[{id:'model-a',label:'Model A',family:'optimization',kind:'text',provider:'qwen'}]};
 await loadModelDefinitions(catalog,{force:true,request:async()=>response});
 assert.deepEqual(catalog.snapshot().map(model=>model.id),['model-a']);
 response={models:[{id:'model-b',label:'Model B',family:'optimization',kind:'text',provider:'deepseek'}]};
 await loadModelDefinitions(catalog,{force:true,request:async()=>response});
 assert.deepEqual(catalog.snapshot().map(model=>model.id),['model-b']);
});

test('real discovery awaits capability probes and disables explicit failures',async()=>{
 resetModelCatalogForTests();const models=[
  {id:'local-unavailable',label:'Local unavailable',family:'generation',kind:'image',provider:'local'},
  {id:'cloud-available',label:'Cloud available',family:'generation',kind:'image',provider:'comfy'},
  {id:'qwen-unavailable',label:'Qwen unavailable',family:'optimization',kind:'text',provider:'qwen'},
  {id:'cloud-text-available',label:'Cloud text available',family:'optimization',kind:'text',provider:'comfy'},
 ];
 const releaseGeneration=bindBusinessService('generation',{async request(action){
  if(action==='models')return Response.json({models});
  const query=new URL(action,'http://local.invalid/').searchParams;
  if(query.get('model')==='local-unavailable')return Response.json({code:'provider_unavailable',error:'not assembled'},{status:503});
  return Response.json({available:true,provider:'comfy'});
 }});
 const releaseOptimization=bindBusinessService('optimization',{async request(action,options){
  assert.equal(action,'capabilities');const model=JSON.parse(options.body).model;
  return Response.json({available:model==='cloud-text-available',models:[{id:model,provider:model==='qwen-unavailable'?'qwen':'comfy',available:model==='cloud-text-available'}]});
 }});
 try{
  await refreshModelCatalog({force:true});const catalog=getModelCatalog();
  assert.equal(catalog.get('local-unavailable').status,MODEL_STATUS.unavailable);
  assert.equal(catalog.get('local-unavailable').selectable,false);
  assert.equal(modelOptionPresentation(catalog.get('local-unavailable')).disabled,true);
  assert.equal(catalog.get('cloud-available').status,MODEL_STATUS.available);
  assert.equal(modelOptionPresentation(catalog.get('cloud-available')).disabled,false);
  assert.equal(catalog.get('qwen-unavailable').status,MODEL_STATUS.unavailable);
  assert.equal(catalog.get('qwen-unavailable').selectable,false);
  assert.equal(catalog.get('cloud-text-available').status,MODEL_STATUS.available);
 }finally{releaseGeneration();releaseOptimization();resetModelCatalogForTests();}
});

test('DeepSeek key add, remove and switch trigger fresh capability probes',async()=>{
 resetModelCatalogForTests();
 const models=[
  {id:'cloud-available',label:'Cloud available',family:'generation',kind:'image',provider:'comfy'},
  {id:'deepseek-flash',label:'DeepSeek API',family:'optimization',kind:'text',provider:'deepseek'},
 ];
 const deepseekCalls=[];
 let configured=false,available=true;
 const releaseGeneration=bindBusinessService('generation',{async request(action){
  if(action==='models')return Response.json({models});
  return Response.json({available:true,provider:'comfy'});
 }});
 const releaseOptimization=bindBusinessService('optimization',{async request(action,options){
  assert.equal(action,'capabilities');const model=JSON.parse(options.body).model;
  if(model==='deepseek-flash'){
   deepseekCalls.push({configured,available});
   return Response.json({available,deepseekKeyConfigured:configured,models:[{id:model,provider:'deepseek',available}]});
  }
  return Response.json({available:true,models:[{id:model,provider:'qwen',available:true}]});
 }});
 const waitFor=async predicate=>{for(let index=0;index<100;index++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('timed out');};
 try{
  startModelCatalogDiscovery();
  const keyApi=createPromptOptimizationApi({fetchApi:async()=>Response.json({})});
  const catalog=getModelCatalog();
  await waitFor(()=>deepseekCalls.length>=1&&catalog.get('deepseek-flash').status!==MODEL_STATUS.checking);
  assert.deepEqual(deepseekCalls.at(-1),{configured:false,available:true});
  assert.equal(catalog.get('deepseek-flash').status,MODEL_STATUS.unverified);
  configured=true;
  keyApi.setDeepSeekKey('synthetic-added');
  await waitFor(()=>deepseekCalls.length>=2&&catalog.get('deepseek-flash').status!==MODEL_STATUS.checking);
  assert.equal(catalog.get('deepseek-flash').status,MODEL_STATUS.available);
  assert.deepEqual(deepseekCalls.at(-1),{configured:true,available:true});
  keyApi.setDeepSeekKey('synthetic-switched');
  await waitFor(()=>deepseekCalls.length>=3&&catalog.get('deepseek-flash').status!==MODEL_STATUS.checking);
  assert.deepEqual(deepseekCalls.at(-1),{configured:true,available:true});
  assert.equal(catalog.get('deepseek-flash').status,MODEL_STATUS.available);
  configured=false;available=true;
  keyApi.clearDeepSeekKey();
  await waitFor(()=>deepseekCalls.length>=4&&catalog.get('deepseek-flash').status!==MODEL_STATUS.checking);
  assert.deepEqual(deepseekCalls.at(-1),{configured:false,available:true});
  assert.equal(catalog.get('deepseek-flash').status,MODEL_STATUS.unverified);
  assert.equal(catalog.get('deepseek-flash').selectable,true);
  configured=true;available=false;
  keyApi.setDeepSeekKey('synthetic-provider-unavailable');
  await waitFor(()=>deepseekCalls.length>=5&&catalog.get('deepseek-flash').status!==MODEL_STATUS.checking);
  assert.deepEqual(deepseekCalls.at(-1),{configured:true,available:false});
  assert.equal(catalog.get('deepseek-flash').status,MODEL_STATUS.unavailable);
  assert.equal(catalog.get('deepseek-flash').selectable,false);
 }finally{releaseGeneration();releaseOptimization();resetModelCatalogForTests();}
});
