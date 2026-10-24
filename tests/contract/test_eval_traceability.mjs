import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {appendEvidence,createTrace,evaluateGate,hash,loadCatalog,selectTests,staleReasons,validateEvidence,verifyEvidenceFiles} from '../../tools/evals/traceability.mjs';

const catalog=loadCatalog();
const trace=createTrace(catalog);
const fixture=path.resolve('tests/contract/test_eval_traceability.mjs');
const artifact={path:fixture,sha256:hash(fs.readFileSync(fixture,'utf8')),kind:'trace'};
const clone=x=>structuredClone(x);
const fp={implementation:hash('implementation'),environment:hash('environment'),fixtures:hash('fixtures'),configuration:hash('configuration')};
const plan=JSON.parse(fs.readFileSync(path.resolve('docs/validation/catalog/local-eval-plan.json'),'utf8'));

function evidence(testId='TC-SYS-003') {
  const t=trace.tests.find(t=>t.id===testId);
  return {schemaVersion:1,runId:'synthetic-tool-test',test:t.id,features:t.features,acceptance:[t.acceptance[0]],usecases:t.usecases,evals:t.evals,
    version:'0.0.0-test',revision:'a'.repeat(40),startedAt:'2026-10-24T08:00:00+08:00',finishedAt:'2026-10-24T08:00:01+08:00',status:'passed',execution:'pure',
    fingerprint:{...fp,specification:t.specificationHash},environment:Object.fromEntries(['os','cpu','ram','gpu','python','node','comfyui','frontend','browser','viewport','optionalPlugins','coldWarmState'].map(k=>[k,'test'])),
    fixtures:[{id:'SYNTHETIC-TOOL-TEST',sha256:hash('synthetic'),origin:'synthetic'}],weights:[],parameters:[],taskIdentities:[],
    assertions:t.assertions.map(a=>({id:a.id,status:'passed',actual:'Synthetic tool contract assertion; not product execution.',artifactPaths:[fixture]})),
    scores:[],artifacts:[artifact],trace:[artifact],deviations:[],defects:[],applicability:{reason:'',approvedBy:''},network:{cloudSubmissions:0,externalModelCalls:0,auditArtifact:fixture},
    uiMatrix:Object.fromEntries(['twoInstances','focusOverflow','graphCanvasModes','activeMuteBypass','saveReload','zoom50_100_150','viewports1920_1280_680','keyboardIme','dispose'].map(k=>[k,false])),
    inference:{sampleExecutions:0,cacheHit:false,ledgerReuse:false,executionTrace:''},supersedes:[],notes:'Synthetic evidence used only in tool tests. Never stored as product evidence.'};
}

