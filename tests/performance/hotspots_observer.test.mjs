import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHotspotsObserver,mountHotspotsObserver,restrictedScriptPath} from '../host_fixture/web/performance_hotspots.js';

const origin='http://127.0.0.1:8226';
function harness(options={}){
    let clock=10;const instances=[];
    class Observer{
        static supportedEntryTypes=['long-animation-frame'];
        constructor(callback){this.callback=callback;this.pending=[];this.disconnected=false;instances.push(this);}
        observe(config){this.config=config;}
        takeRecords(){return this.pending.splice(0);}
        disconnect(){this.disconnected=true;}
        emit(entries,options){this.callback({getEntries:()=>entries},this,options);}
    }
    const observer=createHotspotsObserver({PerformanceObserver:Observer,now:()=>clock,origin,...options});
    return {observer,Observer,instances,setTime:value=>{clock=value;},get latest(){return instances.at(-1);}};
}
const script=(extra={})=>({startTime:22,duration:30,executionStart:22,forcedStyleAndLayoutDuration:12,
    sourceURL:origin+'/extensions/ComfyUI-DAELab-Creative-Studio/canvas/creative_canvas_view.mjs?token=secret#private',sourceFunctionName:'drawWires',sourceCharPosition:123,...extra});
const frame=(extra={})=>({entryType:'long-animation-frame',startTime:20,duration:80,renderStart:60,styleAndLayoutStart:70,blockingDuration:31,scripts:[script()],...extra});
const current=h=>h.observer.report().reports.at(-1);

test('construction and non-explicit start are inert; observes only future LoAF entries',()=>{
    const h=harness();assert.equal(h.instances.length,0);assert.equal(h.observer.start(),false);assert.equal(h.instances.length,0);
    assert.equal(h.observer.start({explicit:true}),true);assert.deepEqual(h.latest.config,{type:'long-animation-frame',buffered:false});
    h.latest.emit([frame({startTime:1}),frame({entryType:'longtask'}),frame()]);
    assert.equal(current(h).frames.length,1);assert.equal(current(h).excludedBoundaryFrames,1);
    h.setTime(200);h.observer.stop();assert.equal(h.latest.disconnected,true);assert.deepEqual(h.observer.resources(),{performanceObservers:0});
});

test('raw timings and script layout attribution are preserved without inventing pure layout time',()=>{
    const h=harness();h.observer.start({explicit:true});h.latest.emit([frame()]);
    const item=current(h).frames[0];assert.equal(item.duration,80);assert.equal(item.renderStart,60);assert.equal(item.styleAndLayoutStart,70);assert.equal(item.blockingDuration,31);
    assert.equal(item.styleDuration,null);assert.equal(item.layoutDuration,null);assert.equal(item.renderPhaseSpanMs,40);assert.equal(item.styleLayoutToFrameEndSpanMs,30);
    assert.equal(item.scripts[0].duration,30);assert.equal(item.scripts[0].forcedStyleAndLayoutDuration,12);assert.equal(item.scripts[0].forcedStyleDuration,null);
    assert.equal(item.scripts[0].sourceFunctionName,'drawWires');assert.equal(item.scripts[0].sourceCharPosition,123);
    const json=JSON.stringify(h.observer.report());assert(!json.includes('token'));assert(!json.includes('secret'));assert(!json.includes(origin));
    assert.match(current(h).limitations.join(' '),/not exact Style\/Layout/);assert.equal(h.observer.report().productAcceptance,false);h.observer.destroy();
});

