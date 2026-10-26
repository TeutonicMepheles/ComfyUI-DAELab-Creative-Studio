import crypto from 'node:crypto';
import path from 'node:path';

const must=(value,message)=>{if(!value)throw Error(`local batch: ${message}`);};
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const median=values=>{const s=[...values].sort((a,b)=>a-b),i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2;};
const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
const canon=value=>Array.isArray(value)?value.map(canon):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().filter(k=>!['runId','outputPrefix'].includes(k)).map(k=>[k,canon(value[k])])):value;
const equal=(a,b)=>JSON.stringify(canon(a))===JSON.stringify(canon(b));
function differences(a,b,pointer='') {
  if(equal(a,b))return [];
  if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)) {
    return [...new Set([...Object.keys(a),...Object.keys(b)])].sort().filter(k=>!['runId','outputPrefix'].includes(k))
      .flatMap(k=>differences(a[k],b[k],`${pointer}/${k.replaceAll('~','~0').replaceAll('/','~1')}`));
  }
  return [pointer||'/'];
}
function parseRequest(text) {
  const request=JSON.parse(text);
  must(request&&typeof request==='object'&&!Array.isArray(request)&&Object.keys(request).length>0,'final request must be a nonempty JSON object');
  const scan=value=>{
    if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)) {
      must(!/^(api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password|secret)$/i.test(key),'credentials cannot enter final requests');
      scan(item);
    }
  };scan(request);return request;
}

