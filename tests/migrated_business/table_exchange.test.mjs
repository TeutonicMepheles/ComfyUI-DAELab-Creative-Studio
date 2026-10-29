import {installBusinessHost} from '../../frontend/src/contracts/business.js';
import test from 'node:test';
import {setPromptSource} from '../../frontend/src/features/prompt/table_prompt_source.mjs';
import assert from 'node:assert/strict';
import {createTableSnapshot,readTableSnapshot,writeTablePrompts} from '../../frontend/src/features/table/table_exchange.mjs';
import {promptContent,toColumnPrompt} from '../../frontend/src/features/prompt/table_prompt_template.mjs';
import {importVideoTasks,syncVideoTaskInputs,selectTaskPrompt} from '../../frontend/src/features/generation/video_tasks_model.mjs';
import {rowGenerationConfig,setRowGenerationConfig,generationFrames,syncGenerationFrameTags} from '../../frontend/src/features/generation/table_generation_model.mjs';
import {createMaterialTable} from '../../frontend/src/application/table_material_columns.mjs';
import {addRecord} from '../../frontend/src/application/table_model.mjs';

test('deselection and deletion archive task receipts, results and overrides across reload and restoration',()=>{
 const source=createMaterialTable(),state=importVideoTasks(source),peer=importVideoTasks(source),id=source.records[0].id;
 const row=state.table.records[0],field=state.table.fields.find(f=>f.id===state.fieldId);
 row.values[state.fieldId]=[{id:'paid-result',kind:'video',url:'/view?filename=paid.mp4&type=output'}];
 row.meta.generationColumns={[state.fieldId]:{phase:'complete',requestId:'paid-once'}};
 row.meta.future={opaque:true};
 setRowGenerationConfig(row,state.fieldId,{...field.generation,settings:{duration:7}});
 const saved=structuredClone(row),peerBefore=JSON.stringify(peer);
 let previous=structuredClone(source);source.records.forEach(r=>r.selected=false);syncVideoTaskInputs(state,source,previous);
 assert.deepEqual(state.table.records,[]);assert.equal(state.currentId,'');
 assert.deepEqual(state.archivedTasks.find(r=>r.id===id).values[state.fieldId],saved.values[state.fieldId]);
 const restored=JSON.parse(JSON.stringify(state));
 previous=structuredClone(source);source.records.reverse();source.records.forEach(r=>r.selected=true);syncVideoTaskInputs(restored,source,previous);
 const task=restored.table.records.find(r=>r.id===id);
 assert.deepEqual(task.values[state.fieldId],saved.values[state.fieldId]);assert.deepEqual(task.meta,saved.meta);
 assert.equal(rowGenerationConfig(task,state.fieldId,field.generation).settings.duration,7);
 assert.deepEqual(restored.table.records.map(r=>r.id),source.records.map(r=>r.id));assert.deepEqual(restored.archivedTasks,[]);
 previous=structuredClone(source);source.records=source.records.filter(r=>r.id!==id);syncVideoTaskInputs(restored,source,previous);
 const deleted=structuredClone(source);source.records=previous.records;syncVideoTaskInputs(restored,source,deleted);
 assert.deepEqual(restored.table.records.find(r=>r.id===id).meta,saved.meta);assert.equal(JSON.stringify(peer),peerBefore);
});

test('source configuration edits reach archived tasks without clearing their results',()=>{
 const {table:source}=frameFixture(),state=importVideoTasks(source),id=source.records[0].id;
 state.table.records[0].values[state.fieldId]=[{id:'result',kind:'video'}];
 let previous=structuredClone(source);source.records[0].selected=false;syncVideoTaskInputs(state,source,previous);
 previous=structuredClone(source);source.fields.at(-1).generation.settings.duration=9;syncVideoTaskInputs(state,source,previous);
 const reloaded=JSON.parse(JSON.stringify(state));previous=structuredClone(source);source.records[0].selected=true;syncVideoTaskInputs(reloaded,source,previous);
 const row=reloaded.table.records.find(r=>r.id===id),owner=reloaded.table.fields.find(f=>f.id===state.fieldId);
 assert.equal(rowGenerationConfig(row,state.fieldId,owner.generation).settings.duration,9);assert.equal(row.values[state.fieldId][0].id,'result');
});

