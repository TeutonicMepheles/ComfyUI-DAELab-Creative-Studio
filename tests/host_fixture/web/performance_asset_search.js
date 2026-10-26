/** Test-only semantic search observer. Import/construct/mount never sends a request. */
export const SEARCH_FIXTURE_SHA256='5854d91c89f51b78fb23704b349f611516b8f9584b0365e8b20e5209fae611bc';
export const ORDER_ORACLE_CONTRACT=Object.freeze({
    schemaVersion:1,kind:'studio-asset-search-order-v1',fixtureSha256:SEARCH_FIXTURE_SHA256,
    rows:'All 2000 {id,assetId,createdAt} rows, in actual API order; unique complete fixed-fixture identities.',
    collection:'In a separate owned empty catalog, explicitly import search-2000.json through the product UI. With writes quiescent, collect standard GET favorites?q=&limit=48&offset=0,48,...,1968. Verify each page total=2000, limit=48, offset, hasMore and each row against the fixed text fixture. Preserve every raw page/hash, collection time and build identity separately. Concatenate rows without sorting, re-query first/last pages to reject changes. This observer never performs collection/import.',
    limitation:'The legacy fixture contains no server creation times. Without this separately fixed full order, queries with more than48 matches cannot get a semantic completion measurement.',
});
const PATHS=new Set(['/daelab/studio/asset-library/favorites','/api/daelab/studio/asset-library/favorites']);
const clone=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const asciiFold=value=>value.replace(/[A-Z]/g,c=>c.toLowerCase());
const utf8=value=>new TextEncoder().encode(value);
const hex=value=>[...new Uint8Array(value)].map(x=>x.toString(16).padStart(2,'0')).join('');
async function uuid5(name,crypto){
    const namespace=Uint8Array.from('6ba7b8119dad11d180b400c04fd430c8'.match(/../g),x=>parseInt(x,16));
    const text=utf8(name),data=new Uint8Array(namespace.length+text.length);data.set(namespace);data.set(text,namespace.length);
    const bytes=new Uint8Array(await crypto.subtle.digest('SHA-1',data)).slice(0,16);bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
    const h=hex(bytes);return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

/** Uses public fixed text contents and documented stable IDs, never a response as its own oracle. */
export async function buildAssetSearchOracle(bytes,{crypto=globalThis.crypto,orderBytes=null}={}){
    const fixtureSha256=hex(await crypto.subtle.digest('SHA-256',bytes));
    check(fixtureSha256===SEARCH_FIXTURE_SHA256,'fixed-search-2000-fixture-hash-mismatch');
    const fixture=JSON.parse(new TextDecoder().decode(bytes)),input=fixture.document?.entries;
    check(fixture.document?.version===1&&input?.length===2000,'fixed-fixture-schema-mismatch');
    const rows=await Promise.all(input.map(async entry=>{
        check(entry.kind==='text'&&typeof entry.name==='string'&&typeof entry.text==='string','text-fixture-required');
        const digest=hex(await crypto.subtle.digest('SHA-256',utf8(entry.text)));
        const assetId=await uuid5('creative-studio:asset:text:'+digest,crypto);
        return {id:await uuid5('creative-studio:favorite:'+assetId,crypto),assetId,name:entry.name,text:entry.text,kind:'text'};
    }));
    const byId=new Map(rows.map(row=>[row.id,row]));check(byId.size===2000,'duplicate-fixed-identities');
    let order=null,orderSha256=null;
    if(orderBytes){
        const supplied=JSON.parse(new TextDecoder().decode(orderBytes));
        check(supplied.schemaVersion===1&&supplied.kind===ORDER_ORACLE_CONTRACT.kind&&supplied.fixtureSha256===fixtureSha256,'order-oracle-binding-mismatch');
        check(Array.isArray(supplied.rows)&&supplied.rows.length===rows.length&&new Set(supplied.rows.map(row=>row.id)).size===rows.length,'incomplete-order-oracle');
        for(let i=0;i<supplied.rows.length;i++){
            const row=supplied.rows[i],previous=supplied.rows[i-1];
            check(byId.get(row.id)?.assetId===row.assetId&&typeof row.createdAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?\+00:00$/.test(row.createdAt),'order-identity-or-time-invalid');
            check(!previous||previous.createdAt>row.createdAt||previous.createdAt===row.createdAt&&previous.id<row.id,'order-not-created-desc-id-asc');
        }
        order=supplied.rows.map(row=>row.id);orderSha256=hex(await crypto.subtle.digest('SHA-256',orderBytes));
    }
    return {fixtureSha256,orderSha256,size:rows.length,rows,byId,order};
}

export function validateSearchResponse(oracle,query,body){
    const eligible=oracle.rows.filter(row=>(query.kind==='all'||query.kind===row.kind)&&[row.name,row.text].some(value=>asciiFold(value).includes(asciiFold(query.q))));
    const ids=new Set(eligible.map(row=>row.id)),count=Math.min(48,Math.max(0,ids.size-query.offset));
    check(body?.schemaVersion===1&&body.limit===48&&body.offset===query.offset&&body.total===ids.size
        &&body.hasMore===(query.offset+count<ids.size)&&Array.isArray(body.entries)&&body.entries.length===count,'response-schema-total-or-pagination-mismatch');
    const actual=body.entries.map(row=>row.id);check(new Set(actual).size===actual.length,'duplicate-response-identities');
    for(let i=0;i<body.entries.length;i++){
        const row=body.entries[i],known=oracle.byId.get(row.id),previous=body.entries[i-1];
        check(ids.has(row.id)&&known&&['assetId','name','text','kind'].every(key=>row[key]===known[key]),'response-does-not-match-fixed-fixture');
        check(typeof row.createdAt==='string'&&/^\d{4}-\d\d-\d\dT/.test(row.createdAt),'response-creation-time-missing');
        check(!previous||previous.createdAt>row.createdAt||previous.createdAt===row.createdAt&&previous.id<row.id,'response-order-invalid');
    }
    if(oracle.order){
        const expected=oracle.order.filter(id=>ids.has(id)).slice(query.offset,query.offset+48);
        check(same(actual,expected),'response-fixed-page-order-mismatch');
    }else if(ids.size>48||query.offset!==0){
        return {status:'oracle-order-unavailable',ids:actual,total:ids.size,offset:query.offset,hasMore:body.hasMore};
    }else check(actual.length===ids.size&&actual.every(id=>ids.has(id)),'response-result-set-mismatch');
    return {status:'validated',ids:actual,total:ids.size,offset:query.offset,hasMore:body.hasMore};
}

// One observer per Window. Exact Promise/Response/this/args/rejection are preserved.
const fetchOwners=new WeakMap();
function notify(cell,phase,value){try{cell.notify?.(phase,value);}catch{/* Diagnostics cannot change product behavior. */}}
function tapPromise(promise,cell){
    try{Promise.prototype.then.call(promise,response=>{
        notify(cell,'headers',response.status);
        if(!cell.notify)return;
        try{const copy=response.clone();Promise.prototype.then.call(copy.json(),body=>notify(cell,'body',body),()=>notify(cell,'body-error'));}
        catch{notify(cell,'body-error');}
    },error=>notify(cell,'rejected',error?.name==='AbortError'?'AbortError':'request-error'));}
    catch{notify(cell,'unobservable-promise');}
}
function leaseFetch(window,onCall){
    check(!fetchOwners.has(window),'another-search-observer-is-active');
    const original=window.fetch,descriptor=Object.getOwnPropertyDescriptor(window,'fetch'),holder={onCall},cells=new Set();
    check(typeof original==='function','standard-fetch-unavailable');
    const wrapper=function(...args){
        let cell;try{const callback=holder.onCall?.(args);if(callback){cell={notify:callback};cells.add(cell);}}catch{/* No host behavior changes. */}
        let result;try{result=Reflect.apply(original,this,args);}catch(error){if(cell)notify(cell,'rejected',error?.name==='AbortError'?'AbortError':'request-error');throw error;}
        if(cell)tapPromise(result,cell);return result;
    };
    Object.defineProperty(window,'fetch',descriptor?{...descriptor,value:wrapper}:{configurable:true,writable:true,value:wrapper});
    fetchOwners.set(window,wrapper);
    return ()=>{
        holder.onCall=null;for(const cell of cells)cell.notify=null;cells.clear();
        try{if(window.fetch===wrapper){if(descriptor)Object.defineProperty(window,'fetch',descriptor);else delete window.fetch;}}
        finally{if(fetchOwners.get(window)===wrapper)fetchOwners.delete(window);}
    };
}

const selector={drawer:'.dae-library-drawer',search:'input.dae-library-search[type="search"]',grid:'.dae-library-grid',count:'.dae-library-header .dae-library-muted',filter:'.dae-library-filters [aria-pressed="true"]'};
function pageButtons(drawer){const buttons=[...drawer.querySelectorAll('.dae-library-footer button')];return {previous:buttons.find(b=>b.textContent.trim()==='上一页'),next:buttons.find(b=>b.textContent.trim()==='下一页')};}
const overlap=(a,b)=>a.width>0&&a.height>0&&a.right>b.left&&a.left<b.right&&a.bottom>b.top&&a.top<b.bottom;
function paintable(element,window){
    if(!element?.isConnected)return false;
    for(let node=element;node&&node.nodeType!==9;node=node.parentElement){
        if(node.hidden)return false;const style=window.getComputedStyle(node);
        if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0)return false;
    }
    return true;
}
function shown(element,window){
    return paintable(element,window)&&overlap(element.getBoundingClientRect(),{left:0,top:0,right:window.innerWidth,bottom:window.innerHeight});
}
const elements=node=>[...(node?.children||[])].filter(child=>child.nodeType===1);
const tree=node=>[node,...elements(node).flatMap(tree)];
const resultRoot=node=>node?.nodeType===1&&(node.matches('.dae-library-tile')||node.matches('.dae-library-empty'));
const tag=(node,name)=>node?.tagName?.toLowerCase()===name;
function currentView(view){
    return !view.invalidated&&view.drawer.isConnected&&view.search?.isConnected&&view.grid?.isConnected
        &&view.drawer.querySelector(selector.search)===view.search&&view.drawer.querySelector(selector.grid)===view.grid;
}
function inspectDOM(view,expected,window,oracle){
    const {drawer,search,grid}=view;
    if(!currentView(view)||!shown(drawer,window)||!shown(grid,window)||search.value.trim()!==view.current.query.q)return null;
    const filter=drawer.querySelector(selector.filter)?.dataset.filter||'all';if(filter!==view.current.query.kind)return null;
    const buttons=pageButtons(drawer),count=drawer.querySelector(selector.count);
    const label=expected.total?`${expected.total} 项 · ${expected.offset+1}–${expected.offset+expected.ids.length}`:'0 项';
    if(count?.textContent!==label||buttons.previous?.disabled!==(expected.offset===0)||buttons.next?.disabled!==!expected.hasMore)return null;
    const nodes=[...grid.querySelectorAll('[data-asset-id]')],ids=nodes.map(node=>node.dataset.assetId);
    if(!same(ids,expected.ids))return null;
    const roots=elements(grid),generation=view.render;
    if(generation?.record!==view.current||roots.length!==(ids.length||1)
        ||roots.some(root=>!resultRoot(root)||!generation.added.has(root)||tree(root).some(node=>generation.before.has(node))))return null;
    for(let i=0;i<nodes.length;i++){
        const thumb=nodes[i],tile=roots[i],known=oracle.byId.get(ids[i]),[actualThumb,line]=elements(tile);
        const [text]=elements(thumb),[label,remove]=elements(line);
        if(!known||!tag(tile,'article')||!tile.matches('.dae-library-tile')||actualThumb!==thumb||elements(tile).length!==2
            ||!tag(thumb,'button')||!thumb.matches('.dae-library-thumb')||elements(thumb).length!==1||!text?.matches('.dae-library-text')
            ||text.textContent!==known.text||!paintable(text,window)||!line?.matches('.dae-library-tile-label')
            ||elements(line).length!==2||!tag(label,'span')||label.textContent!==known.name||!paintable(label,window)
            ||!tag(remove,'button')||remove.dataset.removeId!==ids[i])return null;
    }
    if(!ids.length){
        const empty=roots[0],title=elements(empty).find(node=>tag(node,'strong')),hint=elements(empty).find(node=>tag(node,'span'));
        if(!empty.matches('.dae-library-empty')||title?.textContent!=='把常用素材留在这里'||hint?.textContent!=='点击素材上的收藏按钮，即可跨工作流复用'
            ||!paintable(title,window)||!paintable(hint,window))return null;
    }
    const gridRect=grid.getBoundingClientRect(),screen={left:0,top:0,right:window.innerWidth,bottom:window.innerHeight};
    const viewportVisibleIds=nodes.filter(node=>{const r=node.getBoundingClientRect();return shown(node,window)&&overlap(r,gridRect)&&overlap(r,screen);}).map(node=>node.dataset.assetId);
    if(ids.length&&!viewportVisibleIds.length||!ids.length&&!shown(grid.querySelector('.dae-library-empty'),window))return null;
    return {renderedPageIds:ids,renderedPageCount:ids.length,viewportVisibleIds,viewportVisibleCount:viewportVisibleIds.length,countText:label,offset:expected.offset,total:expected.total,displayFieldsValidated:true,newResultSubtreeValidated:true};
}