test('privacy allowlist rejects arbitrary URLs and source names; never reads toJSON/invoker/window',()=>{
    assert.equal(restrictedScriptPath(origin+'/assets/index-abc.js?key=private#fragment',origin),'assets/index-abc.js');
    assert.equal(restrictedScriptPath(origin+'/extensions/ComfyUI-DAELab-Custom-Nodes-Library/table.mjs',origin),'extensions/ComfyUI-DAELab-Custom-Nodes-Library/table.mjs');
    for(const value of ['https://foreign.test/assets/a.js',origin+'/view/private.js','file:///C:/private.js','blob:'+origin+'/asset','data:text/javascript,secret',origin+'/assets/%73ecret.js',origin+'/extensions/arbitrary-user/private.js','http://user:password@127.0.0.1:8226/assets/a.js'])assert.equal(restrictedScriptPath(value,origin),null,value);
    const denied=script({sourceURL:'https://foreign.test/secret.js',sourceFunctionName:'privateFunction'});
    const protectedScript=script({sourceFunctionName:'function secret contents() {}'});
    for(const key of ['toJSON','invoker','window','name'])Object.defineProperty(protectedScript,key,{get(){throw new Error('private field read');}});
    const h=harness();h.observer.start({explicit:true});h.latest.emit([frame({scripts:[denied,protectedScript]})]);
    const items=current(h).frames[0].scripts;assert.equal(items[0].sourcePath,null);assert.equal(items[0].sourceFunctionName,null);assert.equal(items[1].sourceFunctionName,null);
    assert(!JSON.stringify(h.observer.report()).includes('privateFunction'));assert.equal(current(h).captureValid,true);h.observer.destroy();
});

test('missing and malformed timing stays null, including absent scripts and non-rendering frames',()=>{
    const h=harness();h.observer.start({explicit:true});h.latest.emit([frame({renderStart:0,styleAndLayoutStart:0,blockingDuration:NaN,scripts:undefined}),frame({duration:Infinity})]);
    const [a,b]=current(h).frames;assert.equal(a.renderPhaseSpanMs,null);assert.equal(a.styleLayoutToFrameEndSpanMs,null);assert.equal(a.blockingDuration,null);assert.equal(a.scripts,null);
    assert.equal(b.duration,null);assert.equal(b.styleLayoutToFrameEndSpanMs,null);assert.equal(current(h).captureValid,false);h.observer.destroy();
});

test('unsupported API or subscription failure is explicit missing data and installs no resources',()=>{
    for(const PerformanceObserver of [undefined,class{static supportedEntryTypes=[];},class{static supportedEntryTypes=['long-animation-frame'];observe(){throw new Error('private failure');}disconnect(){}}]){
        const h=harness({PerformanceObserver});assert.equal(h.observer.start({explicit:true}),false);assert.equal(current(h).status,'unsupported');assert.equal(current(h).captureValid,false);
        assert.equal(current(h).frames.length,0);assert(current(h).missing.length);assert.deepEqual(h.observer.resources(),{performanceObservers:0});assert(!JSON.stringify(h.observer.report()).includes('private failure'));
    }
});

test('stop drains already queued entries and excludes frames crossing the observation boundary',()=>{
    const h=harness();h.observer.start({explicit:true});h.latest.pending.push(frame(),frame({startTime:180,duration:80}));h.setTime(200);h.observer.stop();
    assert.equal(current(h).frames.length,1);assert.equal(current(h).excludedBoundaryFrames,1);assert.equal(current(h).endedAt,200);assert.equal(current(h).status,'operator-stop');
    h.latest.emit([frame()]);assert.equal(current(h).frames.length,1);
});

test('multiple instances and restarted epochs do not accept late callback data',()=>{
    const a=harness(),b=harness();a.observer.start({explicit:true});b.observer.start({explicit:true});const stale=a.latest;
    stale.emit([frame()]);assert.equal(current(a).frames.length,1);assert.equal(current(b).frames.length,0);
    a.setTime(200);a.observer.stop();a.observer.start({explicit:true});stale.emit([frame({startTime:220})]);assert.equal(current(a).frames.length,0);
    b.latest.emit([frame()]);assert.equal(current(b).frames.length,1);a.observer.destroy();assert.equal(b.observer.active,true);b.observer.destroy();
});

test('frame and script capacities reject complete entries, stop, and flag diagnostic incomplete',()=>{
    const a=harness({maxFrames:1});a.observer.start({explicit:true});a.latest.emit([frame(),frame(),frame()]);
    assert.equal(current(a).frames.length,1);assert.equal(current(a).status,'capacity-exceeded');assert.equal(current(a).captureValid,false);assert.equal(current(a).rejectedDeliveredEntries,2);assert.equal(a.observer.active,false);assert.equal(a.latest.disconnected,true);
    assert.equal(a.observer.start({explicit:true}),false);
    const b=harness({maxScripts:1});b.observer.start({explicit:true});b.latest.emit([frame({scripts:[script(),script()]})]);
    assert.equal(current(b).frames.length,0);assert.equal(current(b).captureValid,false);assert.equal(current(b).status,'capacity-exceeded');
});