// Synthetic records exercise only the gate. They reuse this test source as fake
// file evidence, live only in a temporary folder, and are never product results.
function withLocalBatch(fn,{turbo=false}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-eval-test-'));
  try {
    const e=evidence('TC-SYS-036');e.execution='local-live';e.startedAt='2026-10-24T00:00:00Z';e.finishedAt='2026-10-24T01:00:00Z';
    e.weights=plan.samples.filter((s,i,a)=>a.findIndex(x=>x.model===s.model)===i).map(s=>({file:`synthetic-${s.id}`,sha256:hash(s.model),model:s.model}));
    const batch={schemaVersion:1,planHash:hash(plan),blindLabels:{baseline:'A',studio:'B'},lora:{baselineConfigured:turbo,studioConfigured:turbo,sha256:turbo?hash('lora'):''},executions:[],requestDifferences:[],recoveries:[]};
    const make=(sample,variant,repetition,turboSupplement=false)=>{
      const index=batch.executions.length,id=`${sample.id}-${variant}-${repetition}-${turboSupplement}`;
      const p={temperature:null,contextTokens:null,maxOutputTokens:null,seed:20261023,width:null,height:null,steps:null,cfg:null,sampler:null,scheduler:null,frames:null,fps:null,inputDurationSeconds:null,turbo:turboSupplement,referenceOrder:[],preprocessedImageSha256:[],actualWeightSha256:[hash(sample.model)],lora:turboSupplement?[hash('lora')]:[]};
      const count=sample.mode.startsWith('image-caption')||sample.mode==='first-frame-to-video'?1:sample.mode==='first-last-frame-to-video'?2:0;
      p.referenceOrder=Array.from({length:count},(_,i)=>`image-${i}`);p.preprocessedImageSha256=p.referenceOrder.map(hash);
      if(sample.id.startsWith('LOCAL-TEXT-')||sample.id.startsWith('LOCAL-VISION-'))Object.assign(p,{temperature:0.4,contextTokens:sample.mode.startsWith('table-row')?16384:8192,maxOutputTokens:sample.mode.startsWith('table-row')?1024:768,seed:'omitted'});
      else if(sample.id.startsWith('LOCAL-IMAGE-'))Object.assign(p,{width:1024,height:1024,steps:8,cfg:1,sampler:'Euler',scheduler:'simple',seed:sample.id==='LOCAL-IMAGE-001'?20261013:20261014});
      else Object.assign(p,{width:512,height:288,steps:turboSupplement?8:20,sampler:'res_multistep',scheduler:'simple',frames:39,fps:24,inputDurationSeconds:1.5});
      const requestJson=JSON.stringify({model:sample.model,system:'fixed',prompt:sample.id,effective:p});
      const x={id,sampleId:sample.id,variant,repetition,turboSupplement,smoke:repetition===1&&!turboSupplement,model:sample.model,endpoint:'local',startedAt:new Date(Date.parse(e.startedAt)+index*1000).toISOString(),finishedAt:new Date(Date.parse(e.startedAt)+(index+1)*1000).toISOString(),requestId:id,providerTaskId:`task-${id}`,attemptId:`attempt-${id}`,requestJson,effective:p,inference:{sampleExecutions:1,cacheHit:false,ledgerReuse:false,traceArtifact:fixture},output:{artifact:fixture,decodable:true,width:p.width,height:p.height,frames:p.frames,fps:p.fps,durationSeconds:p.frames?1.625:null},metrics:{durationMs:1000,peakMemoryBytes:1000000,coldWarmState:'warm',segmentsMs:{preprocess:0,queue:0,modelLoad:0,inference:1000,decode:0,postprocess:0}}};
      batch.executions.push(x);e.parameters.push({model:x.model,endpoint:'local',requestJson});
      e.taskIdentities.push({requestId:x.requestId,workflowSession:'test',nodeId:'test',recordId:sample.id,providerTaskId:x.providerTaskId,attemptId:x.attemptId});
      for(const dimension of plan.qualityGate.dimensions.filter(d=>sample.id.startsWith('LOCAL-H3-')||d!=='first-last-frames-and-motion-continuity'))e.scores.push({executionId:x.id,sampleId:sample.id,blindLabel:batch.blindLabels[variant],reviewer:'synthetic-test-reviewer',dimension,critical:dimension!=='composition-and-style',score:4});
    };
    for(let r=1;r<=3;r++)for(const sample of plan.samples)if(r<=sample.repetitionsPerVariant)for(const variant of plan.variants)make(sample,variant,r);
    if(turbo)for(const sample of plan.samples.filter(s=>s.id.startsWith('LOCAL-H3-')))for(const variant of plan.variants)make(sample,variant,1,true);
    const recovered=batch.executions.find(x=>x.variant==='studio');batch.recoveries=[{originalExecutionId:recovered.id,requestId:recovered.requestId,providerTaskId:recovered.providerTaskId,attemptId:recovered.attemptId,sampleExecutions:0,ledgerReuse:true,traceArtifact:fixture}];
    e.inference={sampleExecutions:batch.executions.length,cacheHit:false,ledgerReuse:false,executionTrace:fixture};
    const report=path.join(dir,'batch.json');e.localBatchArtifact=report;
    const persist=()=>{const text=JSON.stringify(batch);fs.writeFileSync(report,text);e.artifacts=[artifact,{path:report,sha256:hash(text),kind:'report'}];};
    persist();return fn(e,batch,persist);
  } finally {assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(dir).startsWith('studio-eval-test-'));fs.rmSync(dir,{recursive:true,force:true});}
}

