import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const directory=path.resolve(process.env.CREATIVE_STUDIO_TEST_WEB||'web');
const compiled=relative=>import(pathToFileURL(path.join(directory,relative)).href);
const {createBusinessDocument}=await compiled('application/business_document.js');
const {MediaExportService,exportInputDigest,checkedExportReport}=await compiled('application/media_export_service.js');
const {ExportSession}=await compiled('features/editor/export_session.js');
const {createMediaExportHttp}=await compiled('integrations/comfyui/media_exports.js');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

class Port{
    records=new Map();calls=[];submitGate=null;getGate=null;uncertain=false;
    async submit(value){
        this.calls.push(['submit',structuredClone(value)]);
        const report={schemaVersion:1,requestId:value.requestId,state:'running',version:3,fingerprint:'a'.repeat(64),editFingerprint:'b'.repeat(64),
            native:{promptId:'native-'+value.requestId,nodeId:'save',listIndex:0},providerTaskId:'native-'+value.requestId,cancelRequested:false,
            result:null,errorCode:null,source:{...value.source,operation:'video_export'},attempt:1,output:null,recoveryAction:'query_original'};
        this.records.set(value.requestId,report);
        if(this.submitGate)await this.submitGate.promise;
        if(this.uncertain)throw Error('synthetic acknowledgement lost; original may exist');
        return structuredClone(report);
    }
    async get(id){this.calls.push(['get',id]);if(this.getGate)return this.getGate.promise;return structuredClone(this.records.get(id));}
    async recover(id){this.calls.push(['recover',id]);return structuredClone(this.records.get(id));}
    async cancel(id,version){this.calls.push(['cancel',id,version]);const report=this.records.get(id);assert.equal(version,report.version);Object.assign(report,{state:'cancelled',version:version+1,cancelRequested:true});return structuredClone(report);}
    complete(id){const report=this.records.get(id);Object.assign(report,{state:'succeeded',version:report.version+2,result:{kind:'assets',items:[{asset_id:'asset-'+id,reference_id:'ref-'+id,sha256:'d'.repeat(64),bytes:900}]},output:{filename:id+'.mp4',subfolder:'DAELAB/edits',type:'output'},recoveryAction:'read_result'});return report;}
}
function fixture(t,port=new Port(),node='node-a'){
    let state={edit_data:JSON.stringify({version:1,clips:[{id:'clip',source:{slot:'groups.group0',nodeId:'source'},duration:1.00000001,unknown:{retained:true}}]})},epoch=0,current=true,before,views=[];
    const owner={documentId:'document',nodeId:node},connections={groups:{'groups.group0':{version:1,assets:[{id:'source',nodeId:'source',filename:'synthetic.png',type:'input'}]}}};
    const undo=[];
    const native=createBusinessDocument({read:()=>state,write:value=>{state=value;},current:()=>current,
        identity:()=>({workflowSession:'workflow-a',epoch,documentId:owner.documentId+':'+owner.nodeId}),stamp:value=>({edit_data:value.edit_data,connections}),
        history:{begin(){before=structuredClone(state);},end(){undo.push(before);},amend(fn){fn();},undo(){state=undo.pop();},redo(){}}});
    const host={input:()=>({edit_data:state.edit_data,connections:structuredClone(connections),source:owner}),current:()=>current,
        begin:id=>native.beginRequest(id),canApply:native.canApply,release:native.releaseRequest,
        saveReference(reference){native.edit('reference',draft=>{draft.reference=reference;});},
        apply(ticket,binding){return native.controller.applyResult(ticket,'output',draft=>{draft.binding=binding;});},
        binding:()=>state.binding,changed:view=>views.push(view)};
    const session=new ExportSession(new MediaExportService(port),host,100000);
    t.after(()=>{session.dispose();native.dispose();});
    return {session,port,native,host,connections,owner,get state(){return state;},get view(){return views.at(-1);},
        edit(value='changed'){native.edit('input',draft=>{draft.edit_data=JSON.stringify({version:1,clips:[{duration:value}]});});return session.inputChanged();},
        get historyEdits(){return undo.length;},switch(){epoch++;session.invalidate();},detach(){current=false;},restore(value){state=structuredClone(value);},
    };
}

