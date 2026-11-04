import test from 'node:test';
import assert from 'node:assert/strict';
import {bindBusinessService,installBusinessHost} from '../../frontend/src/contracts/business.js';
import {optimizeRow} from '../../frontend/src/features/prompt/llm_local_provider.mjs';
test('standalone PE and 27B submit their exact identities via optimization polish without cloud fallback',async()=>{
 const original=globalThis.FileReader,calls=[];
 globalThis.FileReader=class{readAsDataURL(){this.result='data:image/png;base64,YQ==';queueMicrotask(()=>this.onload());}};
 const stopHost=installBusinessHost({fetchNative:async()=>new Response(new Blob(['image'],{type:'image/png'}))});
 const off=bindBusinessService('optimization',{async request(action,options){assert.equal(action,'polish');const body=JSON.parse(options.body);calls.push(body);return Response.json({requestId:body.requestId,result:'A complete prompt',model:body.model});}});
 try{
  await optimizeRow({text:'Keep product',image:{url:'data:image/png;base64,YQ=='}},'reverse','Forest',{model:'qwen-image-2.1-pe',requestId:'pe-exact'});
  await optimizeRow({text:'A white box'},'polish','Keep subject',{model:'qwen3.8-27b-w4a8',requestId:'27b-exact'});
  assert.deepEqual(calls.map(body=>[body.model,body.mode,body.requestId]),[['qwen-image-2.1-pe','reverse','pe-exact'],['qwen3.8-27b-w4a8','polish','27b-exact']]);
  assert.ok(calls[0].imageDataUrl);assert.equal(calls[1].imageDataUrl,undefined);
 }finally{off();stopHost();if(original===undefined)delete globalThis.FileReader;else globalThis.FileReader=original;}
});