test('catalog has exact approved scope, one task owner per feature, stable complete AC links',()=>{
  assert.equal(catalog.features.length,118);assert.equal(catalog.usecases.length,41);assert.equal(catalog.tests.length,131);
  assert.equal(trace.acceptance.length,catalog.features.reduce((n,f)=>n+f.acceptance.length,0));
  const owners=trace.tasks.flatMap(t=>t.features);
  assert.equal(owners.length,118);assert.equal(new Set(owners).size,118);
  for (const a of trace.acceptance) { assert.ok(a.tests.length&&a.usecases.length&&a.evals.length);assert.equal(a.status,'not-executed');assert.deepEqual(a.evidence,[]); }
  const reordered=clone(catalog);const f=reordered.features[0];f.acceptance.reverse();f.acceptance_ids.reverse();
  assert.deepEqual(createTrace(reordered).acceptance.filter(a=>a.feature===f.id).map(a=>a.id).sort(),trace.acceptance.filter(a=>a.feature===f.id).map(a=>a.id).sort());
});

test('approved table contract and M4/M5 separation remain explicit',()=>{
  const f=catalog.features.find(f=>f.id==='F-BIZ-008');
  assert.match(f.acceptance.join(' '),/3 行/);assert.match(f.acceptance.join(' '),/500 行、64 列/);
  const t=catalog.tests.find(t=>t.id==='TC-SYS-036');
  assert.equal(t.phase,'M4');assert.ok(!t.steps.some(s=>s.includes('剪辑')));
  assert.equal(catalog.tests.find(t=>t.id==='TC-SYS-032').phase,'M5');
});

test('phase gate remains cumulative and unknown paths conservatively trigger regression',()=>{
  const m1=selectTests(catalog,'M1');const m4=selectTests(catalog,'M4',['backend/jobs/ledger.py']);
  assert.ok(m1.required.length>0);assert.ok(m1.required.every(t=>m4.required.some(x=>x.id===t.id)));
  assert.ok(!m4.required.some(t=>t.id==='TC-SYS-032'));assert.ok(m4.required.some(t=>t.id==='TC-SYS-036'));
  assert.ok(selectTests(catalog,'M1',['new-unknown-module/file.ts']).required.every(t=>t.reasons.includes('change-impact')));
  assert.equal(evaluateGate(catalog,'M0',[],fp).status,'baseline-review-required');
  assert.equal(evaluateGate(catalog,'M1',[],fp).status,'blocked');
});

test('strict schema rejects extra fields, unrelated links, duplicate or omitted assertions',()=>{
  assert.equal(validateEvidence(evidence(),catalog),true);
  let e=evidence();e.extra=true;assert.throws(()=>validateEvidence(e,catalog),/unknown property/);
  e=evidence();e.features=['F-BIZ-001'];assert.throws(()=>validateEvidence(e,catalog),/unrelated/);
  e=evidence();e.assertions.pop();assert.throws(()=>validateEvidence(e,catalog),/every expected/);
  e=evidence();e.assertions.push(e.assertions[0]);assert.throws(()=>validateEvidence(e,catalog),/duplicate assertion/);
});

test('missing prerequisites cannot become N/A and unreviewed scope changes are rejected',()=>{
  let e=evidence();e.status='not-applicable';e.applicability={reason:'missing host',approvedBy:'reviewer'};
  assert.throws(()=>validateEvidence(e,catalog),/prerequisites/);
  e.applicability={reason:'Platform out of declared support',approvedBy:''};assert.throws(()=>validateEvidence(e,catalog),/reviewer/);
});

