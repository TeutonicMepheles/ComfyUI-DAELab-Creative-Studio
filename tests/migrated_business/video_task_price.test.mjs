import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createVideoTasks} from '../../frontend/src/features/generation/video_tasks_model.mjs';
import {generationInput,isComfyGenerationModel,LOCAL_VIDEO_MODEL} from '../../frontend/src/features/generation/table_generation_model.mjs';
import {toColumnPrompt} from '../../frontend/src/features/prompt/table_prompt_template.mjs';

const source=readFileSync(new URL('../../frontend/src/features/generation/video_tasks_panel.mjs',import.meta.url),'utf8'),tree=ts.createSourceFile('panel.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),functions=[];
function visit(n){if(ts.isFunctionDeclaration(n)&&['priceRequest','renderPrice'].includes(n.name?.text))functions.push(n.getText(tree));ts.forEachChild(n,visit);}visit(tree);assert.equal(functions.length,2);
function fixture(){
 const state=createVideoTasks({model:'Seedance 2.5',prompt:''}),estimate={hidden:true,textContent:'',setAttribute(name,value){this[name]=value;}},node={mode:0},pending=[],calls=[];
 const current=()=>state.table.records.find(r=>r.id===state.currentId),config=()=>state.table.fields.find(f=>f.id===state.fieldId).generation;
 const globals={state,estimate,node,current,config,generationInput,isComfyGenerationModel,isDocumentReady:()=>true,businessHost:()=>({estimateGenerationCredits:input=>{calls.push(input);return new Promise((resolve,reject)=>pending.push({resolve,reject}));}})};
 const api=new Function(...Object.keys(globals),`let disposed=false,inputError='',priceStamp='',priceSequence=0;${functions.join('\n')}return {render(){renderPrice(current(),config());},setError(e){inputError=e;},dispose(){disposed=true;}};`)(...Object.values(globals));
 return{state,estimate,node,pending,calls,api,config,text(value){const row=current();row.values[config().promptFieldId]=toColumnPrompt(value,row);},flush:()=>new Promise(r=>setImmediate(r))};
}
test('empty, local and incomplete inputs hide task pricing and do not estimate',async()=>{
 const f=fixture();f.api.render();await f.flush();assert.equal(f.estimate.hidden,true);assert.equal(f.calls.length,0);
 f.text('A valid synthetic prompt');f.config().model=LOCAL_VIDEO_MODEL;f.api.render();await f.flush();assert.equal(f.calls.length,0);
 f.config().model='Seedance 2.5';f.config().mode='image2video';f.api.render();assert.equal(f.estimate.hidden,true);
 f.config().mode='text2video';f.api.setError('Input not ready');f.api.render();assert.equal(f.estimate.hidden,true);assert.equal(f.calls.length,0);
});
test('valid paid input estimates and clearing blocks the outstanding response',async()=>{
 const f=fixture();f.text('A valid synthetic prompt');f.api.render();await f.flush();assert.equal(f.calls.length,1);assert.equal(f.estimate.hidden,true);
 f.text('');f.api.render();f.pending[0].resolve({min:125.36,max:125.36});await f.flush();assert.equal(f.estimate.hidden,true);assert.equal(f.estimate.textContent,'');
});
test('content changes and identical-content round trips cannot reuse stale estimates',async()=>{
 const f=fixture();f.text('first');f.api.render();await f.flush();f.text('second');f.api.render();await f.flush();assert.equal(f.calls.length,2);
 f.pending[0].resolve({min:999,max:999});await f.flush();assert.ok(!f.estimate.textContent.includes('999'));
 f.text('');f.api.render();f.text('second');f.api.render();await f.flush();assert.equal(f.calls.length,3);
 f.pending[1].resolve({min:888,max:888});await f.flush();assert.ok(!f.estimate.textContent.includes('888'));
 f.pending[2].resolve({min:12,max:12});await f.flush();assert.equal(f.estimate.textContent,'12');assert.equal(f.estimate.hidden,false);assert.match(f.estimate['aria-label'],/12/);
});
test('switch to local before an estimate resolves rejects stale success and failure',async()=>{
 const f=fixture();f.text('valid');f.api.render();await f.flush();f.config().model=LOCAL_VIDEO_MODEL;
 f.pending[0].resolve({min:999,max:999});await f.flush();assert.ok(!f.estimate.textContent.includes('999'));
 f.api.render();assert.equal(f.estimate.hidden,true);
 f.config().model='Seedance 2.5';f.api.render();await f.flush();f.api.dispose();f.pending[1].reject(new Error('late'));await f.flush();assert.ok(!f.estimate.textContent.includes('暂无法'));
});
