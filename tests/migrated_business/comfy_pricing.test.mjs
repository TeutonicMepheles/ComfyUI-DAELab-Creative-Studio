import test from 'node:test';
import assert from 'node:assert/strict';
import {createComfyPriceEstimator} from '../../frontend/src/integrations/comfyui/business/comfy_pricing.js';

function node(expr,model='Seedance 2.0 Mini'){
 return {
  input:{required:{model:['COMFY_DYNAMICCOMBO_V3',{options:[{key:model,inputs:{required:{
   duration:['INT',{default:4}],resolution:[['480p','720p'],{}],task_type:[['auto','edit'],{}],generate_audio:['BOOLEAN',{default:true}]
  }}}]}]}},
  price_badge:{engine:'jsonata',depends_on:{widgets:[{name:'model',type:'COMBO'},{name:'model.duration',type:'INT'},{name:'model.resolution',type:'COMBO'},{name:'model.task_type',type:'COMBO'},{name:'model.generate_audio',type:'BOOLEAN'}],input_groups:['model.reference_images','model.reference_videos'],inputs:['first_frame','last_frame']},expr}
 };
}
const input=(extra={})=>({model:'Seedance 2.0 Mini',kind:'video',mode:'text2video',settings:{},media:[],...extra});

test('native widget defaults, normalization and current settings reach the official expression',async()=>{
 const estimate=createComfyPriceEstimator(type=>{
  assert.equal(type,'ByteDance2TextToVideoNode');
  return node('{"type":"usd","usd":$lookup(widgets,"model.duration") * ($lookup(widgets,"model.resolution") = "720p" ? 0.2 : 0.1)}');
 });
 assert.deepEqual(await estimate(input()),{min:84.4,max:84.4});
 assert.deepEqual(await estimate(input({settings:{duration:'8',resolution:'720P'}})),{min:337.6,max:337.6});
 const normalized=createComfyPriceEstimator(()=>node('{"type":"usd","usd":($lookup(widgets,"model") = "seedance 2.0 mini" and $lookup(widgets,"model.task_type") = "auto" and $lookup(widgets,"model.generate_audio") = false) ? 1 : 0}'));
 assert.deepEqual(await normalized(input({settings:{enableSound:'off'}})),{min:211,max:211});
});

test('mixed reference estimates use actual media counts and preserve ranges',async()=>{
 const estimate=createComfyPriceEstimator(type=>{
  assert.equal(type,'MinimaxHailuo03ReferenceNode');
  return node('{"type":"range_usd","min_usd":$lookup(inputGroups,"model.reference_images") * 0.1,"max_usd":$lookup(inputGroups,"model.reference_videos") + 1}','MiniMax H3');
 });
 assert.deepEqual(await estimate(input({model:'Minimax H3',mode:'mixed2video',media:[{kind:'image'},{kind:'image'},{kind:'video'}]})),{min:42.2,max:422});
});

test('frame inputs and local or unsupported models are handled separately',async()=>{
 const estimate=createComfyPriceEstimator(type=>{
  assert.equal(type,'ByteDance2FirstLastFrameNode');
  return node('{"type":"usd","usd":inputs.first_frame.connected ? (inputs.last_frame.connected ? 2 : 1) : 0}');
 });
 assert.deepEqual(await estimate(input({mode:'singleImage2video'})),{min:211,max:211});
 assert.deepEqual(await estimate(input({mode:'frames2video'})),{min:422,max:422});
 assert.equal(await estimate(input({model:'MiniMax H3 FL（本地）'})),null);
 assert.equal(await estimate(input({kind:'image',model:'GPT Image 2'})),null);
});

test('missing or invalid prices never turn into zero; a genuine zero remains valid',async()=>{
 assert.equal(await createComfyPriceEstimator(()=>undefined)(input()),null);
 for(const expr of ['{"type":"text","text":"unavailable"}','{"type":"usd","usd":-1}','{"type":"usd","usd":"unknown"}','{}']){
  assert.equal(await createComfyPriceEstimator(()=>node(expr))(input()),null);
 }
 assert.deepEqual(await createComfyPriceEstimator(()=>node('{"type":"usd","usd":0}'))(input()),{min:0,max:0});
});
