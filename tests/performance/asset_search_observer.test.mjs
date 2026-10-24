import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {buildAssetSearchOracle,validateSearchResponse,createAssetSearchObserver,mountAssetSearchPerformanceObserver,SEARCH_FIXTURE_SHA256} from '../host_fixture/web/performance_asset_search.js';

const bytes=readFileSync(new URL('../fixtures/asset-library/search-2000.json',import.meta.url));
const base=await buildAssetSearchOracle(bytes,{crypto:webcrypto});
const orderedRows=base.rows.map((row,index)=>({id:row.id,assetId:row.assetId,createdAt:`2026-10-25T00:00:00.${String(index).padStart(6,'0')}+00:00`})).reverse();
const orderBytes=Buffer.from(JSON.stringify({schemaVersion:1,kind:'studio-asset-search-order-v1',fixtureSha256:SEARCH_FIXTURE_SHA256,rows:orderedRows}));
const oracle=await buildAssetSearchOracle(bytes,{crypto:webcrypto,orderBytes});
const query=(q,offset=0,kind='all')=>({q,kind,offset,limit:48});
function page(q,offset=0,kind='all'){
    const ids=orderedRows.filter(row=>{const source=base.byId.get(row.id);return (kind==='all'||kind==='text')&&(source.name.includes(q)||source.text.includes(q));});
    return {schemaVersion:1,limit:48,offset,total:ids.length,hasMore:offset+48<ids.length,entries:ids.slice(offset,offset+48).map(row=>({...base.byId.get(row.id),createdAt:row.createdAt}))};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
class Target{
    listeners=new Map();
    addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback);}
    removeEventListener(name,callback){this.listeners.get(name)?.delete(callback);}
    emit(name,event={}){
        const implicit=event.eventPhase===undefined;
        if(implicit)event.eventPhase=1;
        for(const callback of [...this.listeners.get(name)||[]])callback(event);
        // Most tests append the real target handler synchronously after capture.
        // Explicit eventPhase is used below to model a UA checkpoint mid-dispatch.
        if(implicit)queueMicrotask(()=>{event.eventPhase=0;});
    }
}
class Element extends Target{
    constructor(tag='div',className=''){super();this.tagName=tag;this.className=className;this.children=[];this.style={};this.dataset={};this.textContent='';this.hidden=false;this.disabled=false;this.isConnected=true;this.value='';this.nodeType=1;this.rect={left:10,top:10,right:110,bottom:110,width:100,height:100};}
    append(...nodes){for(const node of nodes){node.parentElement=this;node.connection(this.isConnected);this.children.push(node);}}
    connection(value){this.isConnected=value;for(const child of this.children)child.connection(value);}
    remove(){this.connection(false);if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null;}
    contains(node){for(let n=node;n;n=n.parentElement)if(n===this)return true;return false;}
    getBoundingClientRect(){return this.rect;}
    matches(selector){
        if(selector==='button')return this.tagName==='button';
        if(selector==='input.dae-library-search[type="search"]')return this.tagName==='input'&&this.className==='dae-library-search'&&this.type==='search';
        if(selector==='[data-asset-id]')return !!this.dataset.assetId;
        if(selector==='[aria-pressed="true"]')return this.pressed===true;
        return selector.startsWith('.')&&this.className.split(' ').includes(selector.slice(1));
    }
    closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
    querySelectorAll(selector){
        const split=selector.indexOf(' ');
        if(split!==-1){const parent=selector.slice(0,split),rest=selector.slice(split+1);return this.querySelectorAll(parent).flatMap(node=>node.querySelectorAll(rest));}
        return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);
    }
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    click(){this.clicked=true;}
}
function environment(){
    let time=0,next=0;const timers=new Map(),rafs=new Map(),calls=[],observers=[],elements=[];
    const document=Object.assign(new Target(),{visibilityState:'visible',body:new Element('body'),getElementById:()=>null,createElement:tag=>{const element=new Element(tag);elements.push(element);return element;}});
    const window=Object.assign(new Target(),{innerWidth:1920,innerHeight:1080,devicePixelRatio:1,location:{origin:'http://127.0.0.1:8226',href:'http://127.0.0.1:8226/'},
        crypto:webcrypto,performance:{now:()=>time},queueMicrotask,
        setTimeout(callback){const id=++next;timers.set(id,callback);return id;},clearTimeout(id){timers.delete(id);},
        requestAnimationFrame(callback){const id=++next;rafs.set(id,callback);return id;},cancelAnimationFrame(id){rafs.delete(id);},
        getComputedStyle:element=>({display:element.hidden?'none':'block',visibility:'visible',opacity:'1'}),
        URL:{createObjectURL:()=>{window.urls++;return 'blob:test';},revokeObjectURL:()=>{window.urls--;}},urls:0,
        MutationObserver:class{constructor(callback){this.callback=callback;this.connected=false;this.pending=[];observers.push(this);}observe(){this.connected=true;}disconnect(){this.connected=false;}takeRecords(){return this.pending.splice(0);}},
        fetch:function(...args){const response=deferred();calls.push({receiver:this,args,...response});return response.promise;}});
    function drawer(){
        const d=new Element('section','dae-library-drawer'),search=new Element('input','dae-library-search');search.type='search';
        const grid=new Element('div','dae-library-grid'),header=new Element('header','dae-library-header'),count=new Element('span','dae-library-muted');header.append(count);
        const filters=new Element('div','dae-library-filters'),all=new Element('button');all.dataset.filter='all';all.pressed=true;filters.append(all);
        const footer=new Element('footer','dae-library-footer'),previous=new Element('button'),next=new Element('button');previous.textContent='上一页';next.textContent='下一页';footer.append(previous,next);
        d.append(header,search,filters,grid,footer);document.body.append(d);return {drawer:d,search,grid,count,previous,next,all};
    }
    function mutate(rows){time++;for(const observer of observers)if(observer.connected)observer.callback(rows);}
    function render(d,p){
        const removedNodes=[...d.grid.children];for(const child of removedNodes)child.remove();
        for(const row of p.entries){
            const tile=new Element('article','dae-library-tile'),thumb=new Element('button','dae-library-thumb'),text=new Element('div','dae-library-text');
            thumb.dataset.assetId=row.id;text.textContent=row.text;thumb.append(text);
            const line=new Element('div','dae-library-tile-label'),label=new Element('span'),remove=new Element('button','dae-library-remove');label.textContent=row.name;remove.dataset.removeId=row.id;line.append(label,remove);tile.append(thumb,line);d.grid.append(tile);
        }
        if(!p.entries.length){const empty=new Element('div','dae-library-empty'),title=new Element('strong'),hint=new Element('span');title.textContent='把常用素材留在这里';hint.textContent='点击素材上的收藏按钮，即可跨工作流复用';empty.append(title,hint);d.grid.append(empty);}
        d.count.textContent=p.total?`${p.total} 项 · ${p.offset+1}–${p.offset+p.entries.length}`:'0 项';d.previous.disabled=p.offset===0;d.next.disabled=!p.hasMore;
        mutate([{type:'childList',target:d.grid,removedNodes,addedNodes:[...d.grid.children]}]);
    }
    function input(d,value,{trusted=true}={}){time++;d.search.value=value;document.emit('input',{target:d.search,isTrusted:trusted,timeStamp:time});}
    function request(q,offset=0,options={}){return window.fetch(`/api/daelab/studio/asset-library/favorites?q=${encodeURIComponent(q)}&limit=48&offset=${offset}`,options);}
    async function respond(index,p,status=200){const response=new Response(JSON.stringify(p),{status,headers:{'Content-Type':'application/json'}});calls[index].resolve(response);await flush();return response;}
    function frame(){time+=16;const rows=[...rafs];rafs.clear();for(const [,callback] of rows)callback(time);}
    function timeout(){time+=5000;for(const [id,callback] of [...timers]){timers.delete(id);callback();}}
    return {window,document,calls,timers,rafs,observers,elements,drawer,input,request,respond,render,mutate,frame,timeout};
}
const start=(h,o=oracle)=>{const observer=createAssetSearchObserver({document:h.document,window:h.window,oracle:o});observer.start({explicit:true,buildFingerprint:'a'.repeat(64)});return observer;};
const records=o=>o.report().reports.flatMap(report=>report.records);

