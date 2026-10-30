import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyFixedScript,planScriptImport,planLegacySplit,validateFixedScript} from '../../frontend/src/features/storyboard/script_partitions.js';
import {assertTransition,readScriptTable} from '../../frontend/src/features/storyboard/script_parser_model.mjs';
import {resolveColumnPrompt} from '../../frontend/src/features/prompt/table_prompt_template.mjs';
const start=()=>[{key:'node-1',title:'解析器',table:emptyFixedScript()}];
function fixture(count,chapter='chapter-1'){
 return {document_id:'doc',filename:'synthetic.docx',assets:{a:{id:'a',url:'/view?filename=a.png',filename:'a.png'}},unassigned:[],audit:[],paragraphs:[{id:'p1',text:'主题原文'}],tables:[],tasks:Array.from({length:count},(_,i)=>({source_key:`doc:r${i}`,row_id:`r${i}`,table_id:'t1',values:{shot_no:'',scene:`画面 ${i}`,notes:'',narration:'未展示的旁白'},chapter:'同名章节',chapter_key:chapter,sources:{scene:[{cell_id:`c${i}`}]},context:['p1'],original_cells:[{text:`原文 ${i}`}],images:[{id:`o${i}`,asset_id:'a'}],issues:[]}))};
}
for(const count of [0,1,10,11,20,21])test(`fixed four fields and lossless pagination for ${count} rows`,()=>{
 const input=fixture(count),result=planScriptImport(start(),input);
 assert.equal(result.pages.length,Math.max(1,Math.ceil(count/10)));
 assert.equal(result.pages.flatMap(p=>p.table.records).length,count);
 for(const page of result.pages){assert.equal(page.table.fields.length,4);assert.ok(page.table.records.length<=10);assert.deepEqual(readScriptTable(JSON.stringify(page.table)).records,page.table.records);}
 const rows=result.pages.flatMap(p=>p.table.records);assert.deepEqual(rows.map(r=>r.values['sp-shot_no']),Array.from({length:count},(_,i)=>String(i+1)));
 assert.deepEqual(rows.map(r=>r.meta.script_original),input.tasks.map(t=>t.original_cells));
});
test('same-named chapters stay separate; append fills only the final page and skips duplicates',()=>{
 const n=fixture(14);for(let i=11;i<14;i++)n.tasks[i].chapter_key='chapter-2';
 const first=planScriptImport(start(),n);assert.deepEqual(first.pages.map(p=>p.table.records.length),[10,1,3]);
 const extra=fixture(16);extra.tasks=extra.tasks.slice(14);const result=planScriptImport(first.pages,extra);
 assert.deepEqual(result.pages.map(p=>p.table.records.length),[10,3,3]);
 assert.equal(planScriptImport(result.pages,n).skipped,14);
 assert.equal(result.pages[0].key,'node-1');assert.equal(result.pages[1].key,first.pages[1].key);
});
test('reparse across a chapter boundary preserves record IDs, edited rich text, image order and references',()=>{
 const n=fixture(11),first=planScriptImport(start(),n).pages,old=first[1].table.records[0];
 old.values['sp-scene']={kind:'column-template',version:1,segments:[{type:'text',text:'手改'},{type:'column',fieldId:'sp-reference',assetId:old.values['sp-reference'][0].id}]};
 old.values['sp-reference'].push({id:'manual',url:'/view?filename=manual.png'});
 const frozen=structuredClone(old);n.tasks[10].chapter_key='chapter-2';n.tasks[10].values.scene='改映射';n.tasks[0].values.scene='更新';
 const result=planScriptImport(first,n,'revise'),rows=result.pages.flatMap(p=>p.table.records),moved=rows.find(r=>r.id===old.id);
 assert.deepEqual(moved.values,frozen.values);assert.equal(rows[0].values['sp-scene'],'更新');assert.equal(rows[0].values['sp-reference'][0].id,first[0].table.records[0].values['sp-reference'][0].id);
 assert.ok(result.conflicts.length>=2);assert.equal(moved.meta.script_original_values.narration,'未展示的旁白');
 assert.equal(first[0].table.records[0].values['sp-scene'],'画面 0');
});
test('removed edited rows survive, repeated image occurrences stay distinct, bad media remains in audit',()=>{
 const n=fixture(2);n.tasks[0].images.push({id:'repeat',asset_id:'a'},{id:'missing',asset_id:'bad'});
 const first=planScriptImport(start(),n).pages;assert.equal(first[0].table.records[0].values['sp-reference'].length,2);
 assert.notEqual(first[0].table.records[0].values['sp-reference'][0].id,first[0].table.records[0].values['sp-reference'][1].id);
 assert.match(first[0].table.records[0].meta.script_source.issues.join(),/missing/);
 first[0].table.records[1].values['sp-notes']='手改';n.tasks.pop();
 const result=planScriptImport(first,n,'revise');assert.equal(result.pages[0].table.records.length,2);assert.match(result.conflicts.join(),/保留原记录/);
});
test('row additions and paste cannot exceed ten; legacy remains readable without implicit conversion',()=>{
 const table=planScriptImport(start(),fixture(10)).pages[0].table,next=structuredClone(table);next.records.push({...structuredClone(next.records[0]),id:'extra'});
 assert.throws(()=>assertTransition(table,next),/最多 10 行/);assert.equal(table.records.length,10);
 const legacy=structuredClone(next);legacy.meta.script_parser.field_policy='nonempty';assert.equal(readScriptTable(JSON.stringify(legacy)).records.length,11);
 assert.throws(()=>planScriptImport([{key:'old',title:'旧表',table:legacy}],fixture(1)),/先使用/);
 next.records.pop();next.fields.pop();assert.throws(()=>validateFixedScript(next),/固定/);
});
test('explicit legacy split retains original table and every edited value, active jobs block structural edits',()=>{
 const old=planScriptImport(start(),fixture(10)).pages[0].table;old.meta.script_parser.field_policy='nonempty';old.records.push({...structuredClone(old.records[0]),id:'last'});
 old.records[0].values.unknown={keep:true};const before=structuredClone(old),pages=planLegacySplit({key:'old',title:'旧表',table:old});
 assert.deepEqual(pages[0].table.meta.script_parser.legacy_table,before);assert.deepEqual(pages[0].table.records[0].meta.script_legacy_values.unknown,{keep:true});assert.equal(pages[1].table.records[0].id,'last');
 pages[0].table.records[0].meta.generationColumns={job:{phase:'running'}};
 assert.throws(()=>planScriptImport(pages,fixture(1)),/进行中/);assert.deepEqual(old,before);
});
test('legacy reference columns combine without breaking positional or asset-ID prompt references',()=>{
 const old=emptyFixedScript();old.meta.script_parser.field_policy='nonempty';old.meta.script_parser.reference_fields=['left','right'];
 old.fields.splice(2,1,{id:'left',name:'左图',type:'content'},{id:'right',name:'右图',type:'content'});
 const prompt={kind:'column-template',version:1,segments:[{type:'text',text:'参考'},{type:'column',fieldId:'right',assetIndex:0}]};
 old.records=[{id:'kept',values:{'sp-scene':prompt,left:[{id:'a',url:'/view?filename=a.png'}],right:[{id:'b',url:'/view?filename=b.png'}]},meta:{}}];
 const [{table}]=planLegacySplit({key:'node',title:'旧表',table:old}),row=table.records[0];
 const resolved=resolveColumnPrompt(row.values['sp-scene'],table,row,'sp-scene');assert.deepEqual(resolved.assets.map(a=>a.id),['b']);
 assert.deepEqual(row.values['sp-reference'].map(a=>a.id),['a','b']);assert.equal(row.id,'kept');
});
test('legacy conversion preserves manual image additions and deletions across reparse',()=>{
 const input=fixture(2),old=planScriptImport(start(),input).pages[0].table;
 old.meta.script_parser.field_policy='nonempty';
 old.records[0].values['sp-reference'].push({id:'manual',url:'/view?filename=manual.png'});
 old.records[1].values['sp-reference']=[];
 const expected=old.records.map(r=>structuredClone(r.values['sp-reference']));
 const converted=planLegacySplit({key:'old',title:'旧表',table:old});
 const result=planScriptImport(converted,input,'revise');
 assert.deepEqual(result.pages.flatMap(p=>p.table.records).map(r=>r.values['sp-reference']),expected);
});
