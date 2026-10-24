/** Test-only controlled CSS experiment. Never imports host APIs or edits a workflow.
 * A frozen variable/handle deliberately differs from the product. No timing from
 * this module, or from a session while it is active, is product acceptance.
 */
const ROOT_ATTRIBUTE='data-studio-zoom-diagnostic';
const ROW_ATTRIBUTE='data-studio-zoom-diagnostic-row';
const VARIABLES=['--dae-canvas-zoom','--dae-canvas-inverse-zoom'];
const ROW_SELECTOR='.dae-table[data-structure] button.table-row-resize';
const leases=new WeakSet();let sequence=0;
const clone=value=>JSON.parse(JSON.stringify(value));
const inline=(element,property)=>({value:element.style.getPropertyValue(property),priority:element.style.getPropertyPriority(property),present:[...element.style].includes(property)});
const attribute=(element,name)=>({present:element.hasAttribute(name),value:element.getAttribute(name)});
function restoreAttribute(element,name,before,owned){
    if(element.getAttribute(name)!==owned)return false;
    if(before.present)element.setAttribute(name,before.value);else element.removeAttribute(name);
    return element.hasAttribute(name)===before.present&&element.getAttribute(name)===before.value;
}
function finite(value){const number=Number(value);if(!String(value).trim()||!Number.isFinite(number)||number<=0)throw new Error('invalid-geometry');return number;}

