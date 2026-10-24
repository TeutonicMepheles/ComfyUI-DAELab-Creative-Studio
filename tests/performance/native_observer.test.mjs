import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createNativeBoundaryObserver,mountNativePerformanceObserver,HOST_BOUNDARIES} from '../host_fixture/web/performance_native.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function host(){
    let tick=0;
    const calls=[];
    const graph={serialize(...args){calls.push({kind:'serialize',self:this,args});return {opaque:'never collected'};}};
    const api={storeUserData(...args){calls.push({kind:'storage',self:this,args});return Promise.resolve({status:200});}};
    const workflow={path:'workflows/private-workflow.json'};
    const store={activeWorkflow:workflow,async saveWorkflow(owner){calls.push({kind:'save',self:this,owner});await api.storeUserData(owner.path,{private:'do not copy'},{});}};
    const app={isGraphReady:true,rootGraph:graph,extensionManager:{workflow:store},loadGraphData(...args){calls.push({kind:'load',self:this,args});return Promise.resolve(true);}};
    return {app,api,store,graph,workflow,calls,now:()=>++tick};
}
const records=observer=>observer.report().reports.flatMap(r=>r.records);

test('import and construction are inert; explicit readiness check avoids early graph getter',()=>{
    let reads=0;const app={isGraphReady:false,get rootGraph(){reads++;throw new Error('too early');}};
    const observer=createNativeBoundaryObserver({app});assert.equal(reads,0);assert.equal(observer.start(),false);
    assert.throws(()=>observer.start({explicit:true}),/graph-not-ready/);assert.equal(reads,0);assert.deepEqual(observer.resources(),{methodSubscriptions:0,pendingSaves:0});
});

test('native serialize preserves exact this, argument array values, return and throw identity',()=>{
    const h=host(),original=h.graph.serialize,observer=createNativeBoundaryObserver(h);observer.start({explicit:true});
    assert.equal(h.calls.length,0);
    const arg={sortNodes:true},receiver={marker:1},value=h.graph.serialize.call(receiver,arg,'extra');
    assert.equal(h.calls[0].self,receiver);assert.equal(h.calls[0].args[0],arg);assert.equal(h.calls[0].args[1],'extra');assert.deepEqual(value,{opaque:'never collected'});
    assert.equal(records(observer)[0].status,'complete');assert.equal(records(observer)[0].saveCorrelation,null);
    observer.stop();assert.equal(h.graph.serialize,original);
    const error=new Error('secret detail');h.graph.serialize=function(){throw error;};observer.start({explicit:true});
    assert.throws(()=>h.graph.serialize(),e=>e===error);assert.equal(records(observer).at(-1).status,'throw');
    assert(!JSON.stringify(observer.report()).includes('secret detail'));observer.destroy();
});

test('native Promise, fulfillment and asynchronous rejection identities are unchanged',async()=>{
    const h=host(),d=deferred(),error=new Error('sensitive error'),value={exact:true};
    h.app.loadGraphData=function(...args){assert.equal(this,h.app);assert.equal(args[0],value);return d.promise;};
    const observer=createNativeBoundaryObserver(h);observer.start({explicit:true});
    assert.equal(h.app.loadGraphData(value),d.promise);d.reject(error);await assert.rejects(d.promise,e=>e===error);await flush();
    assert.equal(records(observer)[0].status,'reject');assert(!JSON.stringify(observer.report()).includes(error.message));observer.stop();
    const h2=host(),d2=deferred();h2.app.loadGraphData=()=>d2.promise;const other=createNativeBoundaryObserver(h2);other.start({explicit:true});
    assert.equal(h2.app.loadGraphData(),d2.promise);d2.resolve(true);assert.equal(await d2.promise,true);await flush();
    const record=records(other)[0];assert.equal(record.status,'complete');assert.equal(record.editableCompleteMs,null);other.destroy();
});

test('load false is not completion and no mutation or frame proxy fills editable or semantic fields',async()=>{
    const h=host();h.app.loadGraphData=()=>Promise.resolve(false);const observer=createNativeBoundaryObserver(h);observer.start({explicit:true});
    await h.app.loadGraphData();await flush();observer.stop();
    const report=observer.report().reports[0];assert.equal(report.records[0].status,'not-loaded');assert.equal(report.records[0].successful,false);
    assert.deepEqual(report.unmeasured,{reopenToEditableMs:null,semanticTableInputToDisplayMs:null,semanticAssetSearchCompletionMs:null});assert.equal(report.productAcceptance,false);
});