test('fixed2000 oracle matches independent Python UUID5 identity; corrupt/reordered inputs fail closed',async()=>{
    assert.equal(base.rows[0].assetId,'02474699-5aec-5e0d-b3fc-33e96f374796');assert.equal(base.rows[0].id,'f2541cdb-94b1-5e07-a6cc-1b3ec7492f6f');
    assert.equal(base.size,2000);assert.equal(oracle.order.length,2000);
    await assert.rejects(buildAssetSearchOracle(Buffer.from('{}'),{crypto:webcrypto}),/hash-mismatch/);
    const bad=JSON.parse(orderBytes);bad.rows.reverse();await assert.rejects(buildAssetSearchOracle(bytes,{crypto:webcrypto,orderBytes:Buffer.from(JSON.stringify(bad))}),/order-not/);
});

test('response validation distinguishes exact content/total/page48/order from missing full oracle',()=>{
    assert.equal(validateSearchResponse(base,query('合成收藏 0001'),page('合成收藏 0001')).status,'validated');
    assert.equal(validateSearchResponse(base,query(''),page('')).status,'oracle-order-unavailable');
    assert.equal(validateSearchResponse(oracle,query('',48),page('',48)).ids.length,48);
    assert.equal(validateSearchResponse(oracle,query('不存在的合成词'),page('不存在的合成词')).total,0);
    const wrong=page('');wrong.entries.reverse();assert.throws(()=>validateSearchResponse(oracle,query(''),wrong),/order/);
    const other=page('合成收藏 0001');other.entries[0].text='wrong';assert.throws(()=>validateSearchResponse(oracle,query('合成收藏 0001'),other),/fixed-fixture/);
    assert.throws(()=>validateSearchResponse(oracle,query('分组 3'),{...page('分组 3'),total:199}),/total/);
});

