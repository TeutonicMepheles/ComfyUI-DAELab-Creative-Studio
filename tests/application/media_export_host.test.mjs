import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

for(const proxied of [false,true])test(`real VideoEdit integration uses HTTP snapshots, preserves slots, isolates instances and never cancels on disposal (native proxies: ${proxied})`,async t=>{
    const cache=new WeakMap(),native=value=>{
        if(!proxied||!value||typeof value!=='object')return value;
        if(!cache.has(value))cache.set(value,new Proxy(value,{get(target,key,receiver){return native(Reflect.get(target,key,receiver));}}));
        return cache.get(value);
    };
    const key=Symbol.for('DAELAB.ExportHostFixture'),records=new Map(),requests=[],panels=new Map(),adapters=new Map(),nodes=new Map();
    const graph={id:'graph-fixture',links:new Map([[101,{origin_id:90}],[102,{origin_id:91}]]),getNodeById:id=>nodes.get(Number(id)),change(){},setDirtyCanvas(){},
        serialize:()=>({nodes:[...nodes.values()].map(n=>({id:n.id,properties:n.properties,widgets_values:n.widgets?.map(w=>w.value)}))})};
    let extension,invalidAsset=false;
    const app={graph,rootGraph:graph,isGraphReady:true,configuringGraph:false,canvas:{selected_nodes:{}},extensionManager:{workflow:{activeWorkflow:{}},toast:{add(){}}},registerExtension(value){extension=value;}};
    const history={begin(){},end(){},amend(fn){fn();},undo(){},redo(){}};
    const api={queuePrompt(){throw Error('native queue must never be invoked by UI');},async fetchApi(url,options={}){
        requests.push([url,options.method||'GET',options.body]);
        const prefix='/daelab/studio/media-exports';assert.ok(url.startsWith(prefix));
        if(url===prefix){
            const input=JSON.parse(options.body),id=input.requestId;
            records.set(id,{schemaVersion:1,requestId:id,state:'running',version:3,fingerprint:'a'.repeat(64),editFingerprint:'b'.repeat(64),native:{promptId:'native-'+id,nodeId:'save',listIndex:0},providerTaskId:'native-'+id,cancelRequested:false,result:null,errorCode:null,source:{...input.source,operation:'video_export'},attempt:1,output:null,recoveryAction:'query_original'});
            return new Response(JSON.stringify(records.get(id)),{status:202});
        }
        const id=decodeURIComponent(url.slice(prefix.length+1).split('/')[0]);
        if(url.endsWith('/cancel'))Object.assign(records.get(id),{state:'cancelled',version:4,cancelRequested:true});
        return new Response(JSON.stringify(records.get(id)));
    }};
    const fixture={app,api,history,registerAdapter:(id,value)=>adapters.set(id,value),adapterFor:node=>node?.fixtureAdapter,
        createVideoEditor(host){const panel={host,root:{},lastOutput:null,lastState:null,output(url){this.lastOutput=url;},exportState(value){this.lastState=value;},error(){},reload(){},async syncSources(){},cancelSourceSync(){},destroy(){}};panels.set(host,panel);return panel;}};
    globalThis[key]=fixture;
    const previousDocument=globalThis.document,previousRAF=globalThis.requestAnimationFrame;
    globalThis.document={createElement:()=>({}),head:{append(){}}};globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);
    t.after(()=>{for(const node of nodes.values())node.__videoEdit?.destroy();delete globalThis[key];globalThis.document=previousDocument;globalThis.requestAnimationFrame=previousRAF;});
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
    const a=new Node(1,101),b=new Node(2,102);a.onNodeCreated();b.onNodeCreated();await new Promise(resolve=>setTimeout(resolve,5));
    const [pa,pb]=[...panels.values()];const originalSlots=a.inputs.map(i=>i.name);
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
    const adapter=adapters.get('daelab.video-edit');assert.equal(adapter.assets(a).assets[0].assetId,'result-a');
    const edited=JSON.parse(a.widgets[0].value);edited.clips[0].duration=1;pa.host.write(edited);assert.equal(adapter.assets(a).ready,false);assert.deepEqual(a.outputs[0].links,[701]);assert.ok(a.properties.daelabEditBinding);
    invalidAsset=true;await pa.host.exportVideo();assert.equal(requests.filter(([url])=>url==='/daelab/studio/media-exports').length,2);assert.match(pa.lastState.error,/不可保存/);invalidAsset=false;
    const copy={properties:JSON.parse(JSON.stringify(b.properties))};adapter.prepareCopy(b,copy);assert.equal(copy.properties.daelabEditExport,undefined);assert.ok(b.properties.daelabEditExport);
    b.onRemoved();assert.equal(requests.some(([url])=>url.endsWith('/cancel')),false);assert.equal(records.get(b.properties.daelabEditExport.requestId).state,'running');
    const broken=new Node(3,101),originalRef={schemaVersion:1,requestId:'keep-corrupt-original',inputDigest:'invalid',source:{documentId:graph.id,nodeId:'3'}};
    broken.properties.daelabEditExport=originalRef;broken.onNodeCreated();await new Promise(resolve=>setTimeout(resolve,5));
    const pc=[...panels.values()].at(-1),beforeBlocked=requests.length;
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
    firstLoad.properties.daelabEditExport=raw;firstLoad.onNodeCreated();await new Promise(resolve=>setTimeout(resolve,5));
    const pd=[...panels.values()].at(-1);assert.equal(pd.lastState.unresolved,true);assert.match(pd.lastState.error,/不可保存/);
    await pd.host.exportVideo();assert.equal(requests.length,beforeBlocked);assert.equal(firstLoad.properties.daelabEditExport.requestId,raw.requestId);
    assert.equal(firstLoad.properties.daelabEditExport.bad,raw.bad);firstLoad.onRemoved();
});
