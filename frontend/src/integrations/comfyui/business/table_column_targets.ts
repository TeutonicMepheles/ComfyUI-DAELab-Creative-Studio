import type {TableField} from '../../../features/table/contracts.js';
// @ts-expect-error Mature ESM material rules are shared by both table adapters.
import {columnDropTypes,columnFillCount,addMaterialColumns,fillMaterialColumn,fillMaterialRow,fillMaterialCell} from '../../../application/table_material_columns.mjs';

/** Add live native indices without replacing the cached descriptor list. */
export function boundColumnTargets<T extends {key:string;project?:boolean}>(node:{inputs?:readonly {daeColumnField?:string}[]},targets:T[]):T[]{
    for(const target of targets)if(target.project)Object.assign(target,{inputIndex:(node.inputs||[]).findIndex(input=>input.daeColumnField===target.key)});
    return targets;
}

/** Native panel descriptors; the Canvas owns Slot appearance and projection. */
export function tableColumnTargets(root:HTMLElement|null|undefined,fields:readonly TableField[]){
    if(!root)return [];
    const cells=Array.from(root.querySelectorAll<HTMLElement>('td[data-field]'));
    return Array.from(root.querySelectorAll<HTMLElement>('th[data-column]')).flatMap(element=>{
        const field=fields.find(field=>field.id===element.dataset.column);
        const accepts:string[]=columnDropTypes(field);
        if(!field||!accepts.length)return [];
        const columnCells=cells.filter(cell=>cell.dataset.field===field.id);
        return [{element,key:field.id,project:true,
            label:'单个素材填满整列，多个素材按序向下填充',accepts,
            clipElement:element.closest<HTMLElement>('.dae-table-scroll'),
            previewElements:(count:number)=>[element,...columnCells.slice(0,columnFillCount(count,columnCells.length))],
        }];
    });
}

/** Shared complete table drop surface, including non-projected cell/row inputs. */
export function tableMaterialTargets(root:HTMLElement|null|undefined,fields:readonly TableField[]){
    if(!root)return [];
    const projected=tableColumnTargets(root,fields);
    const ids=new Set(fields.filter(field=>columnDropTypes(field).includes('image')).map(field=>field.id));
    const cells=Array.from(root.querySelectorAll<HTMLElement>('td[data-field]')).filter(cell=>ids.has(cell.dataset.field!));
    const target=(element:HTMLElement,key:string,label:string)=>({element,key,label,project:false,clipElement:element.closest<HTMLElement>('.dae-table-scroll')});
    const add=root.querySelector<HTMLElement>('th.table-add-column');
    return [...projected,
        ...(add?[{...target(add,JSON.stringify(['new-column']),'松开自动新建列，按顺序从首行填入'),accepts:['image','video','text']}]:[]),
        ...Array.from(root.querySelectorAll<HTMLElement>('.table-choice[data-content-row]')).map(element=>({...target(element,JSON.stringify(['row',element.dataset.contentRow]),'松开按行向右填充'),previewElements:[element,...cells.filter(cell=>cell.dataset.record===element.dataset.contentRow)]})),
        ...cells.map(cell=>target(cell,JSON.stringify(['cell',cell.dataset.record,cell.dataset.field]),'松开将全部素材加入此格'))];
}

export function fillTableMaterialTarget(table:{fields:TableField[]},key:string,collection:unknown):void {
    if(table.fields.some(field=>field.id===key)){fillMaterialColumn(table,key,collection);return;}
    const [kind,record,field]=JSON.parse(key);
    if(kind==='new-column')addMaterialColumns(table,collection);
    else if(kind==='row')fillMaterialRow(table,record,collection);
    else if(kind==='cell')fillMaterialCell(table,record,field,collection);
    else throw new Error('未知表格素材位置');
}
