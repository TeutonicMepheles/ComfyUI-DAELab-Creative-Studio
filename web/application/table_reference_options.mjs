import {isTextColumn} from '../features/prompt/table_prompt_source.mjs';
import {columnValue,effectivePrompt} from '../features/prompt/table_prompt_template.mjs';
export function columnReferenceOptions(table,row){
    return table.fields.flatMap(f=>{
        if(isTextColumn(table,f)){
            const doc=effectivePrompt(table,row,f.id);
            if(doc?.segments?.some(s=>s.type!=='text'))return [];
            let preview;try{preview=columnValue(table,row,f.id).text;}catch(error){preview=error.message;}
            return [{...f,textPreview:preview,valueType:'text'}];
        }
        const value=row.values[f.id];
        if(!['assets','content'].includes(f.type)||!Array.isArray(value)||!value.length)return [];
        if(value.length===1)return {...f,assetIndex:0,asset:value[0]};
        return [{...f,children:value.map((asset,assetIndex)=>({...f,assetIndex,asset}))}];
    });
}

export function frameReferenceOptions(table,row,fieldId){
    const image=option=>option.asset&&(!option.asset.kind||option.asset.kind==='image');
    return columnReferenceOptions(table,row).filter(f=>f.id!==fieldId).flatMap(f=>{
        if(f.asset)return image(f)?[f]:[];
        const children=(f.children||[]).filter(image);
        return children.length===1?[children[0]]:children.length?[{...f,children}]:[];
    });
}


export {createReferenceMenu,materialReferenceLabel} from '../ui/reference_menu.mjs';