test('mock UI and live generation never qualify as actual host or local acceptance',()=>{
  let e=evidence('TC-SYS-004');assert.throws(()=>validateEvidence(e,catalog),/actual ComfyUI/);
  e.execution='actual-host';assert.throws(()=>validateEvidence(e,catalog),/UI matrix/);
  e=evidence('TC-SYS-036');assert.throws(()=>validateEvidence(e,catalog),/protocol mock/);
  e.execution='local-live';assert.throws(()=>validateEvidence(e,catalog),/actual weights/);
});

test('cloud calls and credentials are rejected',()=>{
  let e=evidence();e.network.cloudSubmissions=1;assert.throws(()=>validateEvidence(e,catalog),/cloud submissions/);
  e=evidence();e.parameters=[{model:'test',endpoint:'fake',requestJson:JSON.stringify({nested:{api_key:'not-a-real-key'}})}];
  assert.throws(()=>validateEvidence(e,catalog),/credentials/);
});

test('implementation, environment, fixture, configuration and specification changes invalidate evidence',()=>{
  const e=evidence();assert.deepEqual(staleReasons(e,e.fingerprint),[]);
  for (const key of Object.keys(e.fingerprint)) assert.deepEqual(staleReasons(e,{...e.fingerprint,[key]:hash('changed')}),[key]);
  const report=evaluateGate(catalog,'M1',[e],{...fp,environment:hash('changed')});
  assert.equal(report.tests.find(t=>t.id===e.test).status,'stale');
  const changed=clone(catalog);changed.tests.find(t=>t.id===e.test).expected.push('Additional future acceptance requirement');
  assert.equal(evaluateGate(changed,'M1',[e],fp).tests.find(t=>t.id===e.test).status,'stale');
});

test('changed linked acceptance requirements and usecase steps invalidate otherwise unchanged TC evidence',()=>{
  const e=evidence();
  for (const change of [
    c=>{c.features.find(f=>f.id===e.features[0]).acceptance[0]+=' New mandatory condition.';},
    c=>{c.usecases.find(u=>u.id===e.usecases[0]).steps.push('New required usecase step.');},
  ]) {
    const changed=clone(catalog);change(changed);
    assert.equal(evaluateGate(changed,'M1',[e],fp).tests.find(t=>t.id===e.test).status,'stale');
  }
});

test('a later failure blocks a pass when timestamps use different UTC offsets',()=>{
  const passed=evidence();passed.runId='earlier-pass';passed.startedAt='2026-10-24T00:00:00Z';passed.finishedAt='2026-10-24T09:00:00+08:00';
  const failed=clone(passed);failed.runId='later-failure';failed.status='failed';failed.finishedAt='2026-10-24T02:00:00Z';failed.assertions[0].status='failed';
  assert.equal(evaluateGate(catalog,'M1',[passed,failed],fp).tests.find(t=>t.id===passed.test).status,'failed');
});

test('every assertion, network audit and inference trace must reference a hashed evidence artifact',()=>{
  for (const change of [e=>{e.assertions[0].artifactPaths=['missing-assertion.txt'];},
                         e=>{e.network.auditArtifact='missing-network-audit.txt';}]) {
    const e=evidence();change(e);assert.throws(()=>verifyEvidenceFiles(e),/referenced evidence/);
  }
});

test('a single inference and one score cannot pass the required local batch',()=>{
  const e=evidence('TC-SYS-036');e.execution='local-live';
  e.weights=[{file:'synthetic',sha256:hash('weight'),model:'qwen3.5:9b-q4_K_M'}];
  e.parameters=[{model:'qwen3.5:9b-q4_K_M',endpoint:'local',requestJson:'{}'}];
  e.taskIdentities=[{requestId:'one',workflowSession:'workflow',nodeId:'node',recordId:'row',providerTaskId:'task',attemptId:'attempt'}];
  e.inference={sampleExecutions:1,cacheHit:false,ledgerReuse:false,executionTrace:fixture};
  e.scores=[{sampleId:'unknown-sample',blindLabel:'A',reviewer:'human',dimension:'one',critical:true,score:1}];
  assert.throws(()=>validateEvidence(e,catalog),/local batch/);
});

