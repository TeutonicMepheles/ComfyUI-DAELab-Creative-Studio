import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stopCanvasPropagation} from '../../frontend/src/ui/creative_events.mjs';

const read=path=>readFileSync(new URL('../../frontend/src/'+path,import.meta.url),'utf8');
const contexts=[
  ['upload panel','integrations/comfyui/canvas/media_upload.js',"for(const event of ['pointerdown','dblclick','keydown','wheel'])root.addEventListener",'root'],
  ['text panel','integrations/comfyui/canvas/text_input.js',"for(const type of ['pointerdown','dblclick','keydown','wheel'])root.addEventListener",'root'],
  ['library drawer/dialog','features/assets/asset_library.mjs',"container.addEventListener('keydown',",'container'],
  ['table media preview','ui/material_thumbnail.mjs',"for(const type of ['pointerdown','pointerup','click','dblclick','keydown'])overlay.addEventListener",'overlay'],
  ['table new-column popup','features/table/table_structure.mjs','node.onkeydown=', 'node'],
];
function handler(path,marker,binding){
  const line=read(path).split('\n').find(line=>line.trim().startsWith(marker));assert.ok(line,`${path}: keyboard handler found`);
  let callback;
  const target={addEventListener(type,fn){if(type==='keydown')callback=fn;},set onkeydown(fn){callback=fn;}};
  const unexpected=()=>{throw new Error('composition boundary must not close editor or commit a field');};
  new Function(binding,'stopCanvasPropagation','dialog','closePreview','setOpen','toggle','closeColumn','name','save',line)(
    target,stopCanvasPropagation,{open:true},unexpected,unexpected,{focus:unexpected},unexpected,{},unexpected);
  assert.equal(typeof callback,'function');return callback;
}
for(const [label,path,marker,binding] of contexts){
  test(`${label} passes native save from a focused nested control and preserves local keys`,()=>{
    const callback=handler(path,marker,binding);
    for(const props of [{key:'s',ctrlKey:true},{key:'S',metaKey:true}]){
      let stopped=0,prevented=0;
      callback({type:'keydown',...props,target:{},stopPropagation(){stopped++;},preventDefault(){prevented++;}});
      assert.equal(stopped,0);assert.equal(prevented,0);
    }
    for(const props of [{key:'z',ctrlKey:true},{key:'s',ctrlKey:true,isComposing:true},{key:'s',ctrlKey:true,keyCode:229}]){
      let stopped=0,prevented=0;
      callback({type:'keydown',...props,target:{},stopPropagation(){stopped++;},preventDefault(){prevented++;}});
      assert.equal(stopped,1);assert.equal(prevented,0);
    }
  });
  if(binding==='container'||binding==='node')test(`${label} cannot close on IME Escape boundary`,()=>{
    const callback=handler(path,marker,binding);
    for(const props of [{isComposing:true},{keyCode:229}]){
      let stopped=0,prevented=0;
      callback({type:'keydown',key:'Escape',...props,target:{},stopPropagation(){stopped++;},preventDefault(){prevented++;}});
      assert.equal(stopped,1);assert.equal(prevented,0);
    }
  });
}
