/** Optional test-only observer. Importing does not read app.graph, mount UI, or install hooks. */
export const HOST_BOUNDARIES = Object.freeze({
    frontendVersion:'1.53.10',
    sourceHashBasis:'SHA-256 of original sourcemap sourcesContent encoded as UTF-8 with its LF newlines; not local extracted-file bytes or a runtime bundle attestation.',
    sources:{
        'src/scripts/app.ts':'ba650ea75b14affbdd1fbf4d821679d29dde59bd09986666a4734c8a160f7027',
        'src/lib/litegraph/src/LGraph.ts':'7a99223d5e212b5d6c278b747be8a62bb9ad6b1e93d32be435b8bb8593d339fe',
        'src/platform/workflow/management/stores/workflowStore.ts':'ec22b741c29fd57c2a48e2b5999d4d08e76e9d633847b8ddc065416440009e5e',
        'src/scripts/api.ts':'83a14ae190015005660b53970e8fb9b5f46e048f632607976bd371d0c6fcf914',
    },
});

// Each object/method gets one reversible wrapper. Observers never replace a
// later owner's wrapper, and stopping one observer does not remove another's.
const leases=new WeakMap();
function subscribeMethod(target,key,listener){
    if(!target||typeof target[key]!=='function')throw new Error('native-method-unavailable');
    let methods=leases.get(target);if(!methods){methods=new Map();leases.set(target,methods);}
    let lease=methods.get(key);
    if(lease&&target[key]!==lease.wrapper)throw new Error('native-method-replaced-during-observation');
    if(!lease){
        const descriptor=Object.getOwnPropertyDescriptor(target,key),original=target[key],listeners=new Set();
        const wrapper=function(...args){
            const completions=[];
            for(const subscription of [...listeners]){try{
                const complete=subscription.notify?.(this,args);
                if(typeof complete==='function'){const cell={complete,pending:subscription.pending};subscription.pending.add(cell);completions.push(cell);}
            }catch{/* Observation must not alter native behavior. */}}
            const settle=(outcome,value)=>{for(const cell of completions){const complete=cell.complete;cell.complete=null;cell.pending.delete(cell);try{complete?.(outcome,value);}catch{/* Native outcome remains unchanged. */}}};
            let result;
            try{result=Reflect.apply(original,this,args);}catch(error){settle('throw',error);throw error;}
            // Preserve the ORIGINAL Promise and rejection object. Native methods
            // on this host return genuine Promises; unknown thenables are not run.
            try{
                if(result instanceof Promise){
                    Promise.prototype.then.call(result,value=>settle('resolve',value),error=>settle('reject',error));
                }else settle('return',result);
            }catch{settle('unobservable-return');} // Even an exotic Promise must be returned unchanged.
            return result;
        };
        Object.defineProperty(target,key,descriptor?{...descriptor,value:wrapper}:{value:wrapper,writable:true,configurable:true,enumerable:false});
        lease={wrapper,original,descriptor,listeners};methods.set(key,lease);
    }
    const subscription={notify:listener,pending:new Set()};lease.listeners.add(subscription);let released=false;
    return ()=>{
        if(released)return;released=true;lease.listeners.delete(subscription);subscription.notify=null;
        // Promise callbacks cannot be detached; clear their cells so they retain
        // neither observer closures nor workflow objects after this lease ends.
        for(const cell of subscription.pending)cell.complete=null;subscription.pending.clear();
        if(lease.listeners.size)return;
        if(target[key]===lease.wrapper){
            if(lease.descriptor)Object.defineProperty(target,key,lease.descriptor);else delete target[key];
        }
        if(methods.get(key)===lease)methods.delete(key);
    };
}

const workflowFile=file=>typeof file==='string'&&file.startsWith('workflows/')&&file.endsWith('.json')&&!file.split('/').at(-1).startsWith('.');
const plainClone=value=>JSON.parse(JSON.stringify(value));

