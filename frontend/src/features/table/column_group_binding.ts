import type {Json} from '../../contracts/ports.js';
import type {TableData,TableRecord} from './contracts.js';

export interface BoundItem {identity:string;memberId:string;value:Json;}
export interface CellBinding {identity:string;memberId:string;recordId:string;assetId?:string;}
export interface ColumnBinding {groupId:string;groupStamp:string;columnStamp:string;mapping:CellBinding[];inputName?:string;inputLink?:string|number;}
export const columnStamp=(table:TableData,fieldId:string)=>JSON.stringify(table.records.map(row=>[row.id,row.values[fieldId]]));
export const groupStamp=(items:readonly BoundItem[])=>JSON.stringify(items);
const object=(value:Json|undefined):Record<string,Json>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value:null;
const list=(value:Json|undefined)=>Array.isArray(value)?value:[];
const unique=(items:readonly BoundItem[])=>{const seen=new Set<string>();return items.filter(item=>{if(seen.has(item.identity))return false;seen.add(item.identity);return true;});};

/** Reconcile references by identity and stable record, never flatten back into rows. */
export function planColumnBinding(table:TableData,fieldId:string,groupId:string,incoming:readonly BoundItem[],previous:ColumnBinding|undefined,
 {uid,text}:{uid:()=>string;text:(table:TableData,row:TableRecord,fieldId:string)=>string}) {
 const next=structuredClone(table),field=next.fields.find(f=>f.id===fieldId);
 if(!field||field.readonly)throw new Error('绑定列不存在或不可编辑');
 const media=['content','assets'].includes(field.type)&&field.presentation!=='prompt';
 const items=unique(incoming),initial=!previous||previous.groupId!==groupId;
 const reverse=!initial&&columnStamp(table,fieldId)!==previous.columnStamp;
 const changed=initial||reverse||groupStamp(incoming)!==previous.groupStamp;
 if(!changed)return null;
 const old=previous?.mapping||[],mapping:CellBinding[]=[];
 const addRow=()=>{if(next.records.length>=500)throw new Error('每张表最多500行，未修改绑定');const row={id:uid(),selected:true,values:Object.fromEntries(next.fields.map(f=>[f.id,['content','assets'].includes(f.type)?[]:'']))} as TableRecord;next.records.push(row);return row;};
 const empty=()=>media?[]:'';
 const assign=(row:TableRecord,item:BoundItem,assetId?:string)=>{
  if(media){const value=object(item.value);if(!value||!['image','video'].includes(String(value.kind)))throw new Error('素材类型与绑定列不兼容');const id=assetId||uid();row.values[fieldId]=[...list(row.values[fieldId]),{...value,id,assetId:value.assetId||value.id||item.identity,bindingIdentity:item.identity,sourceNodeId:item.memberId}];mapping.push({identity:item.identity,memberId:item.memberId,recordId:row.id,assetId:id});}
  else{if(typeof item.value!=='string')throw new Error('文本列不能绑定图片或视频组');row.values[fieldId]=item.value;mapping.push({identity:item.identity,memberId:item.memberId,recordId:row.id});}
 };
 if(reverse){
  const outgoing:BoundItem[]=[],seen=new Set<string>();
  for(const row of next.records){
   if(media){
    const kept:Json[]=[],cellIds=new Set<string>();
    for(const raw of list(row.values[fieldId])){
     const value=object(raw);if(!value||!['image','video'].includes(String(value.kind)))throw new Error('绑定素材数据无效');
     const prior=old.find(m=>m.recordId===row.id&&m.assetId===value.id&&!seen.has(m.identity));
     const identity=prior?.identity||'reference:'+uid();seen.add(identity);
     const memberId=items.find(item=>item.identity===identity)?.memberId||prior?.memberId||'';
     let assetId=String(value.id||uid());if(cellIds.has(assetId))assetId=uid();cellIds.add(assetId);
     kept.push({...value,id:assetId,bindingIdentity:identity});mapping.push({identity,memberId,recordId:row.id,assetId});outgoing.push({identity,memberId,value:{...value,id:assetId,bindingIdentity:identity}});
    }
    row.values[fieldId]=kept;
   }else{
    const value=text(next,row,fieldId);if(!value.trim())continue;
    const prior=old.find(m=>m.recordId===row.id),identity=prior?.identity||'row:'+row.id,memberId=prior?.memberId||'';
    mapping.push({identity,memberId,recordId:row.id});outgoing.push({identity,memberId,value});
   }
  }
  return {table:next,items:outgoing,mapping,reverse:true};
 }
 if(initial){
  for(const row of next.records)row.values[fieldId]=empty();
  items.forEach((item,index)=>assign(next.records[index]||addRow(),item));
 }else{
  const byIdentity=new Map(items.map(item=>[item.identity,item])),order=new Map(items.map((item,index)=>[item.identity,index]));
  for(const row of next.records){
   if(media){
    const mapped=old.filter(m=>m.recordId===row.id&&byIdentity.has(m.identity)).sort((a,b)=>order.get(a.identity)!-order.get(b.identity)!);
    row.values[fieldId]=[];for(const prior of mapped)assign(row,byIdentity.get(prior.identity)!,prior.assetId);
   }else{const prior=old.find(m=>m.recordId===row.id),item=prior&&byIdentity.get(prior.identity);row.values[fieldId]=empty();if(item)assign(row,item);}
  }
  const known=new Set(mapping.map(m=>m.identity));for(const item of items)if(!known.has(item.identity))assign(addRow(),item);
 }
 return {table:next,items,mapping,reverse:false};
}

export function clearBoundColumn(table:TableData,fieldId:string):TableData {
 const next=structuredClone(table),field=next.fields.find(f=>f.id===fieldId);if(!field)return next;
 for(const row of next.records)row.values[fieldId]=['assets','content'].includes(field.type)&&field.presentation!=='prompt'?[]:'';
 return next;
}
