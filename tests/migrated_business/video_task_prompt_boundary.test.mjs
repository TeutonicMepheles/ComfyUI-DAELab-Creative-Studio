import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createVideoTasks} from '../../frontend/src/features/generation/video_tasks_model.mjs';
import {effectivePrompt} from '../../frontend/src/features/prompt/table_prompt_template.mjs';

const source=readFileSync(new URL('../../frontend/src/features/generation/video_tasks_panel.mjs',import.meta.url),'utf8');
const ast=ts.createSourceFile('panel.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let render;
function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='renderPrompt')render=node.getText(ast);ts.forEachChild(node,visit);}visit(ast);
function fixture(){
 const state=createVideoTasks({model:'Seedance 2.5',prompt:'unchanged draft'}),prompt={dataset:{},replaceChildren(){}},mounted=[];
 const current=()=>state.table.records[0],config=()=>state.table.fields.find(f=>f.id===state.fieldId).generation;
 const promptUI={mountEditor(options){mounted.push(options.field);return {dispose(){}};}};
 const globals={state,prompt,current,config,promptUI,effectivePrompt,tableAssets:()=>[],clearMaterialPreviews(){},materials:{replaceChildren(){},append(){}},emptyMaterial:{}};
 const api=new Function(...Object.keys(globals),`let binding=null,promptStamp='';${render};return renderPrompt;`)(...Object.values(globals));
 return{state,prompt,mounted,render:api};
}
test('batch origin changes remount the same prompt as readonly and disconnect restores the editable draft',()=>{
 for(const sourceKey of ['source','approvedSource']){
  const f=fixture(),before=structuredClone(f.state.table);f.render();assert.ok(!f.mounted.at(-1).readonly);
  f.prompt.dataset.inlineEditing='true';f.prompt.dataset.record=f.state.table.records[0].id;
  f.state[sourceKey]={key:'upstream'};f.render();assert.equal(f.mounted.at(-1).readonly,true);assert.equal(f.prompt.dataset.readonly,'true');
  assert.equal(f.prompt.dataset.inlineEditing,undefined);assert.deepEqual(f.state.table,before,'view policy does not persist a readonly field or modify upstream input');
  delete f.state[sourceKey];f.render();assert.ok(!f.mounted.at(-1).readonly);assert.equal(f.prompt.dataset.readonly,'false');
 }
});