test('one click captures immutable input and writes only a minimal reference then a verified binding',async t=>{
    const f=fixture(t);await f.session.start();const id=f.state.reference.requestId;
    assert.equal(f.port.calls.filter(c=>c[0]==='submit').length,1);assert.deepEqual(Object.keys(f.state.reference).sort(),['inputDigest','requestId','schemaVersion','source']);
    assert.equal(f.state.binding,undefined);assert.equal(f.view.report.state,'running');
    f.port.complete(id);await f.session.refresh();assert.equal(f.state.binding.asset.asset_id,'asset-'+id);assert.equal(f.view.currentOutput.reference.requestId,id);
    assert.equal('state' in f.state.binding,false);assert.equal('snapshot' in f.state.binding,false);
    assert.equal(f.port.calls.some(c=>String(c[0]).includes('queue')),false);
});

async function completedCopy(t,{documentId='saved-as',nodeId='node-a'}={}){
    const original=fixture(t);await original.session.start();original.port.complete(original.state.reference.requestId);await original.session.refresh();
    const saved=structuredClone(original.state),facts=structuredClone(original.port.records.get(saved.reference.requestId));original.session.dispose();
    const copy=fixture(t,original.port,nodeId);copy.owner.documentId=documentId;copy.restore(saved);
    const before=copy.port.calls.length;assert.equal(copy.session.load(saved.reference),true);await tick();await copy.session.inputChanged();
    return {original,copy,saved,facts,before};
}

test('Save As and cross-node copies verify an existing binding with GET only and never write native history',async t=>{
    for(const owner of [{documentId:'saved-as',nodeId:'node-a'},{documentId:'document',nodeId:'different-node'}]){
        const {copy,saved,before}=await completedCopy(t,owner);
        assert.equal(copy.view.copied,true);assert.deepEqual(copy.view.copiedOutput,saved.binding);assert.equal(copy.view.currentOutput,undefined);
        assert.equal(copy.view.canCancel,false);assert.equal(copy.view.canRecover,false);assert.equal(copy.view.canReview,false);
        assert.equal(copy.view.canExportCopy,true);assert.deepEqual(copy.port.calls.slice(before).map(c=>c[0]),['get']);
        await copy.session.start();await copy.session.cancel();await copy.session.recover();assert.equal(await copy.session.review(),false);
        assert.deepEqual(copy.port.calls.slice(before).map(c=>c[0]),['get']);assert.equal(copy.historyEdits,0);assert.deepEqual(copy.state,saved);
        const change=copy.edit();assert.equal(copy.view.copiedOutput,undefined);await change;copy.native.undo();await copy.session.inputChanged();
        assert.deepEqual(copy.view.copiedOutput,saved.binding);assert.equal(copy.historyEdits,0);assert.deepEqual(copy.state,saved);
    }
});

test('a foreign reference without binding makes no GET or task-control calls, while explicit copy submission uses its new owner',async t=>{
    const original=fixture(t);await original.session.start();const saved=structuredClone(original.state);original.session.dispose();
    const copy=fixture(t,original.port);copy.owner.documentId='saved-as';copy.restore(saved);const before=copy.port.calls.length;
    assert.equal(copy.session.load(saved.reference),true);await tick();await copy.session.refresh();await copy.session.recover();await copy.session.cancel();await copy.session.start();
    assert.equal(copy.port.calls.length,before);assert.equal(copy.view.copied,true);assert.equal(copy.view.copiedOutput,undefined);
    await copy.session.startCopy();const ref=copy.state.reference;assert.notEqual(ref.requestId,saved.reference.requestId);assert.deepEqual(ref.source,copy.owner);
    assert.equal(copy.port.records.get(saved.reference.requestId).state,'running');assert.equal(copy.port.calls.slice(before).filter(c=>c[0]==='submit').length,1);
});

