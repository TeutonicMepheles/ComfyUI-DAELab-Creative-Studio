import test from 'node:test';
import assert from 'node:assert/strict';
import {REWRITE_TEMPLATES,chooseRewriteTemplate,rewriteOptions,rewriteTemplateId} from '../../frontend/src/features/prompt/rewrite_templates.js';
import {processingInstruction} from '../../frontend/src/features/prompt/text_templates.js';
import {slotSignature} from '../../frontend/src/features/prompt/llm_slot_model.mjs';
import {optimizeRow} from '../../frontend/src/features/prompt/llm_local_provider.mjs';

test('four model templates preserve custom instructions and round-trip without Seedance',()=>{
 assert.equal(REWRITE_TEMPLATES.length,4);assert.ok(REWRITE_TEMPLATES.every(t=>!/seedance/i.test(t.id)));
 const state={instruction:'保留标志',purpose:'video',videoTarget:'seedance'};
 chooseRewriteTemplate(state,'qwen-expand');assert.equal(state.rewriteTask,'text2image');assert.equal(state.instruction,'保留标志');
 assert.equal(processingInstruction(state),'保留标志');assert.equal(rewriteTemplateId(state),'qwen-expand');
 state.rewriteTask='image-edit';chooseRewriteTemplate(state,'qwen-faithful');assert.equal(state.rewriteTask,'image-edit');
 chooseRewriteTemplate(state,'minimax-faithful');assert.equal(state.videoTarget,'minimax');assert.equal(state.rewriteTask,'text2video');
 assert.deepEqual(rewriteOptions(JSON.parse(JSON.stringify(state))),rewriteOptions(state));
});

test('template, task and duration changes invalidate results while legacy signatures stay compatible',()=>{
 const node={properties:{llmStylePreview:{source:'cat',mode:'polish',model:'qwen'}}};
 const old=slotSignature(node);assert.deepEqual(JSON.parse(old).slice(1),['polish','','qwen']);
 const state=node.properties.llmStylePreview;chooseRewriteTemplate(state,'minimax-faithful');const first=slotSignature(node);
 state.rewriteTask='frames2video';state.rewriteDuration=5;const second=slotSignature(node);assert.notEqual(first,second);
 state.rewriteDuration=6;assert.notEqual(second,slotSignature(node));
});

test('new requests carry frozen options, preserve review metadata and reject missing dialogue without silent fallback',async()=>{
 const rewrite={version:1,strength:'expand',task:'text2video'};
 let calls=0;
 const fetcher=async(_,options)=>{calls++;const body=JSON.parse(options.body);assert.deepEqual(body.rewrite,rewrite);return Response.json({requestId:body.requestId,result:'[Shot 1] A girl.',receipt:{metadata:{rewrite:{version:1,added_details:['Soft light'],warnings:[]}}}});};
 const result=await optimizeRow({text:'girl'},'polish','',{model:'qwen3.8-27b-w4a8',purpose:'video-minimax',rewrite,fetcher});
 assert.deepEqual(result.review.added_details,['Soft light']);
 await assert.rejects(optimizeRow({text:'女孩说“你好”'},'polish','',{model:'qwen3.8-27b-w4a8',purpose:'video-minimax',rewrite,fetcher}),/未完整保留对白/);
 assert.equal(calls,2);
});
