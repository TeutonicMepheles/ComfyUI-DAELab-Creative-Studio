import {isGeneration} from '../features/generation/table_generation_model.mjs';
import {expandedCellText} from '../features/prompt/table_prompt_template.mjs';

const kinds=['text','image','video'];
const labels={text:'文本',image:'图片',video:'视频'};
const mediaKinds=new Set(['image','video']);
export function tableOutputKey(fieldId,recordId=null){
    return recordId==null?`column:${encodeURIComponent(fieldId)}`:`cell:${encodeURIComponent(recordId)}:${encodeURIComponent(fieldId)}`;
}
export function parseTableOutputKey(key){
    const parts=String(key||'').split(':');
    if(parts[0]==='column'&&parts.length===2)return {fieldId:decodeURIComponent(parts[1]),recordId:null};
    if(parts[0]==='cell'&&parts.length===3)return {fieldId:decodeURIComponent(parts[2]),recordId:decodeURIComponent(parts[1])};
    return {fieldId:String(key||''),recordId:null};
}

function mediaIdentity(asset){
    return String(asset?.id||asset?.assetId||asset?.referenceId||asset?.sourceNodeId||asset?.url||'');
}

function validMedia(asset){
    if(!asset||!mediaKinds.has(asset.kind)||typeof asset.url!=='string')return false;
    try{
        const url=new URL(asset.url,'http://localhost'),params=url.searchParams;
        if(url.origin!=='http://localhost'||url.pathname!=='/view'||params.getAll('filename').length!==1||params.getAll('type').length!==1||params.getAll('subfolder').length>1||!['input','output'].includes(params.get('type')))return false;
        const filename=params.get('filename')||'';
        return asset.kind==='image'?/\.(png|jpe?g|webp)$/i.test(filename):/\.(mp4|webm|mov)$/i.test(filename);
    }catch{return false;}
}

function cellTexts(table,row,field,value){
    if(!['text','longtext','content'].includes(field.type)&&field.presentation!=='prompt')return [];
    if(typeof value==='string')return value.trim()?[{text:value,identity:`${row.id}:${field.id}`}]:[];
    if(field.presentation==='prompt'){
        try{const text=expandedCellText(table,row,field.id);return text.trim()?[{text,identity:`${row.id}:${field.id}`}]:[];}catch{return [];}
    }
    if(!Array.isArray(value))return [];
    return value.flatMap((item,index)=>{
        if(item?.kind!=='text'||typeof item.text!=='string'||!item.text.trim())return [];
        return [{text:item.text,identity:String(item.id||`${row.id}:${field.id}:${index}`)}];
    });
}

function cellMedia(value){
    if(!Array.isArray(value))return [];
    return value.filter(validMedia);
}

/**
 * Builds one order-stable table output plan. This function owns no DOM and does
 * not mutate the table; the canvas materializes each type as a group.
 */
export function tableMaterialSnapshot(table,fieldId,recordId=null){
    const field=table?.fields?.find(item=>item.id===fieldId);
    if(!field)throw new Error('输出列已不存在');
    const records=recordId==null?table.records||[]:[table.records?.find(row=>row.id===recordId)].filter(Boolean);
    if(recordId!=null&&!records.length)throw new Error('输出单元格已不存在');
    const assets=[],texts=[],textSources=[],seen=new Set(),groups=new Map();
    let skipped=0,deduplicated=0;
    const generation=isGeneration(field);
    const bucket=kind=>{
        if(!groups.has(kind))groups.set(kind,{kind,label:`${field.name||'表格列'} · ${labels[kind]}`,assetIndexes:[],textIndexes:[]});
        return groups.get(kind);
    };
    for(const row of records){
        const value=row.values?.[field.id],rowTexts=cellTexts(table,row,field,value),rowMedia=cellMedia(value);
        if(!rowTexts.length&&!rowMedia.length){skipped++;continue;}
        for(const text of rowTexts){
            const identity=`text:${text.identity}`;
            if(seen.has(identity)){deduplicated++;continue;}
            seen.add(identity);bucket('text').textIndexes.push(texts.length);texts.push(text.text);textSources.push({recordId:row.id,fieldId:field.id});
        }
        for(const asset of rowMedia){
            const identity=`${asset.kind}:${mediaIdentity(asset)}`;
            if(seen.has(identity)){deduplicated++;continue;}
            seen.add(identity);
            const state=row.meta?.generationColumns?.[field.id];
            const material={...asset,provenance:{...asset.provenance,fieldId:field.id,recordId:row.id,requestId:asset.provenance?.requestId||state?.requestId,materialId:asset.id}};
            bucket(asset.kind).assetIndexes.push(assets.length);assets.push(material);
        }
    }
    const outputGroups=kinds.flatMap(kind=>{
        const group=groups.get(kind);if(!group)return [];
        return [{...group,count:group.assetIndexes.length+group.textIndexes.length}];
    });
    return {
        version:1,
        label:(field.name||'表格列')+' · 输出',
        ready:assets.length+texts.length>0,
        scope:recordId==null?'column':'cell',
        fieldId:field.id,
        ...(recordId==null?{}:{recordId}),
        assets,
        texts,
        textSources,
        groups:outputGroups,
        skipped,
        deduplicated,
        ...(generation?{generation:true}:{}),
    };
}

export function generationMaterials(table,fieldId,recordId=null,{includeIndexes=false}={}){
    const plan=tableMaterialSnapshot(table,fieldId,recordId),rows=new Map();
    for(const [index,asset] of plan.assets.entries()){
        const recordId=asset.provenance?.recordId;if(recordId==null)continue;
        if(!rows.has(recordId))rows.set(recordId,{label:table.records.find(row=>row.id===recordId)?.name||`任务${table.records.findIndex(row=>row.id===recordId)+1}`,assetIndexes:[],textIndexes:[]});
        rows.get(recordId).assetIndexes.push(index);
    }
    for(const [index,source] of plan.textSources.entries()){
        const recordId=source.recordId;if(recordId==null)continue;
        if(!rows.has(recordId))rows.set(recordId,{label:table.records.find(row=>row.id===recordId)?.name||`任务${table.records.findIndex(row=>row.id===recordId)+1}`,assetIndexes:[],textIndexes:[]});
        rows.get(recordId).textIndexes.push(index);
    }
    const groups=[...rows.values()].flatMap(group=>{
        const count=group.assetIndexes.length+group.textIndexes.length;if(!count)return [];
        const kinds=new Set(group.assetIndexes.map(index=>plan.assets[index]?.kind).concat(group.textIndexes.length?['text']:[]));
        return [{
            label:group.label,count,...(includeIndexes?{kind:kinds.size===1?[...kinds][0]:'mixed',assetIndexes:group.assetIndexes,textIndexes:group.textIndexes}:{}),
        }];
    });
    return {...plan,groups};
}