test('explicit copy submission persists a fresh identity and reload reads it without changing the original receipt',async t=>{
    const {copy,saved,facts,before}=await completedCopy(t);
    await copy.session.startCopy();const current=copy.state.reference;assert.notEqual(current.requestId,saved.reference.requestId);assert.deepEqual(current.source,copy.owner);
    assert.equal(copy.view.copied,false);assert.equal(copy.view.copiedOutput,undefined);copy.port.complete(current.requestId);await copy.session.refresh();
    assert.equal(copy.view.currentOutput.reference.requestId,current.requestId);assert.deepEqual(copy.port.records.get(saved.reference.requestId),facts);
    const persisted=structuredClone(copy.state),reloaded=fixture(t,copy.port);reloaded.owner.documentId='saved-as';reloaded.restore(persisted);reloaded.session.load(persisted.reference);await tick();await reloaded.session.inputChanged();
    assert.deepEqual(reloaded.view.currentOutput,persisted.binding);assert.equal(reloaded.historyEdits,0);
    assert.equal(copy.port.calls.slice(before).filter(c=>c[0]==='submit').length,1);assert.deepEqual(saved.reference.source,{documentId:'document',nodeId:'node-a'});
});

test('foreign bad binding, forged old source, and mismatching completed receipt fail closed and keep saved JSON',async t=>{
    for(const corrupt of [value=>{value.binding.reference.requestId='forged';},value=>{value.binding.asset.bytes=-1;},value=>{value.reference.source.documentId='forged';value.binding.reference.source.documentId='forged';},value=>{value.binding.asset.asset_id='forged';}]){
        const {copy,saved}=await completedCopy(t);copy.session.dispose();const bad=structuredClone(saved);corrupt(bad);
        const other=fixture(t,copy.port);other.owner.documentId='saved-as';other.restore(bad);const before=other.port.calls.length;
        other.session.load(bad.reference);await tick();await other.session.start();await other.session.startCopy();await other.session.recover();await other.session.cancel();
        assert.equal(other.view.currentOutput,undefined);assert.equal(other.view.copiedOutput,undefined);assert.equal(other.view.canExportCopy,false);
        assert.ok(other.view.error);assert.deepEqual(other.state,bad);assert.equal(other.historyEdits,0);
        assert.ok(other.port.calls.slice(before).every(c=>c[0]==='get'));
    }
});

test('foreign completion lookup cannot cross input changes, owner changes, reload or destruction',async t=>{
    for(const action of ['edit','owner','reload','dispose']){
        const {copy,saved,facts}=await completedCopy(t);const gate=copy.port.getGate=deferred();copy.session.load(saved.reference);
        if(action==='edit')await copy.edit();else if(action==='owner')copy.owner.documentId='another-save-as';else if(action==='reload')copy.session.load(undefined);else copy.session.dispose();
        const viewsBefore=copy.view;gate.resolve(structuredClone(facts));await tick();await tick();
        assert.equal(copy.state.binding.reference.requestId,saved.reference.requestId);assert.equal(copy.view.copiedOutput,undefined);
        if(action==='owner'||action==='dispose')assert.equal(copy.view,viewsBefore,'stale lookup cannot notify the new owner');
    }
});

test('same workflow object with owner ID changed rejects late own-task completion before host lifecycle catches up',async t=>{
    const f=fixture(t);await f.session.start();const id=f.state.reference.requestId;f.port.complete(id);const gate=f.port.getGate=deferred(),pending=f.session.refresh();
    f.owner.documentId='save-as-with-same-workflow';gate.resolve(structuredClone(f.port.records.get(id)));await pending;
    assert.equal(f.state.binding,undefined);assert.equal(f.port.calls.filter(c=>c[0]==='submit').length,1);
});

test('copy connection edits hide old output synchronously; restoring content only restores its read-only projection',async t=>{
    const {copy,saved,facts}=await completedCopy(t);
    copy.connections.groups['groups.group0'].assets[0].filename='changed.png';
    const changed=copy.session.inputChanged();assert.equal(copy.view.copiedOutput,undefined);await changed;
    copy.connections.groups['groups.group0'].assets[0].filename='synthetic.png';await copy.session.inputChanged();
    assert.deepEqual(copy.view.copiedOutput,saved.binding);assert.equal(copy.historyEdits,0);assert.deepEqual(copy.port.records.get(saved.reference.requestId),facts);
    copy.state.binding.asset.sha256='bad';await copy.session.inputChanged();assert.equal(copy.view.copiedOutput,undefined);assert.equal(copy.view.canExportCopy,false);
    const calls=copy.port.calls.length;await copy.session.startCopy();assert.equal(copy.port.calls.length,calls);
});