test('checked rows drive task membership, including empty selection, new rows and independent instances',()=>{
 const source=createMaterialTable();source.records[1].selected=false;
 const a=importVideoTasks(source),b=importVideoTasks(source),kept=a.table.records[0],rowId=kept.id;
 assert.deepEqual(a.table.records.map(r=>r.id),[source.records[0].id,source.records[2].id]);
 kept.values[a.fieldId]=[{id:'done',url:'/view?filename=done.png'}];
 setRowGenerationConfig(kept,a.fieldId,{...a.table.fields.find(f=>f.id===a.fieldId).generation,settings:{duration:7}});
 let before=structuredClone(source);source.records[2].selected=false;source.records[1].selected=true;
 for(const s of [a,b])syncVideoTaskInputs(s,source,before);
 assert.deepEqual(a.table.records.map(r=>r.id),[rowId,source.records[1].id]);
 assert.equal(kept.values[a.fieldId][0].id,'done');assert.equal(rowGenerationConfig(kept,a.fieldId,a.table.fields.find(f=>f.id===a.fieldId).generation).settings.duration,7);
 assert.deepEqual(b.table.records[0].values[b.fieldId],[]);
 before=structuredClone(source);source.records.forEach(r=>r.selected=false);syncVideoTaskInputs(a,source,before);
 assert.deepEqual(a.table.records,[]);assert.equal(a.currentId,'');assert.equal(importVideoTasks(source).table.records.length,0);
 before=structuredClone(source);const added=addRecord(source);assert.equal(added.selected,true);syncVideoTaskInputs(a,source,before);
 assert.deepEqual(a.table.records.map(r=>r.id),[added.id]);assert.equal(a.currentId,added.id);
 const saved=JSON.parse(JSON.stringify(a));syncVideoTaskInputs(saved,source,source);assert.deepEqual(saved,a);
});
test('output creation uses serialized table contract and avoids an existing neighbor',()=>{
    let release;
    const graph={_nodes:[{pos:[1160,0],size:[700,600]}],add(node){node.graph=this;this._nodes.push(node);},change(){}};
    release=installBusinessHost({nodes:g=>g._nodes,addNode:(g,n)=>g.add(n),createNode:()=>({type:'DAELAB.Table',mode:0,widgets:[{name:'table_data',value:''}]})});
    try{
        const table={fields:[{id:'text',type:'content',name:'文本'}],records:[{id:'r',values:{text:'模拟结果'}}]};
        const n=createTableSnapshot(graph,table,{pos:[1160,0]});assert.equal(n.pos[0],1920);assert.equal(readTableSnapshot(n).records[0].values.text,'模拟结果');
        n.widgets[0].value='{}';assert.equal(table.records.length,1);
    }finally{release();}
});

function linkedTable(){
 const table={fields:[{id:'p',type:'content',presentation:'prompt',name:'提示词'},{id:'p2',type:'content',presentation:'prompt',name:'另一提示词'},{id:'m',type:'content',name:'素材'}],records:['r1','r2'].map(id=>({id,name:id,values:{p:toColumnPrompt('原文'+id),p2:toColumnPrompt('另一列'+id),m:[]}})),meta:{}};
 setPromptSource(table,'p');
 const data={name:'table_data',value:JSON.stringify(table)},changes=[],refreshed=[];
 const node={type:'DAELAB.Table',mode:0,widgets:[data],__dataTablePanel:{editor:{change(update,options){const next=JSON.parse(data.value);update(next);data.value=JSON.stringify(next);changes.push(options);},refreshCells(...args){refreshed.push(args);}}}};
 return {node,data,changes,refreshed};
}

test('task edits write only the matching prompt cell and remove deleted frame tags',()=>{
 const {node,data,changes,refreshed}=linkedTable(),source=readTableSnapshot(node);
 source.records[1].values.p2.segments.unshift({type:'frame',generationFieldId:'table-output',role:'first'});data.value=JSON.stringify(source);
 writeTablePrompts(node,[{recordId:'r2',fieldId:'p2',expected:promptContent(source,source.records[1],'p2'),segments:[{type:'text',text:'改后的中文\n第二行'}]}],{group:'typing'});
 const result=readTableSnapshot(node);
 assert.deepEqual(result.records[0].values,source.records[0].values);
 assert.deepEqual(result.records[1].values.p,source.records[1].values.p);
 assert.deepEqual(result.records[1].values.p2.segments,[{type:'text',text:'改后的中文\n第二行'}]);
 assert.deepEqual(changes,[{group:'typing',render:false}]);assert.deepEqual(refreshed,[['r2','p2']]);
});

