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
 response={models:[{id:'model-b',label:'Model B',family:'optimization',kind:'text',provider:'qwen'}]};
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

test('retired DeepSeek cannot return through stale catalog definitions or key controls',()=>{
 resetModelCatalogForTests();const catalog=getModelCatalog();catalog.replaceDefinitions([{id:'deepseek-flash',provider:'deepseek',family:'optimization',kind:'text'},{id:'local-text',provider:'qwen',family:'optimization',kind:'text'}]);
 assert.equal(catalog.get('deepseek-flash'),null);assert.deepEqual(catalog.snapshot().map(model=>model.id),['local-text']);const api=createPromptOptimizationApi();assert.equal(api.setDeepSeekKey,undefined);assert.equal(api.hasDeepSeekKey,undefined);resetModelCatalogForTests();
});

test('native PE and 27B probe their own capabilities without entering table optimization or cloud',async()=>{
 resetModelCatalogForTests();const calls=[],ids=['qwen-image-2.1-pe','qwen3.8-27b-w4a8'];
 const release=bindBusinessService('generation',{async request(action){
  calls.push(action);
  if(action==='models')return Response.json({models:ids.map(id=>({id,label:id,family:'optimization',kind:'text',provider:'local'}))});
  assert.ok(ids.includes(new URL(action,'http://local.invalid/').searchParams.get('model')));
  return Response.json({available:true,provider:'local',local:true,requiresReference:true,modes:['reverse']});
 }});
 const forbid=bindBusinessService('optimization',{async request(){throw Error('PE must not use the table optimization contract');}});
 try{await refreshModelCatalog({force:true});for(const id of ids){const model=getModelCatalog().get(id);assert.equal(model.status,'available');assert.equal(model.provider,'local');}assert.equal(calls.length,3);}
 finally{release();forbid();resetModelCatalogForTests();}
});
