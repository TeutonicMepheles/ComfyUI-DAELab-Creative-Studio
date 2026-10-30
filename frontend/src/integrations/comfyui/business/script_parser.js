import {tableClipboard} from './table_capabilities.js';
import {bindBusinessDocument,tableInputStamp} from './business_document_host.js';
import {businessFetch,businessHost} from '../../../contracts/business.js';
import {canvasState} from '../../../canvas/creative_canvas_model.mjs';
import {planScriptImport,planLegacySplit} from '../../../features/storyboard/script_partitions.js';
import {preserveGenerationHistory} from '../../../features/generation/table_generation_history.mjs';
import {scheduleTableInstall} from '../../../features/table/public_helpers.mjs';
import {ensureIdentity,NAMESPACE} from '../../../features/prompt/prompt_optimization_model.mjs';
import {attachPromptOptimization} from '../../../features/prompt/prompt_optimization_controller.mjs';
import {app} from '/scripts/app.js';
import {createScriptParserPanel} from '../../../features/storyboard/script_parser_panel.mjs';
import {readScriptTable,assertTransition} from '../../../features/storyboard/script_parser_model.mjs';
import {generationMaterials} from '../../../application/table_material_output.mjs';
const TYPE='DAELAB.ScriptParser',widget=node=>node.widgets?.find(w=>w.name==='table_data');
const notify=(message,severity='info')=>app.extensionManager?.toast?.add?.({severity,summary:'分镜解析器',detail:message,life:8000});
export function createScriptBatchImport(node){
 const graph=node.graph,host=businessHost();
 const readTable=n=>n.__scriptTable||readScriptTable(widget(n)?.value);
 const members=()=>{const id=readTable(node).meta.script_parser.batch_id;return id?host.nodes(graph).filter(n=>n.type===TYPE&&readTable(n).meta.script_parser.batch_id===id):[node];};
 const key=n=>readTable(n).meta.script_parser.page_key||String(n.id);
 const read=()=>members().map(n=>({key:key(n),title:n.title,table:readTable(n)}));
 const write=pages=>{
  const existing=members(),byKey=new Map(existing.map(n=>[key(n),n])),created=[];
  // Create and validate all native node shells before touching the graph.
  const targets=pages.map(p=>{let n=byKey.get(p.key);if(!n){n=host.createNode(TYPE);if(!n||!widget(n))throw new Error('剧本解析节点不可用，未提交拆表');created.push(n);}return [p,n];});
  const state=canvasState(graph),origin=state.cards[node.id]||{x:node.pos[0],y:node.pos[1],width:1060};
  let x=Math.max(origin.x+origin.width,...Object.values(state.cards).map(c=>c.x+(c.width||1060)))+80;
  for(const [p,n] of targets){
   const data=widget(n);n.__scriptTable=structuredClone(p.table);data.value=JSON.stringify(p.table);n.title=p.title;
   if(created.includes(n)){n.pos=[x,origin.y];host.addNode(graph,n);host.placeNode?.(n,{x,y:origin.y,width:1060});x+=1140;}
   n.__scriptPanel?.render();
  }
  // Normally pages are retained, even when emptied. This also rolls back a failed multi-node write.
  const wanted=new Set(pages.map(p=>p.key));for(const n of existing)if(!wanted.has(key(n))){graph.remove(n);delete state.cards[n.id];}
  graph.setDirtyCanvas?.(true,true);
 };
 const document=bindBusinessDocument(node,read,write);
 const snapshot=()=>JSON.stringify(read());
 return {snapshot,dispose:()=>document.dispose(),apply(normalized,mode,stamp){
  if(snapshot()!==stamp)throw new Error('同批次表格已变化，请重新解析；未覆盖当前编辑');
  const before=read(),result=mode==='convert'?{pages:planLegacySplit(before.find(p=>p.key===key(node))),added:0,skipped:0,conflicts:[]}:planScriptImport(before,normalized,mode);
  const batchId=before[0].table.meta.script_parser.batch_id||crypto.randomUUID();
  for(const page of result.pages)Object.assign(page.table.meta.script_parser,{batch_id:batchId,page_key:page.key});
  document.replace(result.pages);
  return result;
 }};
}
function install(node){
 if(!node.graph)return;const duplicate=node.graph._nodes?.some(n=>n!==node&&n.properties?.[NAMESPACE]?.tableId&&n.properties[NAMESPACE].tableId===node.properties?.[NAMESPACE]?.tableId);ensureIdentity(node.graph,node,{duplicate});const data=widget(node);if(!data)return;
 let table;try{table=readScriptTable(data.value);if(node.__scriptTable){preserveGenerationHistory(node.__scriptTable,table);assertTransition(node.__scriptTable,table,{restoring:true});}}catch(e){notify(e.message,'error');if(node.__scriptTable)data.value=JSON.stringify(node.__scriptTable);return;}
 if(duplicate){delete table.meta.script_parser.batch_id;delete table.meta.script_parser.page_key;}
 node.__scriptTable=table;data.value=JSON.stringify(table);data.hidden=true;data.options={...data.options,hidden:true,canvasOnly:true};data.computeSize=()=>[0,-4];data.computeLayoutSize=()=>({minHeight:0,maxHeight:0,minWidth:0});data.draw=()=>{};for(const el of [data.element,data.inputEl])if(el?.style)el.style.display='none';
 if(node.__scriptPanel){node.__scriptPanel.render();return;}
 const batch=createScriptBatchImport(node);
 const panel=createScriptParserPanel({node,app,batchImport:batch,getPanelContext:root=>globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]?.getPanelContext?.(root),clipboard:tableClipboard,documentFactory:(read,write)=>bindBusinessDocument(node,read,write,tableInputStamp),getTable:()=>node.__scriptTable,setTable:next=>{node.__scriptTable=next;data.value=JSON.stringify(next);data.callback?.(data.value,app.canvas,node);node.graph?.setDirtyCanvas?.(true,true);},notify});node.__scriptPanel=panel;
 const destroy=panel.destroy;panel.destroy=()=>{batch.dispose();destroy();};
 const optimization=attachPromptOptimization({node,graph:node.graph,editor:panel.editor,getTable:()=>node.__scriptTable,identity:ensureIdentity(node.graph,node),fetchApi:businessFetch});
 const parserTasks=panel.tasks;panel.tasks=()=>[...parserTasks(),...optimization.tasks()];
 for(const method of ['render','close','destroy']){const previous=panel[method];panel[method]=(...args)=>{optimization[method==='render'?'observe':method==='close'?'pause':'destroy']();return previous(...args);};}
 const w=node.addDOMWidget('daelab_script_parser','custom',panel.root,{serialize:false,hideOnZoom:false,getHeight:()=>panel.height(),getMinHeight:()=>panel.height(),getValue:()=>'',setValue:()=>panel.render()});w.serialize=false;w.inputEl=panel.root;w.computeSize=width=>[width||1060,panel.height()];w.computeLayoutSize=()=>({minHeight:panel.height(),maxHeight:panel.height(),minWidth:720});
 const removed=w.onRemove?.bind(w);w.onRemove=()=>{panel.destroy();removed?.();panel.root.remove();};
 requestAnimationFrame(()=>{if(node.graph)node.setSize?.([Math.max(1060,node.size[0]),Math.max(580,node.computeSize()[1])]);});
}
app.registerExtension({name:'DAELab.ScriptParser',beforeRegisterNodeDef(type,data){
 if(data.name!==TYPE)return;
 for(const method of ['onNodeCreated','onAdded','onConfigure']){const prev=type.prototype[method];type.prototype[method]=function(...args){const result=prev?.apply(this,args);if(method==='onConfigure'){this.__scriptPanel?.close();this.__scriptPanel?.editor.invalidateAsync();}scheduleTableInstall(this,install);return result;};}
 const removed=type.prototype.onRemoved;type.prototype.onRemoved=function(...args){this.__scriptPanel?.destroy();delete this.__scriptPanel;delete this.__scriptTable;return removed?.apply(this,args);};
}});
let registered=false;
function register(){const api=globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')];if(registered||api?.version!==1)return;
 api.registerAdapter('daelab.script-parser',{matches:node=>node.type===TYPE,menu:[{label:'分镜剧本解析器',type:TYPE,icon:'file-text-line'}],presentation:'content',expanded:true,collapsible:false,resizable:true,fullHeight:true,workspace:()=>false,compactWidth:0,width:1060,
 tasks:node=>node.__scriptPanel?.tasks?.()||[],
 panel:node=>node.__scriptPanel?{root:node.__scriptPanel.root,close:()=>node.__scriptPanel.close()}:null,
 selectionSurface:node=>node.__scriptPanel?.surface,
 materialSources:node=>[...(node.__scriptPanel?.root.querySelectorAll('[data-generation-source]')||[])].map(element=>({element,key:element.dataset.generationSource,label:'输出为素材组'})),
 outputMaterials:(node,key)=>generationMaterials(node.__scriptTable,key),summary:node=>`${node.__scriptTable?.records.length||0} 条已确认任务`,
 prepareCopy(node,data){if(data.properties?.[NAMESPACE])delete data.properties[NAMESPACE];const index=node.widgets?.findIndex(w=>w.name==='table_data');if(index<0||!data.widgets_values?.[index])return;const table=readScriptTable(data.widgets_values[index]);for(const row of table.records)if(row.meta)delete row.meta.generationColumns;delete table.meta.generationProject;delete table.meta.script_parser.batch_id;delete table.meta.script_parser.page_key;data.widgets_values[index]=JSON.stringify(table);},
 });registered=true;
}
globalThis.addEventListener('daelab:creative-canvas-ready',register);register();