test('complete synthetic 44/50-run batch satisfies the structural gate without executing a model',()=>{
  for(const turbo of [false,true])withLocalBatch(e=>{assert.equal(validateEvidence(e,catalog),true);assert.equal(verifyEvidenceFiles(e),true);},{turbo});
});

test('local batch rejects incomplete samples, cached inference, missing smoke and recovery reruns',()=>{
  const cases=[
    [(_e,b)=>b.executions.pop(),/registered inferences|missing array items/],
    [(_e,b)=>{b.executions[0].sampleId='unknown';},/unknown sample/],
    [(_e,b)=>{b.executions[0].inference.cacheHit=true;},/constant false/],
    [(_e,b)=>{b.executions[0].smoke=false;},/paired smoke/],
    [(_e,b)=>{b.recoveries[0].providerTaskId='new-task';},/recovery changed/],
    [(_e,b)=>{b.recoveries[0].sampleExecutions=1;},/constant 0/],
    [(_e,b)=>{b.recoveries=[];},/recovery proof/],
    [(_e,b)=>{b.executions[0].inference.traceArtifact='missing';},/unhashed referenced/],
  ];
  for(const [change,error] of cases)withLocalBatch((e,b,persist)=>{change(e,b);persist();assert.throws(()=>validateEvidence(e,catalog),error);});
});

test('local batch compares requests, fixed seeds, weights, frames, and cold/warm state',()=>{
  const cases=[
    [(_e,b)=>{b.executions.find(x=>x.sampleId==='LOCAL-IMAGE-001').effective.seed=1;},/fixed parameters/],
    [(_e,b)=>{b.executions.find(x=>x.sampleId==='LOCAL-H3-001').output.durationSeconds=1.5;},/H3 output/],
    [(_e,b)=>{b.executions[0].effective.actualWeightSha256=[hash('other-weight')];},/undeclared actual weight/],
    [(_e,b)=>{b.executions[1].metrics.coldWarmState='cold';},/unmatched cold/],
    [(e,b)=>{const x=b.executions[1];x.requestJson=JSON.stringify({...JSON.parse(x.requestJson),prompt:'changed'});e.parameters.push({model:x.model,endpoint:'local',requestJson:x.requestJson});},/unexplained/],
  ];
  for(const [change,error] of cases)withLocalBatch((e,b,persist)=>{change(e,b);persist();assert.throws(()=>validateEvidence(e,catalog),error);});
  withLocalBatch((e,b,persist)=>{const x=b.executions[1];x.requestJson=JSON.stringify({...JSON.parse(x.requestJson),runId:'allowed-different-id',outputPrefix:'allowed-prefix'});e.parameters.push({model:x.model,endpoint:'local',requestJson:x.requestJson});persist();assert.equal(validateEvidence(e,catalog),true);});
});

test('local batch blocks quality and model-performance regressions',()=>{
  const cases=[
    [e=>{for(const score of e.scores)if(score.blindLabel==='B'&&score.dimension==='subject-and-constraints')score.score=3;},/critical quality median/],
    [e=>{for(const score of e.scores)if(score.blindLabel==='B'&&score.dimension==='composition-and-style')score.score=3;},/noncritical quality/],
    [(e,b)=>{for(const score of e.scores){const x=b.executions.find(x=>x.id===score.executionId),sample=plan.samples.find(s=>s.id===x.sampleId);if(sample.repetitionsPerVariant===3&&x.repetition===1)score.score=x.variant==='baseline'?5:3;}},/overall quality mean/],
    [(e,b)=>{for(const x of b.executions.filter(x=>x.variant==='studio')){x.metrics.durationMs=1200;x.metrics.segmentsMs.inference=1200;}},/duration regressed/],
    [(e,b)=>{b.executions.find(x=>x.variant==='studio').metrics.peakMemoryBytes=1200000;},/peak memory regressed/],
    [e=>{e.scores.pop();},/missing per-output/],
  ];
  for(const [change,error] of cases)withLocalBatch((e,b,persist)=>{change(e,b);persist();assert.throws(()=>validateEvidence(e,catalog),error);});
});