export function createZoomDiagnostic({document,getComputedStyle,MutationObserver,now=()=>performance.now(),onUpdate=()=>{},maxRuns=20,maxRows=2000}={}){
    const runs=[];let active=null,disposed=false;
    const notify=()=>{try{onUpdate({active:!!active,mode:active?.record.mode??null,runs:runs.length});}catch{/* Diagnostics must not affect product state. */}};
    function snapshot(root,rows){
        const style=root.isConnected?getComputedStyle(root):null;
        return {connected:root.isConnected,rootVariables:Object.fromEntries(VARIABLES.map(property=>[property,{inline:inline(root,property),computed:style?.getPropertyValue(property).trim()??null}])),
            rowCount:root.querySelectorAll(ROW_SELECTOR).length,
            rows:rows.map(({element},index)=>({index,connected:element.isConnected,inlineHeight:inline(element,'height'),computedHeight:element.isConnected?getComputedStyle(element).height:null}))};
    }
    function safeSnapshot(root,rows){try{return snapshot(root,rows);}catch{return null;}}
    function stop(reason='operator-restore'){
        if(!active)return false;
        const state=active;active=null;
        const {root,rows,style,observer,abort,record,token,rootAttribute}=state;
        record.beforeRestore=safeSnapshot(root,rows);
        observer.disconnect();abort.abort();style.remove();
        record.scopeRestored=restoreAttribute(root,ROOT_ATTRIBUTE,rootAttribute,token);
        record.rowScopesRestored=rows.map(row=>!row.token||restoreAttribute(row.element,ROW_ATTRIBUTE,row.attribute,row.token)).every(Boolean);
        leases.delete(root);
        record.restored=safeSnapshot(root,rows);record.endedAt=now();record.stopReason=reason;
        record.inlineUntouchedDuringRestore=!!record.beforeRestore&&!!record.restored&&VARIABLES.every(property=>
            JSON.stringify(record.beforeRestore.rootVariables[property].inline)===JSON.stringify(record.restored.rootVariables[property].inline))&&
            record.beforeRestore.rows.every((row,index)=>JSON.stringify(row.inlineHeight)===JSON.stringify(record.restored.rows[index].inlineHeight));
        record.returnedToStartingInline=!!record.restored&&VARIABLES.every(property=>JSON.stringify(record.original.rootVariables[property].inline)===JSON.stringify(record.restored.rootVariables[property].inline));
        const currentRows=[...root.querySelectorAll(ROW_SELECTOR)];
        record.sameRowsAtStop=!!record.restored&&currentRows.length===rows.length&&rows.every((row,index)=>currentRows[index]===row.element)&&record.restored.rows.every(row=>row.connected);
        record.overrideRemoved=!style.isConnected;
        notify();return true;
    }
    function start(root,mode,{explicit=false}={}){
        if(disposed||!explicit||active||leases.has(root)||runs.length>=maxRuns||!['root-variables','row-handles'].includes(mode))return false;
        if(!root?.isConnected||root.hidden||typeof MutationObserver!=='function')return false;
        let rows,original,css,token;
        try{
            rows=[...root.querySelectorAll(ROW_SELECTOR)].map(element=>({element,attribute:attribute(element,ROW_ATTRIBUTE)}));
            if(rows.length>maxRows||mode==='row-handles'&&!rows.length)return false;
            original=snapshot(root,rows);
            token='studio-zoom-'+(++sequence);
            const selector=`[${ROOT_ATTRIBUTE}="${token}"]`;
            if(mode==='root-variables')css=`${selector}{${VARIABLES.map(property=>`${property}:${finite(original.rootVariables[property].computed)}!important`).join(';')}}`;
            else css=rows.map((row,index)=>{
                const value=original.rows[index].computedHeight;
                if(!/^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)px$/.test(value))throw new Error('unsupported-height');
                finite(value.slice(0,-2));row.token=token+'-'+index;
                return `${selector} [${ROW_ATTRIBUTE}="${row.token}"]{height:${value}!important}`;
            }).join('\n');
        }catch{return false;}
        const style=document.createElement('style'),abort=new AbortController();
        const record={mode,startedAt:now(),endedAt:null,diagnosticOnly:true,productAcceptance:false,original,
            counts:{cards:root.querySelectorAll('.dae-creative-card').length,tables:root.querySelectorAll('.dae-table[data-structure]').length,contentCells:root.querySelectorAll('td[data-field]').length,descendants:root.querySelectorAll('*').length},
            override:{rootVariables:mode==='root-variables'?Object.fromEntries(VARIABLES.map(property=>[property,original.rootVariables[property].computed])):null,
                rowHeights:mode==='row-handles'?original.rows.map(row=>row.computedHeight):null},
            note:'Original inline values/priorities are captured but never changed. Product viewport writes remain authoritative; restoration removes only owned CSS/scope attributes.'};
        const rootAttribute=attribute(root,ROOT_ATTRIBUTE);
        let observer;
        try{observer=new MutationObserver(()=>{if(active?.root===root&&!root.isConnected)stop('canvas-detached');});}catch{return false;}
        active={root,rows,style,observer,abort,record,token,rootAttribute};leases.add(root);runs.push(record);
        try{
            root.setAttribute(ROOT_ATTRIBUTE,token);
            for(const row of rows)if(row.token)row.element.setAttribute(ROW_ATTRIBUTE,row.token);
            style.textContent=css;(document.head||document.body).append(style);
            if(!style.sheet?.cssRules?.length)throw new Error('stylesheet-unavailable');
            root.addEventListener('dae-canvas-hide',()=>stop('canvas-hidden'),{signal:abort.signal});
            // Canvas roots are body children. Do not observe thousands of table
            // descendants or add a polling/rAF load to the measured interval.
            observer.observe(document.body,{childList:true});
            record.applied=snapshot(root,rows);
            notify();return true;
        }catch{record.setupFailed=true;stop('setup-failed');return false;}
    }
    return {start,stop,destroy(){if(disposed)return;stop('fixture-release');disposed=true;},get active(){return !!active;},
        resources:()=>({styles:active?1:0,mutationObservers:active?1:0,canvasListeners:active?1:0}),
        report:()=>clone({schemaVersion:1,diagnosticOnly:true,productAcceptance:false,limits:{maxRuns,maxRows},runs,
            limitations:['Frozen root variables intentionally invalidate title/handle screen-size compensation. Use only zoom gestures, never editing acceptance.',
                'Frozen row heights intentionally change handle screen-size compensation while root variables still follow the native viewport.',
                'No performance is measured here. Pair each interval with a separate LoAF diagnostic, never a formal budget run.',
                'Use one fixed source/build/workflow/viewport and ten identical plus/minus pairs. Restore baseline between modes.',
                'If rows change, the root detaches, restoration conflicts, or starting inline values differ at the end, retain the record and label the comparison uncontrolled.']})};
}