test('copy action waits for read-only verification and a double click creates only one new submission',async t=>{
    const {copy,saved,facts}=await completedCopy(t);
    const gate=copy.port.getGate=deferred(),read=copy.session.refresh();assert.equal(copy.view.canExportCopy,false);
    gate.resolve(structuredClone(facts));await read;copy.port.getGate=null;
    copy.port.submitGate=deferred();const submit=copy.session.startCopy();await tick();await copy.session.startCopy();
    copy.port.submitGate.resolve();await submit;
    assert.notEqual(copy.state.reference.requestId,saved.reference.requestId);
    assert.equal(copy.port.calls.filter(c=>c[0]==='submit').length,2);assert.equal(copy.view.currentOutput,undefined);assert.equal(copy.view.copiedOutput,undefined);
    assert.deepEqual(copy.port.records.get(saved.reference.requestId),facts);
});

test('double click shares one pending operation and two instances cancel only their own identity',async t=>{
    const port=new Port(),a=fixture(t,port,'a'),b=fixture(t,port,'b');port.submitGate=deferred();
    const first=a.session.start();await tick();await a.session.start();port.submitGate.resolve();await first;port.submitGate=null;await b.session.start();
    assert.equal(port.calls.filter(c=>c[0]==='submit').length,2);
    await a.session.cancel();assert.equal(port.records.get(a.state.reference.requestId).state,'cancelled');assert.equal(port.records.get(b.state.reference.requestId).state,'running');
    port.complete(b.state.reference.requestId);await b.session.refresh();assert.ok(b.state.binding);assert.equal(a.state.binding,undefined);
});

test('editing immediately hides a completed output while the ledger and original binding remain immutable',async t=>{
    const f=fixture(t);await f.session.start();const id=f.state.reference.requestId;f.port.complete(id);await f.session.refresh();
    const binding=structuredClone(f.state.binding);const pending=f.edit();assert.equal(f.view.currentOutput,undefined);await pending;
    assert.deepEqual(f.state.binding,binding);assert.equal(f.port.records.get(id).state,'succeeded');assert.equal(f.view.canReview,false);
});

test('editing then undo never reauthorizes a late ticket and facts are not rewritten',async t=>{
    const f=fixture(t);await f.session.start();const id=f.state.reference.requestId;await f.edit();f.native.undo();await f.session.inputChanged();
    f.port.complete(id);await f.session.refresh();assert.equal(f.state.binding,undefined);assert.equal(f.view.report.state,'succeeded');
    assert.equal(f.view.canReview,true);assert.equal(await f.session.review(),true);assert.ok(f.state.binding);
    f.native.undo();await f.session.inputChanged();assert.equal(f.view.currentOutput,undefined);assert.equal(f.view.report.state,'succeeded');
});

test('late response after workflow replacement, detachment or destruction never applies and never cancels',async t=>{
    for(const change of ['switch','detach','dispose']){
        const f=fixture(t);await f.session.start();const id=f.state.reference.requestId;f.port.complete(id);
        const gate=f.port.getGate=deferred(),pending=f.session.refresh();
        if(change==='dispose')f.session.dispose();else f[change]();gate.resolve(structuredClone(f.port.records.get(id)));await pending;
        assert.equal(f.state.binding,undefined);assert.equal(f.port.calls.filter(c=>c[0]==='cancel').length,0);assert.equal(f.port.records.get(id).state,'succeeded');
    }
});

test('unknown submission keeps the original reference and recovery cannot submit again',async t=>{
    const f=fixture(t);f.port.uncertain=true;await f.session.start();const ref=structuredClone(f.state.reference);
    assert.equal(f.view.unresolved,true);await f.session.start();assert.equal(f.port.calls.filter(c=>c[0]==='submit').length,1);
    await f.session.recover();assert.deepEqual(f.state.reference,ref);assert.equal(f.view.report.state,'running');assert.equal(f.port.calls.filter(c=>c[0]==='recover').length,1);
});

test('loaded references query only and need explicit review to add an output binding',async t=>{
    const f=fixture(t);await f.session.start();const saved=structuredClone(f.state),id=saved.reference.requestId;f.port.complete(id);f.session.dispose();
    const loaded=fixture(t,f.port);loaded.restore(saved);loaded.session.load(saved.reference);await tick();await loaded.session.refresh();await loaded.session.inputChanged();
    assert.equal(loaded.state.binding,undefined);assert.equal(loaded.view.canReview,true);assert.equal(await loaded.session.review(),true);assert.ok(loaded.state.binding);
    assert.equal(f.port.calls.filter(c=>c[0]==='submit').length,1);
});