test('stale, deleted and inactive source cells reject writes without partial changes',()=>{
 const {node,data,changes}=linkedTable(),before=data.value;
 const update={recordId:'r1',fieldId:'p',expected:[],segments:[{type:'text',text:'覆盖'}]};
 assert.throws(()=>writeTablePrompts(node,[update]),/已变化/);
 assert.throws(()=>writeTablePrompts(node,[{...update,recordId:'missing'}]),/已删除/);
 node.mode=2;assert.throws(()=>writeTablePrompts(node,[update]),/不可用/);
 assert.equal(data.value,before);assert.equal(changes.length,0);
});

test('table edits sync by row and column identity while preserving task settings and results',()=>{
 const {node}=linkedTable(),previous=readTableSnapshot(node),state=importVideoTasks(previous,'p');
 assert.throws(()=>selectTaskPrompt(state,'r2','p2'),/列头切换/);const row=state.table.records[1];
 row.values[state.fieldId]=[{id:'result',kind:'video',url:'/view?filename=done.mp4&type=output'}];
 row.meta.generationColumns={[state.fieldId]:{phase:'complete',requestId:'job'}};
 const saved=structuredClone({output:row.values[state.fieldId],meta:row.meta});
 const source=structuredClone(previous);source.records.reverse();source.fields.reverse();
 source.records[0].values.p2=toColumnPrompt('表格新内容');source.records[0].name='新任务名';
 source.records[0].values.m=[{id:'ref',url:'/view?filename=ref.png',kind:'image'}];
 syncVideoTaskInputs(state,source,previous);
 assert.deepEqual(promptContent(state.table,row,'p2'),[{type:'text',text:'表格新内容'}]);
 assert.equal(row.name,'新任务名');assert.equal(row.values.m[0].id,'ref');
 assert.deepEqual(row.values[state.fieldId],saved.output);assert.deepEqual(row.meta,saved.meta);
 assert.deepEqual(promptContent(state.table,state.table.records[0],'p'),promptContent(previous,previous.records.find(r=>r.id===state.table.records[0].id),'p'));
 assert.deepEqual(state.table.records.map(r=>r.id),source.records.map(r=>r.id));
});

test('sync preserves node-only inputs and handles cleared prompts and template changes',()=>{
 const {node}=linkedTable(),previous=readTableSnapshot(node),state=importVideoTasks(previous,'p'),row=state.table.records[0];
 row.values.m=[{id:'local',kind:'image',url:'/view?filename=local.png'}];
 const source=structuredClone(previous);source.records[0].values.p=toColumnPrompt('');
 source.records[1].values.p='';source.fields[0].promptTemplate=toColumnPrompt('整列模板');
 syncVideoTaskInputs(state,source,previous);
 assert.deepEqual(promptContent(state.table,row,'p'),[{type:'text',text:''}]);
 assert.deepEqual(promptContent(state.table,state.table.records[1],'p'),[{type:'text',text:'整列模板'}]);
 assert.equal(row.values.m[0].id,'local');
 const saved=JSON.parse(JSON.stringify(state));syncVideoTaskInputs(saved,source,source);assert.deepEqual(saved,state);
});

test('prompt round trips update two task instances and follow a table undo without feedback writes',()=>{
 const {node,data,changes}=linkedTable(),original=readTableSnapshot(node),a=importVideoTasks(original,'p'),b=importVideoTasks(original,'p');
 writeTablePrompts(node,[{recordId:'r1',fieldId:'p',expected:promptContent(original,original.records[0],'p'),segments:[{type:'text',text:'节点输入'}]}]);
 const updated=readTableSnapshot(node);syncVideoTaskInputs(a,updated,original);syncVideoTaskInputs(b,updated,original);
 assert.deepEqual(promptContent(a.table,a.table.records[0],'p'),[{type:'text',text:'节点输入'}]);
 assert.deepEqual(promptContent(b.table,b.table.records[0],'p'),promptContent(a.table,a.table.records[0],'p'));
 data.value=JSON.stringify(original);syncVideoTaskInputs(a,readTableSnapshot(node),updated);
 assert.deepEqual(promptContent(a.table,a.table.records[0],'p'),promptContent(original,original.records[0],'p'));
 assert.equal(changes.length,1);assert.equal(promptContent(b.table,b.table.records[0],'p')[0].text,'节点输入');
});

