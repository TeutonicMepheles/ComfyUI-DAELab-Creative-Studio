import test from 'node:test';
import assert from 'node:assert/strict';
import {installDom} from './prompt_optimization_dom.mjs';
import {promptSourceHeader} from '../../frontend/src/features/prompt/table_prompt_source_header.mjs';
import {promptSourceId} from '../../frontend/src/features/prompt/table_prompt_source.mjs';
import {normalizeTable} from '../../frontend/src/features/table/data_table_model.mjs';

const fixture=()=>normalizeTable({fields:[{id:'p',name:'提示词',type:'text'},{id:'n',name:'备注',type:'text'}],
 meta:{material_columns:true,generationInput:{version:1,promptFieldId:'p'},future:{kept:true}},
 records:[{id:'r',values:{p:'原提示词',n:'备注文字'}}]});
const click=button=>button.onclick({preventDefault(){},stopPropagation(){}});

test('prompt designation only changes the source; selected clicks never open settings or edit data',t=>{
 const dom=installDom(t);t.after(()=>dom.restore());
 const table=fixture(),peer=fixture(),beforePeer=JSON.stringify(peer),errors=[];
 let edits=0,events=0;
 const root=document.createElement('div');root.dispatchEvent=()=>{events++;return true;};
 const buttons=[];root.querySelectorAll=()=>buttons;
 const draw=id=>{
  const header=document.createElement('th'),title=document.createElement('span');header.append(title);
  promptSourceHeader({table,field:table.fields.find(f=>f.id===id),header,title,root,
   change:fn=>{edits++;fn(table);},notify:message=>errors.push(message)});
  const button=header.children.find(node=>node.classList.contains('table-prompt-toggle'));buttons.push(button);return button;
 };
 const selected=draw('p'),before=JSON.stringify(table);
 assert.match(selected.getAttribute('aria-label'),/^已设为提示词/);
 click(selected);click(selected);
 assert.equal(JSON.stringify(table),before);assert.equal(edits,0);assert.equal(events,0);
 click(draw('n'));
 assert.equal(promptSourceId(table),'n');assert.equal(edits,1);assert.equal(events,0);
 assert.deepEqual(table.records[0].values,{p:'原提示词',n:'备注文字'});
 assert.deepEqual(table.meta.future,{kept:true});
 click(draw('n'));assert.equal(edits,1);assert.equal(events,0);
 assert.equal(JSON.stringify(peer),beforePeer);assert.deepEqual(errors,[]);
 const restored=normalizeTable(JSON.parse(JSON.stringify(table)));assert.equal(promptSourceId(restored),'n');
});
