import test from 'node:test';
import assert from 'node:assert/strict';
import {abovePopoverLayout} from '../../frontend/src/features/prompt/settings_popover_layout.js';
import {modelSourceKind} from '../../frontend/src/features/models/source_badge.js';
test('upward popovers align icon centers and remain above the trigger at viewport edges',()=>{
 const normal=abovePopoverLayout({left:100,top:500},{width:1000,height:800},{width:340,height:300},{anchorCenter:118,iconOffset:34});
 assert.deepEqual(normal,{left:84,top:192,maxHeight:484});
 const edge=abovePopoverLayout({left:980,top:85},{width:1000,height:600},{width:340,height:300},{anchorCenter:990,iconOffset:34});
 assert.equal(edge.left,652);assert.equal(edge.maxHeight,69);assert.equal(edge.top,8);assert.ok(edge.top+edge.maxHeight<=85-8);
});
test('source colors have semantic metadata and unknown does not borrow a known source color',()=>{
 assert.equal(modelSourceKind({provider:'local'}),'local');assert.equal(modelSourceKind({provider:'comfy'}),'api');assert.equal(modelSourceKind({provider:'future'}),'unknown');
});
