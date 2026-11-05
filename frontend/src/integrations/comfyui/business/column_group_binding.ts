import type {Json} from '../../../contracts/ports.js';
import type {TableData} from '../../../features/table/contracts.js';
import {planColumnBinding,clearBoundColumn,columnStamp,groupStamp,type BoundItem,type ColumnBinding} from '../../../features/table/index.js';
// @ts-expect-error Existing prompt expansion remains the sole text reference rule.
import {expandedCellText} from '../../../features/prompt/table_prompt_template.mjs';
// @ts-expect-error Existing ESM bridge owns the native tracker transaction.
import {canvasHistory} from '../canvas/creative_history.mjs';
// @ts-expect-error Public read-only material exchange has no TypeScript declaration.
import {inputSnapshot} from '../../../canvas/creative_input_exchange.mjs';
import {restoreBoundColumnInputs} from './table_column_targets.js';

interface Input {name:string;type:string;link?:number|string|null;daeColumnField?:string;}
interface Link {origin_id:string|number;origin_slot:number;}
interface Widget {name:string;value:string;callback?:(value:string)=>void;}
interface Panel {editor:{change:(mutate:(table:TableData)=>void,options?:{derived:boolean})=>void};render?:()=>void;}
interface Node {id:string|number;type:string;title?:string;mode?:number;graph?:Graph;properties:Record<string,unknown>;widgets?:Widget[];inputs:Input[];outputs?:{type:string}[];pos?:number[];size?:number[];__dataTable?:TableData;__scriptTable?:TableData;__dataTablePanel?:Panel;__scriptPanel?:Panel;__mediaUpload?:{render:()=>void};__daeTextPanel?:{sync:()=>void;invalidateSnapshot:()=>void};addInput:(name:string,type:string)=>void;disconnectInput?:(index:number)=>void;connect:(index:number,target:Node,input:number)=>unknown;}
interface Graph {_nodes:Node[];links:Map<number|string,Link>|Record<string,Link>;getNodeById:(id:string|number)=>Node|undefined;add:(node:Node)=>void;setDirtyCanvas?:(a:boolean,b:boolean)=>void;}
interface App {graph:Graph;rootGraph:Graph;configuringGraph?:boolean;isGraphReady?:boolean;registerExtension?:(extension:{name:string;setup:()=>void;afterConfigureGraph:()=>void})=>void;extensionManager?:{workflow?:{activeWorkflow?:{changeTracker?:{changeCount?:number;_restoringState?:boolean}}};toast?:{add:(message:unknown)=>void}};daelabColumnBindings?:{flush:(graph:Graph)=>void;start?:()=>void};}
declare const LiteGraph:{createNode:(type:string)=>Node|null};
const installed=new WeakSet<App>(),running=new WeakSet<Graph>();
const tableFor=(node:Node)=>node.__scriptTable||node.__dataTable;
const panelFor=(node:Node)=>node.__scriptPanel||node.__dataTablePanel;
const states=(node:Node)=>(node.properties.daelabColumnBindings||{}) as Record<string,ColumnBinding>;
const memberIds=(group:Node)=>Array.isArray(group.properties.members)?group.properties.members as (string|number)[]:[];
const assetUrl=(asset:Record<string,Json>)=>'/view?'+new URLSearchParams({filename:String(asset.filename),subfolder:String(asset.subfolder||''),type:String(asset.type||'input')});
function groupItems(group:Node):BoundItem[]{
 return memberIds(group).map(id=>{
  const member=group.graph?.getNodeById(id);if(!member||member.mode)throw new Error('绑定组中有缺失或停用素材');
  const identity=String(member.properties.daelabColumnReferenceId||'member:'+String(member.id));
  if(member.type==='DAELAB.TextInput'){const snapshot=member.inputs.some(i=>i.link!=null)?inputSnapshot(member):null;if(snapshot?.ready===false)throw new Error('组内文本尚未就绪');return {identity,memberId:String(id),value:snapshot?.texts?.join('\n\n')??member.widgets?.find(w=>w.name==='text')?.value??''};}
  const raw=member.widgets?.find(w=>w.name==='asset_data')?.value,asset=JSON.parse(raw||'null') as Record<string,Json>|null;
  if(member.type!=='DAELAB.MediaUpload'||!asset?.filename||!['image','video'].includes(String(asset.kind)))throw new Error('绑定组有不可用素材');
  return {identity,memberId:String(id),value:{...asset,url:assetUrl(asset),name:asset.name||asset.filename}};
 });
}
function saveTable(node:Node,table:TableData){
 const panel=panelFor(node);if(!panel)throw new Error('绑定表格尚未就绪');
 if(JSON.stringify(table)!==JSON.stringify(tableFor(node)))panel.editor.change(draft=>Object.assign(draft,table),{derived:true});
}
function materialize(group:Node,items:BoundItem[],app:App){
 const graph=group.graph!;
 const members=items.map((item,index)=>{
  let member=graph.getNodeById(item.memberId),created=false;
  if(typeof item.value==='string'&&member?.inputs.some(i=>i.link!=null)&&groupItems(group).find(i=>i.memberId===item.memberId)?.value!==item.value)member=undefined;
  if(!member){member=LiteGraph.createNode(typeof item.value==='string'?'DAELAB.TextInput':'DAELAB.MediaUpload')||undefined;if(!member)throw new Error('素材节点未加载');graph.add(member);created=true;member.properties.daelabColumnReferenceId=item.identity;member.pos=[(group.pos?.[0]||0)+40+index*24,(group.pos?.[1]||0)+100];}
  const text=typeof item.value==='string',widget=member.widgets?.find(w=>w.name===(text?'text':'asset_data'));if(!widget)throw new Error('素材节点缺少保存字段');
  if(text){widget.value=item.value as string;delete member.properties.studioTextAsset;member.__daeTextPanel?.invalidateSnapshot();member.__daeTextPanel?.sync();}
  else{
   const cell=item.value as Record<string,Json>,url=new URL(String(cell.url),'http://localhost');
   if(url.origin!=='http://localhost'||url.pathname!=='/view'||!url.searchParams.get('filename'))throw new Error('绑定只接收已有本地素材引用');
   const asset:Record<string,Json>={...cell,filename:url.searchParams.get('filename')!,subfolder:url.searchParams.get('subfolder')||'',type:url.searchParams.get('type')||'input',id:cell.assetId||cell.id||item.identity};delete asset.bindingIdentity;delete asset.sourceNodeId;
   widget.value=JSON.stringify(asset);member.title=String(cell.name||url.searchParams.get('filename'));
   member.__mediaUpload?.render();
  }
  if(created){const canvas=app.rootGraph as Graph&{extra?:Record<string,unknown>};const state=canvas.extra?.daelabCreativeCanvasV1 as {cards?:Record<string,unknown>}|undefined;if(state?.cards)state.cards[String(member.id)]={x:member.pos?.[0]||0,y:member.pos?.[1]||0,width:280,expanded:false};}
  item.memberId=String(member.id);return member.id;
 });
 group.properties.members=members;
}
function flushBindings(app:App,graph:Graph){
 if(running.has(graph)||app.configuringGraph||app.isGraphReady===false||app.extensionManager?.workflow?.activeWorkflow?.changeTracker?._restoringState||app.graph!==graph)return;
 running.add(graph);
 try{
  // A reverse edit may update another bound column visited earlier in this pass.
  for(let pass=0;pass<3;pass++){
   let changed=false;
   for(const node of graph._nodes){
    const table=tableFor(node);if(!table||!panelFor(node)||node.mode)continue;
    restoreBoundColumnInputs(node);const saved=states(node),fields=new Set([...Object.keys(saved),...node.inputs.filter(i=>i.daeColumnField).map(i=>i.daeColumnField!)]);
    for(const fieldId of fields){
     let input=node.inputs.find(i=>i.daeColumnField===fieldId);
     if(!input&&saved[fieldId]){const candidates=node.inputs.filter(i=>{const link=i.link==null?null:graph.links instanceof Map?graph.links.get(i.link):graph.links[String(i.link)];return !i.daeColumnField&&i.name.startsWith('columns.')&&String(link?.origin_id)===saved[fieldId]?.groupId;});if(candidates.length>1)throw new Error('列绑定映射无法唯一恢复，已保留引用，请重新连接对应列头');if(candidates[0]){input=candidates[0];input.daeColumnField=fieldId;restoreBoundColumnInputs(node);}}
     const link=input?.link==null?null:graph.links instanceof Map?graph.links.get(input.link):graph.links[String(input.link)],group=link&&graph.getNodeById(link.origin_id);
     if(!group||group.type!=='DAELAB.MaterialGroup'){
      if(saved[fieldId]){saveTable(node,clearBoundColumn(tableFor(node)!,fieldId));delete saved[fieldId];changed=true;}
      continue;
     }
     if(!tableFor(node)!.fields.some(field=>field.id===fieldId)){if(input){node.disconnectInput?.(node.inputs.indexOf(input));delete input.daeColumnField;}const slots=node.properties.daelabColumnSlots as Record<string,unknown>|undefined;if(slots)delete slots[fieldId];delete saved[fieldId];changed=true;continue;}
     const items=groupItems(group),plan=planColumnBinding(tableFor(node)!,fieldId,String(group.id),items,saved[fieldId],{uid:()=>crypto.randomUUID(),text:expandedCellText});
     if(!plan)continue;
     if(plan.reverse)materialize(group,plan.items,app);
     for(const mapping of plan.mapping){mapping.memberId=plan.items.find(item=>item.identity===mapping.identity)?.memberId||mapping.memberId;const row=plan.table.records.find(row=>row.id===mapping.recordId);if(mapping.assetId&&row){const values=row.values[fieldId];if(Array.isArray(values))for(const value of values)if(value&&typeof value==='object'&&!Array.isArray(value)&&value.id===mapping.assetId)value.sourceNodeId=mapping.memberId;}}
     saveTable(node,plan.table);
     saved[fieldId]={groupId:String(group.id),mapping:plan.mapping,groupStamp:groupStamp(groupItems(group)),columnStamp:columnStamp(tableFor(node)!,fieldId),...(input?{inputName:input.name}:{}),...(input?.link!=null?{inputLink:input.link}:{})};node.properties.daelabColumnBindings=saved;changed=true;
    }
   }
   if(!changed)break;
  }
 }finally{running.delete(graph);}
}

