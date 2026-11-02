import type {TableField} from '../../../features/table/contracts.js';
// @ts-expect-error Mature ESM material rules are shared by both table adapters.
import {columnDropTypes,columnFillCount} from '../../../application/table_material_columns.mjs';

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