test('inert construction and synthetic input cannot invoke fetch or complete observation',()=>{
    const h=environment(),d=h.drawer(),original=h.window.fetch,o=createAssetSearchObserver({document:h.document,window:h.window,oracle});
    assert.equal(h.window.fetch,original);assert.equal(o.start(),false);assert.equal(h.calls.length,0);
    o.start({explicit:true,buildFingerprint:'b'.repeat(64)});h.input(d,'0001',{trusted:false});h.frame();h.mutate([{type:'childList',target:d.grid}]);assert.equal(records(o).length,0);assert.equal(h.calls.length,0);o.destroy();assert.equal(h.window.fetch,original);
});

test('exact fetch Promise/this/args/response identities preserved; no completion from arbitrary mutation or one frame',async()=>{
    const h=environment(),d=h.drawer(),o=start(h),options={signal:new AbortController().signal,headers:{opaque:'not-exported'}};
    h.input(d,'合成收藏 0001');const returned=h.request('合成收藏 0001',0,options);
    assert.equal(returned,h.calls[0].promise);assert.equal(h.calls[0].receiver,h.window);assert.equal(h.calls[0].args[1],options);
    h.mutate([{type:'childList',target:d.grid}]);h.frame();h.frame();assert.equal(records(o)[0].status,'pending');
    const response=await h.respond(0,page('合成收藏 0001'));assert.equal(await returned,response);assert.equal(response.bodyUsed,false);
    h.mutate([{type:'attributes',target:d.drawer}]);h.frame();h.frame();assert.equal(records(o)[0].status,'pending');
    h.render(d,page('合成收藏 0001'));h.frame();assert.equal(records(o)[0].status,'pending');h.frame();
    const row=records(o)[0];assert.equal(row.status,'complete');assert.equal(row.dom.renderedPageCount,1);assert.equal(row.dom.viewportVisibleCount,1);assert(row.durationMs>0);assert(!JSON.stringify(o.report()).includes('not-exported'));o.destroy();
});

