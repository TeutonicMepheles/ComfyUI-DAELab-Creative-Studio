import test from 'node:test';
import assert from 'node:assert/strict';
import {installBusinessHost} from '../../frontend/src/contracts/business.js';
import {createTextNodeFromCell} from '../../frontend/src/application/table_exchange.mjs';
import {promptSourceId,setPromptSource} from '../../frontend/src/features/prompt/table_prompt_source.mjs';
import {toColumnPrompt} from '../../frontend/src/features/prompt/table_prompt_template.mjs';
import {createMaterialTable} from '../../frontend/src/application/table_material_columns.mjs';

test('cell extraction creates one independent native text node and preserves the source cell',t=>{
 const table=createMaterialTable(),prompt=promptSourceId(table),media=table.fields[0].id,row=table.records[0];
 setPromptSource(table,prompt);row.values[media]=[{id:'image-a',name:'参考.png',url:'/view?filename=reference.png&type=input',kind:'image'}];
 row.values[prompt]={kind:'column-template',version:1,segments:[{type:'text',text:'保留文字\n'},{type:'column',fieldId:media,assetId:'image-a'},{type:'text',text:'\n结束'}]};
 const original=structuredClone(row);
 const events=[],nodes=[],graph={getNodeById(id){return nodes.find(node=>String(node.id)===String(id))||null;}};
 const source={id:3,type:'DAELAB.Table',graph,pos:[100,200],size:[1080,400]};
 const textNode={id:4,type:'DAELAB.TextInput',graph:null,pos:[0,0],widgets:[{name:'text',value:'',callback(value){this.value=value;}}],setSize(size){this.size=size;}};
 const host={
  history:{begin(){events.push('begin');},end(){events.push('end');},assertEditable(){},undo(){},redo(){},prepareNativeShortcut(){return false;},amend(fn){return fn();},updateViewport(){}},
  nodes:()=>nodes,createNode:type=>{assert.equal(type,'DAELAB.TextInput');return textNode;},addNode(_graph,node){events.push('add');nodes.push(node);node.graph=graph;},
  placeNode(node,position){events.push('place');assert.deepEqual(position,{x:1240,y:200,width:350});},focusNode(node){events.push('focus');assert.equal(node,textNode);},
  isSelected:()=>false,fetchNative:async()=>new Response(''),
 };
 const dispose=installBusinessHost(host);t.after(dispose);
 assert.equal(createTextNodeFromCell(source,table,{recordId:row.id,fieldId:prompt,title:'最终描述 · 拆出'}),textNode);
 assert.equal(textNode.widgets[0].value,'保留文字\n@参考.png\n结束');assert.deepEqual(textNode.pos,[1240,200]);assert.deepEqual(textNode.size,[350,220]);assert.equal(textNode.title,'最终描述 · 拆出');
 assert.deepEqual(events,['begin','add','place','focus','end']);assert.deepEqual(row,original);
 assert.equal(nodes[0],textNode);assert.equal(source.graph.getNodeById(4),textNode);
});

test('cell extraction rejects empty or unresolved references before opening history',t=>{
 const table=createMaterialTable(),prompt=promptSourceId(table),row=table.records[0];let began=0;
 const host={history:{begin(){began++;},end(){},assertEditable(){},undo(){},redo(){},prepareNativeShortcut(){return false;},amend(fn){return fn();},updateViewport(){}},nodes:()=>[],createNode(){throw new Error('should not create');},addNode(){},focusNode(){},isSelected:()=>false,fetchNative:async()=>new Response('')};
 const dispose=installBusinessHost(host);t.after(dispose);
 row.values[prompt]='';
 assert.throws(()=>createTextNodeFromCell({graph:{}},table,{recordId:row.id,fieldId:prompt}),/为空/);
 row.values[prompt]=toColumnPrompt('@缺失',row);row.values[prompt].segments=[{type:'column',fieldId:'missing'}];
 assert.throws(()=>createTextNodeFromCell({graph:{}},table,{recordId:row.id,fieldId:prompt}),/引用列已删除/);
 assert.equal(began,0);
});
