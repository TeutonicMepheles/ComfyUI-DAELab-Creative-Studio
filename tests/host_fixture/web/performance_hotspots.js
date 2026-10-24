/** Test-only Long Animation Frame diagnostics. Mounting never starts observation.
 * API reference: https://w3c.github.io/long-animation-frames/
 * This observes browser attribution, not precise function self-time or causality.
 */
const TYPE='long-animation-frame';
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const clone=value=>JSON.parse(JSON.stringify(value));
const CODE_PREFIXES=['/assets/','/scripts/','/extensions/core/',
    '/extensions/ComfyUI-DAELab-Creative-Studio/','/extensions/ComfyUI-DAELab-Creative-Canvas/',
    '/extensions/ComfyUI-DAELab-Custom-Nodes-Library/','/extensions/creative_studio_test_fixture/'];

// Export only a bounded same-origin code path. Never export the original URL,
// invoker (which can contain DOM text/URLs), window, name, or arbitrary metadata.
export function restrictedScriptPath(value,origin){
    if(typeof value!=='string'||value.length>2048||typeof origin!=='string')return null;
    try{
        const url=new URL(value,origin);
        if(!['http:','https:'].includes(url.protocol)||url.origin!==new URL(origin).origin||url.username||url.password)return null;
        const path=url.pathname;
        if(path.length>320||!CODE_PREFIXES.some(prefix=>path.startsWith(prefix))||!/[.]m?js$/.test(path))return null;
        if(!path.split('/').slice(1).every(part=>/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,95}$/.test(part)&&!part.includes('..')))return null;
        return path.slice(1);
    }catch{return null;}
}
function scriptRecord(script,origin){
    const sourcePath=restrictedScriptPath(script.sourceURL,origin);
    const name=script.sourceFunctionName;
    return {startTime:number(script.startTime),duration:number(script.duration),executionStart:number(script.executionStart),
        forcedStyleAndLayoutDuration:number(script.forcedStyleAndLayoutDuration),
        forcedStyleDuration:number(script.forcedStyleDuration),forcedLayoutDuration:number(script.forcedLayoutDuration),
        sourcePath,sourceFunctionName:sourcePath&&typeof name==='string'&&/^[A-Za-z_$][A-Za-z0-9_$.]{0,119}$/.test(name)?name:null,
        sourceCharPosition:Number.isSafeInteger(script.sourceCharPosition)&&script.sourceCharPosition>=0?script.sourceCharPosition:null};
}
function frameRecord(entry,origin){
    const startTime=number(entry.startTime),duration=number(entry.duration),renderStart=number(entry.renderStart),styleAndLayoutStart=number(entry.styleAndLayoutStart);
    const end=startTime===null||duration===null?null:startTime+duration;
    const span=from=>end!==null&&from!==null&&from>0&&from>=startTime&&from<=end?end-from:null;
    const scripts=Array.isArray(entry.scripts)?entry.scripts.map(script=>scriptRecord(script,origin)):null;
    return {startTime,duration,renderStart,styleAndLayoutStart,blockingDuration:number(entry.blockingDuration),
        styleDuration:number(entry.styleDuration),layoutDuration:number(entry.layoutDuration),
        renderPhaseSpanMs:span(renderStart),styleLayoutToFrameEndSpanMs:span(styleAndLayoutStart),scripts};
}

