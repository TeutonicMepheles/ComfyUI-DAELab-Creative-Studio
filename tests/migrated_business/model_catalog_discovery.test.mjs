import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelCatalog} from '../../frontend/src/features/models/model_catalog.mjs';
import {loadModelDefinitions} from '../../frontend/src/integrations/comfyui/business/model_catalog_discovery.mjs';

test('catalog definition refresh replaces added and removed model identities',async()=>{
 const catalog=createModelCatalog();
 let response={models:[{id:'model-a',label:'Model A',family:'optimization',kind:'text',provider:'qwen'}]};
 await loadModelDefinitions(catalog,{force:true,request:async()=>response});
 assert.deepEqual(catalog.snapshot().map(model=>model.id),['model-a']);
 response={models:[{id:'model-b',label:'Model B',family:'optimization',kind:'text',provider:'deepseek'}]};
 await loadModelDefinitions(catalog,{force:true,request:async()=>response});
 assert.deepEqual(catalog.snapshot().map(model=>model.id),['model-b']);
});
