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

test('MiniMax polishing preserves literal speech when a completed model reply omits it',async()=>{
 const response='integrated_multimodal_description:\n[Shot 1]\n女孩嘴唇开合，发出声音。随后男生与她碰撞。';
 for(const [original,words] of [['一个小女孩说“你好”。一个男生撞了他','你好'],['一个小女孩说你好。一个男生撞了他','你好'],['一个小女孩说：你好呀。突然一个小男孩撞了过来','你好呀']]){
  const row=await optimizeRow({text:original},'polish','保留原意',{model:'qwen3.8-27b-w4a8',purpose:'video-minimax',sourceScope:{recordId:'one'},fetcher:async(_,options)=>{
   const body=JSON.parse(options.body);assert.equal(body.source,original);assert.ok(body.instruction.includes(JSON.stringify([words])));
   return Response.json({requestId:body.requestId,state:'succeeded',source:body.sourceScope,receipt:{kind:'text',text:response},result:response,inputFingerprint:'a'.repeat(64)});
  }});
  assert.equal(row.dialogueFallback,true);assert.equal(row.result,original.replace(words,'<d>[Chinese]'+words+'</d>'));
 }
});

test('speech checking keeps correct shots, preserves turn order, and excludes non-dialogue quotes',async()=>{
 const check=async(text,result,purpose='video-minimax')=>optimizeRow({text},'polish','保留原意',{purpose,fetcher:async(_,options)=>{
  const {requestId}=JSON.parse(options.body);return Response.json({requestId,result});
 }});
 const source='女孩说：“你好！”男生回答：“你好！”',line='<d>[Chinese]你好！</d>';
 const good='[Shot 1]\n女孩说 '+line+'。男生回答 '+line+'。';
 assert.equal((await check(source,good)).result,good);
 const dialogue='小女孩开口说：“你好”。随后，男生撞到了她。';
 const cast='一个小女孩和一个男生。',action='小女孩说{你好}。随后，男生撞了她。';
 const original='一个小女孩说“你好”。一个男生撞了他';
 assert.equal((await check(original,cast+action,'video-seedance')).result,action);
 assert.equal((await check(cast+action,cast+action,'video-seedance')).result,cast+action);
 const staticScene=cast+'两人并肩站着。';
 assert.equal((await check(original,staticScene,'video-seedance')).result,staticScene);
 assert.equal((await check(source,dialogue,'video-seedance')).result,dialogue.replace('“你好”','{你好}'));
 const marked='她说{你好}。屏幕上写着“欢迎”。<铃响>（钢琴曲）〖次日〗';
 assert.equal((await check(source,marked,'video-seedance')).result,marked);
 const quoted='女孩停下脚步，轻声说：“你好！”男生回答：“你好！”';
 assert.equal((await check(source,quoted)).result,quoted.replaceAll('你好！',line));
 assert.equal((await check(source,line)).dialogueFallback,true);
 const turns='她说：“Hello!” 他回答：“你好！”';
 assert.equal((await check(turns,'<d>[Chinese]你好！</d><d>[English]Hello!</d>')).dialogueFallback,true);
 assert.equal((await check('招牌上写着“你好”。','画面中的招牌写着“你好”。')).dialogueFallback,undefined);
 assert.equal((await check(source,'画面描述','image')).dialogueFallback,undefined);
 const tagged='她说“<d>[Chinese]你好</d>”。';assert.equal((await check(tagged,'发出声音')).result,tagged);
});