export function installColumnBindings(app:App){
 if(installed.has(app))return;installed.add(app);
 let lastProblem='',polling=false;const flush=(graph:Graph)=>{try{flushBindings(app,graph);lastProblem='';}catch(error){const detail=String(error);if(detail!==lastProblem)app.extensionManager?.toast?.add({severity:'error',summary:'素材组列绑定',detail});lastProblem=detail;throw error;}};
 // Native canvas actions do not use our transaction wrapper; amend their state.
 const start=()=>{if(polling)return;polling=true;
 const timer=setInterval(()=>{
  const tracker=app.extensionManager?.workflow?.activeWorkflow?.changeTracker;
  if(app.isGraphReady===false||app.configuringGraph||tracker?._restoringState||tracker?.changeCount||!app.graph?._nodes.some(n=>Object.keys(n.properties?.daelabColumnBindings||{}).length||n.inputs?.some(i=>i.daeColumnField&&i.link!=null)))return;
  // Read-only comparison keeps ordinary ticks outside the host history machinery.
  const dirty=app.graph._nodes.some(node=>node.inputs?.some(input=>input.daeColumnField&&input.link!=null&&!states(node)[input.daeColumnField])||Object.entries((node.properties.daelabColumnBindings||{}) as Record<string,ColumnBinding>).some(([field,binding])=>{
   const table=tableFor(node),input=node.inputs.find(i=>i.daeColumnField===field),link=input?.link==null?null:app.graph.links instanceof Map?app.graph.links.get(input.link):app.graph.links[String(input.link)],group=link&&app.graph.getNodeById(link.origin_id);
   try{return !!table&&(!group||String(group.id)!==binding.groupId||columnStamp(table,field)!==binding.columnStamp||groupStamp(groupItems(group))!==binding.groupStamp);}catch{return false;}
  }));
  if(dirty)try{canvasHistory(app).amend(()=>flush(app.graph));}catch{/* flush reports the owned error once. */}
 },250);
 (timer as unknown as {unref?:()=>void}).unref?.();
 };
 app.daelabColumnBindings={flush,start};
 app.registerExtension?.({name:'DAELab.ColumnBindings',setup:start,afterConfigureGraph:start});
}

