import test from 'node:test';
import assert from 'node:assert/strict';
import {bindGenerationHttp} from '../../web/integrations/comfyui/business/business_http.js';
import {createBusinessDocument} from '../../web/application/business_document.js';
import {tableInputStamp} from '../../web/integrations/comfyui/business/business_document_host.js';
import {createMaterialTable} from '../../web/features/table/table_material_columns.mjs';
import {attachGenerationTasks} from '../../web/features/generation/table_generation_tasks.mjs';
import {addGenerationColumn} from '../../web/features/generation/table_generation_model.mjs';

function fixture(t,hooks={}){
 let markSubmitted;
 const submissionReady=new Promise(resolve=>{markSubmitted=resolve;});
 let table=createMaterialTable(),steps=0,epoch=0,release,report,reports=[],submitFault=null,statusFault=null;table.records=table.records.slice(0,1);const field=addGenerationColumn(table,{name:'生成列（仅测试用）'}),row=table.records[0];row.values[field.generation.promptFieldId]='合成独立测试输入';
 const original=structuredClone(table),calls=[],history=[];
 const native=createBusinessDocument({read:()=>table,write:value=>{table=value;},current:()=>true,stamp:tableInputStamp,identity:()=>({workflowSession:'w',epoch,documentId:'node'}),history:{begin(){steps++;history.push(structuredClone(table));},end(){},amend(fn){fn();},undo(){table=history.pop();},redo(){}}});
 const editor={root:{querySelectorAll:()=>[]},nativeDocument:native,taskIdentity:{documentId:'document',tableId:'table',nodeId:'node'},change:(fn,options)=>native.edit('编辑',fn,options),beginAsync:(target,id)=>native.beginRequest(id,target),canAsync:native.canApply,releaseAsync:native.releaseRequest,applyAsync:(tickets,fn,options)=>{if(!native.controller.applyResults(tickets,'应用结果',fn,options))throw Error('stale');}};
 const unbind=bindGenerationHttp(async(url,options)=>{const body=options.body?JSON.parse(options.body):{};calls.push({url,body});
  if(url.includes('/capabilities'))return new Response(JSON.stringify({local:true,available:true}));
  if(url.endsWith('/submit')&&submitFault){const status=submitFault;submitFault=null;return new Response(JSON.stringify({error:'synthetic rejection',submitted:false,code:'synthetic-fault'}),{status});}
  if(url.endsWith('/status')&&body.requestIds&&!report)return new Response(JSON.stringify({error:'missing',code:statusFault?'storage_unavailable':'record_not_found'}),{status:statusFault||404});
   if(url.endsWith('/fence-unsubmitted')){if(statusFault)return new Response(JSON.stringify({error:'storage unavailable',code:'storage_unavailable'}),{status:statusFault});report={requestId:body.requestId,source:body.source,inputFingerprint:'a'.repeat(64),state:'cancelled',phase:'needs_input',preparation:'fenced',replacementAllowed:true,version:1};reports=[report];}
  if(url.endsWith('/submit')){reports=body.jobs.map(job=>({requestId:job.requestId,source:job.source,inputFingerprint:'a'.repeat(64),state:'succeeded',phase:'complete',version:3,result:{url:`/view?filename=${job.requestId}.png&type=output`,kind:'image',asset_id:'asset-'+job.requestId,reference_id:'ref-'+job.requestId},receipt:{kind:'assets',items:[{asset_id:'asset-'+job.requestId,reference_id:'ref-'+job.requestId}]}}));report=reports[0];await new Promise(resolve=>{release=resolve;markSubmitted();});}
  return new Response(JSON.stringify({jobs:reports.length?reports:report?[report]:[],nextOffset:null}));
 });
 const notices=[],tasks=attachGenerationTasks({editor,getTable:()=>table,notify:message=>notices.push(message),prepareGeneration:async()=>{},canGenerate:()=>true,...hooks});
 t.after(()=>{tasks.destroy();native.dispose();unbind();});
 return {tasks,native,calls,notices,field,row,original,rejectOnce(status){submitFault=status;},statusFailure(status){statusFault=status;},get table(){return table;},get steps(){return steps;},async submitted(){let timeout;try{await Promise.race([submissionReady,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Generation did not reach the test submit handler')),5000);})]);}finally{clearTimeout(timeout);}},complete(){release();},switch(){epoch++;}};
}
test('injected batch submits all three untouched rows in one shared request',async t=>{
 const f=fixture(t);f.field.generation.attempts=4;
 for(const id of ['second','third']){const row=structuredClone(f.row);row.id=id;row.selected=false;f.table.records.push(row);}
 f.row.selected=true;
 const pending=f.tasks.generate(f.field.id,null,false,true);await f.submitted();
 const jobs=f.calls.find(call=>call.url.endsWith('/submit')).body.jobs;
 assert.deepEqual(jobs.map(job=>job.input.recordId),[f.row.id,'second','third']);
 assert.equal(new Set(jobs.map(job=>job.requestId)).size,3);
 assert.ok(jobs.every(job=>job.source.groupCount===1));
 f.complete();await pending;
 assert.equal(f.calls.filter(call=>call.url.endsWith('/submit')).length,1);
 assert.deepEqual(f.table.records.map(row=>f.tasks.stateFor(row,f.field.id)?.phase),['complete','complete','complete']);
 assert.deepEqual(f.table.records.map(row=>row.values[f.field.id].length),[1,1,1]);
});

test('image node resolves each row from current input images including after a reference is removed',async t=>{
 const f=fixture(t,{autoImageMode:true});
 const column=f.table.fields[0].id;
 const image={id:'reference',kind:'image',url:'/view?filename=reference.png'};
 const withImage=structuredClone(f.row);withImage.id='with-image';withImage.values[column]=[image];
 f.table.records.push(withImage);
 f.field.generation.mode='image2image';
 f.row.meta={generationReferences:{[f.field.id]:[{fieldId:column,assetId:image.id}]}};
 f.row.values[f.field.id]=[{...image,id:'previous-output'}];
 const pending=f.tasks.generateBatch(f.field.id);
 await f.submitted();
 const [plain,reference]=f.calls.find(call=>call.url.endsWith('/submit')).body.jobs.map(job=>job.input);
 f.complete();await pending;
 assert.equal(plain.config.mode,'text2image');assert.deepEqual(plain.assets,[]);
 assert.equal(reference.config.mode,'image2image');assert.deepEqual(reference.assets,[{...image,fieldId:column}]);
});

test('injected batch skips completed receipts and existing outputs',async t=>{
 const f=fixture(t),first=f.tasks.generate(f.field.id,f.row.id);await f.submitted();f.complete();await first;
 const original=f.table.records[0].meta.studioGenerationRefs[f.field.id][0].requestId;
 for(const id of ['completed','remaining']){const row=structuredClone(f.original.records[0]);row.id=id;f.table.records.push(row);}
 f.table.records[1].values[f.field.id]=[{id:'previous-output',kind:'image',url:'/view?filename=previous.png&type=output'}];
 const pending=f.tasks.generate(f.field.id,null,false,true);
 const deadline=Date.now()+5000;
 while(!f.calls.some(call=>call.url.endsWith('/submit')&&call.body.jobs[0].input.recordId==='remaining')){
  assert.ok(Date.now()<deadline,'Remaining row did not reach the submit handler');
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 const submissions=f.calls.filter(call=>call.url.endsWith('/submit'));
 assert.deepEqual(submissions.at(-1).body.jobs.map(job=>job.input.recordId),['remaining']);
 assert.equal(f.table.records[0].meta.studioGenerationRefs[f.field.id][0].requestId,original);
 f.complete();await pending;
});

test('single-task attempts accept 1 and 4 while 0 and 5 fail before submission',async t=>{
 for(const attempts of [1,4]){
  const f=fixture(t);f.field.generation.attempts=attempts;const pending=f.tasks.generate(f.field.id,f.row.id);
  try{
   await f.submitted();
   const jobs=f.calls.find(call=>call.url.endsWith('/submit')).body.jobs;
   assert.equal(jobs.length,attempts);assert.equal(new Set(jobs.map(job=>job.requestId)).size,attempts);
   assert.deepEqual(jobs.map(job=>[job.source.groupIndex,job.source.groupCount]),Array.from({length:attempts},(_,index)=>[index,attempts]),JSON.stringify(jobs[0].source));
   f.complete();await pending;
   assert.equal(f.table.records[0].values[f.field.id].length,attempts);
  }finally{f.complete();await pending.catch(()=>{});}
 }
 for(const attempts of [0,5]){
  const f=fixture(t);f.field.generation.attempts=attempts;await f.tasks.generate(f.field.id,f.row.id);
  assert.equal(f.calls.some(call=>call.url.endsWith('/submit')),false);
  assert.equal(f.table.records[0].meta?.studioGenerationRefs,undefined);
  assert.match(f.notices.at(-1),/1–4/);
 }
});

test('deselecting a row after submission does not remove or rewrite its submitted requests',async t=>{
 const f=fixture(t),second=structuredClone(f.row);second.id='second';second.selected=true;f.row.selected=true;f.table.records.push(second);
 const pending=f.tasks.generate(f.field.id,null,false,true);await f.submitted();
 const jobs=f.calls.find(call=>call.url.endsWith('/submit')).body.jobs,ids=jobs.map(job=>job.requestId);
 f.table.records[1].selected=false;
 assert.deepEqual(f.table.records[1].meta.studioGenerationRefs[f.field.id].map(ref=>ref.requestId),ids.slice(1));
 f.complete();await pending;
 assert.deepEqual(f.table.records[1].meta.studioGenerationRefs[f.field.id].map(ref=>ref.requestId),ids.slice(1));
 assert.equal(f.table.records[1].values[f.field.id].length,1);
});

test('actual table submit stores only immutable references; completion uses one native result transaction and poll never writes facts',async t=>{
 t.mock.timers.enable({apis:['setInterval']});const f=fixture(t),pending=f.tasks.generate(f.field.id,f.row.id);await f.submitted();
 assert.equal(f.table.records[0].meta.generationColumns,undefined);assert.equal(f.steps,1);const refs=f.table.records[0].meta.studioGenerationRefs[f.field.id];assert.equal(refs.length,1);assert.equal(refs[0].phase,undefined);assert.equal(refs[0].input,undefined);
 f.complete();await pending;assert.equal(f.table.records[0].values[f.field.id].length,1);assert.equal(f.steps,1);
 t.mock.timers.tick(3000);await new Promise(setImmediate);assert.equal(f.steps,1);assert.equal(f.calls.filter(c=>c.url.endsWith('/submit')).length,1);
 f.native.undo();assert.equal(f.table.records[0].values[f.field.id].length,0);t.mock.timers.tick(3000);await new Promise(setImmediate);assert.equal(f.table.records[0].values[f.field.id].length,0);assert.equal(f.tasks.stateFor(f.table.records[0],f.field.id).phase,'complete');
 await f.tasks.reviewResult(f.field.id,f.row.id);assert.equal(f.table.records[0].values[f.field.id].length,1);assert.equal(f.steps,2);assert.equal(f.calls.filter(call=>call.url.endsWith('/submit')).length,1);
});
test('actual delayed table response after workflow replacement is retained only as task facts',async t=>{
 const f=fixture(t),pending=f.tasks.generate(f.field.id,f.row.id);await f.submitted();f.switch();f.complete();await pending;
 assert.equal(f.table.records[0].values[f.field.id].length,0);assert.equal(f.steps,1);assert.equal(f.tasks.stateFor(f.table.records[0],f.field.id).phase,'complete');
});
test('actual resume uses recover for the same request and never submits a replacement',async t=>{
 const f=fixture(t),pending=f.tasks.generate(f.field.id,f.row.id);await f.submitted();f.complete();await pending;
 await f.tasks.generate(f.field.id,f.row.id,true);assert.equal(f.calls.filter(c=>c.url.endsWith('/submit')).length,1);
 const recover=f.calls.find(c=>c.url.endsWith('/recover'));assert.deepEqual(recover.body.requestIds,[f.table.records[0].meta.studioGenerationRefs[f.field.id][0].requestId]);
});

test('temporary 404 remains locked; explicit durable fencing precedes a new user request',async t=>{
 const f=fixture(t);f.rejectOnce(429);await f.tasks.generate(f.field.id,f.row.id);const first=f.table.records[0].meta.studioGenerationRefs[f.field.id][0].requestId;
 await f.tasks.generate(f.field.id,f.row.id);assert.equal(f.calls.filter(call=>call.url.endsWith('/submit')).length,1);
  await f.tasks.generate(f.field.id,f.row.id,true);assert.equal(f.tasks.stateFor(f.table.records[0],f.field.id).phase,'needs_recovery');assert.equal(f.calls.filter(call=>call.url.endsWith('/submit')).length,1);
  await f.tasks.generate(f.field.id,f.row.id);assert.equal(f.calls.filter(call=>call.url.endsWith('/submit')).length,1);
  await f.tasks.fenceOriginal(f.field.id,f.row.id);assert.equal(f.tasks.stateFor(f.table.records[0],f.field.id).phase,'needs_input');assert.equal(f.calls.filter(call=>call.url.endsWith('/fence-unsubmitted')).length,1);
 const pending=f.tasks.generate(f.field.id,f.row.id);await f.submitted();f.complete();await pending;
 const refs=f.table.records[0].meta.studioGenerationRefs[f.field.id];assert.equal(refs.length,2);assert.equal(refs[0].requestId,first);assert.notEqual(refs[1].requestId,first);assert.equal(f.calls.filter(call=>call.url.endsWith('/submit')).length,2);
});
test('database unavailability never supplies missing-task evidence or enables replacement submission',async t=>{
 const f=fixture(t);f.rejectOnce(500);await f.tasks.generate(f.field.id,f.row.id);f.statusFailure(503);await f.tasks.generate(f.field.id,f.row.id,true);await f.tasks.generate(f.field.id,f.row.id);
 assert.equal(f.tasks.stateFor(f.table.records[0],f.field.id).phase,'needs_recovery');assert.equal(f.calls.filter(call=>call.url.endsWith('/submit')).length,1);
});

test('output targets are prepared before submission and late invalidated responses cannot update them',async t=>{
 const prepared=[],reports=[],f=fixture(t,{onPrepared:jobs=>prepared.push(...jobs),onReports:jobs=>reports.push(...jobs)});
 const pending=f.tasks.generate(f.field.id,f.row.id);await f.submitted();assert.equal(prepared.length,1);assert.equal(reports.length,0);
 assert.equal(prepared[0].requestId,f.calls.find(call=>call.url.endsWith('/submit')).body.jobs[0].requestId);
 f.tasks.invalidate();f.complete();await pending;assert.equal(reports.length,0);
});
test('a failed submit leaves the existing output visibly awaiting recovery without creating another request',async t=>{
 const reports=[],prepared=[],f=fixture(t,{onPrepared:jobs=>prepared.push(...jobs),onReports:jobs=>reports.push(...jobs)});f.rejectOnce(503);
 await f.tasks.generate(f.field.id,f.row.id);assert.equal(prepared.length,1);assert.equal(reports.at(-1).phase,'needs_recovery');assert.equal(reports.at(-1).requestId,prepared[0].requestId);
});


test('a completed four-row batch reruns every current row with new requests and retained results',async t=>{
 const f=fixture(t);
 for(const id of ['second','third','fourth']){const row=structuredClone(f.row);row.id=id;row.selected=false;f.table.records.push(row);}
 f.row.selected=true;
 const first=f.tasks.generate(f.field.id,null,false,true);await f.submitted();f.complete();await first;
 const initial=f.calls.find(call=>call.url.endsWith('/submit')).body.jobs;
 const before=f.table.records.map(row=>structuredClone(row.values[f.field.id]));
 const second=f.tasks.generateBatch(f.field.id),deadline=Date.now()+5000;
 while(f.calls.filter(call=>call.url.endsWith('/submit')).length<2){assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,10));}
 const jobs=f.calls.filter(call=>call.url.endsWith('/submit')).at(-1).body.jobs;
 assert.deepEqual(jobs.map(job=>job.input.recordId),initial.map(job=>job.input.recordId));
 assert.equal(new Set([...initial,...jobs].map(job=>job.requestId)).size,8);
 assert.equal(new Set(jobs.map(job=>job.source.createdAt)).size,1);
 f.complete();await second;
 for(const [i,row] of f.table.records.entries()){
  assert.equal(row.meta.studioGenerationRefs[f.field.id].length,2);
  assert.equal(row.values[f.field.id].length,2);
  assert.deepEqual(row.values[f.field.id][0],before[i][0]);
 }
 assert.equal(f.calls.some(call=>call.url.endsWith('/recover')),false);
});