// No inference, media decoding or human judging occurs here. This validates the
// captured report and numeric gates, and requires its raw outputs/traces to be
// hash-verified by the surrounding evidence ledger. Missing capture stays blocked.
export function validateLocalBatch(batch,evidence,plan,root) {
  must(batch.planHash===hash(plan),'plan changed; recapture/review required');
  must(batch.blindLabels.baseline!==batch.blindLabels.studio,'blind variant labels must differ');
  const refs=new Set([...evidence.artifacts,...evidence.trace].map(a=>path.resolve(root,a.path)));
  const referenced=file=>must(typeof file==='string'&&refs.has(path.resolve(root,file)),`unhashed referenced evidence ${file}`);
  const executions=batch.executions, samples=new Map(plan.samples.map(s=>[s.id,s]));
  const bothTurbo=batch.lora.baselineConfigured&&batch.lora.studioConfigured;
  must(!bothTurbo||/^[a-f0-9]{64}$/.test(batch.lora.sha256),'configured LoRA requires a fixed weight hash');
  const expected=plan.baseInferenceCount+(bothTurbo?plan.conditionalLora.additionalInferenceCount:0);
  must(executions.length===expected,`expected all ${expected} registered inferences; no cherry-picked subset`);
  must(evidence.inference.sampleExecutions===expected,'aggregate sampler count differs from batch');
  const ids=new Set(),requests=new Set(),tasks=new Set(),attempts=new Set(),slots=new Set();
  const requestData=new Map();
  for(const x of executions) {
    const sample=samples.get(x.sampleId);
    must(sample,`unknown sample ${x.sampleId}`);
    for(const [set,value,label] of [[ids,x.id,'execution'],[requests,x.requestId,'request'],[tasks,x.providerTaskId,'provider task'],[attempts,x.attemptId,'attempt']]) {
      must(!set.has(value),`duplicate independent ${label} identity`);set.add(value);
    }
    const slot=`${x.sampleId}/${x.variant}/${x.repetition}/${x.turboSupplement}`;
    must(!slots.has(slot),'duplicate sample/repetition slot');slots.add(slot);
    must(x.repetition<=(x.turboSupplement?1:sample.repetitionsPerVariant),'unexpected sample repetition');
    must(!x.turboSupplement||(bothTurbo&&sample.id.startsWith('LOCAL-H3-')),'unconfigured turbo supplement');
    must(x.model===sample.model&&x.endpoint==='local','wrong model or nonlocal endpoint');
    must(x.smoke===(!x.turboSupplement&&x.repetition===1),'paired smoke must contain each base sample once per variant');
    must(Number.isFinite(Date.parse(x.startedAt))&&Date.parse(x.finishedAt)>=Date.parse(x.startedAt),'invalid inference dates');
    must(Date.parse(x.startedAt)>=Date.parse(evidence.startedAt)&&Date.parse(x.finishedAt)<=Date.parse(evidence.finishedAt),'inference lies outside the recorded batch time window');
    referenced(x.inference.traceArtifact);referenced(x.output.artifact);
    must(x.inference.sampleExecutions===1&&!x.inference.cacheHit&&!x.inference.ledgerReuse,'cache/ledger reuse is not independent inference');
    must(x.output.decodable,'output is not decodable');
    must(evidence.taskIdentities.some(t=>t.requestId===x.requestId&&t.providerTaskId===x.providerTaskId&&t.attemptId===x.attemptId),'missing exact task identity');
    must(x.effective.actualWeightSha256.every(sha=>evidence.weights.some(w=>w.sha256===sha&&w.model===x.model)),'undeclared actual weight');
    const raw=parseRequest(x.requestJson);requestData.set(x.id,raw);
    must(evidence.parameters.some(p=>p.model===x.model&&p.endpoint==='local'&&equal(parseRequest(p.requestJson),raw)),'final request absent from parameter snapshots');
    const p=x.effective;
    must(p.actualWeightSha256.length>0,'actual weights required');
    must(equal(p.lora,x.turboSupplement?[batch.lora.sha256]:[]),'hidden or wrong LoRA');
    const referenceCount=sample.mode==='first-frame-to-video'||sample.mode.startsWith('image-caption')?1:sample.mode==='first-last-frame-to-video'?2:0;
    must(p.referenceOrder.length===referenceCount&&p.preprocessedImageSha256.length===referenceCount,'wrong reference count/order capture');
    if(x.model===plan.samples[0].model) {
      const table=sample.mode.startsWith('table-row');
      must(p.temperature===0.4&&p.seed==='omitted','Qwen text temperature/seed changed');
      must(p.contextTokens===(table?16384:8192)&&(table?p.maxOutputTokens>=32&&p.maxOutputTokens<=1024:p.maxOutputTokens===768),'Qwen entry context/output limit changed');
    } else if(sample.id.startsWith('LOCAL-IMAGE-')) {
      const seed=sample.id==='LOCAL-IMAGE-001'?20261013:20261014;
      must(p.width===1024&&p.height===1024&&p.steps===8&&p.cfg===1&&p.sampler?.toLowerCase()==='euler'&&p.scheduler==='simple'&&p.seed===seed&&!p.turbo,'Qwen image fixed parameters changed');
      must(x.output.width===1024&&x.output.height===1024,'wrong Qwen image dimensions');
    } else {
      must(p.width===512&&p.height===288&&p.inputDurationSeconds===1.5&&p.steps===(x.turboSupplement?8:20)&&p.turbo===x.turboSupplement&&p.seed===20261023&&p.frames===39&&p.fps===24,'H3 fixed parameters changed');
      must(x.output.width===512&&x.output.height===288&&x.output.frames===39&&x.output.fps===24&&Math.abs(x.output.durationSeconds-1.625)<0.001,'wrong H3 output dimensions/frame count/duration');
    }
    const sum=Object.values(x.metrics.segmentsMs).reduce((a,b)=>a+b,0);
    must(Math.abs(sum-x.metrics.durationMs)<=Math.max(1,x.metrics.durationMs*0.001),'model performance segments do not sum to total duration');
  }
  for(const sample of samples.values())for(const variant of plan.variants) {
    for(let r=1;r<=sample.repetitionsPerVariant;r++)must(slots.has(`${sample.id}/${variant}/${r}/false`),'missing registered base inference');
    if(bothTurbo&&sample.id.startsWith('LOCAL-H3-'))must(slots.has(`${sample.id}/${variant}/1/true`),'missing configured LoRA inference');
  }
  const smoke=executions.filter(x=>x.smoke),remaining=executions.filter(x=>!x.smoke);
  must(smoke.length===plan.pairedSmokeInferenceCount,'paired smoke count differs');
  must(!remaining.length||Math.max(...smoke.map(x=>Date.parse(x.finishedAt)))<=Math.min(...remaining.map(x=>Date.parse(x.startedAt))),'paired smoke must complete before additional repetitions');
  const explained=new Set();
  for(const old of executions.filter(x=>x.variant==='baseline')) {
    const current=executions.find(x=>x.variant==='studio'&&x.sampleId===old.sampleId&&x.repetition===old.repetition&&x.turboSupplement===old.turboSupplement);
    must(current,'unpaired inference');
    must(equal(old.effective,current.effective),'effective inputs/weights/parameters changed across versions');
    must(old.metrics.coldWarmState===current.metrics.coldWarmState,'unmatched cold/warm state');
    for(const pointer of differences(requestData.get(old.id),requestData.get(current.id))) {
      const matches=batch.requestDifferences.filter(d=>d.sampleId===old.sampleId&&d.repetition===old.repetition&&d.turboSupplement===old.turboSupplement&&d.path===pointer);
      must(matches.length===1,'unexplained or multiply explained final-request difference');explained.add(matches[0]);
    }
  }
  must(explained.size===batch.requestDifferences.length,'difference explanation does not match an actual request difference');
  for(const sample of samples.values())for(const turbo of [false,...(bothTurbo&&sample.id.startsWith('LOCAL-H3-')?[true]:[])]) {
    const group=executions.filter(x=>x.sampleId===sample.id&&x.turboSupplement===turbo);
    for(const state of new Set(group.map(x=>x.metrics.coldWarmState))) {
      const old=group.filter(x=>x.variant==='baseline'&&x.metrics.coldWarmState===state),current=group.filter(x=>x.variant==='studio'&&x.metrics.coldWarmState===state);
      must(median(current.map(x=>x.metrics.durationMs))<=median(old.map(x=>x.metrics.durationMs))*(1+plan.modelPerformanceGate.maximumMedianDurationGrowth)+1e-8,'median model duration regressed over budget');
      must(Math.max(...current.map(x=>x.metrics.peakMemoryBytes))<=Math.max(...old.map(x=>x.metrics.peakMemoryBytes))*(1+plan.modelPerformanceGate.maximumPeakMemoryGrowth)+1e-8,'peak memory regressed over budget');
    }
  }
  const scored=new Set();
  for(const score of evidence.scores) {
    const x=executions.find(x=>x.id===score.executionId);
    must(x&&score.sampleId===x.sampleId&&score.blindLabel===batch.blindLabels[x.variant],'score does not identify a registered blind execution');
    must(plan.qualityGate.dimensions.includes(score.dimension),'unknown scoring dimension');
    must(x.sampleId.startsWith('LOCAL-H3-')||score.dimension!=='first-last-frames-and-motion-continuity','inapplicable score dimension');
    must(score.critical===(score.dimension!=='composition-and-style'),'critical scoring dimension changed');
    const key=`${x.id}/${score.reviewer}/${score.dimension}`;
    must(!scored.has(key),'duplicate reviewer score');scored.add(key);
  }
  const scoreGroups=[];
  for(const sample of samples.values())for(const turbo of [false,...(bothTurbo&&sample.id.startsWith('LOCAL-H3-')?[true]:[])]) {
    const group=executions.filter(x=>x.sampleId===sample.id&&x.turboSupplement===turbo);
    const dimensions=plan.qualityGate.dimensions.filter(d=>sample.id.startsWith('LOCAL-H3-')||d!=='first-last-frames-and-motion-continuity');
    for(const dimension of dimensions) {
      const critical=dimension!=='composition-and-style';
      for(const x of group)must(evidence.scores.some(s=>s.executionId===x.id&&s.dimension===dimension&&s.critical===critical),'missing per-output blind score or inconsistent critical dimension');
      const collect=variant=>group.filter(x=>x.variant===variant).map(x=>median(evidence.scores.filter(s=>s.executionId===x.id&&s.dimension===dimension).map(s=>s.score)));
      const old=collect('baseline'),current=collect('studio');
      const oldMedian=median(old),newMedian=median(current);
      must(!critical||newMedian>=oldMedian,'critical quality median regressed');
      must(oldMedian<3||newMedian>=3,'usable baseline became unusable');
      must(critical||oldMedian-newMedian<1,'noncritical quality fell by at least one point');
      scoreGroups.push({old:mean(old),current:mean(current)});
    }
  }
  must(mean(scoreGroups.map(x=>x.old))-mean(scoreGroups.map(x=>x.current))<=plan.qualityGate.maximumOverallMeanDrop+1e-8,'overall quality mean regressed over budget');
  if(evidence.test==='TC-SYS-036')must(batch.recoveries.length>0,'task recovery proof missing');
  for(const r of batch.recoveries) {
    const original=executions.find(x=>x.id===r.originalExecutionId);
    must(original&&r.requestId===original.requestId&&r.providerTaskId===original.providerTaskId&&r.attemptId===original.attemptId,'recovery changed task identity');
    must(r.sampleExecutions===0&&r.ledgerReuse,'recovery reran inference');referenced(r.traceArtifact);
  }
  return true;
}