test('clear/empty and actual page48 clicks bind to response and visible count, not any matching old grid',async()=>{
    const h=environment(),d=h.drawer(),o=start(h);
    h.input(d,'');h.request('');await h.respond(0,page(''));h.render(d,page(''));h.frame();h.frame();assert.equal(records(o)[0].clear,true);assert.equal(records(o)[0].dom.renderedPageCount,48);
    h.document.emit('click',{target:d.next,isTrusted:true,timeStamp:h.window.performance.now()});h.request('',48);await h.respond(1,page('',48));h.render(d,page('',48));h.frame();h.frame();assert.equal(records(o)[1].status,'complete');assert.equal(records(o)[1].query.offset,48);
    h.input(d,'不存在的合成词');h.request('不存在的合成词');await h.respond(2,page('不存在的合成词'));h.render(d,page('不存在的合成词'));h.frame();h.frame();assert.equal(records(o)[2].dom.countText,'0 项');o.stop();
});

test('wrong visibleIDs/count/buttons cannot finish even with correct response; timeout retains evidence',async()=>{
    const h=environment(),d=h.drawer(),o=start(h);h.input(d,'合成收藏 0001');h.request('合成收藏 0001');await h.respond(0,page('合成收藏 0001'));
    h.render(d,page('合成收藏 0002'));h.frame();h.frame();assert.equal(records(o)[0].status,'pending');
    h.render(d,page('合成收藏 0001'));d.count.textContent='incorrect';h.frame();h.frame();assert.equal(records(o)[0].status,'pending');
    h.timeout();assert.equal(records(o)[0].status,'timeout');assert.equal(records(o)[0].response.status,'validated');assert.equal(records(o)[0].durationMs,null);o.destroy();
});

test('already matching old DOM and unrelated mutation cannot replace a post-response grid render',async()=>{
    const h=environment(),d=h.drawer(),o=start(h);h.render(d,page('合成收藏 0001'));
    h.input(d,'合成收藏 0001');h.request('合成收藏 0001');h.render(d,page('合成收藏 0001'));
    await h.respond(0,page('合成收藏 0001'));h.mutate([{type:'characterData',target:d.count}]);h.frame();h.frame();assert.equal(records(o)[0].status,'pending');
    h.render(d,page('合成收藏 0001'));h.frame();h.frame();assert.equal(records(o)[0].status,'complete');o.destroy();
});

test('ASR-001 correct IDs cannot certify wrong, missing or swapped text/name display',async()=>{
    for(const change of [
        d=>{d.grid.querySelector('.dae-library-text').textContent='完全错误的显示文本';},
        d=>{d.grid.querySelector('.dae-library-text').remove();},
        d=>{d.grid.querySelector('.dae-library-tile-label').children[0].textContent='合成收藏 0002';},
        d=>{d.grid.querySelector('.dae-library-text').hidden=true;},
    ]){
        const h=environment(),d=h.drawer(),o=start(h);h.input(d,'合成收藏 0001');h.request('合成收藏 0001');await h.respond(0,page('合成收藏 0001'));h.render(d,page('合成收藏 0001'));change(d);h.frame();h.frame();
        assert.equal(records(o)[0].status,'pending');h.timeout();assert.equal(records(o)[0].status,'timeout');o.destroy();
    }
});

test('ASR-002 comments, unrelated children and retained or recycled old result subtrees are not a render',async()=>{
    for(const kind of ['comment','unrelated','reinserted','recycled-thumb']){
        const h=environment(),d=h.drawer(),o=start(h);h.render(d,page('合成收藏 0001'));const original=d.grid.children[0];
        h.input(d,'合成收藏 0001');h.request('合成收藏 0001');await h.respond(0,page('合成收藏 0001'));
        if(kind==='recycled-thumb'){
            const oldThumb=original.querySelector('[data-asset-id]');h.render(d,page('合成收藏 0001'));
            const fresh=d.grid.children[0],freshThumb=fresh.querySelector('[data-asset-id]');freshThumb.remove();oldThumb.remove();fresh.append(oldThumb);fresh.children.reverse();
            h.mutate([{type:'childList',target:fresh,addedNodes:[oldThumb],removedNodes:[freshThumb]}]);
        }else{
            const added=kind==='reinserted'?original:new Element('div');if(kind==='comment')added.nodeType=8;
            if(kind==='reinserted')original.remove();d.grid.append(added);h.mutate([{type:'childList',target:d.grid,addedNodes:[added],removedNodes:kind==='reinserted'?[original]:[]}]);
        }
        h.frame();h.frame();assert.equal(records(o)[0].status,'pending');h.timeout();assert.equal(records(o)[0].durationMs,null);o.destroy();
    }
});

