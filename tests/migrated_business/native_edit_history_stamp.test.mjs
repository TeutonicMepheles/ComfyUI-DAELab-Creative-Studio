import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {bindBusinessDocument,installBusinessDocuments} from '../../frontend/src/integrations/comfyui/business/business_document_host.ts';
import {canvasHistory} from '../../frontend/src/integrations/comfyui/canvas/creative_history.mjs';

const helper=new URL('../../frontend/src/integrations/comfyui/business/native_edit_history_stamp.ts',import.meta.url);
// Before the candidate exists, exercise the actual previous stamp contract.
const stamp=existsSync(helper)?(await import(helper.href)).nativeEditHistoryStamp:JSON.stringify;
const KEY='daelabCreativeCanvasV1';
const snapshot=()=>({nodes:[{id:1,properties:{instruction:'base',unknown:{keep:true}}}],links:[[1,1,0,2,0,'TEXT']],extra:{ds:{scale:1,offset:[0,0]},[KEY]:{version:1,active:true,cards:{1:{x:10,y:20,width:300}},viewport:{x:60,y:60,zoom:1}}},unknown:{value:7}});
const view=s=>s.extra[KEY].viewport;
const clone=value=>JSON.parse(JSON.stringify(value));

function host(){
 const state=snapshot();
 state.nodes.push({id:2,properties:{instruction:'peer',unknown:{keep:2}}});
 const nodes=state.nodes.map(n=>({...n,properties:clone(n.properties)}));
 const graph={extra:state.extra,links:state.links,getNodeById:id=>nodes.find(n=>n.id===id),serialize:()=>({...state,nodes:nodes.map(({id,properties})=>({id,properties})),extra:graph.extra,links:graph.links})};
 for(const node of nodes)node.graph=graph;
 const read=()=>clone(graph.serialize());
 let begins=0,amends=0;
 const tracker={initialState:read(),activeState:read(),undoQueue:[],redoQueue:[],changeCount:0,
  squashState:{flush(){}},updateModified(){},
  captureCanvasState(){if(this.changeCount)return;const next=read();if(JSON.stringify(this.activeState)!==JSON.stringify(next)){this.undoQueue.push(this.activeState);this.activeState=next;this.redoQueue.length=0;}},
  beforeChange(){this.changeCount++;},afterChange(){this.changeCount--;this.captureCanvasState();},
  undo(){const next=this.undoQueue.pop();if(next){this.redoQueue.push(this.activeState);this.activeState=next;for(const n of next.nodes)graph.getNodeById(n.id).properties=clone(n.properties);graph.extra=clone(next.extra);}},
  redo(){const next=this.redoQueue.pop();if(next){this.undoQueue.push(this.activeState);this.activeState=next;for(const n of next.nodes)graph.getNodeById(n.id).properties=clone(n.properties);graph.extra=clone(next.extra);}},
 };
 const app={graph,rootGraph:graph,isGraphReady:true,extensionManager:{workflow:{activeWorkflow:{changeTracker:tracker}}}};
 const native=canvasHistory(app),history={...native,begin(){begins++;native.begin();},amend(fn){amends++;return native.amend(fn);}};
 installBusinessDocuments(app,history);
 const documents=nodes.map(n=>bindBusinessDocument(n,()=>n.properties,next=>{n.properties=next;}));
 return {graph,tracker,native,documents,nodes,get begins(){return begins;},get amends(){return amends;},
  input(index,text){documents[index].edit('input',draft=>{draft.instruction=text;},{group:'input-'+index});},
  navigate(patch){Object.assign(graph.extra[KEY].viewport,patch);native.updateViewport(graph.extra[KEY].viewport);},
 };
}

test('known navigation changes only the comparison, without mutating the serialized input',()=>{
 const a=snapshot(),b=clone(a);Object.assign(view(b),{x:-200,y:0,zoom:.5});
 const before=JSON.stringify(a),second=JSON.stringify(b);
 assert.equal(stamp(a),stamp(b));assert.equal(JSON.stringify(a),before);assert.equal(JSON.stringify(b),second);
});

