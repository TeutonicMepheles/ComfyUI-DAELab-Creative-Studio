import {isGenerationNode,GENERATION_NODE_TYPES,IMAGE_GENERATION_NODE,VIDEO_GENERATION_NODE} from '../../../features/generation/node_families.js';
import {tableMaterialTargets,fillTableMaterialTarget} from './table_column_targets.js';
import {NAMESPACE} from '../../../features/prompt/prompt_optimization_model.mjs';
import {parseTableOutputKey,tableMaterialSnapshot} from '../../../application/table_material_output.mjs';
// Optional integration: business nodes work without the canvas extension.
// This repository alone owns knowledge of its private panel implementations.
import {createMaterialTable} from '../../../application/table_material_columns.mjs';
import {app} from '/scripts/app.js';
import {materialItem} from '../../../features/table/public_helpers.mjs';
import {videoResultAssets} from '../../../features/generation/libtv_video_model.mjs';
import {generationInputNames} from '../../../features/generation/generation_input.js';
const key=Symbol.for('DAELAB.CreativeCanvas.API.v1');
const tables=['DAELAB.Table','DAELAB.StoryboardImport'];
let registered=false;
const materialTargetCache=new WeakMap();
function register(){
    const api=globalThis[key];if(registered||api?.version!==1)return;
    api.registerAdapter('daelab.business',{
        menu:[{label:'多维表格',type:'DAELAB.Table',icon:'layout-grid-line'},{label:'图片生成',type:IMAGE_GENERATION_NODE,icon:'image-line'},{label:'视频生成',type:VIDEO_GENERATION_NODE,icon:'video-line'}],
        materialItem:(node,key)=>materialItem(node.__dataTable,key),
        materialOutput:node=>isGenerationNode(node.type),
        assets:node=>node.__libtvPanel?.assets?.()||videoResultAssets(node),
        materialTargets(node){
            if(isGenerationNode(node.type))return node.__libtvPanel?.materialTargets?.()||[];
            const root=node.__dataTablePanel?.root;if(!root)return [];
            const grid=root.querySelector('table'),cached=materialTargetCache.get(node);if(cached?.grid===grid&&cached.cellsRevision===grid?.dataset.cellsRevision)return cached.targets;
            const fields=node.__dataTable?.fields||[];
            const targets=tableMaterialTargets(root,fields),projectedTargets=targets.filter(target=>target.project);
            materialTargetCache.set(node,{grid,targets,projectedTargets,cellsRevision:grid?.dataset.cellsRevision});return targets;
        },
        projectedMaterialTargets(node){
            const targets=this.materialTargets(node),cached=materialTargetCache.get(node);
            // Reuse the same owned column descriptors and invalidation boundary.
            // Other providers retain their full list and the Canvas fallback check.
            return cached?.targets===targets?cached.projectedTargets:targets;
        },
        // Generation output controls belong to the current header; never cache its DOM.
        materialSources:node=>[...(node.__dataTablePanel?.root.querySelector('thead')?.querySelectorAll('[data-generation-source],[data-table-source]')||[])].map(element=>({element,key:element.dataset.generationSource||`column:${encodeURIComponent(element.dataset.tableSource)}`,label:'输出为素材组'})),
        outputMaterials:(node,key)=>{const source=parseTableOutputKey(key);return tableMaterialSnapshot(node.__dataTable,source.fieldId,source.recordId);},
        acceptMaterials(node,key,collection){if(isGenerationNode(node.type))return node.__libtvPanel.acceptMaterials(key,collection);const editor=node.__dataTablePanel?.editor;if(!editor)throw new Error('表格尚未就绪');editor.change(t=>fillTableMaterialTarget(t,key,collection));},
        tasks:node=>node.__dataTablePanel?.tasks?.()||node.__libtvPanel?.tasks?.()||[],
        matches:node=>tables.includes(node.type)||isGenerationNode(node.type),
        expanded:node=>tables.includes(node.type),
        resizable:node=>tables.includes(node.type)||isGenerationNode(node.type),
        minWidth:node=>node.type==='DAELAB.Table'?168+160*(node.__dataTable?.fields.filter(field=>!field.hidden).length||0):640,
        fullHeight:node=>tables.includes(node.type)||isGenerationNode(node.type),
        initialAspectRatio:node=>[IMAGE_GENERATION_NODE,VIDEO_GENERATION_NODE].includes(node.type)?5/4:isGenerationNode(node.type)?16/9:null,
        presentation:node=>node.type==='DAELAB.Table'?'content':'card',
        floatingHeader:node=>isGenerationNode(node.type),
        selectionSurface:node=>node.type==='DAELAB.Table'?node.__dataTablePanel?.root.querySelector('.dae-table-scroll'):null,
        workspace:node=>tables.includes(node.type)&&node.type!=='DAELAB.Table',
        compactWidth:0,
        width:node=>node.type==='DAELAB.Table'?1140:tables.includes(node.type)?1060:isGenerationNode(node.type)?900:460,
        action:()=>null,
        refresh:node=>node.__libtvPanel?.sync(),
        panel:node=>{const p=node.__dataTablePanel||node.__libtvPanel;return p?{root:p.root,buttons:p.creativeButtons,fields:p.creativeFields,close:()=>p.close?.()}:null;},
        summary:node=>tables.includes(node.type)?`${node.__dataTable?.records?.length||0} 条记录`:null,
        preview:node=>({url:node.properties?.daelabLibTVResult,kind:'video'}),
        inputLabels:{table_json:'表格任务',first_frame:'首帧',last_frame:'尾帧',reference_images:'参考图片',reference_video:'参考视频',text_input:'描述文本'},
        canConnectInput:node=>node.type!=='DAELAB.Table',
        outputTargetTypes:node=>node.type==='DAELAB.Table'?[...GENERATION_NODE_TYPES,'DAELAB.LLMStylePreviewB']:undefined,
        inputNames:(node,source,slot)=>isGenerationNode(node.type)?generationInputNames(node,source,slot):undefined,
        inputSelection:node=>isGenerationNode(node.type)?'first-free':undefined,
        prepareCopy(node,data){
            if(data.properties?.[NAMESPACE])delete data.properties[NAMESPACE];
            for(const [i,w] of (node.widgets||[]).entries())if(data.widgets_values){
                if(w.name==='request_id')data.widgets_values[i]=`copy-${crypto.randomUUID()}`;
                if(w.name==='task_data'&&data.widgets_values[i]){
                    const state=JSON.parse(data.widgets_values[i]),ids=new Map(state.table.records.map(row=>[row.id,crypto.randomUUID()]));
                    for(const row of state.table.records){row.id=ids.get(row.id);if(row.meta)delete row.meta.generationColumns;}
                    state.currentId=ids.get(state.currentId);for(const input of Object.values(state.inputs||{}))input.recordId=ids.get(input.recordId);
                    data.widgets_values[i]=JSON.stringify(state);
                }
            }
        },
        onCreate(node){if(node.type==='DAELAB.Table'){node.title='多维表格';const table=createMaterialTable(),w=node.widgets?.find(w=>w.name==='table_data');if(w)w.value=JSON.stringify(table);node.__dataTable=table;node.__dataTablePanel?.render();}if(isGenerationNode(node.type)){node.title=node.type===IMAGE_GENERATION_NODE?'图片生成':node.type===VIDEO_GENERATION_NODE?'视频生成':'生成节点';const w=node.widgets?.find(w=>w.name==='request_id');if(w)w.value=`video-${crypto.randomUUID()}`;}},
    });
    registered=true;
}
globalThis.addEventListener('daelab:creative-canvas-ready',register);register();
