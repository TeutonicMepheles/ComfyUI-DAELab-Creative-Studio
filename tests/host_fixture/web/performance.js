/** Test-only, visible, passive observer. No graph access, prompt submission or synthetic input. */
export const PROTOCOL = Object.freeze({warmupMs:10000,sampleMs:30000,repetitions:5,soakMs:3600000});
// Browser viewport overrides can expose float32 rounding (for example 1.0000000298).
// Preserve the raw DPR in evidence; tolerate only numerical noise around 1.
const referenceDpr=value=>Number.isFinite(value)&&Math.abs(value-1)<=1e-6;
export function percentile(values, fraction) {
    const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
    return sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*fraction)-1)]:null;
}
export function distribution(values) {
    const finite=values.filter(Number.isFinite);
    return {count:finite.length,p50:percentile(finite,.5),p95:percentile(finite,.95),max:finite.length?finite.reduce((a,b)=>Math.max(a,b),-Infinity):null};
}
export function summarizeRun(run) {
    return {
        index:run.index,status:run.status,durationMs:run.sampleEndedAt==null?null:run.sampleEndedAt-run.sampleStartedAt,
        activeFrameIntervalsMs:distribution(run.frames.filter(f=>f.active).map(f=>f.intervalMs)),
        allFrameIntervalsMs:distribution(run.frames.map(f=>f.intervalMs)),
        eventTimingDurationMs:distribution(run.eventTimings.map(e=>e.duration)),
        inputToNextRafProxyMs:distribution(run.inputs.map(e=>e.nextRafMs).filter(v=>v!=null)),
        inputToVisibleMutationProxyMs:distribution(run.inputs.map(e=>e.visibleMutationRafMs).filter(v=>v!=null)),
        longTasks:run.longTasks.length,visibilityLoss:run.visibility.some(e=>e.state!=='visible'),
        trustedInputs:run.inputs.length,resourceSamples:run.census.length,
    };
}
export function assessReport(report) {
    const runs=report.runs.map(summarizeRun),complete=runs.filter(r=>r.status==='complete');
    const reasons=[];
    if(report.protocol?.warmupMs!==PROTOCOL.warmupMs||report.protocol?.sampleMs!==PROTOCOL.sampleMs)reasons.push('protocol_mismatch');
    const required=report.scenario==='PERF-07'?PROTOCOL.soakMs/PROTOCOL.sampleMs:PROTOCOL.repetitions;
    if(complete.length!==required||runs.length!==required)reasons.push('incomplete_repetitions');
    if(runs.some(r=>r.durationMs==null||r.durationMs<PROTOCOL.sampleMs))reasons.push('short_sample');
    if(report.warmupEndedAt==null||report.warmupEndedAt-report.startedAt<PROTOCOL.warmupMs)reasons.push('short_warmup');
    if(runs.some(r=>r.visibilityLoss)||(report.visibility||[]).some(e=>e.state!=='visible'))reasons.push('page_hidden_during_sample');
    if(!referenceDpr(report.environment?.dpr))reasons.push('DPR_not_reference_1');
    if(report.environment?.viewport?.width!==1920||report.environment?.viewport?.height!==1080)reasons.push('viewport_not_reference_1920x1080');
    if(!report.fixture?.sha256)reasons.push('missing_fixture_hash');
    if(!/^[a-f0-9]{64}$/.test(report.buildFingerprint||''))reasons.push('missing_build_fingerprint');
    if(report.capacityStop)reasons.push('raw_sample_capacity_reached');
    if(report.runs.some(run=>{
        if(!Number.isFinite(run.sampleStartedAt)||!Number.isFinite(run.sampleEndedAt))return true;
        let previous=run.sampleStartedAt;
        for(const frame of run.frames){if(!Number.isFinite(frame.at)||!Number.isFinite(frame.intervalMs)||frame.intervalMs<=0||Math.abs(frame.at-previous-frame.intervalMs)>1)return true;previous=frame.at;}
        return run.status==='complete'&&Math.abs(previous-run.sampleEndedAt)>1;
    }))reasons.push('invalid_or_missing_raw_frame_timeline');
    if(report.runs.some(run=>(run.marks||[]).some(mark=>mark.kind==='viewport-change'&&(!referenceDpr(mark.dpr)||mark.width!==1920||mark.height!==1080))))reasons.push('reference_viewport_changed');
    if(['PERF-02','PERF-08'].includes(report.scenario)&&runs.some(run=>run.trustedInputs===0))reasons.push('missing_actual_edit_or_search_input');
    const missingByScenario={'PERF-02':'semantic_display_completion_unmeasured','PERF-03':'native_save_and_load_boundaries_unmeasured','PERF-04':'operation_completion_and_cancellation_unverified','PERF-05':'product_resources_and_controlled_GC_unmeasured','PERF-06':'scheduler_concurrency_and_health_unmeasured','PERF-07':'long_run_edit_and_job_integrity_unverified','PERF-08':'semantic_search_completion_unmeasured'};
    if(missingByScenario[report.scenario])reasons.push(missingByScenario[report.scenario]);
    if(['PERF-01','PERF-02','PERF-04'].includes(report.scenario)&&runs.some(r=>r.activeFrameIntervalsMs.count<30))reasons.push('insufficient_actual_interaction');
    const limits={'PERF-01':20,'PERF-02':33.3},limit=limits[report.scenario];
    const numericFrameBudget=limit==null?null:runs.every(r=>r.activeFrameIntervalsMs.p95!=null&&r.activeFrameIntervalsMs.p95<=limit&& (report.scenario!=='PERF-01'||r.activeFrameIntervalsMs.max<=200));
    // This harness never upgrades a proxy or missing external measurement to TC acceptance.
    return {status:reasons.length?'insufficient_evidence':'requires_review',reasons,runs,numericFrameBudget,
        productAcceptance:false,unmeasured:['semantic_input_to_display','native_serialization_duration','reopen_to_editable','product_subscription_timer_ownership','controlled_gc_heap','backend_admission_fairness','backend_RSS','GPU_decoder_memory','edit_and_job_integrity']};
}