test('real host binding and native viewport sync keep a continuous input in one history entry',async()=>{
 const h=host();h.input(0,'base ');h.navigate({x:-200,y:11,zoom:.5});h.input(0,'base | suffix');
 assert.equal(h.begins,1);assert.equal(h.amends,1);assert.equal(h.tracker.undoQueue.length,1);
 await h.documents[0].undo();assert.equal(h.nodes[0].properties.instruction,'base');assert.deepEqual(h.graph.extra[KEY].viewport,{x:-200,y:11,zoom:.5});
 h.navigate({x:400});assert.equal(h.tracker.redoQueue.length,1);
 await h.documents[0].redo();assert.equal(h.nodes[0].properties.instruction,'base | suffix');assert.equal(h.graph.extra[KEY].viewport.x,400);
});

test('another bound instance still breaks the prior input group',()=>{
 const h=host();h.input(0,'base ');h.input(1,'peer edited');h.input(0,'base | suffix');
 assert.equal(h.begins,3);assert.equal(h.amends,0);assert.equal(h.tracker.undoQueue.length,3);
 assert.equal(h.nodes[1].properties.instruction,'peer edited');
});

test('a known prompt-optimization revision/stamp change remains an intervening business change',()=>{
 const h=host();h.nodes[1].properties.daelabPromptOptimizationV1={rows:{first:{revision:1,stamp:'old prompt'}}};
 h.input(0,'base ');
 const row=h.nodes[1].properties.daelabPromptOptimizationV1.rows.first;row.revision=2;row.stamp='old prompt | SAVE-F6-A';
 h.navigate({x:-50});h.input(0,'base | suffix');
 assert.equal(h.begins,2);assert.equal(h.amends,0);assert.equal(row.revision,2);
});

test('unknown root/extra/Canvas/viewport data, cards, native ds and links remain significant',()=>{
 const mutations=[s=>s.unknown.value++,s=>{s.extra.future={x:1};},s=>{s.extra[KEY].future=1;},s=>{view(s).future=1;},s=>{s.extra[KEY].cards[1].x++;},s=>{s.extra.ds.scale=2;},s=>{s.links[0][4]=1;},s=>{s.nodes[0].properties.unknown.keep=false;}];
 for(const mutate of mutations){const a=snapshot(),b=clone(a);mutate(b);assert.notEqual(stamp(a),stamp(b));}
 for(const mutate of [g=>{g.extra.future=1;},g=>{g.extra[KEY].future=1;},g=>{g.extra[KEY].viewport.future=1;},g=>{g.extra[KEY].cards[1].width++;},g=>{g.extra.ds.scale=2;},g=>{g.links[0][4]=1;}]){
  const h=host();h.input(0,'base ');mutate(h.graph);h.input(0,'base next');assert.equal(h.begins,2);assert.equal(h.amends,0);
 }
});

test('unknown own __proto__, constructor and shared aliases survive exact shallow path projection',()=>{
 const a=snapshot();Object.defineProperty(view(a),'__proto__',{value:{opaque:1},enumerable:true});a.extra.constructor={kept:true};a.alias=view(a);
 const b=clone(a);Object.assign(view(b),{x:0,y:1,zoom:2});
 const projected=JSON.parse(stamp(a));assert.deepEqual(projected.extra[KEY].viewport.__proto__,{opaque:1});assert.deepEqual(projected.extra.constructor,{kept:true});
 assert.deepEqual(projected.alias,view(a));assert.equal(stamp(a),stamp(b));
 b.extra[KEY].viewport.__proto__.opaque=2;assert.notEqual(stamp(a),stamp(b));
 assert.equal(Object.getPrototypeOf(view(a)),Object.prototype);
});

test('null prototypes and frozen data descriptors are accepted without changing the source',()=>{
 const a=snapshot();for(const obj of [a,a.extra,a.extra[KEY],view(a)])Object.setPrototypeOf(obj,null);
 const b=clone(a);Object.assign(view(b),{x:100,y:200,zoom:2});
 for(const obj of [view(a),a.extra[KEY],a.extra,a])Object.freeze(obj);
 assert.equal(stamp(a),stamp(b));assert.equal(view(a).x,60);assert.equal(Object.getPrototypeOf(a),null);
});