/** Construction is inert; callers must explicitly start. Each instance owns its observer. */
export function createHotspotsObserver({PerformanceObserver,now=()=>performance.now(),origin,onUpdate=()=>{},maxFrames=2000,maxScripts=20000}={}){
    if(!Number.isSafeInteger(maxFrames)||maxFrames<1||!Number.isSafeInteger(maxScripts)||maxScripts<1)throw new Error('invalid-capacity');
    const reports=[];let active=false,current=null,observer=null,epoch=0,totalFrames=0,totalScripts=0;
    const time=()=>number(now());
    const notify=()=>{try{onUpdate({active,status:current?.status??'idle',frames:current?.frames.length??0,valid:current?.captureValid??null});}catch{/* Passive UI cannot affect host execution. */}};
    function finish(reason){
        active=false;current.endedAt??=time();current.status=reason;
        const owned=observer;observer=null;
        try{owned?.disconnect();}catch{current.captureValid=false;current.missing.push('observer-disconnect-failed');}
        notify();
    }
    function accept(entries,token,options){
        if(!active||token!==epoch)return;
        if(Number.isSafeInteger(options?.droppedEntriesCount)&&options.droppedEntriesCount>=0){
            current.browserDeliveryLossCount=(current.browserDeliveryLossCount??0)+options.droppedEntriesCount;
            if(options.droppedEntriesCount){current.captureValid=false;current.missing.push('browser-reported-dropped-entries');}
        }
        for(let index=0;index<entries.length;index++){
            const entry=entries[index];if(entry?.entryType!==TYPE)continue;
            const start=number(entry.startTime),duration=number(entry.duration);
            if(start!==null&&start<current.startedAt){current.excludedBoundaryFrames++;continue;}
            if(current.endedAt!==null&&start!==null&&duration!==null&&start+duration>current.endedAt){current.excludedBoundaryFrames++;continue;}
            const scriptCount=Array.isArray(entry.scripts)?entry.scripts.length:0;
            if(totalFrames>=maxFrames||totalScripts+scriptCount>maxScripts){
                current.captureValid=false;current.rejectedDeliveredEntries+=entries.length-index;
                current.missing.push('capacity-exceeded-no-further-collection');finish('capacity-exceeded');return;
            }
            const record=frameRecord(entry,origin);
            current.frames.push(record);totalFrames++;totalScripts+=scriptCount;
            if(start===null||duration===null){current.captureValid=false;current.missing.push('invalid-frame-timing');}
        }
        notify();
    }
    function start({explicit=false}={}){
        if(!explicit||active)return false;
        if(totalFrames>=maxFrames||totalScripts>=maxScripts)return false;
        current={kind:'long-animation-frame-diagnostic',epoch:++epoch,startedAt:time(),endedAt:null,status:'observing',captureValid:true,
            browserDeliveryLossCount:null,rejectedDeliveredEntries:0,excludedBoundaryFrames:0,frames:[],missing:[],productAcceptance:false,
            limitations:['Only delivered long-animation-frame entries beginning after Start and ending before Stop are collected; this is not an all-frame sample.',
                'Empty scripts do not prove zero JavaScript work. Browser attribution can omit short, cross-origin or opaque scripts.',
                'Script duration includes synchronous forced style/layout; do not add it to forcedStyleAndLayoutDuration as independent work.',
                'Render/style-to-frame-end spans include other work and are not exact Style/Layout/Paint durations or a root-cause proof.',
                'Missing browser fields are null. Delivery loss is unknown unless the browser reports it.',
                'Observer and UI overhead are present. This diagnostic does not replace the five-segment performance budget run.',
                'Only allowlisted same-origin relative script paths and short function identifiers are exported; no URL/query/body/invoker is retained.']};
        reports.push(current);
        if(typeof PerformanceObserver!=='function'||!PerformanceObserver.supportedEntryTypes?.includes(TYPE)){
            current.captureValid=false;current.missing.push('long-animation-frame-api-unavailable');finish('unsupported');return false;
        }
        const token=epoch;
        try{
            observer=new PerformanceObserver((list,_observer,options)=>{
                if(!active||token!==epoch)return;
                try{accept(list.getEntries(),token,options);}catch{current.captureValid=false;current.missing.push('entry-read-failed');finish('observation-error');}
            });
            active=true;observer.observe({type:TYPE,buffered:false});
        }catch{current.captureValid=false;current.missing.push('observer-subscription-failed');finish('unsupported');return false;}
        notify();return true;
    }
    function stop(reason='operator-stop'){
        if(!active)return;current.endedAt=time();
        try{accept(observer.takeRecords(),epoch);}catch{current.captureValid=false;current.missing.push('pending-record-drain-failed');}
        if(active)finish(reason);
    }
    return {start,stop,destroy:()=>stop('page-release'),get active(){return active;},
        resources:()=>({performanceObservers:observer?1:0}),
        report:()=>clone({schemaVersion:1,diagnosticOnly:true,productAcceptance:false,limits:{maxFrames,maxScripts},reports})};
}

