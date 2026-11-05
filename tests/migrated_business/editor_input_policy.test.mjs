import test from 'node:test';
import assert from 'node:assert/strict';
import {canConnectEditorInput} from '../../frontend/src/integrations/comfyui/canvas/editor_input_policy.ts';
for(const map of [false,true])test(`native editor repeated inputs reject duplicates with ${map?'Map':'object'} links`,()=>{
 const link={origin_id:7,origin_slot:0},graph={links:map?new Map([[1,link]]):{1:link}},target={graph,inputs:[{link:1},{}]};
 assert.equal(canConnectEditorInput(target,{id:'7'},0,1),false);
 assert.equal(canConnectEditorInput(target,{id:7},0,0),true,'same existing slot is not a second route');
 assert.equal(canConnectEditorInput(target,{id:8},0,1),true);
 assert.equal(canConnectEditorInput(target,{id:7},1,1),true,'a different output is not rejected by native source alone');
 target.inputs[0].link=null;assert.equal(canConnectEditorInput(target,{id:7},0,1),true,'explicit disconnect permits reconnect');
});
