import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';

test('production entry closure loads before graph initialization and exposes only formal business nodes',async t=>{
 const extensions=[],adapters=[],types=new Map();let graphReads=0;
 const app={registerExtension:extension=>extensions.push(extension),isGraphReady:false};
 Object.defineProperty(app,'graph',{get(){graphReads++;throw Error('graph not initialized');}});
 globalThis.__businessFixtureApp=app;
 const hooks=registerHooks({resolve(specifier,context,next){if(specifier==='/scripts/app.js')return {url:'fixture:business-app',shortCircuit:true};return next(specifier,context);},load(url,context,next){if(url==='fixture:business-app')return {format:'module',shortCircuit:true,source:'export const app=globalThis.__businessFixtureApp;'};return next(url,context);}});
 t.after(()=>{hooks.deregister();delete globalThis.__businessFixtureApp;});
 t.mock.method(globalThis,'setInterval',()=>{throw Error('Import must not start polling');});
 globalThis.addEventListener=()=>{};
 globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]={version:1,registerAdapter:(_name,adapter)=>adapters.push(adapter)};
 globalThis.LiteGraph={registerNodeType:(type,constructor)=>types.set(type,constructor)};
 globalThis.LGraphNode=class{constructor(){this.inputs=[];this.outputs=[];this.widgets=[];}addInput(name,type){this.inputs.push({name,type});}addOutput(name,type){this.outputs.push({name,type});}addWidget(_type,name,value){const w={name,value};this.widgets.push(w);return w;}};
 t.after(()=>{delete globalThis.addEventListener;delete globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')];delete globalThis.LiteGraph;delete globalThis.LGraphNode;});
 for(const file of ['business_bootstrap.js','app_mode_bypass.js','creative_canvas_adapter.js','daelab_comfytv_storyboard.js','libtv_panel.js','llm_style_preview.js','prompt_optimization_lifecycle.js','script_parser.js'])await import(`../../frontend/src/integrations/comfyui/business/${file}`);
 assert.equal(graphReads,0);assert.equal(new Set(extensions.map(e=>e.name)).size,extensions.length);
 for(const extension of extensions)extension.registerCustomNodes?.();
 assert.deepEqual([...types.keys()],['DAELAB.LLMStylePreviewB']);
 const formal=new Set(['DAELAB.Table','DAELAB.StoryboardImport','DAELAB.ScriptParser','DAELAB.LLMStylePreviewB','DAELAB.LibTV.VideoGenerate']);
 for(const adapter of adapters)for(const entry of adapter.menu||[])assert.equal(formal.has(entry.type),true,entry.type);
 for(const type of ['DAELAB.LLMStylePreviewA','DAELAB.LLMStylePreviewC','DAELAB.LLMStylePreviewD','DAELAB.LLMStylePreviewE','DAELAB.GPTImageStoryboardStage','DAELAB.LibTV.StoryboardBatch','Unknown.CustomNode']){
  assert.equal(adapters.some(a=>a.matches?.({type})),false,type);
  class Unknown{};const before=Object.getOwnPropertyDescriptors(Unknown.prototype);
  for(const extension of extensions)await extension.beforeRegisterNodeDef?.(Unknown,{name:type});
  assert.deepEqual(Object.getOwnPropertyDescriptors(Unknown.prototype),before,type);
 }
 const node=new(types.get('DAELAB.LLMStylePreviewB'))();
 assert.deepEqual(node.inputs.map(v=>[v.name,v.type]),[['原文','STRING'],['参考图片','IMAGE'],['素材组','DAELAB_ASSETS'],['多维表格','STRING'],['其他输入','*']]);
 assert.deepEqual(node.outputs.map(v=>[v.name,v.type]),[['结果','STRING'],['逐行结果','STRING']]);
 assert.deepEqual(node.widgets.map(v=>v.name),['applied_text','applied_rows']);
});
