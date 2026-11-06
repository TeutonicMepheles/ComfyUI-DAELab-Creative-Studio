/** Pure import planning. Native nodes/history and file IO belong to the host. */
type Bag = Record<string, any>;
export interface ScriptTable extends Bag { fields: Bag[]; records: ScriptRow[]; meta: Bag }
export interface ScriptRow extends Bag { id: string; values: Bag; meta: Bag }
export interface ScriptPage { key: string; title: string; table: ScriptTable }
export interface NormalizedScript extends Bag {
 document_id: string; filename: string; tasks: Bag[]; assets: Bag; unassigned: Bag[];
}
export const SCRIPT_ROW_LIMIT = 500;
const ids = ['sp-shot_no','sp-scene','sp-reference','sp-notes'];
const copy = <T>(value:T):T => structuredClone(value);
function setImportTitle(page:ScriptPage,title:string):void {
 const parser=page.table.meta.script_parser;
 const defaults=['剧本文档解析器','分镜剧本解析器','DAELAB - 分镜剧本解析器','DAELAB.ScriptParser'];
 if(!page.title||defaults.includes(page.title)||page.title===parser.import_title){page.title=title;parser.import_title=title;}
}
const same = (a:unknown,b:unknown) => JSON.stringify(a??'')===JSON.stringify(b??'');
const active = new Set(['waiting','running','queued','preparing','submitting','recovering','pausing']);
function chapterIdentity(documentId:string,tableId:string,_key:string):string {
 return `${documentId}:table:${tableId}`;
}
const chapterLimit=(_source:Bag)=>SCRIPT_ROW_LIMIT;
export const isFixedScript = (table:ScriptTable):boolean => table.meta?.script_parser?.field_policy==='fixed-four';
export function emptyFixedScript():ScriptTable {
 return {version:1,view:'table',fields:[
  {id:ids[0],name:'镜号/序号',type:'text',width:180,hidden:false},
  {id:ids[1],name:'画面描述',type:'json',presentation:'prompt',width:360,hidden:false},
  {id:ids[2],name:'画面参考',type:'content',width:300,hidden:false,video_reference:false},
  {id:ids[3],name:'备注',type:'longtext',width:180,hidden:false},
 ],records:[],meta:{material_columns:true,video_reference_version:1,generationInput:{version:1,promptFieldId:'sp-scene'},script_parser:{version:1,field_policy:'fixed-four',bindings:{shot_no:'sp-shot_no',scene:'sp-scene',notes:'sp-notes'},reference_fields:['sp-reference'],documents:[]}}};
}
export function validateFixedScript(table:ScriptTable):void {
 if(!isFixedScript(table))return;
 if(table.records.length>SCRIPT_ROW_LIMIT)throw new Error('单张源表超过 500 行，未截断或自动拆分');
 if(table.fields.length!==4||table.fields.some((f,i)=>f.id!==ids[i]||f.hidden))throw new Error('剧本解析表固定为镜号/序号、画面描述、画面参考、备注四列');
 if(table.fields[2]?.type!=='content'||table.fields.some((f,i)=>i!==2&&!(['text','longtext','json'].includes(f.type))))throw new Error('剧本解析表的文字和参考图片列类型不可互换');
}
function assertIdle(pages:ScriptPage[]):void {
 if(pages.some(p=>p.table.records.some(r=>Object.values(r.meta?.generationColumns||{}).some((s:any)=>active.has(s.phase)))))throw new Error('生成任务进行中，暂不能调整解析或拆表');
}
function documentRecord(n:NormalizedScript):Bag {
 // Keep unknown normalized data as well as the original inventory, including non-visible roles.
 const {tasks,baseSnapshot,editTicket,...rest}=n;
 return copy({...rest,tasks});
}
function freshRow(task:Bag,n:NormalizedScript,index:number):ScriptRow {
 const issues=copy(task.issues||[]),refs:Bag[]=[];
 for(const o of task.images||[]){
  const asset=n.assets[o.asset_id];
  if(!asset?.url||asset.error){issues.push(`${o.id} 图片无法读取，待补充`);continue;}
  refs.push({id:crypto.randomUUID(),url:asset.url,kind:'image',name:`${task.row_id} · 参考 ${refs.length+1}`,...(asset.filename?{filename:asset.filename}:{}),subfolder:asset.subfolder||'',type:'input',provenance:{document_id:n.document_id,occurrence_id:o.id,...(o.cell_id?{source_cell:o.cell_id}:{}),asset_id:asset.id||o.asset_id}});
 }
 const values={'sp-shot_no':task.values.shot_no?.trim()?task.values.shot_no:String(index+1),'sp-scene':task.values.scene||'','sp-reference':refs,'sp-notes':task.values.notes||''};
 const tableNumber=task.source_table_number||[...new Set(n.tasks.map(t=>t.table_id))].indexOf(task.table_id)+1;
 return {id:crypto.randomUUID(),selected:false,values,meta:{script_source:{source_key:task.source_key,document_id:n.document_id,filename:n.filename,row_id:task.row_id,table_id:task.table_id,chapter:task.chapter||'',chapter_explicit:task.chapter_explicit===true,source_table_number:tableNumber,chapter_key:chapterIdentity(n.document_id,task.table_id||'',task.chapter_key||`${n.document_id}:chapter:${task.chapter||''}`),issues,sources:copy(task.sources||{}),context:copy(task.context||[])},script_original:copy(task.original_cells||[]),script_import_values:copy(values),script_original_values:copy(task.values)}};
}
function reconcile(old:ScriptRow,next:ScriptRow,conflicts:string[],table:ScriptTable):ScriptRow {
 const baseline=old.meta?.script_import_values||{},fresh=copy(next.values),values=copy(old.values);
 if(!next.meta.script_original_values.shot_no?.trim()&&baseline['sp-shot_no'])fresh['sp-shot_no']=baseline['sp-shot_no'];
 // Occurrence identity survives reparsing even when the same binary occurs more than once.
 const previous=new Map((Array.isArray(old.values['sp-reference'])?old.values['sp-reference']:[]).map((a:Bag)=>[a.provenance?.occurrence_id,a]));
 for(const asset of fresh['sp-reference']){const match=previous.get(asset.provenance.occurrence_id) as Bag|undefined;if(match)asset.id=match.id;}
 for(const fid of ids){
  const field=table.fields.find(f=>f.id===fid);
  if(!field||(fid==='sp-reference'?field.type!=='content':!['text','longtext','json'].includes(field.type))){
   conflicts.push(`${old.meta.script_source?.row_id||old.id} · ${fid} 字段已调整，保留当前表格`);continue;
  }
  if(same(values[fid],baseline[fid]))values[fid]=fresh[fid];
  else if(!same(values[fid],fresh[fid]))conflicts.push(`${old.meta.script_source?.row_id||old.id} · ${fid} 已编辑，保留当前内容`);
 }
 return {...copy(old),values,meta:{...copy(old.meta),...next.meta,script_source:{...copy(old.meta?.script_source),...next.meta.script_source},script_import_values:fresh}};
}
function edited(row:ScriptRow):boolean {
 return !row.meta?.script_import_values||Object.entries(row.values).some(([k,v])=>!same(v,row.meta.script_import_values[k]))||Object.keys(row.meta.generationColumns||{}).length>0;
}
function rowChapter(row:ScriptRow):string {return row.meta?.script_source?.chapter_key||'manual';}
function addDocument(table:ScriptTable,doc:Bag):void {
 const documents=table.meta.script_parser.documents as Bag[];
 const at=documents.findIndex(d=>d.document_id===doc.document_id);
 if(at<0)documents.push(copy(doc));else documents[at]={...documents[at],...copy(doc)};
}
export function planScriptImport(current:ScriptPage[],normalized:NormalizedScript,mode:'append'|'replace'|'revise'='append'):{pages:ScriptPage[];added:number;skipped:number;conflicts:string[]} {
 if(!current.length)throw new Error('缺少剧本解析节点');
 if(current.some(p=>!isFixedScript(p.table)))throw new Error('旧版表格请先使用“按四列与章节拆表”；原表格未改变');
 assertIdle(current);
 if(normalized.tasks.length>500)throw new Error('文档任务超过 500 行，未截断');
 const sourceKeys=normalized.tasks.map(t=>t.source_key);
 if(new Set(sourceKeys).size!==sourceKeys.length)throw new Error('解析结果包含重复来源行');
 const pages=copy(current),conflicts:string[]=[],rows=new Map<string,{row:ScriptRow;page:ScriptPage}>();
 for(const page of pages)for(const row of page.table.records){const key=row.meta?.script_source?.source_key;if(key){if(rows.has(key))throw new Error('多个表存在重复来源，请先核对复制的记录');rows.set(key,{row,page});}}
 if(mode==='replace')for(const page of pages){page.table.records=[];page.table.meta.script_parser.documents=[];delete page.table.meta.script_parser.chapter_key;}
 const pending:ScriptRow[]=[],wanted=new Set(sourceKeys);let added=0,skipped=0;
 normalized.tasks.forEach((task,index)=>{
  const old=mode==='replace'?undefined:rows.get(task.source_key);
  if(old&&mode==='append'){skipped++;return;}
  let row=freshRow(task,normalized,index);
  if(old){row=reconcile(old.row,row,conflicts,old.page.table);const i=old.page.table.records.indexOf(old.row);old.page.table.records[i]=row;
   if(rowChapter(row)!==old.page.table.meta.script_parser.chapter_key){old.page.table.records.splice(i,1);pending.push(row);}
  }else{pending.push(row);added++;}
 });
 if(mode==='revise')for(const page of pages)page.table.records=page.table.records.filter(row=>{
  if(row.meta?.script_source?.document_id!==normalized.document_id||wanted.has(row.meta.script_source.source_key))return true;
  if(edited(row)){conflicts.push(`${row.meta.script_source.row_id} 已编辑，保留原记录`);return true;}return false;
 });
 const doc=documentRecord(normalized);doc.conflicts=conflicts;
 for(const row of pending){
  const acceptsImport=(table:ScriptTable)=>ids.every(id=>{const f=table.fields.find(f=>f.id===id);return f&&!f.readonly&&(id==='sp-reference'?f.type==='content':['text','longtext','json'].includes(f.type));});
  const chapter=rowChapter(row),candidates=pages.filter(p=>p.table.meta.script_parser.chapter_key===chapter&&acceptsImport(p.table));
  let page=candidates.at(-1);
  if(!page||page.table.records.length>=chapterLimit(row.meta.script_source)){
   page=pages.find(p=>!p.table.records.length&&!p.table.meta.script_parser.chapter_key&&acceptsImport(p.table));
   if(!page){
    const table=emptyFixedScript();
    page={key:crypto.randomUUID(),title:'',table};pages.push(page);
   }
   page.table.meta.script_parser.chapter_key=chapter;
   page.table.meta.script_parser.chapter=row.meta.script_source.chapter||`表 ${row.meta.script_source.source_table_number}`;
   page.table.meta.script_parser.chapter_explicit=row.meta.script_source.chapter_explicit;
   page.table.meta.script_parser.source_table_number=row.meta.script_source.source_table_number;
   page.table.meta.script_parser.source_table_id=row.meta.script_source.table_id||'';
   setImportTitle(page,page.table.meta.script_parser.chapter);
  }
  page.table.records.push(row);
 }
 // A selected header-only table is still an independent source table.
 const selected=normalized.choices?.tables;
 for(const source of normalized.inventory?.tables||normalized.tables||[]){
  if(selected&&!selected[source.id])continue;
  const identity=chapterIdentity(normalized.document_id,source.id,'');
  if(pages.some(p=>p.table.meta.script_parser.chapter_key===identity))continue;
  const page=pages.find(p=>!p.table.records.length&&!p.table.meta.script_parser.chapter_key)||{key:crypto.randomUUID(),title:'',table:emptyFixedScript()};
  if(!pages.includes(page))pages.push(page);
  Object.assign(page.table.meta.script_parser,{chapter_key:identity,source_table_id:source.id,source_table_number:(source.order??0)+1,chapter:source.chapter||`表 ${(source.order??0)+1}`});
  setImportTitle(page,page.table.meta.script_parser.chapter);
 }
 // Keep empty pages and their node connections after revision; never silently delete native nodes.
 for(const page of pages){
  if(page.table.records.some(r=>r.meta?.script_source?.document_id===normalized.document_id)||page.table.meta.script_parser.documents.some((d:Bag)=>d.document_id===normalized.document_id)||page===pages[0])addDocument(page.table,doc);
  // Existing pages are fully editable tables; never reapply the initial schema
  // or shrink manually added rows when importing/revising another document.
 }
 return {pages,added,skipped,conflicts};
}

