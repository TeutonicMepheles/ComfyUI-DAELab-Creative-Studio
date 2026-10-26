import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

for(const proxied of [false,true])test(`real VideoEdit integration uses HTTP snapshots, preserves slots, isolates instances and never cancels on disposal (native proxies: ${proxied})`,{timeout:10000},async t=>{
    const cache=new WeakMap(),native=value=>{
        if(!proxied||!value||typeof value!=='object')return value;
        if(!cache.has(value))cache.set(value,new Proxy(value,{get(target,key,receiver){return native(Reflect.get(target,key,receiver));}}));
        return cache.get(value);
    };
    const key=Symbol.for('DAELAB.ExportHostFixture'),records=new Map(),requests=[],panels=new Map(),adapters=new Map(),nodes=new Map();
    const graph={id:'graph-fixture',links:new Map([[101,{origin_id:90}],[102,{origin_id:91}]]),getNodeById:id=>nodes.get(Number(id)),change(){},setDirtyCanvas(){},
        serialize:()=>({nodes:[...nodes.values()].map(n=>({id:n.id,properties:n.properties,widgets_values:n.widgets?.map(w=>w.value)}))})};
    let extension,invalidAsset=false,nextLookupGate;
    const lookupGates=[];
    function holdNextLookup(requestId){
        let enter,release;
        const entered=new Promise(resolve=>{enter=resolve;}),completion=new Promise(resolve=>{release=resolve;});
        const gate={requestId,entered,completion,enter,release};lookupGates.push(gate);nextLookupGate=gate;return gate;
    }
    const app={graph,rootGraph:graph,isGraphReady:true,configuringGraph:false,canvas:{selected_nodes:{}},extensionManager:{workflow:{activeWorkflow:{}},toast:{add(){}}},registerExtension(value){extension=value;}};
    let historyEdits=0;
    const history={begin(){historyEdits++;},end(){},amend(fn){fn();},undo(){},redo(){}};
    const api={queuePrompt(){throw Error('native queue must never be invoked by UI');},async fetchApi(url,options={}){
        requests.push([url,options.method||'GET',options.body]);
        const prefix='/daelab/studio/media-exports';assert.ok(url.startsWith(prefix));
        if(url===prefix){
            const input=JSON.parse(options.body),id=input.requestId;
            records.set(id,{schemaVersion:1,requestId:id,state:'running',version:3,fingerprint:'a'.repeat(64),editFingerprint:'b'.repeat(64),native:{promptId:'native-'+id,nodeId:'save',listIndex:0},providerTaskId:'native-'+id,cancelRequested:false,result:null,errorCode:null,source:{...input.source,operation:'video_export'},attempt:1,output:null,recoveryAction:'query_original'});
            return new Response(JSON.stringify(records.get(id)),{status:202});
        }
        const id=decodeURIComponent(url.slice(prefix.length+1).split('/')[0]);
        if(nextLookupGate&&url===prefix+'/'+encodeURIComponent(nextLookupGate.requestId)){
            const gate=nextLookupGate;nextLookupGate=null;gate.enter();await gate.completion;
        }
        if(url.endsWith('/cancel'))Object.assign(records.get(id),{state:'cancelled',version:4,cancelRequested:true});
        return new Response(JSON.stringify(records.get(id)));
    }};
    const fixture={app,api,history,registerAdapter:(id,value)=>adapters.set(id,value),adapterFor:node=>node?.fixtureAdapter,
        createVideoEditor(host){
            const observers=new Set(),timers=new Set(),publish=()=>{for(const observer of [...observers])observer();};
            const panel={host,root:{},lastOutput:null,lastState:null,
                output(url){this.lastOutput=url;publish();},exportState(value){this.lastState=value;publish();},
                // reload/load intentionally returns before asynchronous digest and GET projection.
                // Wait for the observed owner/receipt state, not a presumed timer duration.
                when(predicate,description){return new Promise((resolve,reject)=>{
                    const finish=error=>{clearTimeout(timer);timers.delete(timer);observers.delete(check);if(error)reject(error);else resolve();};
                    const check=()=>{try{if(predicate(panel))finish();}catch(error){finish(error);}};
                    const timer=setTimeout(()=>finish(new Error(`Timed out waiting for ${description}; observed ${JSON.stringify({output:panel.lastOutput,state:panel.lastState})}`)),2000);
                    timers.add(timer);observers.add(check);check();
                });},
                error(){},reload(){},async syncSources(){},cancelSourceSync(){},destroy(){for(const timer of timers)clearTimeout(timer);timers.clear();observers.clear();}};
            panels.set(host,panel);return panel;
        }};
    globalThis[key]=fixture;
    const previousDocument=globalThis.document,previousRAF=globalThis.requestAnimationFrame;
    globalThis.document={createElement:()=>({}),head:{append(){}}};globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);
    t.after(()=>{for(const gate of lookupGates)gate.release();for(const node of nodes.values())node.__videoEdit?.destroy();delete globalThis[key];globalThis.document=previousDocument;globalThis.requestAnimationFrame=previousRAF;});
    const sourceFile=path.resolve('frontend/src/integrations/comfyui/canvas/video_edit.js'),sourceURL=pathToFileURL(sourceFile).href;
    let code=fs.readFileSync(sourceFile,'utf8');
    code=code.replace("import {app} from '/scripts/app.js';",`const fixture=globalThis[Symbol.for('DAELAB.ExportHostFixture')],app=fixture.app;`)
        .replace("import {api} from '/scripts/api.js';",'const api=fixture.api;')
        .replace(/import \{registerAdapter,adapterFor\} from [^;]+;/,'const {registerAdapter,adapterFor}=fixture;')
        .replace(/import \{canvasHistory\} from [^;]+;/,'const canvasHistory=()=>fixture.history;')
        .replace(/import \{bindPanelAvailability\} from [^;]+;/,'const bindPanelAvailability=()=>()=>{};')
        .replace(/import \{createVideoEditor\} from [^;]+;/,'const {createVideoEditor}=fixture;');
    code=code.replace(/from '(\.[^']+)'/g,(_all,spec)=>{
        const target=new URL(spec,sourceURL),relative=path.relative(path.resolve('frontend/src'),target.pathname.replace(/^\/(?=[A-Za-z]:)/,'')).replaceAll('\\','/');
        if(relative.endsWith('.js')&&fs.existsSync(path.resolve(process.env.CREATIVE_STUDIO_TEST_WEB||'web',relative)))return `from '${pathToFileURL(path.resolve(process.env.CREATIVE_STUDIO_TEST_WEB||'web',relative)).href}'`;
        return `from '${target.href}'`;
    }).replaceAll('import.meta.url',JSON.stringify(sourceURL));
    await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')+'#native-proxies-'+proxied);
    class Node{
        constructor(id,link){this.id=id;this.type='DAELAB.VideoEdit';this.graph=graph;this.properties=native({future:'retained'});this.outputs=[{links:[700+id]},{links:[]}];this.inputs=[{name:'edit_data',widget:{}},{name:'assets',link:null},{name:'videos.video0',link:null},{name:'images.image0',link:null},{name:'groups.group0',link}];
            this.widgets=[{name:'edit_data',value:JSON.stringify({version:1,fit:'contain',clips:[{id:'clip-'+id,source:{slot:'groups.group0',groupId:String(90+id-1),nodeId:'member-'+id,assetId:'asset-'+id},asset:{kind:'image',filename:'image-'+id+'.png',type:'input',fps:24,width:16,height:16},duration:.25,start:0,mute:false}]})}];nodes.set(id,this);}
        addDOMWidget(){return {};}setSize(){}disconnectInput(index){this.inputs[index].link=null;}addInput(name,type){this.inputs.push({name,type});}
    }
    for(const id of [1,2])nodes.set(89+id,{id:89+id,fixtureAdapter:{assets:()=>native({version:1,ready:true,assets:[{id:'asset-'+id,nodeId:'member-'+id,kind:'image',filename:'image-'+id+'.png',subfolder:'',type:'input',...(invalidAsset?{width:NaN}:{})}]})}});
    extension.beforeRegisterNodeDef(Node,{name:'DAELAB.VideoEdit'});
    const a=new Node(1,101),b=new Node(2,102);a.onNodeCreated();b.onNodeCreated();
    const [pa,pb]=[...panels.values()];const originalSlots=a.inputs.map(i=>i.name);
    await Promise.all([pa,pb].map(panel=>panel.when(p=>p.lastState!==null&&!p.lastState.unresolved,'initial reference load')));
    await pa.host.exportVideo();await pb.host.exportVideo();
    assert.deepEqual(a.inputs.map(i=>i.name),originalSlots);assert.equal(a.outputs.length,2);
    const submitted=requests.filter(([url])=>url==='/daelab/studio/media-exports').map(([,_,body])=>JSON.parse(body));
    assert.equal(submitted.length,2);assert.equal(submitted[0].source.nodeId,'1');assert.equal(submitted[1].source.nodeId,'2');
    assert.equal(submitted[0].connections.groups['groups.group0'].assets[0].nodeId,'member-1');
    const id=a.properties.daelabEditExport.requestId,report=records.get(id);
    Object.assign(report,{state:'succeeded',version:5,result:{kind:'assets',items:[{asset_id:'result-a',reference_id:'reference-a',sha256:'c'.repeat(64),bytes:500}]},output:{filename:'result-a.mp4',subfolder:'DAELAB/edits',type:'output'}});
    await pa.host.recoverExport();assert.match(pa.lastOutput,/result-a.mp4/);assert.equal(pb.lastOutput,null);
    a.__videoEdit.reload();await pa.host.recoverExport();assert.match(pa.lastOutput,/result-a.mp4/);assert.equal(pb.lastOutput,null);
    assert.equal(requests.filter(([url])=>url==='/daelab/studio/media-exports').length,2,'reload only reads the original request');
    const readyEdit=a.widgets[0].value,adapter=adapters.get('daelab.video-edit');assert.equal(adapter.assets(a).assets[0].assetId,'result-a');
    const edited=JSON.parse(a.widgets[0].value);edited.clips[0].duration=1;pa.host.write(edited);assert.equal(adapter.assets(a).ready,false);assert.deepEqual(a.outputs[0].links,[701]);assert.ok(a.properties.daelabEditBinding);
    invalidAsset=true;await pa.host.exportVideo();assert.equal(requests.filter(([url])=>url==='/daelab/studio/media-exports').length,2);assert.match(pa.lastState.error,/不可保存/);invalidAsset=false;
    const copy={properties:JSON.parse(JSON.stringify(b.properties))};adapter.prepareCopy(b,copy);assert.equal(copy.properties.daelabEditExport,undefined);assert.ok(b.properties.daelabEditExport);
    // Actual Save As keeps the workflow and node objects, but changes graph.id.
    // Completion projection must rebind immediately, not wait for graph reload.
    a.widgets[0].value=readyEdit;a.__videoEdit.reload();
    await pa.when(p=>p.lastState?.currentOutput?.reference.requestId===id&&p.lastOutput?.includes('result-a.mp4'),'original verified output after reload');
    const originalProperties=JSON.parse(JSON.stringify(a.properties)),originalFacts=JSON.parse(JSON.stringify(report)),originalB=b.properties.daelabEditExport.requestId;
    const editsBeforeSaveAs=historyEdits,requestsBeforeSaveAs=requests.length;
    graph.id='save-as-graph';a.__videoEdit.syncConnections();b.__videoEdit.syncConnections();
    await Promise.all([pa.when(p=>p.lastState?.copiedOutput?.reference.requestId===id&&p.lastState.copied===true&&p.lastState.busy===false,'read-only copied result'),pb.when(p=>p.lastState?.copied===true,'second copied instance')]);
    assert.equal(pa.lastState.copied,true);assert.equal(pa.lastState.currentOutput,undefined);assert.equal(pa.lastState.copiedOutput.reference.requestId,id);
    assert.match(pa.lastOutput,/result-a.mp4/);assert.equal(pb.lastOutput,null);assert.equal(pb.lastState.copied,true);
    assert.equal(pa.lastState.canCancel,false);assert.equal(pa.lastState.canRecover,false);assert.equal(pa.lastState.canReview,false);
    assert.equal(historyEdits,editsBeforeSaveAs,'read-only copied output projection does not add native edits');
    assert.deepEqual(JSON.parse(JSON.stringify(a.properties)),originalProperties);
    assert.deepEqual(requests.slice(requestsBeforeSaveAs).map(([url,method])=>[url,method]),[['/daelab/studio/media-exports/'+id,'GET']]);
    assert.equal(adapter.assets(a).assets[0].provenance.requestId,id);assert.deepEqual(adapter.assets(a).assets[0].provenance.source,{documentId:'graph-fixture',nodeId:'1'});
    await pa.host.exportVideo();await pa.host.cancelExport();await pa.host.recoverExport();await pa.host.reviewExport();
    await pb.host.exportVideo();await pb.host.cancelExport();await pb.host.recoverExport();
    assert.equal(requests.length,requestsBeforeSaveAs+1,'default actions cannot run or take over a copied task');
    await pa.host.exportCopy();const freshId=a.properties.daelabEditExport.requestId;
    assert.notEqual(freshId,id);assert.deepEqual(a.properties.daelabEditExport.source,{documentId:'save-as-graph',nodeId:'1'});
    assert.equal(pa.lastState.copied,false);assert.equal(pa.lastOutput,null);assert.equal(records.get(originalB).state,'running');
    assert.deepEqual(records.get(id),originalFacts);assert.deepEqual(originalProperties.daelabEditExport.source,{documentId:'graph-fixture',nodeId:'1'});
    Object.assign(records.get(freshId),{state:'succeeded',version:5,result:{kind:'assets',items:[{asset_id:'copy-result',reference_id:'copy-reference',sha256:'d'.repeat(64),bytes:600}]},output:{filename:'copy-result.mp4',subfolder:'DAELAB/edits',type:'output'}});
    await pa.host.recoverExport();assert.match(pa.lastOutput,/copy-result.mp4/);
    const copyFacts=JSON.parse(JSON.stringify(records.get(freshId))),copyProperties=JSON.parse(JSON.stringify(a.properties)),editsBeforeCopyReload=historyEdits;
    const reloadGate=holdNextLookup(freshId),requestsBeforeCopyReload=requests.length;
    a.__videoEdit.reload();await reloadGate.entered;
    assert.equal(pa.lastOutput,null,'reload must wait for verification instead of publishing an unchecked saved binding');
    let projected=false;
    const projection=pa.when(p=>p.lastOutput?.includes('copy-result.mp4')&&p.lastState?.currentOutput?.reference.requestId===freshId&&p.lastState.currentOutput.reference.source.documentId==='save-as-graph'&&p.lastState.currentOutput.reference.source.nodeId==='1'&&p.lastState.report?.version===5,'exact new-owner successful output after reload').then(()=>{projected=true;});
    await new Promise(setImmediate);
    assert.equal(projected,false,'an event-loop turn is not completion while the exact lookup is still held');
    assert.deepEqual(records.get(freshId),copyFacts);assert.deepEqual(records.get(id),originalFacts);
    assert.deepEqual(requests.slice(requestsBeforeCopyReload).map(([url,method])=>[url,method]),[['/daelab/studio/media-exports/'+freshId,'GET']]);
    reloadGate.release();await projection;
    assert.match(pa.lastOutput,/copy-result.mp4/);assert.equal(pa.lastState.currentOutput.reference.requestId,freshId);assert.equal(pa.lastState.copiedOutput,undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(a.properties)),copyProperties);assert.equal(historyEdits,editsBeforeCopyReload,'read-only reload projection adds no edit');
    assert.equal(requests.filter(([url])=>url==='/daelab/studio/media-exports').length,3);
    b.onRemoved();assert.equal(requests.some(([url])=>url.endsWith('/cancel')),false);assert.equal(records.get(b.properties.daelabEditExport.requestId).state,'running');
    const broken=new Node(3,101),originalRef={schemaVersion:1,requestId:'keep-corrupt-original',inputDigest:'invalid',source:{documentId:graph.id,nodeId:'3'}};
    broken.properties.daelabEditExport=originalRef;broken.onNodeCreated();
    const pc=[...panels.values()].at(-1),beforeBlocked=requests.length;
    await pc.when(p=>p.lastState?.unresolved===true,'malformed reference rejection');
    assert.equal(pc.lastState.unresolved,true,'an existing malformed reference locks the real session view');
    assert.match(pc.lastState.error,/原导出引用/);
    for(const invalid of [NaN,()=>{},Symbol('not-json'),1n]){
        broken.properties.daelabEditExport.corrupt=invalid;
        assert.doesNotThrow(()=>broken.__videoEdit.reload());
        assert.equal(pc.lastState.unresolved,true);assert.equal(pc.lastState.canRecover,false);
        for(let repeat=0;repeat<3;repeat++)assert.doesNotThrow(()=>broken.__videoEdit.syncConnections());
        await pc.host.exportVideo();await pc.host.recoverExport();await pc.host.cancelExport();await pc.host.reviewExport();
        assert.equal(requests.length,beforeBlocked,'blocked loading cannot POST, query or cancel an unverified identity');
        assert.equal(broken.properties.daelabEditExport.requestId,originalRef.requestId);
        assert.equal(broken.properties.daelabEditExport.corrupt,invalid);
        assert.equal(pc.lastState.unresolved,true);assert.equal(pc.lastOutput,null);
    }
    delete broken.properties.daelabEditExport.corrupt;
    broken.properties.daelabEditExport.inputDigest='a'.repeat(64);broken.properties.daelabEditExport.source.nodeId='another-node';
    broken.__videoEdit.reload();await pc.host.exportVideo();assert.equal(pc.lastState.unresolved,true);assert.equal(requests.length,beforeBlocked);
    broken.onRemoved();
    const firstLoad=new Node(4,101),raw={schemaVersion:1,requestId:'keep-first-load',inputDigest:'a'.repeat(64),source:{documentId:graph.id,nodeId:'4'},bad:()=>{}};
    firstLoad.properties.daelabEditExport=raw;firstLoad.onNodeCreated();
    const pd=[...panels.values()].at(-1);await pd.when(p=>p.lastState?.unresolved===true,'first-load invalid JSON rejection');assert.equal(pd.lastState.unresolved,true);assert.match(pd.lastState.error,/不可保存/);
    await pd.host.exportVideo();assert.equal(requests.length,beforeBlocked);assert.equal(firstLoad.properties.daelabEditExport.requestId,raw.requestId);
    assert.equal(firstLoad.properties.daelabEditExport.bad,raw.bad);firstLoad.onRemoved();
});