test('visible summaries distinguish pending, failed and completed calls without sharing mutable facts',async()=>{
    const h=host(),d=deferred(),updates=[];
    h.app.loadGraphData=()=>d.promise;
    const observer=createNativeBoundaryObserver({...h,onUpdate:value=>updates.push(value)});
    observer.start({explicit:true});
    const result=h.app.loadGraphData({private:'never exported'});
    assert.equal(result,d.promise);
    const pending=updates.at(-1).latest[0];
    assert.equal(pending.kind,'native-workflow-load');assert.equal(pending.status,'pending');
    pending.status='fake-complete';
    assert.equal(records(observer)[0].status,'pending');
    d.resolve(false);await result;await flush();
    assert.equal(updates.at(-1).latest[0].status,'not-loaded');
    assert.equal(updates.at(-1).latest[0].successful,false);
    await h.store.saveWorkflow(h.workflow);await flush();
    const saved=updates.at(-1).latest.find(row=>row.kind==='native-workflow-save');
    assert.equal(saved.status,'complete');assert.equal(saved.storageAcknowledged,true);
    assert(!JSON.stringify(updates).includes('private-workflow'));
    assert(!JSON.stringify(updates).includes('never exported'));
    observer.stop();observer.start({explicit:true});
    assert.deepEqual(updates.at(-1).latest,[]);observer.destroy();
});

test('an exotic Promise or observer rendering error cannot change the native return',()=>{
    class ExoticPromise extends Promise{static get [Symbol.species](){throw new Error('observer must not surface this');}}
    const h=host(),result=new ExoticPromise(resolve=>resolve(true));h.app.loadGraphData=()=>result;
    const observer=createNativeBoundaryObserver({...h,onUpdate:()=>{throw new Error('broken test UI');}});observer.start({explicit:true});
    assert.equal(h.app.loadGraphData(),result);assert.equal(records(observer)[0].status,'unobservable-return');observer.stop();
});

test('save completion correlates only exact workflow storage acknowledgement and exports no private data',async()=>{
    const h=host(),observer=createNativeBoundaryObserver(h);observer.start({explicit:true});await h.store.saveWorkflow(h.workflow);await flush();
    const [save,storage]=records(observer);assert.equal(save.kind,'native-workflow-save');assert.equal(save.status,'complete');assert.equal(save.storageAcknowledged,true);
    assert.equal(storage.saveOperationId,save.id);assert.equal(storage.correlation,'exact-workflow-path');assert.equal(storage.httpStatus,200);assert.equal(save.storageRequestId,storage.id);
    await h.api.storeUserData('workflows/.index.json',{});await h.api.storeUserData('settings.json',{});assert.equal(records(observer).length,2);
    const json=JSON.stringify(observer.report());assert(!json.includes('private-workflow'));assert(!json.includes('do not copy'));observer.destroy();
});

test('HTTP non-200 and concurrent saves cannot masquerade as exact persistent acknowledgement',async()=>{
    const h=host();h.api.storeUserData=()=>Promise.resolve({status:500});const observer=createNativeBoundaryObserver(h);observer.start({explicit:true});
    await h.store.saveWorkflow(h.workflow);await flush();const [save,storage]=records(observer);assert.equal(save.storageAcknowledged,false);assert.equal(storage.status,'http-not-confirmed');observer.stop();
    const h2=host(),first=deferred(),second=deferred();let count=0;
    h2.store.saveWorkflow=async owner=>{await (++count===1?first.promise:second.promise);await h2.api.storeUserData(owner.path,{});};
    const other=createNativeBoundaryObserver(h2);other.start({explicit:true});
    const a=h2.store.saveWorkflow(h2.workflow),b=h2.store.saveWorkflow(h2.workflow);first.resolve();await a;
    const ambiguous=records(other).find(r=>r.kind==='native-workflow-storage');assert.equal(ambiguous.correlation,'ambiguous');assert.equal(ambiguous.saveOperationId,null);
    second.resolve();await b;await flush();other.destroy();
});

test('two workflow objects and two host instances keep independent identities and records',async()=>{
    const a=host(),b=host(),oa=createNativeBoundaryObserver(a),ob=createNativeBoundaryObserver(b);oa.start({explicit:true});ob.start({explicit:true});
    const second={path:'workflows/second.json'};await a.store.saveWorkflow(a.workflow);await a.store.saveWorkflow(second);await flush();
    const saves=records(oa).filter(r=>r.kind==='native-workflow-save');assert.notEqual(saves[0].workflowId,saves[1].workflowId);assert.equal(records(ob).length,0);
    b.graph.serialize();assert.equal(records(ob).length,1);assert.equal(records(oa).length,4);oa.destroy();ob.destroy();
});

