import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isGroupSlot,localAsset} from '../../frontend/src/features/editor/video_edit_model.mjs';

const source=readFileSync(new URL('../../frontend/src/integrations/comfyui/canvas/video_edit.js',import.meta.url),'utf8');
const start=source.indexOf('    function connectionInputs(){'),end=source.indexOf('\n    function connected(){',start);
const read=(node,adapter)=>new Function('node','adapterFor','isGroupSlot','localAsset','nativeSnapshot',`${source.slice(start,end)};return connectionInputs();`)(node,()=>adapter,isGroupSlot,localAsset,value=>JSON.parse(JSON.stringify(value)));

test('multi-result direct input freezes every original output without a single preview',()=>{
 const assets=Array.from({length:4},(_,i)=>({id:`result-${i}`,kind:'video',url:`/view?filename=${i}.mp4&type=output`,provenance:{requestId:`request-${i}`}}));
 const collection={version:1,ready:true,assets},node={inputs:[{name:'videos.video0',link:1}],graph:{links:{1:{origin_id:9}},getNodeById:()=>({id:9})}};
 const adapter={assets:()=>collection,preview:()=>null};
 const frozen=read(node,adapter);
 assert.deepEqual(frozen.videos['videos.video0'],collection);
 const restored={...node,inputs:JSON.parse(JSON.stringify(node.inputs))};
 assert.deepEqual(read(restored,adapter),frozen);
});

test('empty published collection refuses export rather than switching to preview',()=>{
 const node={inputs:[{name:'videos.video0',link:1}],graph:{links:{1:{origin_id:9}},getNodeById:()=>({id:9})}};
 const adapter={assets:()=>({version:1,assets:[]}),preview:()=>{throw Error('preview must not be consulted');}};
 assert.throws(()=>read(node,adapter),/没有可导出的素材/);
});