test('browser dropped entries and attribution read failures never pass as complete capture',()=>{
    const h=harness({onUpdate(){throw new Error('UI unavailable');}});h.observer.start({explicit:true});h.latest.emit([frame()],{droppedEntriesCount:3});
    assert.equal(current(h).browserDeliveryLossCount,3);assert.equal(current(h).captureValid,false);
    const bad=frame();Object.defineProperty(bad,'scripts',{get(){throw new Error('do not export');}});assert.doesNotThrow(()=>h.latest.emit([bad]));
    assert.equal(current(h).status,'observation-error');assert.equal(h.latest.disconnected,true);assert(!JSON.stringify(h.observer.report()).includes('do not export'));
});

class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag;this.children=[];this.style={};this.isConnected=true;this.clicks=0;}
    append(child){child.parentElement=this;this.children.push(child);}
    remove(){this.isConnected=false;}
    click(){this.clicks++;}
}
function dom(h){
    const elements=[],body=new Element('body'),urls=[];
    const document=Object.assign(new EventTarget(),{body,readyState:'complete',getElementById:id=>elements.find(e=>e.id===id&&e.isConnected),createElement:tag=>{const e=new Element(tag);elements.push(e);return e;}});
    const window=Object.assign(new EventTarget(),{PerformanceObserver:h.Observer,performance:{now:()=>500},location:{origin},URL:{createObjectURL(blob){urls.push(blob);return 'blob:test';},revokeObjectURL(url){urls.push(url);}}});
    return {document,window,elements,body,urls};
}
test('visible UI starts/stops/downloads only on trusted clicks and pagehide releases every owned resource',()=>{
    const h=harness(),d=dom(h),panel=mountHotspotsObserver(d.document,d.window);assert.equal(h.instances.length,0);assert.equal(mountHotspotsObserver(d.document,d.window),null);
    const button=text=>d.elements.find(e=>e.textContent===text),start=button('开始热点观测'),stop=button('停止并释放'),download=button('下载热点原始记录');
    start.onclick({isTrusted:false});assert.equal(h.instances.length,0);start.onclick({isTrusted:true});assert.equal(h.instances.length,1);
    stop.onclick({isTrusted:false});assert.equal(h.latest.disconnected,false);download.onclick({isTrusted:true});assert.equal(d.urls.length,0);
    stop.onclick({isTrusted:true});assert.equal(h.latest.disconnected,true);download.onclick({isTrusted:false});assert.equal(d.urls.length,0);download.onclick({isTrusted:true});assert.equal(d.urls.length,2);
    start.onclick({isTrusted:true});d.window.dispatchEvent(new Event('pagehide'));assert.equal(h.latest.disconnected,true);assert.deepEqual(panel.resources(),{performanceObservers:0});assert.equal(d.body.children[0].isConnected,false);assert.equal(start.onclick,null);panel.destroy();
});

test('WEB_DIRECTORY import mounts once after DOM readiness but never starts or reads host state',()=>{
    const source=fs.readFileSync(new URL('../host_fixture/web/performance_hotspots.js',import.meta.url),'utf8');
    assert(!/app\.|rootGraph|MutationObserver|requestAnimationFrame|fetch\(/.test(source));
    for(const readyState of ['loading','complete']){
        const h=harness(),d=dom(h);d.document.readyState=readyState;
        vm.runInNewContext(source.replace(/export /g,''),{document:d.document,window:d.window,AbortController,Blob,URL});
        if(readyState==='loading'){assert.equal(d.body.children.length,0);d.document.dispatchEvent(new Event('DOMContentLoaded'));d.document.dispatchEvent(new Event('DOMContentLoaded'));}
        assert.equal(d.body.children.length,1);assert.equal(h.instances.length,0);d.window.dispatchEvent(new Event('pagehide'));
    }
});