function frameFixture(){
 const fixture=linkedTable(),table=readTableSnapshot(fixture.node);
 table.fields.push({id:'table-output',presentation:'generation',type:'content',readonly:true,generation:{kind:'video',model:'Seedance 2.5',promptFieldId:'p',mode:'text2video',settings:{duration:5}}});
 for(const row of table.records){row.values['table-output']=[];row.values.m=[{id:'image-'+row.id,kind:'image',url:'/view?filename='+row.id+'.png'}];}
 fixture.data.value=JSON.stringify(table);return {...fixture,table};
}

test('frame addition, replacement and deletion synchronize bindings and reference mode',()=>{
 const {node,table}=frameFixture(),row=table.records[0],frame=(role,assetId)=>({type:'frame',role,generationFieldId:'node-output',binding:{fieldId:'m',assetId}});
 const send=segments=>{const source=readTableSnapshot(node);writeTablePrompts(node,[{recordId:row.id,fieldId:'p',expected:promptContent(source,source.records[0],'p'),segments}]);return readTableSnapshot(node);};
 let result=send([frame('first','image-r1'),{type:'text',text:'画面'}]);let current=result.records[0],owner=result.fields.at(-1);
 assert.equal(current.values.p.segments[0].generationFieldId,'table-output');assert.equal(current.values.p.segments[0].binding,undefined);
 assert.equal(rowGenerationConfig(current,owner.id,owner.generation).mode,'singleImage2video');
 assert.equal(generationFrames(result,current,owner.id,rowGenerationConfig(current,owner.id,owner.generation))[0].asset.id,'image-r1');
 result=send([frame('first','image-r1'),frame('last','image-r1'),{type:'text',text:'画面'}]);
 assert.equal(rowGenerationConfig(result.records[0],owner.id,owner.generation).mode,'frames2video');
 result=send([{type:'text',text:'画面'}]);current=result.records[0];
 assert.equal(rowGenerationConfig(current,owner.id,owner.generation).mode,'text2video');assert.deepEqual(current.meta.generationFrames[owner.id],{});
 syncGenerationFrameTags(result,owner.id,owner.generation);assert.deepEqual(current.values.p.segments,[{type:'text',text:'画面'}]);
 assert.equal(result.records[1].values.p.segments[0].text,'原文r2');
});

test('source frame edits map to the task owner, including binding-only edits and initial reconciliation',()=>{
 const {table:source}=frameFixture(),state=importVideoTasks(source,'p'),owner=state.table.fields.find(f=>f.id===state.fieldId);
 const oldId=state.fieldId;state.fieldId=owner.id='node-output';
 for(const row of state.table.records){setRowGenerationConfig(row,state.fieldId,row.meta.generationSettings.p[oldId]);delete row.meta.generationSettings.p[oldId];row.values[state.fieldId]=row.values[oldId];delete row.values[oldId];}
 let previous=structuredClone(source);
 source.records[0].values.p.segments.unshift({type:'frame',role:'first',generationFieldId:'table-output'});
 source.records[0].meta={generationFrames:{'table-output':{first:{fieldId:'m',assetId:'image-r1'}}}};
 syncVideoTaskInputs(state,source,previous);const row=state.table.records[0];
 assert.equal(row.values.p.segments[0].generationFieldId,'node-output');assert.equal(rowGenerationConfig(row,state.fieldId,owner.generation).mode,'singleImage2video');
 assert.deepEqual(row.meta.generationFrames[state.fieldId].first,{fieldId:'m',assetId:'image-r1'});
 previous=structuredClone(source);source.records[0].meta.generationFrames['table-output'].first={fieldId:'m',assetId:'replacement'};
 syncVideoTaskInputs(state,source,previous);assert.equal(row.meta.generationFrames[state.fieldId].first.assetId,'replacement');
 row.values.p=toColumnPrompt('旧版副本');syncVideoTaskInputs(state,source,source);assert.equal(row.values.p.segments[0].type,'frame');
 previous=structuredClone(source);source.records[0].values.p=toColumnPrompt('已删掉标签');syncVideoTaskInputs(state,source,previous);
 assert.equal(rowGenerationConfig(row,state.fieldId,owner.generation).mode,'text2video');assert.deepEqual(row.meta.generationFrames[state.fieldId],{});
});
