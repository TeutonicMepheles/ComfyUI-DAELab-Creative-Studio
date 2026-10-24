import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assessReport,distribution,mountPerformanceObserver,PROTOCOL} from '../host_fixture/web/performance.js';
import {analyze} from '../../tools/performance/analyze.mjs';

const manifest=JSON.parse(fs.readFileSync(new URL('../fixtures/performance/manifest.json',import.meta.url),'utf8'));
function report(){return {schemaVersion:1,kind:'passive-performance-observation',scenario:'PERF-01',implementation:'new',mediaVariant:'no-video',buildFingerprint:'a'.repeat(64),fixture:{sha256:manifest.workflows[0].sha256},protocol:{...PROTOCOL},startedAt:0,warmupEndedAt:10000,environment:{dpr:1,viewport:{width:1920,height:1080}},runs:Array.from({length:5},(_,index)=>({index:index+1,status:'complete',sampleStartedAt:10000+index*30000,sampleEndedAt:40000+index*30000,frames:Array.from({length:1800},(_,i)=>({at:10000+index*30000+(i+1)*1000/60,intervalMs:1000/60,active:true})),inputs:[],eventTimings:[],longTasks:[],census:[{visibleVideos:0,playingVideos:0}],visibility:[]}))};}
test('quantiles use all finite samples and never turn no samples into zero latency',()=>{
    assert.deepEqual(distribution([]),{count:0,p50:null,p95:null,max:null});assert.equal(distribution([1,2,3,4,1000]).p95,1000);
});
test('five ideal synthetic traces remain review-only, never product acceptance',()=>{
    const result=assessReport(report());assert.equal(result.status,'requires_review');assert.equal(result.numericFrameBudget,true);assert.equal(result.productAcceptance,false);assert(result.unmeasured.includes('controlled_gc_heap'));
});
test('missing repeats, warmup, fixture, build, DPR and visibility are explicit insufficiencies',()=>{
    const r=report();r.runs.pop();r.warmupEndedAt=0;r.fixture=null;r.buildFingerprint=null;r.environment.dpr=2;r.runs[0].visibility.push({state:'hidden'});
    const result=assessReport(r);assert.equal(result.status,'insufficient_evidence');for(const reason of ['incomplete_repetitions','short_warmup','missing_fixture_hash','missing_build_fingerprint','DPR_not_reference_1','page_hidden_during_sample'])assert(result.reasons.includes(reason));
});
test('idle frames cannot satisfy interaction budget and a 201 ms active pause is retained',()=>{
    const idle=report();idle.runs[0].frames.forEach(f=>{f.active=false;});assert(assessReport(idle).reasons.includes('insufficient_actual_interaction'));
    const stalled=report();stalled.runs[0].frames[100].intervalMs=201;const result=assessReport(stalled);assert.equal(result.numericFrameBudget,false);assert.equal(result.runs[0].activeFrameIntervalsMs.max,201);
});
test('long-run cannot be replaced by five short runs, even with a claimed successful assessment',()=>{
    const r=report();r.scenario='PERF-07';r.assessment={productAcceptance:true};assert(assessReport(r).reasons.includes('incomplete_repetitions'));
});
test('offline review rechecks raw data, known fixture hash and media variant',()=>{
    const r=report();r.fixture.sha256='b'.repeat(64);r.mediaVariant='video';r.assessment={productAcceptance:true};const result=analyze({schemaVersion:1,reports:[r]}).reports[0];
    assert.equal(result.productAcceptance,false);assert(result.reasons.includes('fixture_not_in_fixed_catalog'));assert(result.reasons.includes('media_variant_not_observed_as_declared'));
});

class Element extends EventTarget {
    constructor(tag){super();this.tagName=tag;this.children=[];this.style={};this.type='';this.textContent='';this.value='';this.isConnected=true;}
    append(child){child.parentElement=this;this.children.push(child);}
    add(option){this.append(option);if(!this.value)this.value=option.value;}
    contains(target){return target===this||this.children.some(c=>c.contains?.(target));}
    remove(){this.isConnected=false;}
    getBoundingClientRect(){return {left:0,top:0,right:100,bottom:100,width:100,height:100};}
}
test('visible observer start/stop/destroy releases its rAF, timers and observers without touching any graph',async()=>{
    const previousOption=globalThis.Option,previousMutation=globalThis.MutationObserver;const elements=[],mutations=[];
    globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
    globalThis.MutationObserver=class{constructor(fn){this.fn=fn;this.active=false;mutations.push(this);}observe(){this.active=true;}disconnect(){this.active=false;}};
    const body=new Element('body'),document=Object.assign(new EventTarget(),{body,readyState:'complete',visibilityState:'visible',createElement:tag=>{const e=new Element(tag);elements.push(e);return e;},getElementById:()=>null,querySelectorAll:()=>[],getElementsByTagName:()=>elements});
    let time=0,nextId=1;const frames=new Map(),timers=new Map();
    const window=Object.assign(new EventTarget(),{performance:{now:()=>time,timeOrigin:0},navigator:{userAgent:'synthetic-unit-harness',hardwareConcurrency:1},devicePixelRatio:1,innerWidth:1920,innerHeight:1080,screen:{width:1920,height:1080},crypto:globalThis.crypto,queueMicrotask,
        requestAnimationFrame(fn){const id=nextId++;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),setInterval(fn){const id=nextId++;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id)});
    let observer;
    try{
        observer=mountPerformanceObserver(document,window);assert.equal(frames.size,0);assert.equal(timers.size,0);assert.equal(mutations.length,0);
        const picker=elements.find(e=>e.type==='file');picker.files=[{arrayBuffer:async()=>new TextEncoder().encode('{}').buffer}];picker.dispatchEvent(new Event('change'));
        await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
        elements.find(e=>e.type==='checkbox').checked=true;
        elements.find(e=>e.tagName==='button'&&e.textContent==='开始观测').onclick();assert.equal(frames.size,1);assert.equal(timers.size,1);assert.equal(mutations[0].active,true);
        time=10001;const scheduled=[...frames];frames.clear();for(const [,fn] of scheduled)fn(time);assert.equal(frames.size,1);
        observer.stop();assert.equal(frames.size,0);assert.equal(timers.size,0);assert.equal(mutations[0].active,false);
        observer.destroy();assert.equal(body.children[0].isConnected,false);
    }finally{observer?.destroy();globalThis.Option=previousOption;globalThis.MutationObserver=previousMutation;}
});