test('saved verified binding is projected after reload without creating an edit or changing job facts',async t=>{
    const f=fixture(t);await f.session.start();f.port.complete(f.state.reference.requestId);await f.session.refresh();const saved=structuredClone(f.state);f.session.dispose();
    const loaded=fixture(t,f.port);loaded.restore(saved);loaded.session.load(saved.reference);await tick();await loaded.session.refresh();await loaded.session.inputChanged();
    assert.deepEqual(loaded.state,saved);assert.deepEqual(loaded.view.currentOutput,saved.binding);assert.equal(f.port.calls.filter(c=>c[0]==='submit').length,1);
});

test('forged workflow digest cannot relabel an immutable server receipt as current input',async t=>{
    const f=fixture(t);await f.session.start();const id=f.state.reference.requestId;f.port.complete(id);const old=structuredClone(f.state);f.session.dispose();
    const loaded=fixture(t,f.port);loaded.restore(old);await loaded.edit('different');const forged={...old.reference,inputDigest:await exportInputDigest(loaded.host.input())};
    loaded.restore({...loaded.state,reference:forged});loaded.session.load(forged);await tick();await loaded.session.refresh();
    assert.equal(loaded.state.binding,undefined);assert.equal(await loaded.session.review(),false);assert.match(loaded.view.error,/身份不一致/);
});

test('copying a reference to another node cannot query or cancel its original owner',async t=>{
    const a=fixture(t);await a.session.start();const b=fixture(t,a.port,'other');const before=a.port.calls.length;
    b.session.load(a.state.reference);await tick();await b.session.cancel();assert.equal(a.port.calls.length,before);assert.equal(b.view.canCancel,false);
    await b.session.start();assert.equal(a.port.calls.length,before);assert.equal(b.view.unresolved,true);
});

test('malformed saved reference stays unresolved and cannot silently become a new submission',async t=>{
    const f=fixture(t),raw={schemaVersion:1,requestId:'original-kept',inputDigest:'damaged',source:f.owner};
    f.restore({...f.state,reference:raw});
    assert.equal(f.session.load(raw),false);await tick();
    assert.equal(f.view.unresolved,true);assert.match(f.view.error,/原导出引用/);
    await f.session.inputChanged();await f.session.start();await f.session.recover();await f.session.cancel();await f.session.review();
    assert.equal(f.port.calls.length,0);assert.deepEqual(f.state.reference,raw);assert.equal(f.view.unresolved,true);
    f.session.invalidate();await f.session.start();assert.equal(f.port.calls.length,0);
});

test('changed connection snapshot invalidates application without modifying the submitted payload',async t=>{
    const f=fixture(t);await f.session.start();const submitted=f.port.calls.find(c=>c[0]==='submit')[1];
    f.connections.groups['groups.group0'].assets[0].filename='replacement.png';f.native.observe();await f.session.inputChanged();
    f.port.complete(f.state.reference.requestId);await f.session.refresh();assert.equal(f.state.binding,undefined);
    assert.equal(submitted.connections.groups['groups.group0'].assets[0].filename,'synthetic.png');
});

test('regressive versions and altered terminal receipts cannot rewind facts',async t=>{
    const f=fixture(t);await f.session.start();const id=f.state.reference.requestId;f.port.complete(id);await f.session.refresh();const saved=structuredClone(f.view.report);
    f.port.records.set(id,{...saved,state:'running',version:2,result:null,output:null});await f.session.refresh();assert.equal(f.view.report.state,'succeeded');
    f.port.records.set(id,{...saved,version:saved.version+1,result:{kind:'assets',items:[{...saved.result.items[0],asset_id:'foreign'}]}});await f.session.refresh();
    assert.deepEqual(f.view.report,saved);assert.equal(f.state.binding.asset.asset_id,saved.result.items[0].asset_id);
});