test('ASR-003 replaced search/grid and same-batch detach/reinsert permanently invalidate that input epoch',async()=>{
    for(const kind of ['search','grid','same-batch-reinsert']){
        const h=environment(),d=h.drawer(),o=start(h);h.input(d,'合成收藏 0001');h.request('合成收藏 0001');await h.respond(0,page('合成收藏 0001'));
        const original=kind==='grid'?d.grid:d.search;original.remove();
        const replacement=kind==='same-batch-reinsert'?original:kind==='grid'?new Element('div','dae-library-grid'):new Element('input','dae-library-search');
        if(kind!=='grid'){replacement.type='search';replacement.value=kind==='same-batch-reinsert'?'合成收藏 0001':'另一个当前查询';}d.drawer.append(replacement);
        h.mutate([{type:'childList',target:d.drawer,removedNodes:[original],addedNodes:[replacement]}]);
        if(kind==='grid')d.grid=replacement;else d.search=replacement;
        h.render(d,page('合成收藏 0001'));h.frame();h.frame();assert.equal(records(o)[0].status,'view-identity-lost');assert.equal(records(o)[0].durationMs,null);
        h.input(d,'合成收藏 0002');h.request('合成收藏 0002');await h.respond(1,page('合成收藏 0002'));h.render(d,page('合成收藏 0002'));h.frame();h.frame();
        assert.equal(records(o)[1].status,'complete');assert.notEqual(records(o)[0].viewId,records(o)[1].viewId);o.destroy();
    }
});

test('ASR-003 identity loss after first paint opportunity cannot resume the old epoch',async()=>{
    const h=environment(),d=h.drawer(),o=start(h);h.input(d,'合成收藏 0001');h.request('合成收藏 0001');await h.respond(0,page('合成收藏 0001'));h.render(d,page('合成收藏 0001'));h.frame();
    const oldSearch=d.search;oldSearch.remove();d.drawer.append(oldSearch);
    h.mutate([{type:'childList',target:d.drawer,removedNodes:[oldSearch],addedNodes:[oldSearch]}]);h.frame();
    assert.equal(records(o)[0].status,'view-identity-lost');assert.equal(records(o)[0].durationMs,null);assert.equal(h.rafs.size,0);o.destroy();
});

test('rendered48 and viewport-visible subset remain separate, and invalid event clock gives no latency',async()=>{
    const h=environment(),d=h.drawer(),o=start(h);h.input(d,'');h.request('');await h.respond(0,page(''));h.render(d,page(''));
    for(const tile of d.grid.children.slice(1))for(const node of [tile,...tile.querySelectorAll('[data-asset-id]'),...tile.querySelectorAll('.dae-library-text')])node.rect={left:10,top:2000,right:110,bottom:2100,width:100,height:100};
    h.frame();h.frame();assert.equal(records(o)[0].dom.renderedPageCount,48);assert.equal(records(o)[0].dom.viewportVisibleCount,1);
    h.document.emit('input',{target:d.search,isTrusted:true,timeStamp:Date.now()});assert.equal(records(o)[1].status,'unsupported-event-clock');assert.equal(records(o)[1].durationMs,null);o.destroy();
});

test('same query two drawers and reversed responses keep exact input/request/view epochs',async()=>{
    const h=environment(),a=h.drawer(),b=h.drawer(),o=start(h);
    h.input(a,'合成收藏 0001');h.request('合成收藏 0001');h.input(b,'合成收藏 0001');h.request('合成收藏 0001');
    await h.respond(1,page('合成收藏 0001'));h.render(b,page('合成收藏 0001'));h.frame();h.frame();
    assert.equal(records(o)[0].status,'pending');assert.equal(records(o)[1].status,'complete');
    await h.respond(0,page('合成收藏 0001'));h.render(a,page('合成收藏 0001'));h.frame();h.frame();assert.equal(records(o)[0].status,'complete');assert.notEqual(records(o)[0].viewId,records(o)[1].viewId);o.destroy();
});

