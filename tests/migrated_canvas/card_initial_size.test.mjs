import test from 'node:test';
import assert from 'node:assert/strict';
import {registerAdapter} from '../../frontend/src/canvas/creative_contract.mjs';
import {cardState,initialCardSize} from '../../frontend/src/canvas/creative_canvas_model.mjs';
import {copySnapshot} from '../../frontend/src/canvas/creative_navigation.mjs';

test('default aspect size is initialized once and saved manual layout is retained',t=>{
 t.after(registerAdapter('test.initial-aspect',{matches:n=>n.type==='InitialAspectFixture',width:900,initialAspectRatio:n=>n.parsed?null:16/9}));
 const a={id:'a',type:'InitialAspectFixture'},b={id:'b',type:'InitialAspectFixture'},state={cards:{}};
 assert.deepEqual(initialCardSize(a),{width:900,height:506.25});
 assert.equal(cardState(state,a).height,506.25);
 cardState(state,a).width=1120;
 assert.equal(cardState(state,a).height,506.25,'manual width is not forced back to a ratio');
 state.cards.b={x:10,y:20,width:760,expanded:true};
 assert.equal(cardState(state,b).width,760);assert.equal(cardState(state,b).height,undefined,'legacy layout is not migrated');
 const restored=JSON.parse(JSON.stringify(state));
 assert.equal(cardState(restored,a).width,1120);assert.equal(cardState(restored,a).height,506.25);
 assert.equal(copySnapshot({serialize:()=>({type:a.type})},restored.cards.a).layout.height,506.25);
 assert.equal('height' in copySnapshot({serialize:()=>({type:b.type})},restored.cards.b).layout,false);
 assert.deepEqual(initialCardSize({...a,parsed:true}),{width:900},'populated parser can return to natural content height');
 assert.deepEqual(initialCardSize({type:'UnknownFixture'}),{width:460});
});
