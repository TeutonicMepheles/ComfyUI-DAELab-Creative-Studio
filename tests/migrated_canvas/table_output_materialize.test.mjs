import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generationMaterials,tableMaterialSnapshot} from '../../frontend/src/application/table_material_output.mjs';

const source=readFileSync(new URL('../../frontend/src/canvas/creative_canvas_view.mjs',import.meta.url),'utf8');
const start=source.indexOf('    async function outputMaterials('),end=source.indexOf('\n    function tableOutput(',start);
assert.ok(start>=0&&end>start);
test('cell output resolves the native owner when the graph node ID is numeric',()=>{
 const from=source.indexOf('    function tableOutput('),to=source.indexOf("\n    root.addEventListener('dae-table-output'",from);
 const node={id:17},graph={getNodeById:id=>id===17?node:null},card={dataset:{nodeId:'17'}},owners=new WeakMap([[card,{node}]]),calls=[];
 const handler=new Function('cards','cardOwners','visible','graph','host','root','MATERIAL_SLOT','outputMaterials',`${source.slice(from,to)};return tableOutput;`)(new Map([[17,{node}]]),owners,true,graph,{graph:()=>graph},{getBoundingClientRect:()=>({left:0,top:0})},-1,(...args)=>calls.push(args));
 handler({detail:{key:'cell:r:scene'},target:{closest:()=>card,getBoundingClientRect:()=>({right:100,top:50})},stopPropagation(){}});
 assert.equal(calls.length,1);assert.equal(calls[0][0].node,node);assert.equal(calls[0][0].materialKey,'cell:r:scene');
});
const connectTableOutput=function(sourceNode,group){
 const output=sourceNode.outputs.findIndex(slot=>slot.name==='table_json'),input=group.inputs.findIndex(slot=>slot.name==='source_report');
 return output>=0&&input>=0&&Boolean(sourceNode.connect(output,group,input));
};

function fixture(skipIndex=null,cell=false,options={}){
 const asset=(id,kind)=>({id,assetId:id,kind,url:`/view?filename=${id}.${kind==='video'?'mp4':'png'}&type=output`,name:id});
 const table={fields:[{id:'result',name:'生成结果',type:'content',presentation:'generation',generation:{kind:'image'}}],records:[
  {id:'second',name:'第二行',values:{result:[asset('second-video','video')]},meta:{}},
  {id:'first',name:'第一行',values:{result:[asset('first-image','image'),asset('first-video','video')]},meta:{}},
 ],meta:{}};
 const plan=cell?tableMaterialSnapshot(table,'result','second'):generationMaterials(table,'result'),created=[],links=[],messages=[],removed=[];
 const byId=new Map(),sourceNode={id:'table',type:'DAELAB.Table',outputs:[{name:'table_json'}],inputs:[],connect(output,group,input){links.push([output,group,input]);return {id:links.length};}};byId.set(sourceNode.id,sourceNode);
 let serial=0;
 const createNode=type=>{
  const node={id:`node-${++serial}`,type,properties:{},graph:{getNodeById:id=>byId.get(id)},inputs:type==='DAELAB.MaterialGroup'?[{name:'collection_data'},{name:'source_report'}]:[],widgets:[]};
  if(type==='DAELAB.MaterialGroup')node.widgets=[{name:'collection_data',value:''}];
  if(type==='DAELAB.MediaUpload')node.widgets=[{name:'asset_data',value:''}];
  if(type==='DAELAB.TextInput')node.widgets=[{name:'text',value:''}];
  byId.set(node.id,node);created.push(node);return node;
 };
 const graph={id:'workflow',getNodeById:id=>byId.get(id)},state={viewport:{zoom:1},cards:{}},host={graph:()=>graph,nodeDefinition:type=>Boolean(type),removeNode(_graph,node){removed.push(node.id);byId.delete(node.id);},tickGroups(){}};
 const outputMaterials=new Function(
  'outputPending','snapshotFor','message','fetch','visible','graph','host','state','validConnection','history','GROUP_TYPE','createNode','UPLOAD_TYPE','adapterFor','collectionFor','connectTableOutput','dirty','sync','select','root',
  `${source.slice(start,end)}\nreturn outputMaterials;`,
 )(
  new Set(),()=>structuredClone(plan),value=>messages.push(value),async()=>{if(options.fetchError)throw new Error('import failed');options.beforeResponse?.(plan);return {ok:true,json:async()=>({assets:plan.assets.flatMap((asset,index)=>index===skipIndex?[]:[{...asset,name:asset.name||asset.id,sourceIndex:index}]),skipped:skipIndex==null?0:1})};},
  true,graph,host,state,()=>true,{begin(){},end(){}},'DAELAB.MaterialGroup',createNode,'DAELAB.MediaUpload',()=>({takeMaterialItem:options.take}),group=>({version:1,assets:group.properties.members.map(id=>({nodeId:id}))}),connectTableOutput,()=>{},()=>{},()=>{}, {focus(){}},
 );
 return {table,plan,created,links,messages,removed,outputMaterials,sourceNode};
}

test('moving a cell asset commits its source removal only after one standalone node exists',async()=>{
 let taken=0;const f=fixture(null,true,{take(_node,key,stamp){assert.equal(key,'item');assert.equal(JSON.stringify(f.plan),stamp);assert.equal(f.created.length,1);taken++;f.table.records[0].values.result=[];}});
 f.plan.movable=true;
 await f.outputMaterials({node:f.sourceNode,itemKey:'item'},{x:0,y:0},{move:true});
 assert.equal(taken,1);assert.deepEqual(f.created.map(n=>n.type),['DAELAB.MediaUpload']);assert.equal(f.table.records[0].values.result.length,0);assert.equal(f.table.records[1].values.result.length,2);assert.match(f.messages.at(-1),/已移出 1/);
});
test('failed or stale move keeps the source, and a rejected source commit removes the new node',async()=>{
 for(const options of [{fetchError:true},{beforeResponse:plan=>{plan.assets[0].name='changed';}},{reject:true},{skip:0}]){
  let taken=0;const f=fixture(options.skip??null,true,{...options,take(){taken++;throw new Error('source changed');}});f.plan.movable=true;
  const before=JSON.stringify(f.table);
  await f.outputMaterials({node:f.sourceNode,itemKey:'item'},{x:0,y:0},{move:true});
  assert.equal(JSON.stringify(f.table),before);assert.equal(f.removed.length,f.created.length);assert.match(f.messages.at(-1),/输出失败/);
  assert.equal(taken,options.reject?1:0);
 }
});

test('single-cell single media materializes directly without a wrapper group',async()=>{
 const f=fixture(null,true);await f.outputMaterials({node:f.sourceNode,side:'output',materialKey:'cell:second:result'},{x:0,y:0});
 assert.deepEqual(f.created.map(n=>n.type),['DAELAB.MediaUpload']);assert.equal(f.created[0].properties.materialOutputSource.recordId,'second');assert.equal(f.links.length,0);
});

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