test('stale response, unrelated requests and stop/restart epochs do not turn into new completion',async()=>{
    const h=environment(),d=h.drawer(),o=start(h);h.input(d,'合成收藏 0001');h.request('合成收藏 0001');h.input(d,'合成收藏 0002');h.request('合成收藏 0002');
    await h.respond(0,page('合成收藏 0001'));h.render(d,page('合成收藏 0001'));h.frame();h.frame();assert.equal(records(o)[0].status,'superseded');assert.equal(records(o)[1].status,'pending');
    await h.respond(1,page('合成收藏 0002'));h.render(d,page('合成收藏 0002'));h.frame();h.frame();assert.equal(records(o)[1].status,'complete');assert(o.report().reports[0].lateResponses.length>0);
    h.input(d,'1999');h.request('1999');o.stop();o.start({explicit:true,buildFingerprint:'b'.repeat(64)});await h.respond(2,page('1999'));h.render(d,page('1999'));h.frame();h.frame();assert.equal(o.report().reports[1].records.length,0);o.destroy();
});

test('delayed/debounced fetch lacks synchronous event provenance and cannot be guessed by same query',async()=>{
    const h=environment(),d=h.drawer(),o=start(h);h.input(d,'合成收藏 0001');await flush();h.request('合成收藏 0001');await h.respond(0,page('合成收藏 0001'));h.render(d,page('合成收藏 0001'));h.frame();h.frame();h.timeout();assert.equal(records(o)[0].status,'timeout');assert.equal(o.report().reports[0].unboundRequests,1);o.destroy();
});

test('UA microtask checkpoint between capture and target keeps same dispatch; ended dispatch cannot bind',async()=>{
    const h=environment(),d=h.drawer(),o=start(h);
    d.search.value='合成收藏 0001';
    const event={target:d.search,isTrusted:true,timeStamp:h.window.performance.now(),eventPhase:1};
    h.document.emit('input',event);
    await flush(); // Browser callbacks may checkpoint before the next listener.
    event.eventPhase=2;h.request('合成收藏 0001');event.eventPhase=0;
    await h.respond(0,page('合成收藏 0001'));h.render(d,page('合成收藏 0001'));h.frame();h.frame();
    assert.equal(records(o)[0].status,'complete');
    d.search.value='合成收藏 0002';
    const ended={target:d.search,isTrusted:true,timeStamp:h.window.performance.now(),eventPhase:1};h.document.emit('input',ended);ended.eventPhase=0;
    h.request('合成收藏 0002');await h.respond(1,page('合成收藏 0002'));h.render(d,page('合成收藏 0002'));h.frame();h.frame();h.timeout();
    assert.equal(records(o)[1].status,'timeout');assert.equal(o.report().reports[0].unboundRequests,1);o.destroy();
});

test('AbortError/rejection and synchronous throw identity remain unchanged; no error details exported',async()=>{
    const h=environment(),d=h.drawer(),o=start(h),error=new DOMException('private abort detail','AbortError');h.input(d,'0001');const promise=h.request('0001');h.calls[0].reject(error);await assert.rejects(promise,e=>e===error);await flush();assert.equal(records(o)[0].status,'aborted');assert(!JSON.stringify(o.report()).includes('private abort'));o.stop();
    const exact=new Error('private sync detail');h.window.fetch=function(){throw exact;};o.start({explicit:true,buildFingerprint:'b'.repeat(64)});h.input(d,'0001');assert.throws(()=>h.request('0001'),e=>e===exact);assert.equal(records(o).at(-1).status,'rejected');o.destroy();
});

test('duplicate request, missing page order, hidden page and removed drawer explicitly fail instead of proxy completion',async()=>{
    const h=environment(),d=h.drawer(),o=start(h);h.input(d,'0001');h.request('0001');h.request('0001');assert.equal(records(o)[0].status,'ambiguous-multiple-requests');o.stop();
    const missing=start(h,base);h.input(d,'');h.request('');await h.respond(2,page(''));assert.equal(records(missing)[0].status,'oracle-order-unavailable');missing.stop();
    o.start({explicit:true,buildFingerprint:'b'.repeat(64)});h.input(d,'0001');h.request('0001');d.drawer.remove();h.mutate([{type:'childList',target:h.document.body}]);assert.equal(records(o).at(-1).status,'view-detached');o.stop();
    const second=h.drawer();o.start({explicit:true,buildFingerprint:'b'.repeat(64)});h.input(second,'0001');h.document.visibilityState='hidden';h.document.emit('visibilitychange');assert.equal(o.active,false);assert.equal(records(o).at(-1).status,'page-hidden');
});

