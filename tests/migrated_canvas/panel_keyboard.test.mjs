import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stopCanvasPropagation} from '../../frontend/src/features/table/list_editor_controls.mjs';
import {stopCanvasPropagation as sharedPropagation} from '../../frontend/src/ui/creative_events.mjs';

const editor=readFileSync(new URL('../../frontend/src/features/editor/video_edit_panel.mjs',import.meta.url),'utf8');
test('legacy table API re-exports the same shared propagation implementation',()=>{
  assert.equal(stopCanvasPropagation,sharedPropagation);
});
function editorHandlers(){
  const handlers=new Map(),root={addEventListener(type,fn){handlers.set(type,fn);}};
  const start=editor.indexOf("for(const event of ['pointerdown','pointermove','pointerup','dblclick','keydown','wheel'])");
  const end=editor.indexOf('\n    for(const player',start);
  assert.ok(start>=0&&end>start);
  new Function('root','stopCanvasPropagation',editor.slice(start,end))(root,stopCanvasPropagation);
  let menu;
  const menuStart=editor.indexOf("clipMenu.addEventListener('keydown',e=>{");
  const menuEnd=editor.indexOf("\n    track.addEventListener('contextmenu'",menuStart);
  new Function('clipMenu','stopCanvasPropagation','fitGroup',editor.slice(menuStart,menuEnd))({addEventListener(type,fn){menu=fn;}},stopCanvasPropagation,{contains:()=>false});
  return [handlers.get('keydown'),menu];
}
test('clip toolbar button and menu let Ctrl/Cmd+S reach native save without a second save dispatcher',()=>{
  for(const handler of editorHandlers())for(const props of [{key:'s',ctrlKey:true},{key:'S',metaKey:true}]){
    let stopped=0,prevented=0;
    handler({type:'keydown',...props,target:{},stopPropagation(){stopped++;},preventDefault(){prevented++;}});
    assert.equal(stopped,0,'focused copy/menu control must let native save propagate');assert.equal(prevented,0);
  }
});
test('clip containers keep IME boundary and ordinary editor key ownership',()=>{
  for(const handler of editorHandlers())for(const props of [{key:'s',ctrlKey:true,isComposing:true},{key:'s',ctrlKey:true,keyCode:229},{key:'z',ctrlKey:true}]){
    let stopped=0,prevented=0;
    handler({type:'keydown',...props,target:{},stopPropagation(){stopped++;},preventDefault(){prevented++;}});
    assert.equal(stopped,1);assert.equal(prevented,0);
  }
});
