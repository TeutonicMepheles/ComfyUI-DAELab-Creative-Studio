import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerAdapter} from '../../frontend/src/canvas/creative_contract.mjs';
import {acceptsTargetType,targetChoices,MATERIAL_SLOT} from '../../frontend/src/canvas/creative_connections.mjs';

// Execute the production registration functions, without initializing native panels.
function adapter(file){
 const source=readFileSync(new URL('../../frontend/src/integrations/comfyui/business/'+file,import.meta.url),'utf8');
 const start=source.indexOf('function register()'),end=source.indexOf("globalThis.addEventListener",start);
 let result;const sandbox={};sandbox[Symbol.for('DAELAB.CreativeCanvas.API.v1')]={version:1,registerAdapter:(_id,value)=>{result=value;}};
 new Function('globalThis','IMAGE_GENERATION_NODE','VIDEO_GENERATION_NODE',`let registered=false;const app={},installColumnBindings=()=>{};const isGenerationNode=type=>['DAELAB.ImageGenerate','DAELAB.VideoGenerate','DAELAB.LibTV.VideoGenerate'].includes(type),generationInputNames=()=>undefined;const key=Symbol.for('DAELAB.CreativeCanvas.API.v1'),TYPE='DAELAB.ScriptParser',tables=['DAELAB.Table','DAELAB.StoryboardImport'];${source.slice(start,end)};register();`)(sandbox,'DAELAB.ImageGenerate','DAELAB.VideoGenerate');
 return result;
}

for(const [file,types]of [['creative_canvas_adapter.js',['DAELAB.Table','DAELAB.StoryboardImport']],['script_parser.js',['DAELAB.ScriptParser']]]){
 test(file+' applies the same target policy to menus and existing compatible inputs',()=>{
  const production=adapter(file),release=registerAdapter('test.'+file,production);
  try{for(const type of types){
   const source={type,outputs:[{name:'table_json',type:'STRING',links:[7]}]},before=JSON.stringify(source);
   for(const destination of ['DAELAB.ImageGenerate','DAELAB.VideoGenerate','DAELAB.LLMStylePreviewB','DAELAB.TextInput','DAELAB.MediaUpload','DAELAB.Table','DAELAB.ScriptParser','DAELAB.VideoEdit','DAELAB.LibTV.VideoGenerate']){
    const allowed=['DAELAB.ImageGenerate','DAELAB.VideoGenerate'].includes(destination);
    assert.equal(acceptsTargetType(source,destination),allowed,destination);
    assert.equal(targetChoices(source,MATERIAL_SLOT,{type:destination,inputs:[{name:'table_json',type:'STRING'}]}).length,allowed?1:0,destination);
   }
   assert.equal(JSON.stringify(source),before,'stored links and slots remain intact');
  }}finally{release();}
 });
}
