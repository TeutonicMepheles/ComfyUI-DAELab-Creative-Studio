import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateLocalBatch} from './local_batch.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const FAMILIES = ['EV-ARCH','EV-UI','EV-DATA','EV-JOBS','EV-PERF','EV-LOCAL','EV-E2E'];
export const LIVE_MODELS = ['qwen3.5:9b-q4_K_M','Qwen-Image-2.1 Turbo（本地）','MiniMax H3 FL（本地）'];
export const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const unique = xs => [...new Set(xs)].sort();
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const must = (value, message) => { if (!value) throw new Error(message); };

export function loadCatalog(root = ROOT) {
  const bundles = ['canvas','business','system','exclusions'].map(name => read(path.join(root,'docs/migration-blueprint/catalog',name+'.json')));
  return {features:bundles.flatMap(b=>b.features),usecases:bundles.flatMap(b=>b.usecases),tests:bundles.flatMap(b=>b.tests)};
}

const ownerOverrides = {
  'F-CAN-001':'integrations/comfyui','F-SYS-001':'integrations/comfyui','F-SYS-015':'integrations/comfyui',
  'F-CAN-003':'design/ui','F-CAN-039':'design/ui','F-SYS-003':'design/ui',
  'F-CAN-013':'application','F-SYS-005':'application','F-SYS-002':'application',
  'F-CAN-024':'backend/assets','F-SYS-008':'backend/assets',
  'F-CAN-014':'compat','F-CAN-020':'features/groups','F-CAN-033':'backend/media','F-CAN-036':'backend/assets','F-BIZ-037':'compat','F-BIZ-038':'compat',
  'F-SYS-013':'compat','F-SYS-014':'compat','F-SYS-021':'compat',
  'F-BIZ-029':'backend/jobs','F-BIZ-030':'backend/jobs','F-SYS-007':'backend/jobs',
  'F-BIZ-031':'backend/jobs','F-SYS-019':'backend/jobs','F-BIZ-035':'backend/jobs','F-SYS-010':'backend/jobs',
  'F-SYS-004':'tests/evals','F-SYS-012':'tests/evals','F-SYS-017':'tests/evals',
  'F-SYS-016':'release','F-BIZ-039':'compat','F-BIZ-040':'compat'
};

export function ownerOf(f) {
  if (ownerOverrides[f.id]) return ownerOverrides[f.id];
  if (f.id.startsWith('F-OUT-')) return 'compat';
  const first = f.target.split(';')[0].trim();
  if (/integrations\/comfyui/.test(first)) return 'integrations/comfyui';
  if (/^frontend\/src\/(design|ui)/.test(first)) return 'design/ui';
  if (first.startsWith('frontend/src/canvas')) return 'canvas';
  if (first.startsWith('frontend/src/application')) return 'application';
  if (first.startsWith('frontend/src/features/')) return first.replace('frontend/src/','').split('/').slice(0,2).join('/');
  if (first.startsWith('compat')) return 'compat';
  if (first.startsWith('backend/')) return first.split('/').slice(0,2).join('/');
  if (first.startsWith('tests/') || first.startsWith('docs/')) return 'tests/evals';
  throw new Error(`Assign explicit implementation owner for ${f.id}`);
}

export function evalsFor(t) {
  const ids = new Set();
  const primary = {domain:'EV-DATA',contract:'EV-ARCH',backend:'EV-JOBS',integration:'EV-ARCH',host:'EV-UI',migration:'EV-DATA',performance:'EV-PERF','provider-live':'EV-LOCAL'};
  ids.add(primary[t.level]);
  if (/任务|账本|恢复|幂等|提交|调度|回填/.test(t.title)) ids.add('EV-JOBS');
  if (/完整|安装|发布|回滚/.test(t.title)) ids.add('EV-E2E');
  return [...ids].sort();
}