export {boundColumnTargets} from './table_column_targets.js';
export function bindColumnGroup(app:App,node:Node,fieldId:string,group:Node):boolean {
 if(group.type!=='DAELAB.MaterialGroup')return false;
 installColumnBindings(app);app.daelabColumnBindings?.start?.();const table=tableFor(node);if(!table?.fields.some(f=>f.id===fieldId&&!f.readonly))throw new Error('绑定列不可编辑');
 const items=groupItems(group);planColumnBinding(table,fieldId,String(group.id),items,undefined,{uid:()=>crypto.randomUUID(),text:expandedCellText});let index=node.inputs.findIndex(input=>input.daeColumnField===fieldId);
 if(index<0){index=node.inputs.findIndex(input=>input.name.startsWith('columns.')&&input.link==null&&!input.daeColumnField);if(index<0){const suffix=node.inputs.filter(input=>input.name.startsWith('columns.')).length;node.addInput('columns.column'+suffix,'DAELAB_ASSETS');index=node.inputs.length-1;}node.inputs[index]!.daeColumnField=fieldId;}
 restoreBoundColumnInputs(node);
 const output=group.outputs?.findIndex(output=>output.type==='DAELAB_ASSETS')??-1;if(output<0)throw new Error('素材组输出不可用');
 if(node.inputs[index]!.link!=null&&!window.confirm('此列已有素材组，替换绑定？'))return true;
 if(!group.connect(output,node,index))throw new Error('列绑定连线未建立');
 flushBindings(app,node.graph!);return true;
}