export function createAssetSearchObserver({document,window,oracle,onUpdate=()=>{},timeoutMs=5000,maxRecords=2000}={}){
    const histories=[],views=new Map();let active=false,current=null,context=null,epoch=0,nextView=0,nextRecord=0,releaseFetch=null,observer=null;
    const listeners=[],timers=new Set(),rafs=new Set();const now=()=>window.performance.now();
    const emit=()=>{try{onUpdate({active,status:current?.status||'idle',records:current?.records.length||0});}catch{}};
    const pending=record=>active&&record?.status==='pending';
    function finish(record,status,detail={}){
        if(!pending(record))return;
        Object.assign(record,{status,endedAt:now(),...detail});
        if(record.timer!=null){window.clearTimeout(record.timer);timers.delete(record.timer);delete record.timer;}
        const view=views.get(record.viewId);if(view?.raf!=null){window.cancelAnimationFrame(view.raf);rafs.delete(view.raf);view.raf=null;}
        if(view?.current===record)view.render=null;
        emit();
    }
    function add(type,target,listener,capture=false){target.addEventListener(type,listener,capture);listeners.push(()=>target.removeEventListener(type,listener,capture));}
    function viewFor(drawer){
        let view=[...views.values()].find(v=>v.drawer===drawer&&!v.invalidated);
        if(view&&!currentView(view)){invalidate(view);view=null;}
        if(!view){view={id:++nextView,drawer,search:drawer.querySelector(selector.search),grid:drawer.querySelector(selector.grid),epoch:0,current:null,gridCommit:0,gridCommittedAt:null,raf:null,render:null,invalidated:false};views.set(view.id,view);}
        return view;
    }
    function invalidate(view){view.invalidated=true;if(view.current)finish(view.current,'view-identity-lost');}
    function recordInput(event){
        const input=event.target?.closest?.(selector.search),drawer=input?.closest(selector.drawer);
        if(!drawer)return;
        const view=viewFor(drawer);
        if(!event.isTrusted){if(view.current)finish(view.current,'untrusted-interference');return;}
        begin(view,event,'input',{q:input.value.trim(),kind:drawer.querySelector(selector.filter)?.dataset.filter||'all',offset:0,limit:48});
    }
    function recordClick(event){
        if(!event.isTrusted)return;const button=event.target?.closest?.('button'),drawer=button?.closest(selector.drawer);if(!drawer)return;
        const view=viewFor(drawer),buttons=pageButtons(drawer);let query=null,kind='';
        if(button.dataset.filter){query={q:view.search.value.trim(),kind:button.dataset.filter,offset:0,limit:48};kind='filter';}
        else if(button===buttons.previous||button===buttons.next){
            const text=drawer.querySelector(selector.count)?.textContent||'',match=/^\d+ 项 · (\d+)–\d+$/.exec(text);
            if(!match||button.disabled)return;query={q:view.search.value.trim(),kind:drawer.querySelector(selector.filter)?.dataset.filter||'all',offset:Math.max(0,Number(match[1])-1+(button===buttons.next?48:-48)),limit:48};kind='page';
        }
        if(query)begin(view,event,kind,query);
    }
    function begin(view,event,kind,query){
        if(!active||!currentView(view)||!shown(view.drawer,window))return;
        if(current.records.length>=maxRecords){stop('capacity-stop');return;}
        if(view.current)finish(view.current,'superseded',{stale:true});
        const capturedAt=now(),eventTime=event.timeStamp,validClock=Number.isFinite(eventTime)&&eventTime>=0&&eventTime<=capturedAt+1;
        const record={id:++nextRecord,observerEpoch:epoch,viewId:view.id,viewEpoch:++view.epoch,kind,clear:kind==='input'&&!query.q,
            query,startedAt:validClock?eventTime:capturedAt,capturedAt,eventTimeStamp:validClock?eventTime:null,isComposing:!!event.isComposing,
            timingBasis:validClock?'trusted-event-timeStamp-relative-to-performance-origin':'unsupported-event-clock',
            status:'pending',durationMs:null,request:null,response:null,dom:null,gridCommitBefore:view.gridCommit};
        current.records.push(record);view.current=record;
        if(!validClock){finish(record,'unsupported-event-clock');return;}
        const timer=window.setTimeout(()=>finish(record,'timeout',{missing:record.response?'matching-visible-dom-and-paint':'correlated-valid-response'}),timeoutMs);record.timer=timer;timers.add(timer);
        // UA dispatch can checkpoint microtasks between capture and the target
        // listener. The actual Event remains in a dispatch phase through both;
        // after dispatch eventPhase is NONE, so deferred calls cannot bind.
        context={view,record,event};emit();
    }
    function onFetch(args){
        if(!active)return;
        let url,method;try{url=new URL(typeof args[0]==='string'?args[0]:args[0]?.url||args[0]?.href,window.location.href);method=args[1]?.method||args[0]?.method||'GET';}catch{return;}
        if(url.origin!==window.location.origin||!PATHS.has(url.pathname)||String(method).toUpperCase()!=='GET')return;
        const token=context,record=token?.record;
        if(!pending(record)||![1,2,3].includes(token.event.eventPhase)){current.unboundRequests++;return;}
        if(!currentView(token.view)){invalidate(token.view);return;}
        if(record.request){finish(record,'ambiguous-multiple-requests');return;}
        const params=url.searchParams,query={q:params.get('q')||'',kind:params.get('kind')||'all',offset:Number(params.get('offset')),limit:Number(params.get('limit'))};
        const known=['q','kind','offset','limit'];
        if([...params.keys()].some(key=>!known.includes(key))||known.some(key=>params.getAll(key).length>1)||!same(query,record.query)){finish(record,'request-query-mismatch');return;}
        record.request={at:now(),path:url.pathname,...query};
        return (phase,value)=>{
            if(!active||record.observerEpoch!==epoch)return;
            if(!pending(record)){current.lateResponses.push({recordId:record.id,viewId:record.viewId,phase,at:now(),status:record.status});return;}
            if(phase==='headers'){
                // Drain pre-response DOM records before freezing the causal
                // sequence. Equal/coarsened timestamps must not admit an old render.
                const previous=observer?.takeRecords()||[];if(previous.length)mutations(previous);
                if(!pending(record))return;
                if(!currentView(token.view)){invalidate(token.view);return;}
                record.headersAt=now();record.headersGridCommit=token.view.gridCommit;record.httpStatus=value;
                token.view.render={record,before:new Set(elements(token.view.grid).flatMap(tree)),added:new Set()};
                if(value!==200)finish(record,'http-error');return;
            }
            if(phase!=='body'){finish(record,phase==='rejected'&&value==='AbortError'?'aborted':phase);return;}
            try{
                const valid=validateSearchResponse(oracle,record.query,value);
                record.response={...valid,receivedAt:now(),httpStatus:record.httpStatus};
                if(valid.status!=='validated'){finish(record,valid.status);return;}
                checkDOM(token.view);
            }catch(error){finish(record,'response-mismatch',{reason:error.message});}
        };
    }
    function checkDOM(view,frame=0){
        const record=view.current;if(!pending(record)||!record.response)return;
        if(!view.drawer.isConnected){finish(record,'view-detached');return;}
        if(!currentView(view)){invalidate(view);return;}
        if(document.visibilityState!=='visible'){finish(record,'page-hidden');return;}
        if(view.gridCommit<=record.gridCommitBefore||view.gridCommit<=record.headersGridCommit||view.gridCommittedAt<record.headersAt)return;
        const start=now(),dom=inspectDOM(view,record.response,window,oracle);record.observerCostMs=(record.observerCostMs||0)+now()-start;
        if(!dom){if(view.raf!=null){window.cancelAnimationFrame(view.raf);rafs.delete(view.raf);view.raf=null;}return;}
        if(frame===2){record.dom=dom;finish(record,'complete',{durationMs:now()-record.startedAt,paintOpportunityAt:now(),paintBoundary:'Two successive visible rAF callbacks after matching response + direct grid render mutation; physical display time unmeasured.'});return;}
        if(view.raf!=null)return;
        if(frame===0)record.domMatchedAt=now();
        const raf=window.requestAnimationFrame(()=>{rafs.delete(raf);view.raf=null;if(view.current===record)checkDOM(view,frame+1);});view.raf=raf;rafs.add(raf);
    }
    function mutations(records){
        for(const view of views.values()){
            if(!pending(view.current))continue;
            if(!view.drawer.isConnected){finish(view.current,'view-detached');continue;}
            const removed=records.some(row=>row.type==='childList'&&[...(row.removedNodes||[])].some(node=>[view.drawer,view.search,view.grid].some(owned=>node===owned||node.contains?.(owned))));
            if(removed||!currentView(view)){invalidate(view);continue;}
            for(const row of records)if(row.type==='childList'&&row.target===view.grid){
                const added=[...(row.addedNodes||[])].filter(resultRoot),removedResults=[...(row.removedNodes||[])].filter(resultRoot);
                if(added.length||removedResults.length){view.gridCommit++;view.gridCommittedAt=now();}
                if(view.render?.record===view.current)for(const root of added)if(!view.render.before.has(root))view.render.added.add(root);
            }
            if(records.some(row=>view.drawer.contains(row.target)))checkDOM(view);
        }
    }
    function start({explicit=false,buildFingerprint=''}={}){
        if(!explicit||active)return false;
        check(oracle?.fixtureSha256===SEARCH_FIXTURE_SHA256&&oracle.size===2000,'load-fixed-2000-oracle-first');
        check(/^[a-f0-9]{64}$/.test(buildFingerprint),'build-fingerprint-required');
        check(document.visibilityState==='visible','visible-page-required');
        current={schemaVersion:1,kind:'semantic-asset-search-observation',epoch:++epoch,status:'observing',startedAt:now(),endedAt:null,
            fixtureSha256:oracle.fixtureSha256,orderSha256:oracle.orderSha256,buildFingerprint,buildIdentity:'operator-supplied-not-runtime-attestation',
            environment:{dpr:window.devicePixelRatio??null,viewport:{width:window.innerWidth,height:window.innerHeight}},
            records:[],lateResponses:[],unboundRequests:0,productAcceptance:false,
            limitations:['Captures only fetch synchronously initiated by the trusted search/filter/page handler; delayed/debounced/unbound calls are not guessed.',
                'Response oracle validation and visible DOM verification are separate; arbitrary mutations/frames cannot complete a sample.',
                'All rendered page IDs and the viewport-visible subset are recorded separately; a page of48 need not have48 on-screen tiles.',
                'Two rAF callbacks establish a paint opportunity, not physical display/photons. Hidden pages cannot complete.',
                'Response.clone parsing, mutation checks and geometry reads add observer overhead; no automatic requests/input/graph access.',
                'Only same-origin fixed favorites endpoint is observed; headers/cookies/credentials and response bodies are not exported.']};
        histories.push(current);
        try{
            releaseFetch=leaseFetch(window,onFetch);active=true;
            add('input',document,recordInput,true);add('click',document,recordClick,true);
            add('visibilitychange',document,()=>{if(document.visibilityState!=='visible')stop('page-hidden');});
            add('pagehide',window,()=>stop('page-release'));
            observer=new window.MutationObserver(mutations);observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','disabled','aria-pressed','class','style']});
        }catch(error){current.failure=error.message;stop('start-failed');throw error;}
        emit();return true;
    }
    function stop(reason='operator-stop'){
        if(!current||current.status!=='observing')return;
        try{for(const view of views.values())if(pending(view.current))finish(view.current,reason);}
        finally{
            active=false;context=null;observer?.disconnect();observer=null;
            for(const release of listeners.splice(0))release();for(const timer of timers)window.clearTimeout(timer);timers.clear();
            for(const raf of rafs)window.cancelAnimationFrame(raf);rafs.clear();views.clear();
            try{releaseFetch?.();}finally{releaseFetch=null;current.status=reason;current.endedAt=now();emit();}
        }
    }
    return {start,stop,destroy:()=>stop('destroyed'),get active(){return active;},
        report:()=>clone({schemaVersion:1,productAcceptance:false,reports:histories}),
        resources:()=>({fetchLeases:releaseFetch?1:0,listeners:listeners.length,mutationObservers:observer?1:0,timers:timers.size,raf:rafs.size,views:views.size})};
}