test('future versions, missing paths, arrays and malformed navigation keep the original stringification',()=>{
 const cases=[s=>{s.extra[KEY].version=2;},s=>{delete s.extra[KEY].version;},s=>{Object.defineProperty(s.extra[KEY],'version',{enumerable:false});},s=>{s.extra[KEY].viewport=[];},s=>{view(s).x=Infinity;},s=>{view(s).y='60';},s=>{view(s).zoom=0;},s=>{view(s).zoom=3;},s=>{delete view(s).x;},s=>{delete s.extra;},s=>{s.extra=null;},s=>{s.extra[KEY]=[];}];
 for(const mutate of cases){const a=snapshot();mutate(a);assert.equal(stamp(a),JSON.stringify(a));}
 for(const a of [null,undefined,1,'string',[],true])assert.equal(stamp(a),JSON.stringify(a));
});

test('accessors on any projected layer fall back without an extra value read',()=>{
 for(const path of ['root','extra','canvas','viewport']){
  const a=snapshot(),obj={root:a,extra:a.extra,canvas:a.extra[KEY],viewport:view(a)}[path];let reads=0;
  Object.defineProperty(obj,'future',{enumerable:true,get(){reads++;return {owner:this===obj};}});
  const expected=JSON.stringify(a);assert.equal(reads,1);reads=0;
  assert.equal(stamp(a),expected);assert.equal(reads,1);
 }
});

test('custom toJSON and nonplain objects retain original receiver and one call',()=>{
 for(const path of ['root','extra','canvas','viewport']){
  const a=snapshot(),obj={root:a,extra:a.extra,canvas:a.extra[KEY],viewport:view(a)}[path];let calls=0;
  Object.defineProperty(obj,'toJSON',{value:function(key){calls++;assert.equal(this,obj);return {key,value:'opaque'};}});
  const expected=JSON.stringify(a);calls=0;assert.equal(stamp(a),expected);assert.equal(calls,1);
 }
 const a=snapshot();class Custom{}Object.setPrototypeOf(view(a),Custom.prototype);assert.equal(stamp(a),JSON.stringify(a));
});

test('opaque nested getters and toJSON are not cloned and retain their receivers',()=>{
 const a=snapshot();let calls=0;const nested={toJSON(){calls++;assert.equal(this,nested);return {kept:true};}};view(a).future=nested;
 const result=JSON.parse(stamp(a));assert.equal(calls,1);assert.deepEqual(result.extra[KEY].viewport.future,{kept:true});
 let reads=0;const opaque={get value(){reads++;assert.equal(this,opaque);return 7;}};view(a).future=opaque;
 assert.deepEqual(JSON.parse(stamp(a)).extra[KEY].viewport.future,{value:7});assert.equal(reads,1);
});

test('unsupported proxy metadata falls back; ordinary stringify errors are not retried',()=>{
 const a=snapshot();let reads=0;a.extra=new Proxy(a.extra,{getPrototypeOf(){throw Error('metadata unavailable');},get(target,key,receiver){if(key===KEY)reads++;return Reflect.get(target,key,receiver);}});
 const expected=JSON.stringify(a);reads=0;assert.equal(stamp(a),expected);assert.equal(reads,1);
 let calls=0;const bad={toJSON(){calls++;throw Error('same failure');}};assert.throws(()=>stamp(bad),/same failure/);assert.equal(calls,1);
 const cycle=snapshot();cycle.self=cycle;assert.throws(()=>stamp(cycle),TypeError);
});

test('detached and disposed bindings still reject editing after navigation',()=>{
 for(const kind of ['detach','dispose']){
  const h=host();h.input(0,'base ');h.navigate({x:100});
  if(kind==='detach')h.nodes[0].graph=null;else h.documents[0].dispose();
  assert.throws(()=>h.input(0,'late'));assert.equal(h.nodes[0].properties.instruction,'base ');
 }
});