export function mountPerformanceObserver(document, window) {
    if(document.getElementById('studio-performance-observer'))return null;
    const make=(tag,text,parent)=>{const e=document.createElement(tag);if(text)e.textContent=text;parent?.append(e);return e;};
    const panel=make('details','',document.body);panel.id='studio-performance-observer';
    panel.style.cssText='position:fixed;left:8px;bottom:8px;z-index:2147483000;width:340px;max-height:85vh;overflow:auto;color:#eee;background:#182027;border:1px solid #71858f;padding:10px;font:12px/1.5 sans-serif;box-sizing:border-box';
    make('summary','性能观测（仅隔离测试）',panel);
    make('p','只观察真实操作。先加载合成夹具并等待资源，再开始 10 秒预热 + 30 秒 × 5；拖动、输入、保存均由操作者在原界面执行。',panel);
    const row=(label,element)=>{const wrap=make('label',label+' ',panel);wrap.style.display='block';wrap.append(element);return element;};
    const select=(label,values)=>{const e=make('select');for(const value of values)e.add(new Option(value,value));return row(label,e);};
    const scenario=select('项目',['PERF-01','PERF-02','PERF-03','PERF-04','PERF-05','PERF-06','PERF-07','PERF-08']);
    const edition=select('实现',['old','new']),media=select('媒体',['no-video','video']),cache=select('缓存声明',['warm','cold','not-established']);
    const fixtureFile=row('固定工作流 / 搜索夹具',make('input'));fixtureFile.type='file';fixtureFile.accept='.json';
    const build=row('构建指纹',make('input'));build.placeholder='粘贴 build/source SHA256';build.maxLength=64;
    const loaded=row('资源已加载（人工确认）',make('input'));loaded.type='checkbox';
    const status=make('output','等待开始',panel);status.style.cssText='display:block;white-space:pre-wrap';
    const buttons=make('div','',panel);buttons.style.cssText='display:flex;flex-wrap:wrap;gap:4px';
    const button=(label,action)=>{const e=make('button',label,buttons);e.type='button';e.onclick=action;return e;};
    let fixture=null,region=null,picking=false,active=null,run=null,phase='idle',raf=null,samplingTimer=null,abort=null,mutationObserver=null,performanceObservers=[],lastFrame=null,lastActivity=-Infinity,rawCount=0;
    let pendingInputs=[],reports=[],exported=true,operationStart=null,cycle=0,disposed=false,urls=new Set(),paintRafs=new Set();
    const own=new AbortController();
    const now=()=>window.performance.now();
    const inside=e=>panel.contains(e);
    const visible=e=>{if(!e?.isConnected||inside(e))return false;const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&b.right>0&&b.bottom>0&&b.left<window.innerWidth&&b.top<window.innerHeight;};
    const count=selector=>document.querySelectorAll(selector).length;
    function census(){
        const started=now();
        const videos=[...document.querySelectorAll('video')];
        const memory=window.performance.memory;
        const value={at:started,domElements:document.getElementsByTagName('*').length,images:count('img'),videos:videos.length,visibleVideos:videos.filter(visible).length,
            playingVideos:videos.filter(v=>!v.paused&&!v.ended).length,
            videoStates:videos.map(v=>({visible:visible(v),paused:v.paused,readyState:v.readyState,width:v.videoWidth,height:v.videoHeight,droppedFrames:v.getVideoPlaybackQuality?.().droppedVideoFrames??null,totalFrames:v.getVideoPlaybackQuality?.().totalVideoFrames??null})),
            heapUsedBytes:memory?.usedJSHeapSize??null,heapMeasurement:memory?'nonstandard-telemetry-without-controlled-GC':'unavailable',
            productTimers:null,productSubscriptions:null,observersOwnedByHarness:{samplingEventListeners:7,mutationObservers:mutationObserver?1:0,performanceObservers:performanceObservers.length,intervals:samplingTimer?1:0,raf:(raf==null?0:1)+paintRafs.size}};
        value.observerCostMs=now()-started;return value;
    }
    function push(list,value){if(!active||!run)return;list.push(value);rawCount++;if(rawCount>500000&&!active.capacityStop){const report=active;report.capacityStop=true;window.queueMicrotask(()=>{if(active===report)stop('capacity-stop');});}}
    function environment(){return {userAgent:window.navigator.userAgent,hardwareConcurrency:window.navigator.hardwareConcurrency??null,deviceMemoryGiBApproximate:window.navigator.deviceMemory??null,dpr:window.devicePixelRatio??null,viewport:{width:window.innerWidth,height:window.innerHeight},screen:{width:window.screen.width,height:window.screen.height},timeOrigin:window.performance.timeOrigin,
        controlledGC:false,heapAPI:!!window.performance.memory,performanceEntryTypes:window.PerformanceObserver?.supportedEntryTypes||[],gpuRenderer:null,backendRSS:null};}
    function beginRun(at){
        run={index:active.runs.length+1,status:'running',sampleStartedAt:at,sampleEndedAt:null,frames:[],interactions:[],inputs:[],mutations:[],eventTimings:[],longTasks:[],resources:[],census:[],visibility:[{at,state:document.visibilityState}],marks:[]};
        active.runs.push(run);pendingInputs=[];lastFrame=at;lastActivity=-Infinity;phase='sample';push(run.census,census());
        status.textContent=`采样 ${run.index}/${active.repetitions} · 请在原界面执行固定操作`;
    }
    function frame(at){
        raf=null;if(!active)return;
        if(phase==='warmup'&&at-active.startedAt>=PROTOCOL.warmupMs){active.warmupEndedAt=at;beginRun(at);}
        else if(phase==='sample'){
            if(lastFrame!=null){const interacting=lastActivity>=lastFrame-250;push(run.frames,{at,intervalMs:at-lastFrame,active:interacting});}
            for(const input of pendingInputs)if(input.nextRafMs==null)input.nextRafMs=at-input.at;
            lastFrame=at;
            if(at-run.sampleStartedAt>=PROTOCOL.sampleMs){run.sampleEndedAt=at;run.status='complete';push(run.census,census());
                if(run.index>=active.repetitions){stop('complete');return;}beginRun(at);
            }
        }
        if(active)raf=window.requestAnimationFrame(frame);
    }
    function activity(event){
        if(!active||phase!=='sample'||inside(event.target)||!event.isTrusted)return;
        if(event.type==='pointermove'&&!event.buttons)return;
        lastActivity=now();
        if(['pointerdown','pointermove','wheel'].includes(event.type))push(run.interactions,{at:lastActivity,type:event.type,x:event.clientX,y:event.clientY,buttons:event.buttons??0,deltaY:event.deltaY??0,ctrlKey:!!event.ctrlKey});
        if(event.type==='input'||event.type==='keydown'){
            if(event.type==='keydown'&&event.key?.length===1&&!event.ctrlKey&&!event.metaKey)return;
            const item={id:run.inputs.length+1,at:lastActivity,type:event.type,targetTag:event.target?.tagName||null,isComposing:!!event.isComposing,nextRafMs:null,visibleMutationRafMs:null};
            push(run.inputs,item);pendingInputs.push(item);
            // No input text, target label, URL or serialized node data is collected.
        }
    }
    function changed(records){
        if(!active||phase!=='sample')return;
        const observedAt=now();
        const relevant=records.filter(record=>!inside(record.target)&&visible(record.target.nodeType===1?record.target:record.target.parentElement));
        if(!relevant.length)return;
        const at=now();push(run.mutations,{at,records:relevant.length,selectedRegion:!!region,observerCostMs:at-observedAt});
        // This correlation remains a proxy: a visible mutation need not be the intended result.
        if(region){const sampleRun=run;const waiting=pendingInputs.filter(input=>input.visibleMutationRafMs==null&&at-input.at<2000);
            const id=window.requestAnimationFrame(painted=>{paintRafs.delete(id);if(!active||run!==sampleRun)return;for(const input of waiting)input.visibleMutationRafMs=painted-input.at;});paintRafs.add(id);}
    }
    function observePerformance(type,callback,options={}){
        if(!window.PerformanceObserver?.supportedEntryTypes?.includes(type))return;
        try{const observer=new window.PerformanceObserver(list=>{if(active&&phase==='sample')for(const entry of list.getEntries())if(entry.startTime>=run.sampleStartedAt)callback(entry);});observer.observe({type,buffered:false,...options});performanceObservers.push(observer);}catch(error){active.observerErrors.push({type,error:error.name});}
    }
    function start(){
        if(active||disposed)return;
        if(!exported){status.textContent='先下载此前全部原始样本，再开始下一批。';return;}
        if(!fixture||!loaded.checked){status.textContent='请选择固定夹具文件，并确认资源已加载。';return;}
        active={schemaVersion:1,kind:'passive-performance-observation',scenario:scenario.value,implementation:edition.value,mediaVariant:media.value,cacheDeclaration:cache.value,fixture:{...fixture,loadedInHost:'operator-declared-not-verified-by-observer'},buildFingerprint:/^[a-f0-9]{64}$/i.test(build.value.trim())?build.value.trim().toLowerCase():null,
            protocol:{...PROTOCOL},repetitions:scenario.value==='PERF-07'?PROTOCOL.soakMs/PROTOCOL.sampleMs:PROTOCOL.repetitions,startedAt:now(),wallClockStartedAt:new Date().toISOString(),warmupEndedAt:null,endedAt:null,status:'running',environment:environment(),observerErrors:[],visibility:[{at:now(),state:document.visibilityState}],runs:[],notes:['No graph access or synthetic events','All raw samples kept, including incomplete/hidden runs','rAF and mutation delays are proxies, not semantic display acceptance','Event Timing threshold 16 ms censors short entries and duration can be quantized']};
        reports.push(active);exported=false;phase='warmup';run=null;rawCount=0;cycle=0;abort=new AbortController();
        for(const type of ['pointerdown','pointermove','wheel','input','keydown'])document.addEventListener(type,activity,{capture:true,passive:true,signal:abort.signal});
        document.addEventListener('visibilitychange',()=>{const entry={at:now(),state:document.visibilityState};active.visibility.push(entry);if(run)push(run.visibility,entry);},{signal:abort.signal});
        window.addEventListener('resize',()=>{if(run)push(run.marks,{at:now(),kind:'viewport-change',width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio});},{signal:abort.signal});
        mutationObserver=new MutationObserver(changed);mutationObserver.observe(region||document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','hidden','aria-busy','disabled']});
        observePerformance('event',entry=>{if(!inside(entry.target))push(run.eventTimings,{startTime:entry.startTime,duration:entry.duration,processingStart:entry.processingStart,processingEnd:entry.processingEnd,interactionId:entry.interactionId??null,name:entry.name});},{durationThreshold:16});
        observePerformance('longtask',entry=>push(run.longTasks,{startTime:entry.startTime,duration:entry.duration}));
        observePerformance('resource',entry=>push(run.resources,{startTime:entry.startTime,duration:entry.duration,initiatorType:entry.initiatorType,transferSize:entry.transferSize,encodedBodySize:entry.encodedBodySize}));
        samplingTimer=window.setInterval(()=>{if(run)push(run.census,census());},1000);
        raf=window.requestAnimationFrame(frame);status.textContent='预热 10 秒；然后开始固定真实操作。';startButton.disabled=true;stopButton.disabled=false;
    }
    function stop(reason='operator-stop'){
        if(!active)return;
        const report=active;report.endedAt=now();report.status=reason;
        if(run&&run.status==='running'){run.status=reason;run.sampleEndedAt=report.endedAt;run.census.push(census());}
        active=null;phase='idle';abort?.abort();abort=null;mutationObserver?.disconnect();mutationObserver=null;
        for(const observer of performanceObservers)observer.disconnect();performanceObservers=[];
        if(raf!=null)window.cancelAnimationFrame(raf);raf=null;if(samplingTimer!=null)window.clearInterval(samplingTimer);samplingTimer=null;
        for(const id of paintRafs)window.cancelAnimationFrame(id);paintRafs.clear();
        report.assessment=assessReport(report);report.samplingResourcesAfterStop={listeners:0,observers:0,intervals:0,raf:0,visibleUIBindingsRemain:true};pendingInputs=[];run=null;operationStart=null;
        status.textContent=`已停止：${reason}\n${report.runs.length} 段原始样本；结论 ${report.assessment.status}，不是产品通过。请下载。`;startButton.disabled=false;stopButton.disabled=true;
    }
    const startButton=button('开始观测',start),stopButton=button('停止',()=>stop());stopButton.disabled=true;
    button('选可见结果区域',()=>{if(active)return;panel.open=false;picking=true;status.textContent='点击实际结果区域；只选取观测范围，不拦截原操作。';});
    button('记录轮次 / 资源样本',()=>{if(run){cycle++;push(run.marks,{at:now(),kind:'operator-lifecycle-cycle',cycle,controlledGC:false});push(run.census,census());status.textContent=`记录轮次 ${cycle}；未执行或声称 GC。`;}});
    button('操作开始 / 结束标记',()=>{if(!run)return;if(operationStart==null){operationStart=now();push(run.marks,{at:operationStart,kind:'operator-operation-start'});}else{push(run.marks,{at:now(),kind:'operator-operation-end',elapsedMs:now()-operationStart,measurement:'human-inclusive-boundary-not-native-serialization'});operationStart=null;}});
    button('下载全部原始报告',()=>{
        if(active){status.textContent='先停止采样，再下载完整原始报告。';return;}
        if(!reports.length)return;
        const blob=new Blob([JSON.stringify({schemaVersion:1,reports},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);urls.add(url);
        const link=make('a');link.href=url;link.download=`performance-raw-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;panel.append(link);link.click();link.remove();URL.revokeObjectURL(url);urls.delete(url);exported=true;status.textContent='已请求浏览器下载全部原始样本。请确认文件存在；不会自动删除旧报告。';
    });
    fixtureFile.addEventListener('change',async()=>{const file=fixtureFile.files?.[0];fixture=null;if(!file)return;const bytes=await file.arrayBuffer();const digest=await window.crypto.subtle.digest('SHA-256',bytes);fixture={sha256:[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join(''),bytes:bytes.byteLength};status.textContent='夹具哈希已固定；此动作没有加载或改变宿主图。';},{signal:own.signal});
    document.addEventListener('pointerdown',event=>{if(!picking||!event.isTrusted||inside(event.target))return;region=event.target.closest?.('section,main,[role=grid],dialog')||event.target.parentElement;picking=false;panel.open=true;status.textContent='已选取可见 DOM 范围。输入→首个可见变化仍须人工核对语义。';},{capture:true,passive:true,signal:own.signal});
    for(const type of ['pointerdown','keydown','dblclick','wheel'])panel.addEventListener(type,event=>event.stopPropagation(),{signal:own.signal});
    function destroy(){if(disposed)return;stop('page-release');disposed=true;own.abort();for(const url of urls)URL.revokeObjectURL(url);urls.clear();panel.remove();}
    window.addEventListener('pagehide',destroy,{once:true,signal:own.signal});
    return {destroy,stop};
}

if(typeof document!=='undefined'&&typeof window!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>mountPerformanceObserver(document,window),{once:true});
    else mountPerformanceObserver(document,window);
}
