// Stable item identity; no dependency on canvas DOM or node internals.
export function materialItem(table,key){
    let record,field,asset;
    try{[record,field,asset]=JSON.parse(key);}catch{return null;}
    const row=table?.records?.find(r=>r.id===record),values=row?.values?.[field];
    const item=Array.isArray(values)?values.find(a=>a.id===asset):null;
    if(!item?.url?.startsWith('/view?'))return null;
    const filename=new URL(item.url,'http://localhost').searchParams.get('filename')||'';
    const kind=item.kind||(/\.(png|jpe?g|webp)$/i.test(filename)?'image':/\.(mp4|webm|mov)$/i.test(filename)?'video':null);
    if(!['image','video'].includes(kind))return null;
    const column=table?.fields?.find(f=>f.id===field);
    return {version:1,ready:true,scope:'cell',recordId:record,fieldId:field,movable:!!column&&!column.readonly&&['assets','content'].includes(column.type),assets:[{...item,kind,provenance:{...item.provenance,recordId:record,fieldId:field,assetId:asset}}]};
}

/** Apply only to an editor transaction draft, after the canvas output succeeds. */
export function takeMaterialItem(table,key,expected){
    const current=materialItem(table,key);
    if(!current?.movable||JSON.stringify(current)!==expected)throw new Error('素材来源已变化或不可编辑，未移出');
    const [record,field,asset]=JSON.parse(key),row=table.records.find(r=>r.id===record),values=row.values[field];
    const index=values.findIndex(item=>item.id===asset);
    if(index<0)throw new Error('素材已不存在，未移出');
    values.splice(index,1);
}
