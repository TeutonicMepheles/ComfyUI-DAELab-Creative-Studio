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
    return String(asset?.assetId||asset?.referenceId||asset?.sourceNodeId||asset?.id||asset?.url||'');
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
    return value.filter(asset=>asset&&typeof asset.url==='string'&&asset.url&&mediaKinds.has(asset.kind));
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
    const assets=[],texts=[],seen=new Set(),groups=new Map();
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
            seen.add(identity);bucket('text').textIndexes.push(texts.length);texts.push(text.text);
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
        groups:outputGroups,
        skipped,
        deduplicated,
        ...(generation?{generation:true}:{}),
    };
}

export function generationMaterials(table,fieldId,recordId=null){
    return tableMaterialSnapshot(table,fieldId,recordId);
}
