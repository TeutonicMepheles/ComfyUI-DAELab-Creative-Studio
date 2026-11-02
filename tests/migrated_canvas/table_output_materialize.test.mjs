import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generationMaterials} from '../../frontend/src/application/table_material_output.mjs';

const source=readFileSync(new URL('../../frontend/src/canvas/creative_canvas_view.mjs',import.meta.url),'utf8');
const start=source.indexOf('    async function outputMaterials('),end=source.indexOf('\n    function tableOutput(',start);
assert.ok(start>=0&&end>start);
const connectTableOutput=function(sourceNode,group){
 const output=sourceNode.outputs.findIndex(slot=>slot.name==='table_json'),input=group.inputs.findIndex(slot=>slot.name==='source_report');
 return output>=0&&input>=0&&Boolean(sourceNode.connect(output,group,input));
};

function fixture(skipIndex=null){
 const asset=(id,kind)=>({id,assetId:id,kind,url:`/view?filename=${id}.${kind==='video'?'mp4':'png'}&type=output`,name:id});
 const table={fields:[{id:'result',name:'生成结果',type:'content',presentation:'generation',generation:{kind:'image'}}],records:[
  {id:'second',name:'第二行',values:{result:[asset('second-video','video')]},meta:{}},
  {id:'first',name:'第一行',values:{result:[asset('first-image','image'),asset('first-video','video')]},meta:{}},
 ],meta:{}};
 const plan=generationMaterials(table,'result'),created=[],links=[],messages=[];
 const byId=new Map(),sourceNode={id:'table',type:'DAELAB.Table',outputs:[{name:'table_json'}],inputs:[],connect(output,group,input){links.push([output,group,input]);return {id:links.length};}};byId.set(sourceNode.id,sourceNode);
 let serial=0;
 const createNode=type=>{
  const node={id:`node-${++serial}`,type,properties:{},graph:{getNodeById:id=>byId.get(id)},inputs:type==='DAELAB.MaterialGroup'?[{name:'collection_data'},{name:'source_report'}]:[],widgets:[]};
  if(type==='DAELAB.MaterialGroup')node.widgets=[{name:'collection_data',value:''}];
  if(type==='DAELAB.MediaUpload')node.widgets=[{name:'asset_data',value:''}];
  if(type==='DAELAB.TextInput')node.widgets=[{name:'text',value:''}];
  byId.set(node.id,node);created.push(node);return node;
 };
 const graph={id:'workflow',getNodeById:id=>byId.get(id)},state={viewport:{zoom:1},cards:{}},host={graph:()=>graph,nodeDefinition:type=>Boolean(type),removeNode(){},tickGroups(){}};
 const outputMaterials=new Function(
  'outputPending','snapshotFor','message','fetch','visible','graph','host','state','validConnection','history','GROUP_TYPE','createNode','UPLOAD_TYPE','adapterFor','collectionFor','connectTableOutput','dirty','sync','select','root',
  `${source.slice(start,end)}\nreturn outputMaterials;`,
 )(
  new Set(),()=>structuredClone(plan),value=>messages.push(value),async()=>({ok:true,json:async()=>({assets:plan.assets.flatMap((asset,index)=>index===skipIndex?[]:[{...asset,name:asset.name||asset.id,sourceIndex:index}]),skipped:skipIndex==null?0:1})}),
  true,graph,host,state,()=>true,{begin(){},end(){}},'DAELAB.MaterialGroup',createNode,'DAELAB.MediaUpload',()=>({}),group=>({version:1,assets:group.properties.members.map(id=>({nodeId:id}))}),connectTableOutput,()=>{},()=>{},()=>{}, {focus(){}},
 );
 return {table,plan,created,links,messages,outputMaterials,sourceNode};
}

test('generation row groups materialize as indexed, same-type canvas groups with persistent table lineage',async()=>{
 const f=fixture();
 await f.outputMaterials({node:f.sourceNode,materialKey:'column:result',element:{},tableOutput:true},{x:100,y:100});
 const groups=f.created.filter(node=>node.type==='DAELAB.MaterialGroup');
 assert.deepEqual(groups.map(group=>group.properties.materialType),['video','image','video']);
 assert.deepEqual(groups.map(group=>group.title),['第二行 · 视频','第一行 · 图片','第一行 · 视频']);
 assert.deepEqual(groups.map(group=>group.properties.members.length),[1,1,1]);
 assert.equal(f.links.length,3);
 assert.ok(f.messages.at(-1).startsWith('已输出 3 项素材'));
});

test('a missing local file is skipped while valid items in other groups still materialize',async()=>{
 const f=fixture(0);
 await f.outputMaterials({node:f.sourceNode,materialKey:'column:result',element:{},tableOutput:true},{x:100,y:100});
 const groups=f.created.filter(node=>node.type==='DAELAB.MaterialGroup');
 assert.deepEqual(groups.map(group=>group.title),['第一行 · 图片','第一行 · 视频']);
 assert.equal(f.links.length,2);
 assert.match(f.messages.at(-1),/已输出 2 项素材.*跳过 1 项/);
});

test('an exported video snapshot without texts materializes its existing asset identity',async()=>{
 const f=fixture(),asset={...f.plan.assets[0],referenceId:'export-reference',provenance:{requestId:'export-request'}};
 for(const key of Object.keys(f.plan))delete f.plan[key];
 Object.assign(f.plan,{version:1,ready:true,assets:[asset]});
 f.sourceNode.type='DAELAB.VideoEdit';f.sourceNode.outputs=[];
 await f.outputMaterials({node:f.sourceNode,element:{}},{x:100,y:100});
 const upload=f.created.find(node=>node.type==='DAELAB.MediaUpload');
 assert.ok(upload,f.messages.join('\n'));
 const output=JSON.parse(upload.widgets.find(widget=>widget.name==='asset_data').value);
 assert.equal(output.referenceId,'export-reference');
 assert.deepEqual(output.provenance,{requestId:'export-request'});
 assert.equal(f.created.filter(node=>node.type==='DAELAB.MaterialGroup').length,1);
 assert.equal(f.links.length,0);
});