export function mountAssetSearchPerformanceObserver(document,window){
    if(document.getElementById('studio-asset-search-observer'))return null;
    const make=(tag,text,parent)=>{const e=document.createElement(tag);e.textContent=text||'';parent?.append(e);return e;};
    const panel=make('details','',document.body);panel.id='studio-asset-search-observer';panel.style.cssText='position:fixed;right:8px;top:160px;z-index:2147483004;width:350px;max-height:65vh;overflow:auto;background:#182027;color:#eee;padding:10px;border:1px solid #71858f;font:12px/1.5 sans-serif';
    make('summary','资产搜索语义观测（仅测试）',panel);
    make('p','加载固定2000收藏和可选完整排序oracle；开始后在真实资产库输入、清空或翻页。本面板不导入收藏、不搜索、不派发输入。多于48项缺排序oracle时不记录完成时延。',panel);
    const field=(label,type)=>{const row=make('label',label+' ',panel),input=make('input','',row);input.type=type;row.style.display='block';return input;};
    const fixture=field('search-2000.json','file'),order=field('排序oracle（格式见下）','file'),build=field('固定构建SHA256','text');fixture.accept=order.accept='.json';build.maxLength=64;
    const schema=make('details','',panel);make('summary','排序oracle合同与采集说明',schema);make('pre',JSON.stringify(ORDER_ORACLE_CONTRACT,null,2),schema).style.whiteSpace='pre-wrap';
    const status=make('output','未加载；未观测',panel);status.style.display='block';
    const start=make('button','开始搜索观测',panel),stop=make('button','停止并释放',panel),download=make('button','下载搜索原始报告',panel);for(const button of [start,stop,download])button.type='button';stop.disabled=true;
    let observer=null,disposed=false,loadEpoch=0,loaded=null;const reports=[];
    async function load(event){
        if(!event.isTrusted||disposed||observer?.active)return;const token=++loadEpoch;loaded=null;
        try{const file=fixture.files?.[0];if(!file)return;check(file.size<=4*1024*1024,'fixture-too-large');const sorted=order.files?.[0];check(!sorted||sorted.size<=4*1024*1024,'order-too-large');
            const value=await buildAssetSearchOracle(await file.arrayBuffer(),{crypto:window.crypto,orderBytes:sorted?await sorted.arrayBuffer():null});
            if(!disposed&&token===loadEpoch){loaded=value;status.textContent=`已固定2000项；排序${value.order?'完整':'缺失（>48匹配不计完成）'}；未发送请求。`;}
        }catch(error){if(!disposed&&token===loadEpoch)status.textContent=error.message;}
    }
    fixture.onchange=order.onchange=load;
    start.onclick=event=>{if(disposed||!event.isTrusted||observer?.active)return;
        try{check(loaded,'load-fixed-fixture-first');stopOwned();observer=createAssetSearchObserver({document,window,oracle:loaded,onUpdate:value=>{status.textContent=`${value.status} · ${value.records}条；不是验收结论`;start.disabled=value.active;stop.disabled=!value.active;}});observer.start({explicit:true,buildFingerprint:build.value.trim()});fixture.disabled=order.disabled=build.disabled=true;}
        catch(error){observer?.destroy();if(observer)reports.push(...observer.report().reports);observer=null;status.textContent=error.message;}
    };
    function stopOwned(){if(observer){observer.stop();reports.push(...observer.report().reports);observer.destroy();observer=null;}fixture.disabled=order.disabled=build.disabled=false;start.disabled=false;stop.disabled=true;}
    stop.onclick=event=>{if(!disposed&&event.isTrusted)stopOwned();};
    download.onclick=event=>{if(disposed||!event.isTrusted)return;if(observer?.active){status.textContent='先停止再下载。';return;}stopOwned();
        const url=window.URL.createObjectURL(new Blob([JSON.stringify({schemaVersion:1,productAcceptance:false,oracleContract:ORDER_ORACLE_CONTRACT,reports},null,2)],{type:'application/json'}));
        try{const a=make('a','',panel);a.href=url;a.download='performance-asset-search-raw.json';a.click();a.remove();}finally{window.URL.revokeObjectURL(url);}
    };
    const abort=new AbortController();for(const type of ['pointerdown','keydown','dblclick','wheel'])panel.addEventListener(type,event=>event.stopPropagation(),{signal:abort.signal});
    function destroy(){if(disposed)return;disposed=true;++loadEpoch;try{stopOwned();}finally{abort.abort();fixture.onchange=order.onchange=start.onclick=stop.onclick=download.onclick=null;loaded=null;panel.remove();}}
    window.addEventListener('pagehide',destroy,{once:true,signal:abort.signal});
    return {destroy,stop:stopOwned,report:()=>clone({schemaVersion:1,productAcceptance:false,reports:[...reports,...(observer?.report().reports||[])]}),resources:()=>observer?.resources()||{fetchLeases:0,listeners:0,mutationObservers:0,timers:0,raf:0,views:0}};
}