export function mountZoomDiagnostic(document,window){
    if(document.getElementById('studio-performance-zoom-diagnostic'))return null;
    const make=(tag,text,parent)=>{const e=document.createElement(tag);e.textContent=text||'';parent?.append(e);return e;};
    const panel=make('details','',document.body);panel.id='studio-performance-zoom-diagnostic';
    panel.style.cssText='position:fixed;right:8px;bottom:56px;z-index:2147483003;width:370px;max-height:65vh;overflow:auto;background:#322513;color:#fff;border:2px solid #ffb347;padding:10px;font:12px/1.5 sans-serif';
    const summary=make('summary','缩放 CSS 对照（DIAGNOSTIC ONLY）',panel);
    make('p','仅做定位，不是产品性能或视觉验收。先固定同一来源/版本、S样例、50%倍率，预热5秒；每轮做10次“+再−”。顺序：基线→行柄冻结→恢复基线→根变量冻结→恢复基线。每轮单独开始/停止热点观测。',panel);
    make('p','只操作缩放；冻结根变量时标题补偿会故意失真。恢复只移除测试CSS，保留产品最新inline，不修改工作流。先停热点记录，再恢复并下载本状态记录。',panel);
    const status=make('output','未覆盖；产品样式保持原状',panel);status.style.cssText='display:block;white-space:pre-wrap';
    const controls=make('div','',panel);controls.style.cssText='display:flex;gap:6px;flex-wrap:wrap';
    const button=text=>{const e=make('button',text,controls);e.type='button';return e;};
    const row=button('仅冻结行柄高度'),root=button('冻结根缩放变量'),restore=button('恢复产品样式'),download=button('下载诊断状态');restore.disabled=true;
    let disposed=false;
    const controller=createZoomDiagnostic({document,getComputedStyle:element=>window.getComputedStyle(element),MutationObserver:window.MutationObserver,now:()=>window.performance.now(),onUpdate:state=>{
        row.disabled=root.disabled=state.active;restore.disabled=!state.active;
        summary.textContent=state.active?`DIAGNOSTIC ONLY — ${state.mode==='row-handles'?'行柄冻结':'根变量冻结'}，不得验收`:'缩放 CSS 对照（DIAGNOSTIC ONLY）';
        status.textContent=state.active?`测试覆盖已启用：${state.mode}。先停止热点记录再恢复。`:`测试覆盖已移除；共 ${state.runs} 次诊断。`;
    }});
    const begin=(event,mode)=>{
        if(disposed||!event?.isTrusted)return;
        const roots=[...document.querySelectorAll('.dae-creative')].filter(element=>element.isConnected&&!element.hidden);
        if(roots.length!==1||!controller.start(roots[0],mode,{explicit:true}))status.textContent='无法开始：需要唯一活动画布、未覆盖状态和可检查的几何。';
    };
    row.onclick=event=>begin(event,'row-handles');root.onclick=event=>begin(event,'root-variables');
    restore.onclick=event=>{if(!disposed&&event?.isTrusted)controller.stop();};
    download.onclick=event=>{
        if(disposed||!event?.isTrusted)return;
        if(controller.active){status.textContent='请先恢复产品样式再下载诊断状态。';return;}
        const blob=new Blob([JSON.stringify(controller.report(),null,2)],{type:'application/json'}),url=window.URL.createObjectURL(blob);
        try{const link=make('a','',panel);link.href=url;link.download='performance-zoom-diagnostic-state.json';link.click();link.remove();}finally{window.URL.revokeObjectURL(url);}
    };
    const abort=new AbortController();
    for(const event of ['pointerdown','keydown','dblclick','wheel'])panel.addEventListener(event,e=>e.stopPropagation(),{signal:abort.signal});
    function destroy(){if(disposed)return;disposed=true;controller.destroy();abort.abort();row.onclick=root.onclick=restore.onclick=download.onclick=null;panel.remove();}
    window.addEventListener('pagehide',destroy,{once:true,signal:abort.signal});
    return {destroy,report:controller.report,resources:controller.resources};
}

if(typeof document!=='undefined'&&typeof window!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>mountZoomDiagnostic(document,window),{once:true});
    else mountZoomDiagnostic(document,window);
}