test('finite fractional inputs use an opaque client digest and malformed numbers are rejected',async()=>{
    const input={edit_data:'{"version":1,"clips":[{"duration":0.00000001,"start":1.00000000000001}]}',connections:{},source:{documentId:'d',nodeId:'n'}};
    const digest=await exportInputDigest(input);assert.match(digest,/^[a-f0-9]{64}$/);assert.equal(digest,await exportInputDigest(structuredClone(input)));
    await assert.rejects(exportInputDigest({...input,connections:{nan:NaN}}),/有限数字/);
    await assert.rejects(exportInputDigest({...input,edit_data:'{"duration":1e999}'}),/有限数字/);
});

test('HTTP service uses only allowed export routes and exact expected-version cancellation',async()=>{
    const calls=[],service=createMediaExportHttp(async(url,init)=>{calls.push([url,init]);return new Response(JSON.stringify({error:{message:'synthetic unavailable'}}),{status:503});});
    const ref={schemaVersion:1,requestId:'same/id',inputDigest:'a'.repeat(64),source:{documentId:'d',nodeId:'n'}},signal=new AbortController().signal;
    await assert.rejects(service.get(ref,signal));await assert.rejects(service.cancel(ref,7,signal));await assert.rejects(service.recover(ref,signal));
    assert.deepEqual(calls.map(c=>c[0]),['/daelab/studio/media-exports/same%2Fid','/daelab/studio/media-exports/same%2Fid/cancel','/daelab/studio/media-exports/same%2Fid/recover']);
    assert.deepEqual(JSON.parse(calls[1][1].body),{expectedVersion:7});assert.deepEqual(JSON.parse(calls[2][1].body),{});
});

test('successful reports require exact owner digest and complete safe media receipt',async t=>{
    const f=fixture(t);await f.session.start();const good=f.port.complete(f.state.reference.requestId),ref=f.state.reference;
    for(const value of [{...good,source:{...good.source,nodeId:'other'}},{...good,source:{...good.source,inputDigest:'f'.repeat(64)}},
        {...good,result:null},{...good,output:{...good.output,filename:'../foreign.mp4'}},{...good,result:{kind:'assets',items:[{...good.result.items[0],bytes:NaN}]}}]){
        assert.throws(()=>checkedExportReport(value,ref));
    }
});

test('public submit port rejects a mismatched snapshot digest before sending any request',async t=>{
    const f=fixture(t),input=f.host.input(),service=new MediaExportService(f.port),signal=new AbortController().signal;
    const reference={schemaVersion:1,requestId:'unsubmitted',inputDigest:'f'.repeat(64),source:input.source};
    await assert.rejects(service.submit(reference,input,signal),/快照不一致/);
    assert.equal(f.port.calls.length,0);
});

test('only a proven preflight rejection permits a new explicit identity; no automatic retry occurs',async t=>{
    const f=fixture(t);let rejected=true;
    const original=f.port.submit.bind(f.port);
    f.port.submit=async value=>{if(rejected){f.port.calls.push(['rejected',value.requestId]);throw Object.assign(Error('known preflight rejection'),{preflightRejected:true});}return original(value);};
    await f.session.start();const first=f.state.reference.requestId;assert.equal(f.view.rejected,true);assert.equal(f.view.unresolved,false);assert.equal(f.port.calls.length,1);
    rejected=false;await f.session.start();assert.notEqual(f.state.reference.requestId,first);assert.equal(f.view.report.state,'running');
});

test('lost rejection response recovers its durable terminal fact before a new explicit operation',async t=>{
    const f=fixture(t),original=f.port.submit.bind(f.port);let rejectFirst=true;
    f.port.submit=async value=>{const report=await original(value);if(rejectFirst){rejectFirst=false;Object.assign(f.port.records.get(value.requestId),{state:'cancelled',version:1,attempt:0,providerTaskId:null,cancelRequested:true,errorCode:'export_input_rejected'});throw Error('lost rejection acknowledgement');}return report;};
    await f.session.start();const first=f.state.reference.requestId;assert.equal(f.view.unresolved,true);
    await f.session.recover();assert.equal(f.view.report.state,'cancelled');assert.equal(f.view.unresolved,false);assert.equal(f.port.calls.filter(c=>c[0]==='submit').length,1);
    await f.session.start();assert.notEqual(f.state.reference.requestId,first);assert.equal(f.port.records.get(first).state,'cancelled');assert.equal(f.port.calls.filter(c=>c[0]==='submit').length,2);
});