/** No IO or hooks until start({explicit:true}). All result text/graph content stays private. */
export function createNativeBoundaryObserver({app,api,now=()=>performance.now(),onUpdate=()=>{},maxRecords=20000}={}){
    const histories=[],workflowIds=new WeakMap(),graphIds=new WeakMap();
    let current=null,active=false,epoch=0,nextWorkflow=0,nextGraph=0,nextOperation=0,release=[],saveOperations=new Set();
    const latest=new Map();
    const id=(map,value,prefix,next)=>{
        if(!value||(typeof value!=='object'&&typeof value!=='function'))return null;
        if(!map.has(value))map.set(value,prefix+next());return map.get(value);
    };
    const workflowId=value=>id(workflowIds,value,'workflow-',()=>++nextWorkflow);
    const graphId=value=>id(graphIds,value,'graph-',()=>++nextGraph);
    const workflow=()=>app?.extensionManager?.workflow?.activeWorkflow;
    const time=()=>{const t=now();return Number.isFinite(t)?t:null;};
    const emit=()=>{try{onUpdate({active,status:current?.status??'idle',records:current?.records.length??0,
        latest:[...latest.values()].map(record=>({id:record.id,kind:record.kind,status:record.status,
            workflowId:record.workflowId,durationMs:record.durationMs,successful:record.successful??null,
            storageAcknowledged:record.storageAcknowledged??null}))});}catch{/* A view failure cannot change host behavior. */}};
    function finish(record,outcome,detail={}){
        if(!active||record.epoch!==epoch||record.status!=='pending')return;
        record.endedAt=time();record.durationMs=record.startedAt==null||record.endedAt==null?null:record.endedAt-record.startedAt;
        Object.assign(record,{status:outcome,...detail});emit();
    }
    function begin(kind,owner,detail={}){
        if(!active)return null;
        if(current.records.length>=maxRecords){stop('capacity-stop');return null;}
        const record={id:++nextOperation,epoch,kind,workflowId:workflowId(owner),startedAt:time(),endedAt:null,durationMs:null,status:'pending',...detail};
        current.records.push(record);latest.set(kind,record);
        if(kind!=='native-serialization')emit();
        return record;
    }
    function installGraph(){
        if(app.isGraphReady!==true)throw new Error('native-graph-not-ready');
        const graph=app.rootGraph;
        release.push(subscribeMethod(graph,'serialize',(_this,_args)=>{
            const record=begin('native-serialization',workflow(),{graphId:graphId(graph),boundary:'LGraph.serialize synchronous return',saveCorrelation:null});
            if(!record)return;
            return outcome=>finish(record,outcome==='return'?'complete':outcome,{successful:outcome==='return'});
        }));
    }
    function start({explicit=false}={}){
        if(!explicit||active)return false;
        if(app?.isGraphReady!==true)throw new Error('native-graph-not-ready');
        const store=app.extensionManager?.workflow;
        if(typeof app.loadGraphData!=='function'||typeof store?.saveWorkflow!=='function'||typeof api?.storeUserData!=='function')throw new Error('native-boundary-capability-unavailable');
        active=true;++epoch;latest.clear();
        current={schemaVersion:1,kind:'passive-native-performance-observation',hostContract:HOST_BOUNDARIES,
            startedAt:time(),endedAt:null,status:'observing',records:[],productAcceptance:false,
            limitations:['Source hashes identify the inspected 1.53.10 source, not a runtime hash attestation.',
                'Promise timing is observed at its settlement callback; no native function is invoked by this observer.',
                'Serialization is measured independently; unrelated history/extension serialization calls are retained.',
                'Workflow store completion and HTTP 200 acknowledgement are distinct boundaries.',
                'loadGraphData true does not prove a rendered target is editable.',
                'No workflow data, paths, input text, response bodies, credentials, or error messages are recorded.'],
            unmeasured:{reopenToEditableMs:null,semanticTableInputToDisplayMs:null,semanticAssetSearchCompletionMs:null},
            missing:['editable-target-native-boundary-unavailable','PERF-02-target-identity-and-expected-content-not-bound','PERF-08-fixed-query-and-exact-results-not-bound']};
        histories.push(current);
        try{
            installGraph();
            release.push(subscribeMethod(app,'loadGraphData',(_this,_args)=>{
                const record=begin('native-workflow-load',workflow(),{boundary:'ComfyApp.loadGraphData Promise<boolean>',requestedWorkflowId:workflowId(_args[3]),observedWorkflowAfterLoad:null,editableCompleteMs:null});
                if(!record)return;
                return (outcome,value)=>{
                    const successful=outcome==='resolve'&&value===true;
                    finish(record,successful?'complete':outcome==='resolve'?'not-loaded':outcome,{successful,observedWorkflowAfterLoad:successful?workflowId(workflow()):null});
                };
            }));
            release.push(subscribeMethod(store,'saveWorkflow',(_this,args)=>{
                const owner=args[0],record=begin('native-workflow-save',owner,{boundary:'workflowStore.saveWorkflow Promise settlement',storageAcknowledgedAt:null,storageDurationMs:null,storageRequestId:null});
                if(!record)return;
                // Paths are used only in this closure to bind the exact save, never exported.
                const operation={record,owner,path:typeof owner?.path==='string'?owner.path:null};saveOperations.add(operation);
                return (outcome,_value)=>{
                    saveOperations.delete(operation);
                    finish(record,outcome==='resolve'?'complete':outcome,{successful:outcome==='resolve',storageAcknowledged:record.storageAcknowledgedAt!=null});
                };
            }));
            release.push(subscribeMethod(api,'storeUserData',(_this,args)=>{
                if(!workflowFile(args[0]))return;
                const matching=[...saveOperations].filter(item=>item.path===args[0]&&item.record.epoch===epoch);
                const bound=matching.length===1?matching[0]:null;
                const record=begin('native-workflow-storage',bound?.owner,{boundary:'api.storeUserData HTTP response',saveOperationId:bound?.record.id??null,correlation:matching.length>1?'ambiguous':bound?'exact-workflow-path':'unbound',httpStatus:null});
                if(!record)return;
                return (outcome,response)=>{
                    const status=outcome==='resolve'&&Number.isInteger(response?.status)?response.status:null;
                    const successful=outcome==='resolve'&&status===200;
                    finish(record,successful?'complete':outcome==='resolve'?'http-not-confirmed':outcome,{successful,httpStatus:status});
                    if(active&&record.epoch===epoch&&successful&&bound&&bound.record.status==='pending'){
                        bound.record.storageAcknowledgedAt=record.endedAt;bound.record.storageDurationMs=record.durationMs;bound.record.storageRequestId=record.id;
                    }
                };
            }));
        }catch(error){stop('capability-unavailable');throw error;}
        emit();return true;
    }
    function stop(reason='operator-stop'){
        if(!active)return;active=false;
        for(const record of current.records)if(record.status==='pending')record.status='interrupted-observation';
        current.endedAt=time();current.status=reason;
        const callbacks=release;release=[];for(const dispose of callbacks.reverse()){try{dispose();}catch{current.missing.push('hook-restore-failed');}}
        saveOperations.clear();current.harnessHooksAfterStop=release.length;emit();
    }
    return {start,stop,destroy:()=>stop('page-release'),get active(){return active;},
        report:()=>plainClone({schemaVersion:1,reports:histories,productAcceptance:false}),
        resources:()=>({methodSubscriptions:release.length,pendingSaves:saveOperations.size})};
}

