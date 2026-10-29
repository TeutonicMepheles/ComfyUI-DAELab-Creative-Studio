import test from 'node:test';
import assert from 'node:assert/strict';
import {slotRows,slotSignature,appliedSnapshot,outputText} from '../../frontend/src/features/prompt/llm_slot_model.mjs';
import {applyIOResult,undoIOResult,tableInput} from '../../frontend/src/features/prompt/llm_io_model.mjs';
import {createMaterialTable} from '../../frontend/src/application/table_material_columns.mjs';
import {addField,addRecord,normalizeTable} from '../../frontend/src/application/table_model.mjs';
import {setPromptSource} from '../../frontend/src/features/prompt/table_prompt_source.mjs';
function fixture(){const upstream={id:1,title:'文字',getOutputData:()=> '湖畔展厅'},node={id:2,type:'DAELAB.LLMStylePreviewB',inputs:[{link:1}],properties:{llmStylePreview:{mode:'polish',model:'mock',instruction:''}}};node.graph={links:{1:{origin_id:1,origin_slot:0}},getNodeById:id=>id===1?upstream:node};return {node,upstream,s:node.properties.llmStylePreview};}
test('normalized legacy scalar tables retain selected text/image inputs without mutating bindings',()=>{
 const image={id:'legacy-image',kind:'image',url:'/view?filename=legacy.png'};
 const table=normalizeTable({fields:[{id:'text',type:'content'},{id:'image',type:'content'}],records:[{id:'a',values:{text:'legacy',image:[image]}},{id:'b',selected:false,values:{text:'skip',image:[]}}]});
 const before=JSON.stringify(table);assert.equal(table.meta.generationInput.promptFieldId,null);
 assert.deepEqual(tableInput(table).rows,[{id:'a',index:1,text:'legacy',image}]);assert.equal(JSON.stringify(table),before);
 assert.deepEqual(tableInput(JSON.parse(before)),tableInput(table));
 table.meta.generationInput={version:2,promptFieldId:null};assert.throws(()=>tableInput(table),/版本/);
 table.meta.generationInput={version:1,promptFieldId:'deleted'};assert.throws(()=>tableInput(table),/提示词/);
});
test('linked input takes precedence and disconnecting restores manual text',()=>{const {node,s}=fixture();s.source='手动文字';s.inputIds=['99'];assert.equal(slotRows(node)[0].text,'湖畔展厅');node.inputs[0].link=null;assert.equal(slotRows(node)[0].text,'手动文字');assert.equal(s.source,'手动文字');s.source=' \n ';assert.deepEqual(slotRows(node),[]);});
test('manual input participates in approved output validation and survives serialization',()=>{
    const {node,s}=fixture();node.inputs[0].link=null;s.source='第一段\n\n第二段';
    assert.deepEqual(slotRows(node).map(row=>row.text),['第一段','第二段']);
    s.ioResult={complete:true,requestId:'manual',signature:slotSignature(node),rows:[{result:'优化结果'}]};
    applyIOResult(s,slotSignature(node));assert.equal(outputText(node),'优化结果');
    node.properties=JSON.parse(JSON.stringify(node.properties));assert.equal(outputText(node),'优化结果');
    node.properties.llmStylePreview.source='修改原文';assert.equal(appliedSnapshot(node).ready,false);
    node.properties.llmStylePreview.source='第一段\n\n第二段';assert.equal(outputText(node),'优化结果');
    node.inputs[0].link=1;assert.equal(appliedSnapshot(node).ready,false);
});
test('applied result propagates, undo and upstream edits invalidate output',()=>{const {node,upstream,s}=fixture();s.ioResult={complete:true,requestId:'one',signature:slotSignature(node),rows:[{result:'湖畔极简展厅'}]};assert.throws(()=>outputText(node));applyIOResult(s,slotSignature(node));assert.equal(outputText(node),'湖畔极简展厅');undoIOResult(s);assert.equal(appliedSnapshot(node).ready,false);applyIOResult(s,slotSignature(node));upstream.getOutputData=()=> '其他';assert.throws(()=>outputText(node));});
test('unsupported sources and unavailable nodes report parse errors',()=>{const {node,upstream}=fixture();upstream.getOutputData=()=>123;assert.throws(()=>slotRows(node),/无法解析/);upstream.mode=4;assert.throws(()=>slotRows(node),/停用/);});
test('chained nodes consume approved output and reject cycles',()=>{const {node,s}=fixture();s.appliedIO={complete:true,signature:slotSignature(node),rows:[{result:'approved'}]};const child={id:3,type:node.type,inputs:[{link:2}],properties:{llmStylePreview:{}}};const graph=node.graph;graph.links[2]={origin_id:2,origin_slot:0};child.graph=graph;assert.equal(slotRows(child)[0].text,'approved');node.inputs[0].link=2;assert.throws(()=>slotRows(node),/循环/);});

test('modern tables read selected prompt rows in table order and expand referenced text',()=>{
 const table=createMaterialTable(),prompt=addField(table,{name:'提示词',type:'text'}),detail=addField(table,{name:'说明',type:'text'});
 setPromptSource(table,prompt.id);table.records=table.records.slice(0,1);addRecord(table);addRecord(table);
 for(const [index,row] of table.records.entries()){row.selected=index!==1;row.values[detail.id]='细节'+index;row.values[prompt.id]={kind:'column-template',version:1,segments:[{type:'text',text:'画面：'},{type:'column',fieldId:detail.id}]};}
 const before=JSON.stringify(table),rows=tableInput(table).rows;
 assert.deepEqual(rows.map(row=>row.id),[table.records[0].id,table.records[2].id]);
 assert.deepEqual(rows.map(row=>row.text),['画面：细节0','画面：细节2']);
 assert.equal(JSON.stringify(table),before);
 table.records.reverse();assert.deepEqual(tableInput(table).rows.map(row=>row.text),['画面：细节2','画面：细节0']);
 table.meta.generationInput.promptFieldId=null;assert.throws(()=>tableInput(table),/提示词/);
});