test('one active observer per window; restoration, foreign replacement and teardown release all owned resources',()=>{
    const h=environment(),d=h.drawer(),original=h.window.fetch,a=start(h),b=createAssetSearchObserver({document:h.document,window:h.window,oracle});
    assert.throws(()=>b.start({explicit:true,buildFingerprint:'b'.repeat(64)}),/another/);h.input(d,'0001');h.request('0001');const foreign=()=>42;h.window.fetch=foreign;a.stop();assert.equal(h.window.fetch,foreign);
    assert.deepEqual(a.resources(),{fetchLeases:0,listeners:0,mutationObservers:0,timers:0,raf:0,views:0});
    h.window.fetch=original;b.start({explicit:true,buildFingerprint:'b'.repeat(64)});h.window.emit('pagehide');assert.equal(h.window.fetch,original);assert.equal(b.resources().fetchLeases,0);
});

test('visible mount is inert, synthetic Start is rejected, real Stop/pagehide removes UI without mounting elsewhere',()=>{
    const h=environment(),original=h.window.fetch,panel=mountAssetSearchPerformanceObserver(h.document,h.window);
    const start=h.elements.find(e=>e.textContent==='开始搜索观测'),stop=h.elements.find(e=>e.textContent==='停止并释放');
    start.onclick({isTrusted:false});assert.equal(h.window.fetch,original);assert.equal(h.calls.length,0);
    start.onclick({isTrusted:true});assert.equal(h.window.fetch,original);assert.equal(h.calls.length,0);stop.onclick({isTrusted:true});
    h.window.emit('pagehide');assert.equal(h.document.body.children.length,0);assert.equal(h.window.urls,0);panel.destroy();
    const source=readFileSync(new URL('../host_fixture/web/performance_asset_search.js',import.meta.url),'utf8');
    assert(!/\/scripts\/app|app\.|rootGraph|dispatchEvent|setInterval|fetchApi|import\(/.test(source));
    assert(!/if\(typeof document/.test(source));
});

test('visible file-loaded panel preserves auto-stopped epochs, has exact dock position and revokes downloads',async()=>{
    const h=environment(),d=h.drawer(),original=h.window.fetch,panel=mountAssetSearchPerformanceObserver(h.document,h.window);
    const inputs=h.elements.filter(e=>e.tagName==='input'),[fixture,order,build]=inputs;
    fixture.files=[{size:bytes.length,arrayBuffer:async()=>bytes}];order.files=[{size:orderBytes.length,arrayBuffer:async()=>orderBytes}];
    await fixture.onchange({isTrusted:true});build.value='a'.repeat(64);
    const start=h.elements.find(e=>e.textContent==='开始搜索观测'),stop=h.elements.find(e=>e.textContent==='停止并释放'),download=h.elements.find(e=>e.textContent==='下载搜索原始报告');
    const element=h.document.body.children.find(e=>e.id==='studio-asset-search-observer');
    assert.match(element.style.cssText,/right:8px;top:160px/);assert.match(element.style.cssText,/width:350px;max-height:65vh/);assert(!element.open);
    start.onclick({isTrusted:true});assert.notEqual(h.window.fetch,original);assert.equal(h.calls.length,0);
    h.input(d,'0001');h.document.visibilityState='hidden';h.document.emit('visibilitychange');assert.equal(h.window.fetch,original);
    h.document.visibilityState='visible';start.onclick({isTrusted:true});h.input(d,'0002');stop.onclick({isTrusted:true});assert.equal(panel.report().reports.length,2);assert.equal(panel.report().reports[0].records[0].status,'page-hidden');
    download.onclick({isTrusted:true});assert.equal(h.window.urls,0);assert.equal(panel.report().reports.length,2);panel.destroy();assert.equal(h.window.fetch,original);assert.equal(panel.resources().listeners,0);
});