/** Explicit legacy conversion; retain the full old table and every original cell value. */
export function planLegacySplit(current:ScriptPage):ScriptPage[] {
 assertIdle([current]);
 const old=current.table,bindings=old.meta.script_parser?.bindings||{},docs=old.meta.script_parser?.documents||[];
 const pages:ScriptPage[]=[];
 for(const original of old.records){
  const source=copy(original.meta?.script_source||{}),chapter=String(original.values[bindings.chapter]||source.chapter||'');
  const chapterKey=chapterIdentity(source.document_id||'legacy',source.table_id||'',source.chapter_key||`${source.document_id||'legacy'}:chapter:${chapter}`);
  let page=pages.filter(p=>p.table.meta.script_parser.chapter_key===chapterKey).at(-1);
  if(!page||page.table.records.length>=chapterLimit(source)){page={key:pages.length?crypto.randomUUID():current.key,title:`${chapter||current.title} · ${pages.length+1}`,table:emptyFixedScript()};page.table.meta.script_parser.documents=copy(docs);page.table.meta.script_parser.chapter_key=chapterKey;page.table.meta.script_parser.chapter=chapter||`表 ${source.source_table_number||pages.length+1}`;page.table.meta.script_parser.chapter_explicit=source.chapter_explicit===true;page.table.meta.script_parser.source_table_number=source.source_table_number;page.table.meta.script_parser.chapter_page=pages.filter(p=>p.table.meta.script_parser.chapter_key===chapterKey).length+1;page.table.meta.script_parser.legacy_table=copy(old);pages.push(page);}
  const refs=(old.meta.script_parser?.reference_fields||[]).flatMap((fid:string)=>Array.isArray(original.values[fid])?copy(original.values[fid]):[]);
  const mapping:Bag={[bindings.shot_no]:'sp-shot_no',[bindings.scene]:'sp-scene',[bindings.notes]:'sp-notes'};
  for(const fid of old.meta.script_parser?.reference_fields||[])mapping[fid]='sp-reference';
  const remap=(value:any):any=>{
   if(!value||typeof value!=='object'||Array.isArray(value))return copy(value);
   const doc=copy(value);
   if(Array.isArray(doc.references))for(const ref of doc.references){if(mapping[ref.fieldId])ref.fieldId=mapping[ref.fieldId];else throw new Error('旧提示词引用了四列之外的字段，请先调整该引用后转换；原表未改变');}
   if(Array.isArray(doc.segments))doc.segments=doc.segments.map((s:Bag)=>{
    if(s.type!=='column')return s;
    const value=original.values[s.fieldId];
    if(mapping[s.fieldId]==='sp-reference'){
     const asset=Array.isArray(value)?value.find((a:Bag)=>s.assetId?a.id===s.assetId:false)||value[s.assetIndex||0]:null;
     if(!asset)throw new Error('旧提示词的图片引用无法解析，请先修正后转换；原表未改变');
     return {...s,fieldId:'sp-reference',assetId:asset.id};
    }
    if(mapping[s.fieldId])return {...s,fieldId:mapping[s.fieldId]};
    if(['string','number','boolean'].includes(typeof value))return {type:'text',text:String(value)};
    throw new Error('旧提示词引用了无法转换的字段，请先调整该引用；原表未改变');
   });
   return doc;
  };
  const values={'sp-shot_no':copy(original.values[bindings.shot_no]||String(old.records.indexOf(original)+1)),'sp-scene':remap(original.values[bindings.scene]||old.fields.find(f=>f.id===bindings.scene)?.promptTemplate||''),'sp-reference':refs,'sp-notes':remap(original.values[bindings.notes]||'')};
  for(const [fid,value] of Object.entries(values))if(value&&typeof value==='object'&&!Array.isArray(value)){const field=page.table.fields.find(f=>f.id===fid)!;field.type='json';field.presentation='prompt';}
  const baseline=original.meta?.script_import_values||{},baselineValues={...copy(values)};
  baselineValues['sp-reference']=(old.meta.script_parser?.reference_fields||[]).flatMap((fid:string)=>Array.isArray(baseline[fid])?copy(baseline[fid]):[]);
  for(const [role,fid] of Object.entries({shot_no:'sp-shot_no',scene:'sp-scene',notes:'sp-notes'}))if(bindings[role] in baseline)(baselineValues as Bag)[fid]=remap(baseline[bindings[role]]);
  page.table.records.push({...copy(original),values,meta:{...copy(original.meta),script_source:{...source,chapter,chapter_key:chapterKey},script_legacy_values:copy(original.values),script_import_values:baselineValues}});
 }
 if(!pages.length){const table=emptyFixedScript();table.meta.script_parser.documents=copy(docs);table.meta.script_parser.legacy_table=copy(old);pages.push({...current,table});}
 return pages;
}
