import test from 'node:test';
import assert from 'node:assert/strict';
import {optimizeRow} from '../../web/features/prompt/llm_local_provider.mjs';
import {bindBusinessAuth} from '../../web/contracts/business.js';
const scope={documentId:'doc',tableId:'table',nodeId:'node',workflowSession:'workflow',epoch:1,recordId:'row',fieldId:'instruction',inputVersion:2};

test('independent GPT sends Comfy credentials only in headers and requires current login',async()=>{
 let current=true,calls=0;
 const unbind=bindBusinessAuth(async required=>{assert.equal(required,true);return {headers:{Authorization:'Bearer synthetic-comfy-token'},assertCurrent(){if(!current)throw Error('account changed');}};});
 try{
  const fetcher=async(url,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer synthetic-comfy-token');assert.ok(!options.body.includes('synthetic-comfy-token'));const body=JSON.parse(options.body);assert.equal(body.model,'gpt-6-luna');return new Response(JSON.stringify({requestId:body.requestId,result:'Synthetic result',model:'gpt-6-luna'}));};
  await optimizeRow({id:'row',text:'Synthetic input'},'polish','',{model:'gpt-6-luna',fetcher});
  current=false;
  await assert.rejects(optimizeRow({id:'row',text:'Synthetic input'},'polish','',{model:'gpt-6-luna',fetcher}),/account changed/);
  assert.equal(calls,1);
 }finally{unbind();}
});
test('independent Qwen preserves caller request identity and accepts only its completed immutable text receipt',async()=>{
 const calls=[],fetcher=async(url,options)=>{const payload=JSON.parse(options.body);calls.push({url,payload});return new Response(JSON.stringify({requestId:payload.requestId,result:'合成优化结果',model:'qwen3.5:9b-q4_K_M',state:'succeeded',source:payload.sourceScope,inputFingerprint:'a'.repeat(64),receipt:{kind:'text',text:'合成优化结果'}}));};
 const output=await optimizeRow({id:'row',text:'合成输入'},'polish','简洁',{fetcher,requestId:'fixed-request',sourceScope:scope});
 assert.equal(output.requestId,'fixed-request');assert.equal(output.result,'合成优化结果');assert.equal(calls.length,1);assert.deepEqual(calls[0].payload.sourceScope,scope);
});
test('wrong row, wrong request, missing receipt and incomplete Qwen response never become applicable and never retry',async()=>{
 for(const override of [{source:{...scope,recordId:'other'}},{requestId:'other'},{receipt:null},{state:'running'}]){
  let calls=0;const fetcher=async()=>{calls++;return new Response(JSON.stringify({requestId:'fixed',result:'合成结果',state:'succeeded',source:scope,inputFingerprint:'a'.repeat(64),receipt:{kind:'text',text:'合成结果'},...override}));};
  await assert.rejects(optimizeRow({id:'row',text:'输入'},'polish','',{fetcher,requestId:'fixed',sourceScope:scope}));assert.equal(calls,1);
 }
});
