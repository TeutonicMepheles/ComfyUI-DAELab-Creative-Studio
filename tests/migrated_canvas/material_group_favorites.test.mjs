import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../../frontend/src/features/groups/material_groups.mjs',import.meta.url),'utf8');
const tree=ts.createSourceFile('groups.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let body;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='saveMaterials')body=n.getText(tree);ts.forEachChild(n,visit);}visit(tree);
function setup({save,invalid=false}={}){
 const nodes=[{id:1,title:'One'},{id:2,title:'Two'}],snapshot=n=>n.id===2&&invalid?null:{assets:[{kind:'image',filename:`${n.id}.png`} ]};
 const graph={getNodeById:id=>nodes.find(n=>String(n.id)===String(id))},state={graph},saved=[],messages=[];
 const run=new Function('host','inputSnapshot','normalizeAsset','saveFavorite','say','TYPE',`let disposed=false;${body};return saveMaterials;`)(
  {graph:()=>state.graph},snapshot,v=>JSON.parse(JSON.stringify(v)),async value=>{if(save)await save(value,state);saved.push(value);},v=>messages.push(v),'group');
 return {nodes,graph,state,saved,messages,run};
}
test('saving a group and selected members captures each material once before awaiting',async()=>{
 const f=setup({save:async(v)=>{if(v.name==='One')f.nodes[1].title='Changed during save';}});
 await f.run([{type:'group',properties:{members:[1,2]}},f.nodes[0]]);
 assert.deepEqual(f.saved.map(v=>v.name),['One','Two']);
 assert.deepEqual(f.saved.map(v=>v.source.nodeId),['1','2']);
 assert.match(f.messages.at(-1),/已保存 2 项/);
});
test('unready selected material rejects before any favorites are saved',async()=>{
 const f=setup({invalid:true});await f.run(f.nodes);
 assert.equal(f.saved.length,0);assert.match(f.messages.at(-1),/尚未就绪/);
});
test('a failed save reports partial success without removing prior favorites',async()=>{
 const f=setup({save:async value=>{if(value.name==='Two')throw Error('storage unavailable');}});await f.run(f.nodes);
 assert.equal(f.saved.length,1);assert.match(f.messages.at(-1),/已保存 1 项；其余未保存：storage unavailable/);
});
test('changing workflows stops remaining saves and suppresses stale notices',async()=>{
 const f=setup({save:async(v,state)=>{state.graph={};}});await f.run(f.nodes);
 assert.equal(f.saved.length,1);assert.equal(f.messages.length,0);
});