export function specificationHash(catalog, test, root = ROOT) {
  const contracts = ['docs/migration-blueprint/TEST_STRATEGY.md', 'docs/validation/catalog/evidence.schema.json'];
  if (test.level === 'provider-live') contracts.push('docs/validation/catalog/local-eval-plan.json', 'docs/validation/catalog/local-batch.schema.json');
  return hash({test,
    acceptance:catalog.features.filter(f=>test.features.includes(f.id)).map(f=>({id:f.id,
      requirements:f.acceptance.map((text,i)=>({id:f.acceptance_ids[i],text})).sort((a,b)=>a.id.localeCompare(b.id))})).sort((a,b)=>a.id.localeCompare(b.id)),
    usecases:catalog.usecases.filter(u=>test.usecases.includes(u.id)).sort((a,b)=>a.id.localeCompare(b.id)),
    // Normative text follows Git's LF checkout contract. Only CRLF is
    // equivalent here; raw evidence/trace artifacts remain byte-exact below.
    contracts:contracts.map(file=>({file,sha256:hash(fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n'))}))});
}

export function createTrace(catalog, root = ROOT) {
  const {features,usecases,tests} = catalog;
  const tasks = new Map();
  const acceptance = [];
  for (const f of features) {
    const owner = ownerOf(f);
    const taskId = `TASK-${f.phase}-${owner.replaceAll('/','-').toUpperCase()}`;
    if (!tasks.has(taskId)) tasks.set(taskId,{id:taskId,phase:f.phase,owner,features:[],acceptance:[],usecases:[],tests:[],evals:[],status:'not-started'});
    const task = tasks.get(taskId);
    task.features.push(f.id);
    const tc = tests.filter(t=>t.features.includes(f.id));
    const uc = usecases.filter(u=>u.features.includes(f.id));
    must(f.acceptance_ids?.length===f.acceptance.length, `acceptance ID count differs for ${f.id}`);
    f.acceptance.forEach((text,i)=>{
      const id = f.acceptance_ids?.[i];
      must(typeof id==='string' && new RegExp(`^AC-${f.id.slice(2)}-[0-9]{3}$`).test(id),`missing stable acceptance ID for ${f.id}`);
      must(!acceptance.some(a=>a.id===id),`duplicate acceptance ID ${id}`);
      acceptance.push({id,feature:f.id,task:taskId,owner,requirement:text,requirementHash:hash(text),usecases:uc.map(u=>u.id),tests:tc.map(t=>t.id),evals:unique(tc.flatMap(evalsFor)),status:'not-executed',evidence:[]});
      task.acceptance.push(id);
    });
    task.usecases.push(...uc.map(u=>u.id)); task.tests.push(...tc.map(t=>t.id)); task.evals.push(...tc.flatMap(evalsFor));
  }
  for (const task of tasks.values()) for (const key of ['features','acceptance','usecases','tests','evals']) task[key]=unique(task[key]);
  return {schemaVersion:1,specificationHash:hash(catalog),status:'Specification and execution plan only; no product acceptance claimed.',tasks:[...tasks.values()].sort((a,b)=>a.id.localeCompare(b.id)),acceptance,
    tests:tests.map(t=>({id:t.id,phase:t.phase,priority:t.priority,level:t.level,features:t.features,usecases:t.usecases,acceptance:acceptance.filter(a=>t.features.includes(a.feature)).map(a=>a.id),evals:evalsFor(t),specificationHash:specificationHash(catalog,t,root),assertions:t.expected.map((text,i)=>({id:`AS-${t.id.slice(3)}-${String(i+1).padStart(3,'0')}`,expected:text})),status:'not-executed',evidence:[]})),
    evals:FAMILIES.map(id=>({id,tests:tests.filter(t=>evalsFor(t).includes(id)).map(t=>t.id),status:'not-executed'}))};
}

// Fail closed: unknown changed paths trigger regression of all due cases. Selection
// never turns an unimplemented, missing-model or missing-host case into N/A.
export function selectTests(catalog, phase, changed = []) {
  must(/^M[0-6]$/.test(phase),'phase must be M0..M6');
  const normalized = changed.map(p=>p.replaceAll('\\','/').replace(/^\.\//,''));
  const impacted = new Set();
  let unknownImpact = false;
  for (const file of normalized) {
    const matching = catalog.features.filter(f=>f.target.split(';').some(p=>{
      const target=p.trim(); return file===target || file.startsWith(target+'/') || target.startsWith(file+'/');
    }));
    if (!matching.length) unknownImpact=true;
    matching.forEach(f=>impacted.add(f.id));
  }
  const required = catalog.tests.filter(t=>t.phase<=phase && ['P0','P1'].includes(t.priority));
  return {phase,changed:normalized,unknownImpact,required:required.map(t=>({id:t.id,priority:t.priority,phase:t.phase,reasons:['phase-gate',...(unknownImpact||t.features.some(f=>impacted.has(f))?['change-impact']:[])]})),deferred:catalog.tests.filter(t=>t.phase>phase).map(t=>t.id),
    warning:phase==='M0'?'No TC is assigned to M0. This selection cannot certify M0 baseline readiness.':null};
}

// Restricted JSON Schema vocabulary used by the checked-in evidence schema.
// Unsupported vocabulary fails rather than silently weakening the contract.
export function validateSchema(value, schema, at='$') {
  const allowed = new Set(['$schema','$id','title','description','type','required','properties','additionalProperties','items','minItems','uniqueItems','enum','const','pattern','minimum','maximum','minLength']);
  for (const key of Object.keys(schema)) must(allowed.has(key),`${at}: unsupported schema keyword ${key}`);
  const types=Array.isArray(schema.type)?schema.type:[schema.type];
  const kind=value===null?'null':Array.isArray(value)?'array':typeof value;
  must(types.some(t=>t===kind || t==='integer'&&Number.isInteger(value)),`${at}: expected ${types.join('|')}`);
  if ('const' in schema) must(value===schema.const,`${at}: expected constant ${schema.const}`);
  if (schema.enum) must(schema.enum.includes(value),`${at}: invalid enum value`);
  if (typeof value==='string') {
    if (schema.pattern) must(new RegExp(schema.pattern).test(value),`${at}: invalid pattern`);
    if (schema.minLength) must(value.length>=schema.minLength,`${at}: empty string`);
  }
  if (typeof value==='number') {
    must(Number.isFinite(value),`${at}: non-finite number`);
    if ('minimum' in schema) must(value>=schema.minimum,`${at}: below minimum`);
    if ('maximum' in schema) must(value<=schema.maximum,`${at}: above maximum`);
  }
  if (kind==='array') {
    if (schema.minItems) must(value.length>=schema.minItems,`${at}: missing array items`);
    if (schema.uniqueItems) must(new Set(value.map(v=>JSON.stringify(v))).size===value.length,`${at}: duplicate items`);
    value.forEach((v,i)=>validateSchema(v,schema.items,`${at}[${i}]`));
  }
  if (kind==='object') {
    for (const key of schema.required||[]) must(Object.hasOwn(value,key),`${at}: missing ${key}`);
    for (const [key,v] of Object.entries(value)) {
      if (schema.properties?.[key]) validateSchema(v,schema.properties[key],`${at}.${key}`);
      else must(schema.additionalProperties!==false,`${at}: unknown property ${key}`);
    }
  }
  return true;
}

export function validateEvidence(evidence,catalog,root=ROOT,allowStaleSpecification=false) {
  validateSchema(evidence,read(path.join(root,'docs/validation/catalog/evidence.schema.json')));
  const trace=createTrace(catalog,root), t=trace.tests.find(t=>t.id===evidence.test);
  must(t,`unknown test ${evidence.test}`);
  const source=catalog.tests.find(x=>x.id===t.id);
  const sameSpecification=evidence.fingerprint.specification===t.specificationHash;
  must(sameSpecification||allowStaleSpecification,'evidence uses different test specification');
  must(Number.isFinite(Date.parse(evidence.startedAt)) && Number.isFinite(Date.parse(evidence.finishedAt)) && Date.parse(evidence.finishedAt)>=Date.parse(evidence.startedAt),'invalid execution dates');
  for (const p of evidence.parameters) {
    const request=JSON.parse(p.requestJson);
    const rejectSecrets=value=>{
      if (value && typeof value==='object') for (const [key,item] of Object.entries(value)) {
        must(!/^(api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password|secret)$/i.test(key),'credentials must not enter evidence');
        rejectSecrets(item);
      }
    };
    rejectSecrets(request);
  }
  for (const [key,known] of [['features',t.features],['acceptance',t.acceptance],['usecases',t.usecases],['evals',t.evals]]) {
    must(evidence[key].length>0,`missing ${key} links`);
    for (const id of evidence[key]) must(known.includes(id),`unrelated ${key}: ${id}`);
  }
  const assertionIds=new Set(t.assertions.map(a=>a.id));
  const seen=new Set();
  for (const a of evidence.assertions) { if (sameSpecification) must(assertionIds.has(a.id),`unrelated assertion ${a.id}`); must(!seen.has(a.id),`duplicate assertion ${a.id}`); seen.add(a.id); }
  const incomplete=['failed','blocked','not-executed'].includes(evidence.status);
  // Missing telemetry must stay unknown in retained failures, never fabricated as
  // zero. A detected forbidden call is itself a hard failure that must be kept.
  if (!incomplete) {
    must(evidence.network.cloudSubmissions===0,'cloud submissions are forbidden in this eval scope or unmeasured');
    must(evidence.network.externalModelCalls===0,'external model calls are forbidden or unmeasured');
    must(evidence.inference.sampleExecutions!==null && evidence.inference.cacheHit!==null && evidence.inference.ledgerReuse!==null,'completed evidence needs known inference accounting');
  } else if (evidence.network.cloudSubmissions>0 || evidence.network.externalModelCalls>0) {
    must(evidence.status==='failed' && evidence.defects.some(d=>d.status==='open'),'detected forbidden calls require failed evidence with an open defect');
  }
  if (incomplete && [evidence.network.cloudSubmissions,evidence.network.externalModelCalls,evidence.inference.sampleExecutions,evidence.inference.cacheHit,evidence.inference.ledgerReuse].includes(null)) {
    must(evidence.deviations.length>0 || evidence.notes.trim().length>0,'unknown accounting needs a recorded missing-telemetry explanation');
  }
  if (evidence.status==='not-applicable') {
    must(evidence.applicability.reason.length>0 && evidence.applicability.approvedBy.length>0,'N/A needs recorded scope reason and reviewer');
    must(!/missing|unimplemented|unavailable|budget|no model|缺|未实现|无环境|无预算/i.test(evidence.applicability.reason),'missing prerequisites cannot be N/A');
    must(evidence.defects.every(d=>d.status==='resolved'),'unresolved defects block N/A');
    must(evidence.artifacts.length>0 && evidence.trace.length>0,'N/A needs scope evidence and trace');
  }
  if (evidence.status==='passed' && sameSpecification) {
    must((!sameSpecification||seen.size===assertionIds.size) && evidence.assertions.every(a=>a.status==='passed'),'pass needs every expected assertion');
    must(evidence.artifacts.length>0 && evidence.trace.length>0,'pass needs artifacts and trace');
    must(evidence.defects.every(d=>d.status==='resolved'),'unresolved defects block pass');
    if (source.level==='host') {
      must(evidence.execution==='actual-host','host TC needs actual ComfyUI');
      for (const [key,value] of Object.entries(evidence.uiMatrix)) must(value===true,`host UI matrix incomplete: ${key}`);
      must(evidence.environment.comfyui && evidence.environment.frontend && evidence.environment.browser,'host versions required');
    }
    if (source.level==='provider-live') {
      must(evidence.execution==='local-live','live TC cannot pass with protocol mock');
      must(evidence.weights.length>0 && evidence.parameters.length>0 && evidence.taskIdentities.length>0,'live evidence needs actual weights, parameters and task identities');
      must(evidence.inference.sampleExecutions>0 && !evidence.inference.cacheHit && !evidence.inference.ledgerReuse,'independent inference execution was not proven');
      must(evidence.inference.executionTrace.length>0,'live inference needs sampler trace');
      must(evidence.scores.length>0,'live acceptance needs blind human review');
      for (const p of evidence.parameters) must(LIVE_MODELS.includes(p.model) && p.endpoint==='local','only approved local model paths may execute');
      must(evidence.localBatchArtifact,'passed live TC needs a complete local batch report');
      const batchArtifact=evidence.artifacts.find(a=>path.resolve(root,a.path)===path.resolve(root,evidence.localBatchArtifact));
      must(batchArtifact?.kind==='report','local batch report must be a declared hashed report artifact');
      const batch=read(path.resolve(root,evidence.localBatchArtifact));
      validateSchema(batch,read(path.join(root,'docs/validation/catalog/local-batch.schema.json')));
      validateLocalBatch(batch,evidence,read(path.join(root,'docs/validation/catalog/local-eval-plan.json')),root);
    }
    if (source.level==='performance') must(evidence.execution==='measured-performance','performance requires measured evidence');
  }
  return true;
}

export function staleReasons(evidence,current) {
  const reasons=[];
  for (const key of ['implementation','environment','fixtures','configuration','specification']) if (evidence.fingerprint[key]!==current[key]) reasons.push(key);
  return reasons;
}

export function verifyEvidenceFiles(evidence,base=ROOT,requireReferences=true) {
  const verified=new Set();
  for (const artifact of [...evidence.artifacts,...evidence.trace]) {
    const file=path.resolve(base,artifact.path);
    must(fs.existsSync(file)&&fs.statSync(file).isFile(),`missing evidence file ${artifact.path}`);
    const actual=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    must(actual===artifact.sha256,`evidence file changed ${artifact.path}`);
    verified.add(file);
  }
  if (evidence.status==='not-applicable' && requireReferences) {
    const ref=evidence.network.auditArtifact;
    must(typeof ref==='string' && ref.length>0 && verified.has(path.resolve(base,ref)),'N/A needs a hashed network/scope audit');
  }
  if (evidence.status==='passed' && requireReferences) {
    const refs=evidence.assertions.flatMap(a=>a.artifactPaths);
    must(evidence.assertions.every(a=>a.artifactPaths.length>0),'passed assertion needs referenced evidence');
    refs.push(evidence.network.auditArtifact);
    if (evidence.execution==='local-live') refs.push(evidence.inference.executionTrace,evidence.localBatchArtifact);
    for (const ref of refs) must(typeof ref==='string' && ref.length>0 && verified.has(path.resolve(base,ref)),`missing hashed referenced evidence ${ref||'(empty)'}`);
  }
  return true;
}

export function evaluateGate(catalog,phase,evidence,current,changed=[]) {
  const selected=selectTests(catalog,phase,changed);
  const seen=new Set();
  for (const run of evidence) {
    validateEvidence(run,catalog,ROOT,true);
    const test=catalog.tests.find(t=>t.id===run.test);
    verifyEvidenceFiles(run,ROOT,run.fingerprint.specification===specificationHash(catalog,test));
    must(!seen.has(run.runId),`duplicate runId ${run.runId}`); seen.add(run.runId);
  }
  const tests=selected.required.map(t=>{
    const spec=catalog.tests.find(x=>x.id===t.id);
    const now={...current,specification:specificationHash(catalog,spec)};
    const severity={passed:0,'not-applicable':0,'not-executed':1,blocked:2,failed:3};
    const history=evidence.filter(e=>e.test===t.id).sort((a,b)=>Date.parse(a.finishedAt)-Date.parse(b.finishedAt)||severity[a.status]-severity[b.status]||a.runId.localeCompare(b.runId));
    const active=history.filter(e=>!staleReasons(e,now).length);
    const last=active.at(-1);
    return {id:t.id,status:last?.status||(history.length?'stale':'not-executed'),runId:last?.runId||null,history:history.map(e=>({runId:e.runId,status:e.status,stale:staleReasons(e,now)}))};
  });
  return {phase,status:phase==='M0'?'baseline-review-required':tests.every(t=>t.status==='passed'||t.status==='not-applicable')?'passed':'blocked',tests};
}

export function appendEvidence(directory,evidence,catalog) {
  validateEvidence(evidence,catalog);
  verifyEvidenceFiles(evidence);
  fs.mkdirSync(directory,{recursive:true});
  const dest=path.join(directory,evidence.runId+'.json');
  fs.writeFileSync(dest,JSON.stringify(evidence,null,2)+'\n',{encoding:'utf8',flag:'wx'});
  return dest;
}

export function renderTrace(root=ROOT,write=false) {
  const catalog=loadCatalog(root),trace=createTrace(catalog,root);
  const file=path.join(root,'docs/validation/catalog/traceability.json');
  const content=JSON.stringify(trace,null,2)+'\n';
  if (write) { fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,content); }
  else must(fs.readFileSync(file,'utf8')===content,'traceability.json is stale; run --write');
  return {features:catalog.features.length,usecases:catalog.usecases.length,tests:catalog.tests.length,acceptance:trace.acceptance.length,tasks:trace.tasks.length,status:'tooling verification only'};
}

function main(args) {
  const get=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
  if (args.includes('--write')||args.includes('--check')) return renderTrace(ROOT,args.includes('--write'));
  const catalog=loadCatalog();
  const phase=get('--phase','M1');
  const changed=get('--changed','').split(',').filter(Boolean);
  if (args.includes('--select')) return selectTests(catalog,phase,changed);
  if (args.includes('--record')) return {path:appendEvidence(get('--evidence-dir',path.join(ROOT,'.local/evidence')),read(get('--record')),catalog)};
  if (args.includes('--gate')) {
    const dir=get('--evidence-dir',path.join(ROOT,'.local/evidence'));
    const evidence=fs.existsSync(dir)?fs.readdirSync(dir).filter(x=>x.endsWith('.json')).map(x=>read(path.join(dir,x))):[];
    const report=evaluateGate(catalog,phase,evidence,read(get('--fingerprint')),changed);
    if (report.status!=='passed') process.exitCode=1;
    return report;
  }
  throw new Error('Use --write, --check, --select --phase M1, --record run.json, or --gate --phase M1 --fingerprint current.json');
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(main(process.argv.slice(2)),null,2)+'\n'); }
  catch(error) { process.stderr.write(error.message+'\n'); process.exitCode=1; }
}