test('append-only storage retains failures and later failure blocks an earlier pass',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-eval-test-'));
  try {
    const passed=evidence();appendEvidence(dir,passed,catalog);
    assert.throws(()=>appendEvidence(dir,passed,catalog),/EEXIST/);
    const failed=clone(passed);failed.runId='synthetic-later-failure';failed.status='failed';failed.finishedAt='2026-10-24T08:01:00+08:00';failed.assertions[0].status='failed';
    appendEvidence(dir,failed,catalog);
    assert.equal(fs.readdirSync(dir).length,2);
    const report=evaluateGate(catalog,'M1',[passed,failed],fp);
    assert.equal(report.tests.find(t=>t.id===passed.test).status,'failed');
    assert.equal(report.tests.find(t=>t.id===passed.test).history.length,2);
  } finally { assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(dir).startsWith('studio-eval-test-'));fs.rmSync(dir,{recursive:true,force:true}); }
});

test('missing or changed artifacts cannot support a pass',()=>{
  const e=evidence();assert.equal(verifyEvidenceFiles(e),true);
  e.artifacts=[{...artifact,path:path.join(os.tmpdir(),'missing-studio-eval-evidence-unique.trace')}];
  assert.throws(()=>verifyEvidenceFiles(e),/missing evidence/);
  e.artifacts=[{...artifact,sha256:'0'.repeat(64)}];assert.throws(()=>verifyEvidenceFiles(e),/file changed/);
});

test('source catalog renders in a standalone checkout without either old repository',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-eval-test-'));
  try {
    const dest=path.join(dir,'docs/migration-blueprint');fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.cpSync(path.resolve('docs/migration-blueprint'),dest,{recursive:true});
    const result=spawnSync(process.execPath,[path.join(dest,'render_catalog.mjs'),'--check'],{cwd:dir,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const manifest=JSON.parse(fs.readFileSync(path.join(dest,'source-manifest.json'),'utf8'));
    assert.equal(Object.keys(manifest.files).length,277);
    manifest.files['canvas:__init__.py'].sha256='bad';
    fs.writeFileSync(path.join(dest,'source-manifest.json'),JSON.stringify(manifest));
    const invalid=spawnSync(process.execPath,[path.join(dest,'render_catalog.mjs'),'--check'],{cwd:dir,encoding:'utf8'});
    assert.equal(invalid.status,1);assert.match(invalid.stderr,/source manifest/);
  } finally {assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(dir).startsWith('studio-eval-test-'));fs.rmSync(dir,{recursive:true,force:true});}
});

test('local Eval plan contains ten samples, forty-four base inferences, counted smoke and conditional LoRA',()=>{
  const plan=JSON.parse(fs.readFileSync(path.resolve('docs/validation/catalog/local-eval-plan.json'),'utf8'));
  assert.equal(plan.samples.length,10);
  assert.equal(plan.samples.reduce((n,s)=>n+2*s.repetitionsPerVariant,0),44);
  assert.equal(plan.pairedSmokeInferenceCount,20);assert.equal(plan.smokeCountsTowardBase,true);
  assert.equal(plan.conditionalLora.additionalInferenceCount,6);
  assert.equal(plan.fixedParameters.video.alignedFrames/plan.fixedParameters.video.fps,1.625);
});
