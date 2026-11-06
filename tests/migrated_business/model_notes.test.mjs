import test from 'node:test';
import assert from 'node:assert/strict';
import {modelNoteText} from '../../frontend/src/features/models/model_notes.js';
test('model notes use binding and workflow capability fields without inferring tier quality',()=>{
 const entry={capability:{weightBinding:{diffusion_models:{name:'minimax_int8_convrot.safetensors',path:'/private/not-for-display'},video_vae:{name:'vae_fp16.safetensors'}},sampling:{sampler:'res_multistep',steps:20},schema:{properties:{modeType:{items:{text2video:[0,0],frames2video:[2,2],image2video:[1,9]}}}}}};
 const text=modelNoteText(entry);assert.match(text,/INT8/);assert.match(text,/FP16/);assert.match(text,/20/);assert.match(text,/1–9/);assert.doesNotMatch(text,/private|safetensors|高配|画质/);
 assert.equal(modelNoteText({label:'High BF16 fastest'}),'');assert.equal(modelNoteText(null),'');
 const changed=structuredClone(entry);changed.capability.weightBinding.diffusion_models.name='model_nvfp4_awq.safetensors';assert.match(modelNoteText(changed),/NVFP4 \/ AWQ/);assert.doesNotMatch(modelNoteText(changed),/INT8/);
});
test('verified text binding and high workflow retain their own precision and sampler',()=>{
 assert.match(modelNoteText({capability:{weightBinding:{model:'qwen3.5:9b-q4_K_M'},maxOutputTokens:1024}}),/Q4_K_M/);
 assert.match(modelNoteText({capability:{sampling:{sampler:'lcm',steps:6}}}),/lcm.*6/);
 assert.equal(modelNoteText({capability:{weightBinding:{diffusion_models:{name:'unknown-name'}}}}),'');
});
