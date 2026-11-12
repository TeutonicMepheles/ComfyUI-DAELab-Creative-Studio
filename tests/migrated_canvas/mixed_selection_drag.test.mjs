import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {GROUP_TYPE,expandGroupSelection} from '../../frontend/src/features/groups/material_group_model.mjs';

const source=readFileSync(new URL('../../frontend/src/canvas/creative_canvas_view.mjs',import.meta.url),'utf8');
const ast=ts.createSourceFile('view.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),fns=[];
function visit(n){if(ts.isFunctionDeclaration(n)&&['startCardDrag','moveCards','finishCardDrag'].includes(n.name?.text))fns.push(n.getText(ast));ts.forEachChild(n,visit);}visit(ast);
function fixture(){
 const nodes=[{id:1,type:'DAELAB.MediaUpload',properties:{}},{id:2,type:'DAELAB.LibTV.VideoGenerate',properties:{}},{id:3,type:'DAELAB.ScriptParser',properties:{}}];
 const graph={getNodeById:id=>nodes.find(n=>n.id===id)},selected=new Set([1,2,3]),cards=new Map(nodes.map(n=>[n.id,{node:n,layout:{x:n.id*100,y:20}}]));
 const events=[],root={focus(){},setPointerCapture(){events.push('capture');},hasPointerCapture:()=>true,releasePointerCapture(){events.push('release');}},state={viewport:{zoom:.5}};
 const globals={GROUP_TYPE,expandGroupSelection,graph,selected,cards,root,state,host:{nodes:()=>nodes},message:m=>events.push(m),select(node){selected.clear();selected.add(node.id);},raise(){},update(){},drawWires(){},dirty(){events.push('dirty');},history:{begin(){events.push('begin');},end(){events.push('end');}}};
 const api=new Function(...Object.keys(globals),`let drag=null;${fns.join('\n')}return {startCardDrag,moveCards,finishCardDrag};`)(...Object.values(globals));
 const event=(x=0,y=0,interactive=false)=>({button:0,pointerId:7,clientX:x,clientY:y,target:{closest:()=>interactive?{}:null},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}});
 return{api,nodes,selected,cards,events,event};
}
test('mixed selection moves by identical zoom-adjusted delta and commits one transaction',()=>{
 const f=fixture(),down=f.event();assert.equal(f.api.startCardDrag(f.cards.get(2),down),true);assert.equal(down.defaultPrevented,true);assert.deepEqual(f.events,[]);
 f.api.moveCards(f.event(2,1));assert.deepEqual(f.events,[]);
 f.api.moveCards(f.event(40,20));for(const [id,c]of f.cards)assert.deepEqual(c.layout,{x:id*100+80,y:60});
 f.api.moveCards(f.event(50,30));f.api.finishCardDrag();assert.equal(f.events.filter(e=>e==='begin').length,1);assert.equal(f.events.filter(e=>e==='end').length,1);
 for(const n of f.nodes)assert.equal(n.properties.daelabLayoutRevision,1);
});
test('first drag on an unselected card moves only that card and suppresses text selection',()=>{
 const f=fixture(),down=f.event();f.selected.delete(2);
 assert.equal(f.api.startCardDrag(f.cards.get(2),down),true);assert.equal(down.defaultPrevented,true);
 f.api.moveCards(f.event(20,0));f.api.finishCardDrag();
 assert.deepEqual([...f.cards.values()].map(c=>c.layout.x),[100,240,300]);
});
test('cancel restores every position and temporary group membership',()=>{
 const f=fixture(),owner={id:4,type:GROUP_TYPE,properties:{members:[1]}};f.nodes.push(owner);
 f.api.startCardDrag(f.cards.get(2),f.event());f.api.moveCards(f.event(40,20));assert.deepEqual(owner.properties.members,[]);
 f.api.finishCardDrag(true);assert.deepEqual(owner.properties.members,[1]);for(const[id,c]of f.cards)assert.deepEqual(c.layout,{x:id*100,y:20});
 assert.ok(f.nodes.every(n=>!n.properties.daelabLayoutRevision));
});
test('interactive controls and locked members do not begin a mixed move',()=>{
 const f=fixture(),down=f.event(0,0,true);assert.equal(f.api.startCardDrag(f.cards.get(2),down),false);assert.equal(down.defaultPrevented,false);
 f.nodes.push({id:4,type:GROUP_TYPE,properties:{members:[1],locked:true}});assert.equal(f.api.startCardDrag(f.cards.get(2),f.event()),false);
 assert.ok(!f.events.includes('begin'));
});

test('column divider owns pointerdown ahead of selected card movement',()=>{
 const f=fixture(),e=f.event();
 e.target.closest=selector=>selector.includes('.dae-column-divider')?{}:null;
 assert.equal(f.api.startCardDrag(f.cards.get(3),e),false);
 assert.deepEqual(f.events,[]);
 assert.deepEqual(f.cards.get(3).layout,{x:300,y:20});
});
test('selected group expands its members once and retains ownership on commit',()=>{
 const f=fixture(),owner={id:4,type:GROUP_TYPE,properties:{members:[1]}};f.nodes.push(owner);f.cards.set(4,{node:owner,layout:{x:400,y:20}});f.selected.delete(1);f.selected.add(4);
 f.api.startCardDrag(f.cards.get(2),f.event());f.api.moveCards(f.event(40,20));f.api.finishCardDrag();
 assert.deepEqual(owner.properties.members,[1]);assert.equal(f.cards.get(1).layout.x,180);assert.equal(f.cards.get(4).layout.x,480);
});
test('selection hull covers business nodes while grouping toolbar remains material-only',()=>{
 const text=readFileSync(new URL('../../frontend/src/features/groups/material_groups.mjs',import.meta.url),'utf8'),tree=ts.createSourceFile('groups.mjs',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let fn;
 function scan(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='positionCreateButton')fn=n.getText(tree);ts.forEachChild(n,scan);}scan(tree);
 const selectionBox={style:{}},createButton={style:{},offsetWidth:200,offsetHeight:40},selectionCount={},root={clientWidth:1000,clientHeight:800,getBoundingClientRect:()=>({left:0,top:0,right:1000,bottom:800})};
 const cards=new Map([[1,{left:100,top:100,right:300,bottom:300,width:200,height:200}],[2,{left:600,top:400,right:900,bottom:700,width:300,height:300}]]);
 const position=new Function('root','isGroupMember','card','selectionBox','createButton','selectionCount',`${fn};return positionCreateButton;`)(root,n=>n.material,id=>({getBoundingClientRect:()=>cards.get(id)}),selectionBox,createButton,selectionCount);
 position([{id:1},{id:2}]);assert.equal(selectionBox.hidden,false);assert.equal(selectionBox.style.width,'820px');assert.equal(createButton.hidden,true);
 position([{id:1,material:true},{id:2}]);assert.equal(selectionBox.hidden,false);assert.equal(createButton.hidden,true);
 position([{id:1,material:true},{id:2,material:true}]);assert.equal(createButton.hidden,false);assert.equal(selectionCount.textContent,'2 项');
});