/** The WEB_DIRECTORY module mounts this visible opt-in UI, never an active observer. */
export function mountHotspotsObserver(document,window){
    if(document.getElementById('studio-performance-hotspots'))return null;
    const make=(tag,text,parent)=>{const e=document.createElement(tag);e.textContent=text||'';parent?.append(e);return e;};
    const panel=make('details','',document.body);panel.id='studio-performance-hotspots';
    panel.style.cssText='position:fixed;left:8px;bottom:56px;z-index:2147483002;width:360px;max-height:65vh;overflow:auto;background:#182027;color:#eee;border:1px solid #71858f;padding:10px;font:12px/1.5 sans-serif';
    make('summary','缩放热点诊断（仅本页测试）',panel);
    make('p','可信点击开始后，仅观察浏览器长动画帧。请自行缩放；不会输入、保存、生成或更改图。此短诊断不能替代五段正式预算。',panel);
    make('p','脚本耗时含同步强制布局；Style/Layout 尾段也含其他渲染工作。空归因不代表零 JS，不据此断言精确根因。',panel);
    const status=make('output','未启用',panel);status.style.cssText='display:block;white-space:pre-wrap';
    const controls=make('div','',panel);controls.style.cssText='display:flex;gap:6px;flex-wrap:wrap';
    const button=label=>{const e=make('button',label,controls);e.type='button';return e;};
    const start=button('开始热点观测'),stop=button('停止并释放'),download=button('下载热点原始记录');stop.disabled=true;
    let disposed=false;
    const observer=createHotspotsObserver({PerformanceObserver:window.PerformanceObserver,now:()=>window.performance.now(),origin:window.location.origin,onUpdate:state=>{
        status.textContent=`${state.status} · ${state.frames} 个长帧 · ${state.valid===false?'记录缺失/不可判定':'仅诊断，不是验收'}`;
        start.disabled=state.active;stop.disabled=!state.active;
    }});
    start.onclick=event=>{if(!disposed&&event?.isTrusted&&!observer.start({explicit:true})&&observer.report().reports.length===0)status.textContent='尚未开始；能力或容量不可用。';};
    stop.onclick=event=>{if(!disposed&&event?.isTrusted)observer.stop();};
    download.onclick=event=>{
        if(disposed||!event?.isTrusted)return;
        if(observer.active){status.textContent='请先停止观测再下载。';return;}
        const blob=new Blob([JSON.stringify(observer.report(),null,2)],{type:'application/json'}),url=window.URL.createObjectURL(blob);
        try{const link=make('a','',panel);link.href=url;link.download='performance-hotspots-raw.json';link.click();link.remove();}finally{window.URL.revokeObjectURL(url);}
    };
    const abort=new AbortController();
    for(const type of ['pointerdown','keydown','dblclick','wheel'])panel.addEventListener(type,event=>event.stopPropagation(),{signal:abort.signal});
    function destroy(){if(disposed)return;disposed=true;observer.destroy();abort.abort();start.onclick=stop.onclick=download.onclick=null;panel.remove();}
    window.addEventListener('pagehide',destroy,{once:true,signal:abort.signal});
    return {destroy,stop:()=>observer.stop(),report:observer.report,resources:observer.resources};
}

if(typeof document!=='undefined'&&typeof window!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>mountHotspotsObserver(document,window),{once:true});
    else mountHotspotsObserver(document,window);
}
