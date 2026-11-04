import test from 'node:test';
import assert from 'node:assert/strict';
import {optimizeRow} from '../../frontend/src/features/prompt/llm_local_provider.mjs';
for(const model of ['qwen'])test(`${model} uses the shared real endpoint and preserves result identity`,async()=>{
 let calls=0;
 const row=await optimizeRow({text:'original'},'polish','keep',{model,fetcher:async(url,options)=>{
  calls++;assert.equal(url,'/daelab/prompt-optimization/polish');const body=JSON.parse(options.body);assert.equal(body.model,model);assert.equal(body.source,'original');
  return {ok:true,json:async()=>({requestId:body.requestId,result:'optimized',model})};
 }});
 assert.equal(calls,1);assert.equal(row.result,'optimized');assert.equal(row.model,model);
});
for(const [model,transport] of [['qwen3.5:9b-q4_K_M','qwen']])test(`${model} is persisted as a logical identity and aliased only at transport`,async()=>{
 let calls=0;
 const row=await optimizeRow({text:'original'},'polish','keep',{model,fetcher:async(_url,options)=>{
  calls++;const body=JSON.parse(options.body);assert.equal(body.model,transport);
  return {ok:true,json:async()=>({requestId:body.requestId,result:'optimized',model})};
 }});
 assert.equal(calls,1);assert.equal(row.result,'optimized');assert.equal(row.model,model);
});
test('retired DeepSeek is rejected before transport without silently switching models',async()=>{
 let calls=0;
 await assert.rejects(optimizeRow({text:'original'},'polish','',{model:'deepseek',fetcher:async()=>{calls++;return {ok:false,json:async()=>({error:'network unavailable'})};}}),/不支持/);
 assert.equal(calls,0);
});