/** Explicit caller must mount this panel; its Start button alone enables observation. */
export function mountNativePerformanceObserver(document,window,{app,api}={}){
    if(document.getElementById('studio-native-performance-observer'))return null;
    const make=(tag,text,parent)=>{const element=document.createElement(tag);element.textContent=text||'';parent?.append(element);return element;};
    const panel=make('details','',document.body);panel.id='studio-native-performance-observer';
    panel.style.cssText='position:fixed;right:8px;bottom:56px;z-index:2147483001;width:350px;max-height:70vh;overflow:auto;background:#182027;color:#eee;border:1px solid #71858f;padding:10px;font:12px/1.5 sans-serif';
    make('summary','原生保存 / 加载观测（仅本页测试）',panel);
    make('p','开始后仅观察真实原生调用。请在原界面保存、重开；不会自动输入、保存、加载或生成。重新加载页面后不自动继续。',panel);
    make('p','加载返回 true 仅代表原生加载完成；可编辑完成、表格语义显示和资产搜索完成仍为 null，不能由任意 DOM 变化补齐。',panel);
    const status=make('output','未启用；尚未读取宿主 graph',panel);status.style.cssText='display:block;white-space:pre-wrap';
    const controls=make('div','',panel);controls.style.cssText='display:flex;gap:6px;flex-wrap:wrap';
    const button=(label,callback)=>{const element=make('button',label,controls);element.type='button';element.onclick=callback;return element;};
    let disposed=false;
    const observer=createNativeBoundaryObserver({app,api,now:()=>window.performance.now(),onUpdate:summary=>{
        status.textContent=`${summary.active?'正在观察':'已停止'} · ${summary.records} 个原始调用；产品验收未判定`+
            summary.latest.map(record=>`\n#${record.id} ${record.kind}: ${record.status}`+
                (record.durationMs==null?'':` · ${record.durationMs.toFixed(1)} ms`)+
                (record.storageAcknowledged===true?' · 存储已确认':'')).join('');
    }});
    const start=button('开始本页观测',event=>{
        if(disposed||!event?.isTrusted)return;
        try{observer.start({explicit:true});start.disabled=true;stop.disabled=false;}catch{status.textContent='原生边界尚不可用；保持未启用。请在宿主完全加载后重试。';}
    });
    const stop=button('停止并释放',()=>{observer.stop();start.disabled=false;stop.disabled=true;});stop.disabled=true;
    button('下载原始记录',()=>{
        if(observer.active){status.textContent='先停止观测再下载。';return;}
        const blob=new Blob([JSON.stringify(observer.report(),null,2)],{type:'application/json'}),url=window.URL.createObjectURL(blob);
        try{const link=make('a','',panel);link.href=url;link.download='native-performance-raw.json';link.click();link.remove();}finally{window.URL.revokeObjectURL(url);}
    });
    const abort=new AbortController();
    for(const type of ['pointerdown','keydown','dblclick','wheel'])panel.addEventListener(type,event=>event.stopPropagation(),{signal:abort.signal});
    function destroy(){if(disposed)return;disposed=true;observer.destroy();abort.abort();panel.remove();}
    window.addEventListener('pagehide',destroy,{once:true,signal:abort.signal});
    return {destroy,stop:()=>{observer.stop();start.disabled=false;stop.disabled=true;},report:observer.report};
}