test('two observers share a reversible wrapper; stopping one keeps the other installed',()=>{
    const h=host(),original=h.graph.serialize,a=createNativeBoundaryObserver(h),b=createNativeBoundaryObserver(h);a.start({explicit:true});b.start({explicit:true});
    const wrapper=h.graph.serialize;h.graph.serialize();assert.equal(records(a).length,1);assert.equal(records(b).length,1);
    a.stop();assert.equal(h.graph.serialize,wrapper);h.graph.serialize();assert.equal(records(a).length,1);assert.equal(records(b).length,2);
    b.stop();assert.equal(h.graph.serialize,original);assert.equal(a.resources().methodSubscriptions,0);assert.equal(b.resources().methodSubscriptions,0);
});

test('stop preserves native in-flight Promise and ignores late completion across restart epochs',async()=>{
    const h=host(),d=deferred();h.app.loadGraphData=()=>d.promise;const original=h.app.loadGraphData,observer=createNativeBoundaryObserver(h);
    observer.start({explicit:true});const result=h.app.loadGraphData();observer.stop();assert.equal(h.app.loadGraphData,original);observer.start({explicit:true});
    d.resolve(true);assert.equal(await result,true);await flush();
    const report=observer.report();assert.equal(report.reports[0].records[0].status,'interrupted-observation');assert.equal(report.reports[0].records[0].durationMs,null);assert.equal(report.reports[1].records.length,0);observer.destroy();
});

test('later foreign method replacement is preserved and capacity stops without changing native result',()=>{
    const h=host(),observer=createNativeBoundaryObserver({...h,maxRecords:1});observer.start({explicit:true});h.graph.serialize();const value=h.graph.serialize();assert.deepEqual(value,{opaque:'never collected'});assert.equal(observer.active,false);assert.equal(observer.report().reports[0].status,'capacity-stop');
    observer.start({explicit:true});const foreign=()=>42;h.graph.serialize=foreign;observer.stop();assert.equal(h.graph.serialize,foreign);
});

class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag;this.children=[];this.style={};this.isConnected=true;}
    append(child){child.parentElement=this;this.children.push(child);}
    remove(){this.isConnected=false;}
}
test('panel is opt-in and only a trusted explicit Start enables hooks; pagehide releases them',()=>{
    const h=host(),original=h.graph.serialize,elements=[],body=new Element('body');
    const document={body,getElementById:()=>null,createElement:tag=>{const e=new Element(tag);elements.push(e);return e;}};
    const window=Object.assign(new EventTarget(),{performance:{now:h.now}});
    const panel=mountNativePerformanceObserver(document,window,h);assert.equal(h.graph.serialize,original);assert.equal(h.calls.length,0);
    const start=elements.find(e=>e.textContent==='开始本页观测');start.onclick({isTrusted:false});assert.equal(h.graph.serialize,original);
    start.onclick({isTrusted:true});assert.notEqual(h.graph.serialize,original);assert.equal(h.calls.length,0);
    window.dispatchEvent(new Event('pagehide'));assert.equal(h.graph.serialize,original);assert.equal(body.children[0].isConnected,false);panel.destroy();
    assert.equal(HOST_BOUNDARIES.frontendVersion,'1.53.10');
});

test('WEB_DIRECTORY entry uses official app/api imports and mounts once without reading graph or starting',()=>{
    const source=fs.readFileSync(new URL('../host_fixture/web/performance_native_entry.js',import.meta.url),'utf8');
    assert.match(source,/import \{ app \} from '\/scripts\/app\.js';/);
    assert.match(source,/import \{ api \} from '\/scripts\/api\.js';/);
    assert.match(source,/import \{ mountNativePerformanceObserver \} from '\.\/performance_native\.js';/);
    const body=source.replace(/^import .*;\r?\n/gm,'');
    const execute=new Function('app','api','mountNativePerformanceObserver','document','window',body);
    for(const readyState of ['loading','complete']){
        let count=0;
        const app={get rootGraph(){throw new Error('entry read graph');},get isGraphReady(){throw new Error('entry checked graph before click');}},api={},window={};
        const document=Object.assign(new EventTarget(),{readyState});
        execute(app,api,(d,w,dependencies)=>{assert.equal(d,document);assert.equal(w,window);assert.equal(dependencies.app,app);assert.equal(dependencies.api,api);count++;return {start(){throw new Error('automatic start');}};},document,window);
        if(readyState==='loading'){assert.equal(count,0);document.dispatchEvent(new Event('DOMContentLoaded'));document.dispatchEvent(new Event('DOMContentLoaded'));}
        assert.equal(count,1);
    }
    assert.match(HOST_BOUNDARIES.sourceHashBasis,/sourcemap sourcesContent/);
});
