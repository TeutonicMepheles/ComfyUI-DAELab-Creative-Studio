import test from 'node:test';
import assert from 'node:assert/strict';
import {installDom} from './prompt_optimization_dom.mjs';
import {localImageSizePresets} from '../../frontend/src/features/generation/local_image_sizes.js';
import {createGenerationParameters,normalizeLocalGenerationConfig,generationParametersSummary} from '../../frontend/src/features/prompt/table_prompt_settings.mjs';
import {LOCAL_IMAGE_MODEL} from '../../frontend/src/features/generation/table_generation_model.mjs';

const schema={properties:{modeType:{items:{text2image:[],image2image:[1,1]}},ratio:{type:'string',enum:['auto','1:1','16:9','9:16']},width:{type:'integer',min:256,max:2048,step:32,default:1024},height:{type:'integer',min:256,max:2048,step:32,default:1024},seed:{type:'integer',default:-1}},config:{settings:['ratio','width','height'],advancedSettings:['seed'],imageSize:{min:256,max:2048,step:32,maxPixels:2097152,defaultWidth:1024,defaultHeight:1024,presets:[{ratio:'1:1',width:1024,height:1024},{ratio:'16:9',width:1536,height:864},{ratio:'9:16',width:864,height:1536}]}}};
function descendants(node){return (node.children||[]).flatMap(child=>[child,...descendants(child)]);}

test('local image presets obey declared dimensions and pixel limits without changing the schema',()=>{
 const before=JSON.stringify(schema);assert.equal(localImageSizePresets(schema).length,3);assert.equal(JSON.stringify(schema),before);
 const invalid=structuredClone(schema);invalid.config.imageSize.presets.push({ratio:'16:9',width:1025,height:576},{ratio:'2:1',width:2048,height:2048});
 assert.equal(localImageSizePresets(invalid).length,3);
 assert.deepEqual(localImageSizePresets({}),[]);
});

test('Qwen shows auto and visual ratio buttons instead of editable width/height, preserving saved custom sizes',t=>{
 const dom=installDom(t);t.after(()=>dom.restore());
 const create=document.createElement.bind(document);t.mock.method(document,'createElement',tag=>{
  const node=create(tag);node.prepend=(...children)=>{for(const child of children)child.parentNode=node;node.children.unshift(...children);};return node;
 });
 const config={kind:'image',model:LOCAL_IMAGE_MODEL,mode:'image2image',settings:{width:1920,height:1024,seed:7}},before=JSON.stringify(config);
 normalizeLocalGenerationConfig(config,schema);assert.equal(JSON.stringify(config),before);
 const changes=[],root=createGenerationParameters(config,schema,{onMode(){},onSetting(){},onSettings:value=>changes.push(value)});
 const nodes=descendants(root);assert.equal(nodes.filter(node=>node.tagName==='input').length,0);assert.equal(nodes.filter(node=>node.tagName==='small').length,0);assert.ok(nodes.every(node=>!/[0-9]+[x×][0-9]+/.test(node.textContent||'')));
 assert.ok(nodes.some(node=>node.textContent==='自动'));
 const ratio=nodes.find(node=>node.tagName==='button'&&node.textContent.startsWith('16:9'));
 assert.ok(ratio);assert.ok(descendants(ratio).some(node=>node.className==='generation-ratio-shape'));
 ratio.onclick({preventDefault(){},stopPropagation(){}});
 assert.deepEqual(changes,[{ratio:'16:9',width:1536,height:864}]);assert.equal(JSON.stringify(config),before);
 nodes.find(node=>node.tagName==='button'&&node.textContent==='自动').onclick({preventDefault(){},stopPropagation(){}});
 assert.deepEqual(changes[1],{ratio:'auto',width:1024,height:1024});
 assert.match(generationParametersSummary({...config,settings:{...config.settings,ratio:'auto'}}),/自动比例/);
 root.dispose();
});

test('fresh local image settings choose auto while old dimensions do not silently migrate',()=>{
 const fresh={kind:'image',model:LOCAL_IMAGE_MODEL,mode:'text2image',settings:{}};
 normalizeLocalGenerationConfig(fresh,schema);assert.equal(fresh.settings.ratio,'auto');
 const old={kind:'image',model:LOCAL_IMAGE_MODEL,mode:'image2image',settings:{width:1920,height:1024,seed:7}};
 normalizeLocalGenerationConfig(old,schema);assert.equal(old.settings.ratio,undefined);assert.equal(old.settings.width,1920);
});
