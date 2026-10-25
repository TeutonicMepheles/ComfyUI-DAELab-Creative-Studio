import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../migrated_business/register.mjs';
import ts from 'typescript';
import {canvasHistory} from '../../frontend/src/integrations/comfyui/canvas/creative_history.mjs';
import {isPanelActive} from '../../frontend/src/ui/creative_panel_state.mjs';

const {createCaretReveal,revealDelta}=await import('../../frontend/src/canvas/creative_focus_reveal.ts');

const viewSource=readFileSync(new URL('../../frontend/src/canvas/creative_canvas_view.mjs',import.meta.url),'utf8');
test('Canvas binds caret reveal to its card lease and disposes it with the view',()=>{
    assert.match(viewSource,/createCaretReveal\(\{/);
    assert.match(viewSource,/cardOwners\.get\(editor\.closest\('\.dae-creative-card'\)\)/);
    assert.match(viewSource,/function clear\(\)\{caretReveal\.cancel\(\)/);
    assert.match(viewSource,/destroy\(\)\{caretReveal\.destroy\(\)/);
});

const syntax=ts.createSourceFile('view.mjs',viewSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let binding;
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(syntax)==='caretReveal')binding=node.initializer.getText(syntax);ts.forEachChild(node,visit);}
visit(syntax);
// Execute the actual view binding and its lease callback. Replacements alter the
// real closure, not a second test-only approximation of its ownership conditions.
const bindView=new Function('createCaretReveal','root','cardOwners','graph','host','state','cards','isPanelActive','navigate',`
 let visible=true,workspace=null,drag=null;
 const caretReveal=${binding};
 return {controller:caretReveal,replaceGraph(v){graph=v},replaceState(v){state=v},setVisible(v){visible=v},setWorkspace(v){workspace=v},setDrag(v){drag=v}};
`);
class Events {
    listeners=new Map();
    addEventListener(type,callback){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(callback);}
    removeEventListener(type,callback){this.listeners.get(type)?.delete(callback);}
    emit(type,options={}){const e={type,target:this,...options};for(const fn of this.listeners.get(type)||[])fn(e);}
    count(){return [...this.listeners.values()].reduce((n,s)=>n+s.size,0);}
}
const rect=(left,top,right,bottom)=>({left,top,right,bottom,width:right-left,height:bottom-top});
function fixture(){
    const doc=new Events(),win=new Events(),frames=new Map(),pans=[],writes=[],measures=[],styleReads=[],rangeReads=[];
    let nextFrame=0;
    doc.defaultView=win;doc.hidden=false;doc.documentElement={clientWidth:680,clientHeight:720};
    win.visualViewport=null;
    win.requestAnimationFrame=fn=>{const id=++nextFrame;frames.set(id,fn);return id;};
    win.cancelAnimationFrame=id=>frames.delete(id);
    win.getComputedStyle=e=>{styleReads.push(e);return {overflowX:'visible',overflowY:'visible',transform:'none',rotate:'none',scale:'none',perspective:'none',zoom:'1',...e.css};};
    function element(tag='DIV',parent=null){
        const e=new Events();Object.assign(e,{tagName:tag,ownerDocument:doc,parentElement:parent,isConnected:true,hidden:false,inert:false,isContentEditable:false,
            bounds:rect(108,280,946.59375,322),offsetWidth:558.3958333333,offsetHeight:28,clientWidth:558.3958333333,clientHeight:28,clientLeft:0,clientTop:0});
        e.contains=child=>{for(let n=child;n;n=n.parentElement)if(n===e)return true;return false;};
        e.closest=selector=>{for(let n=e;n;n=n.parentElement){
            if(selector==='.dae-creative-card'&&n.card)return n;
            if(selector.includes('[hidden]')&&(n.hidden||n.inert||n.tagName==='DIALOG'||n.workspace))return n;
        }return null;};
        e.getBoundingClientRect=()=>{measures.push(e);return e.bounds;};
        e.tabIndex=-1;e.disabled=false;e.matches=selector=>selector===':disabled'&&e.disabled;
        for(const name of ['focus','blur','setSelectionRange'])e[name]=()=>{throw new Error('forbidden '+name);};
        for(const name of ['value','scrollLeft','scrollTop'])Object.defineProperty(e,name,{get:()=>name==='value'?'unchanged':0,set:v=>{writes.push([name,v]);throw new Error('forbidden '+name);}});
        return e;
    }
    const root=element('SECTION');root.bounds=rect(58,96,680,720);
    const state={viewport:{x:50,y:200,zoom:1.5}},nodes=new Map(),cards=new Map(),cardOwners=new WeakMap();
    const graph={extra:{daelabCreativeCanvasV1:state},getNodeById:id=>nodes.get(id)};
    const host={graph:()=>graph};
    function card(id){
        const node={id,mode:0},outer=element('ARTICLE',root);outer.card=true;
        const body=element('DIV',outer),panel=element('DIV',body),editor=element('DIV',panel);editor.isContentEditable=true;
        const text={parentElement:editor};
        const c={node,element:outer,body,panel,release(){},editor,text};nodes.set(id,node);cards.set(id,c);cardOwners.set(outer,{card:c,node});return c;
    }
    const a=card(1),b=card(2);
    const selection={isCollapsed:true,rangeCount:1,focusNode:a.text,anchorNode:a.text,focusOffset:50};
    let ranges=[rect(791.8125,286,791.8125,315)],rangeThrows=false;
    doc.getSelection=()=>selection;
    doc.createRange=()=>({setStart(node,offset){assert.equal(node,selection.focusNode);assert.equal(offset,selection.focusOffset);if(rangeThrows)throw new Error('detached');},
        collapse(value){assert.equal(value,true);},getClientRects:()=>{rangeReads.push(true);return ranges;}});
    doc.activeElement=a.editor;
    const snapshot=()=>({nodes:[{id:1,unknown:{raw:['retained']}}],extra:{daelabCreativeCanvasV1:{viewport:{x:0,y:0,zoom:1},cards:{1:{x:7}}}}});
    const tracker={initialState:snapshot(),activeState:snapshot(),undoQueue:[snapshot()],redoQueue:[snapshot()]};
    const history=canvasHistory({extensionManager:{workflow:{activeWorkflow:{changeTracker:tracker}}}});
    const beforeSnapshots=structuredClone(tracker);
    const navigation=()=>{pans.push({...state.viewport});history.updateViewport(state.viewport);};
    const view=bindView(createCaretReveal,root,cardOwners,graph,host,state,cards,isPanelActive,navigation);
    return {doc,win,root,a,b,state,nodes,cards,cardOwners,graph,host,view,controller:view.controller,frames,pans,writes,measures,styleReads,rangeReads,selection,tracker,beforeSnapshots,element,
        setRanges(v){ranges=v},setRangeThrows(v){rangeThrows=v},
        active(c){doc.activeElement=c.editor;selection.focusNode=c.text;selection.anchorNode=c.text;},
        fire(type,c=a,options={}){root.emit(type,{target:c.editor,...options});},
        control(c=a,tag='BUTTON',bounds=rect(918.671875,341.8125,1072,398.40625)){const e=element(tag,c.panel);e.tabIndex=0;e.bounds=bounds;return e;},
        tabTo(target,{shiftKey=false,isTrusted=true,isComposing=false,keyCode=9,relatedTarget=doc.activeElement}={}){const from=doc.activeElement;root.emit('keydown',{target:from,key:'Tab',shiftKey,isTrusted,isComposing,keyCode});root.emit('focusout',{target:from,relatedTarget:target});doc.activeElement=target;root.emit('focusin',{target,relatedTarget,isTrusted});},
        flush(){const todo=[...frames.values()];frames.clear();for(const fn of todo)fn();},
    };
}

test('actual tail geometry pans screen pixels once, preserves focus/text/scroll and native undo facts',()=>{
    const f=fixture();f.fire('focusin');f.fire('input');f.doc.emit('selectionchange');assert.equal(f.frames.size,1);f.flush();
    assert.deepEqual(f.pans,[{x:50-127.8125,y:200,zoom:1.5}]);assert.equal(f.doc.activeElement,f.a.editor);assert.deepEqual(f.writes,[]);
    const after=structuredClone(f.tracker);
    for(const saved of [after.initialState,after.activeState,...after.undoQueue,...after.redoQueue])saved.extra.daelabCreativeCanvasV1.viewport={x:0,y:0,zoom:1};
    assert.deepEqual(after,f.beforeSnapshots);assert.equal(f.frames.size,0);
    f.controller.destroy();
});

test('pure geometry uses nearest edges, rejects non-finite/oversized geometry and accepts zero-width caret',()=>{
    const viewport=rect(58,96,680,720);
    assert.deepEqual(revealDelta(rect(74,112,74,130),viewport),{dx:0,dy:0});
    assert.deepEqual(revealDelta(rect(50,100,50,129),viewport),{dx:-24,dy:-12});
    assert.deepEqual(revealDelta(rect(400,700,400,730),viewport),{dx:0,dy:26});
    assert.equal(revealDelta(rect(NaN,100,200,120),viewport),null);
    assert.equal(revealDelta(rect(0,100,900,130),viewport),null);
    assert.equal(revealDelta(rect(1,1,1,1),viewport),null);
});

test('visible caret causes zero pan and selection is measured without writing live Selection',()=>{
    const f=fixture();f.setRanges([rect(400,286,400,315)]);
    for(const name of ['collapse','extend','removeAllRanges','addRange','setPosition'])f.selection[name]=()=>assert.fail('live Selection changed');
    f.fire('input');f.flush();assert.deepEqual(f.pans,[]);assert.deepEqual(f.writes,[]);f.controller.destroy();
});

test('events coalesce into one geometry pass; visible carets read Range/root but skip every clipping ancestor',()=>{
    const f=fixture();f.setRanges([rect(400,286,400,315)]);
    f.fire('input');f.fire('keyup',f.a,{key:'ArrowRight'});f.doc.emit('selectionchange');assert.equal(f.frames.size,1);f.flush();
    assert.equal(f.rangeReads.length,1);assert.deepEqual(f.styleReads,[]);assert.deepEqual(f.measures,[f.root]);
    assert.equal(f.pans.length,0);f.flush();assert.equal(f.rangeReads.length,1);
    f.fire('input');f.flush();assert.equal(f.rangeReads.length,2);assert.equal(f.pans.length,0);f.controller.destroy();
});

test('ownership is checked again after geometry reads before mutating viewport',()=>{
    const f=fixture();const measure=f.root.getBoundingClientRect;f.root.getBoundingClientRect=()=>{const r=measure();f.a.panel={};return r;};
    f.fire('input');f.flush();assert.equal(f.pans.length,0);f.controller.destroy();
});

test('unmeasurable, noncollapsed, detached and internally clipped caret never guesses or retries',()=>{
    for(const change of [f=>f.setRanges([]),f=>f.setRanges([rect(0,0,0,0)]),f=>f.setRanges([rect(1,1,1,20),rect(2,2,2,20)]),
        f=>f.selection.isCollapsed=false,f=>f.selection.focusNode={},f=>f.setRangeThrows(true),
        f=>{f.a.panel.css={overflowX:'auto'};f.a.panel.bounds=rect(108,280,500,322);},
        f=>{f.a.editor.css={overflowY:'hidden'};f.a.editor.bounds=rect(108,290,946,310);}]){
        const f=fixture();change(f);f.fire('input');f.flush();assert.deepEqual(f.pans,[]);assert.equal(f.frames.size,0);f.controller.destroy();
    }
});

test('textarea/input reveal a fit-sized control; oversized controls retain native inner caret/scroll ownership',()=>{
    for(const tag of ['TEXTAREA','INPUT']){
        const f=fixture();Object.assign(f.a.editor,{tagName:tag,type:'text',isContentEditable:false,bounds:rect(600,280,800,322),selectionStart:7,selectionEnd:7});
        f.fire('focusin');f.flush();assert.equal(f.pans[0].x,50-136);assert.equal(f.a.editor.selectionStart,7);assert.deepEqual(f.writes,[]);
        f.a.editor.bounds=rect(108,280,946.59375,322);f.fire('input');f.flush();assert.equal(f.pans.length,1);f.controller.destroy();
    }
    const f=fixture();Object.assign(f.a.editor,{tagName:'INPUT',type:'number',isContentEditable:false});f.fire('focusin');f.flush();assert.equal(f.pans.length,0);f.controller.destroy();
});

test('scheduled A cannot move B; B requires its own current event and content geometry',()=>{
    const f=fixture();f.fire('input');f.active(f.b);f.flush();assert.equal(f.pans.length,0);
    f.setRanges([rect(20,286,20,315)]);f.fire('focusin',f.b);f.flush();assert.equal(f.pans[0].x,104);assert.deepEqual(f.writes,[]);f.controller.destroy();
});

test('actual view lease rejects graph/state/panel/release/card/node replacement, inactive mode and hide',()=>{
    const changes=[f=>f.view.replaceGraph({}),f=>f.host.graph=()=>({}),f=>f.view.replaceState({}),f=>f.graph.extra.daelabCreativeCanvasV1={},
        f=>f.a.panel={},f=>f.a.release=()=>{},f=>f.cards.set(1,{...f.a}),f=>f.nodes.set(1,{id:1,mode:0}),f=>f.nodes.delete(1),
        f=>f.a.node.mode=2,f=>f.a.node.mode=4,f=>f.a.body.hidden=true,f=>f.a.body.inert=true,
        f=>f.a.body.parentElement=null,f=>f.a.element.parentElement=null,f=>f.a.editor.parentElement=null,
        f=>f.a.editor.isConnected=false,f=>f.a.editor.isContentEditable=false,f=>f.view.setVisible(false),
        f=>f.view.setWorkspace({}),f=>f.view.setDrag({}),f=>f.doc.hidden=true];
    for(const change of changes){const f=fixture();f.fire('input');change(f);f.flush();assert.equal(f.pans.length,0,String(change));f.controller.destroy();}
});

test('native same-ID replacement before an event rejects the old DOM even before Canvas sync; proxy wrappers need not equal the lookup',()=>{
    const f=fixture();f.nodes.set(1,{id:1,mode:0});f.fire('input');assert.equal(f.frames.size,0);f.controller.destroy();
    const wrapped=fixture();wrapped.a.node=new Proxy(wrapped.a.node,{});wrapped.fire('input');wrapped.flush();assert.equal(wrapped.pans.length,1);wrapped.controller.destroy();
});

test('composition defers selection/input/navigation and final commit coalesces once without stealing focus',()=>{
    const f=fixture();f.fire('input');f.fire('compositionstart');f.fire('input',f.a,{isComposing:true});
    f.fire('keydown',f.a,{key:'Process',keyCode:229,isComposing:true});f.doc.emit('selectionchange');f.flush();assert.equal(f.pans.length,0);
    f.fire('compositionend');f.fire('input',f.a,{isComposing:false});assert.equal(f.frames.size,1);f.flush();assert.equal(f.pans.length,1);assert.deepEqual(f.writes,[]);
    f.fire('compositionstart');f.fire('focusout');f.active(f.b);f.fire('compositionend',f.a);f.flush();assert.equal(f.pans.length,1);f.controller.destroy();
});

test('229 without composition events defers until non-composing committed input',()=>{
    const f=fixture();f.fire('keydown',f.a,{keyCode:229});f.doc.emit('selectionchange');f.fire('keyup',f.a,{key:'End'});f.flush();assert.equal(f.pans.length,0);
    f.fire('input',f.a,{isComposing:false});f.flush();assert.equal(f.pans.length,1);f.controller.destroy();
});

test('composing input without start is deferred; lifecycle cancellation cannot leave the next owner IME-blocked',()=>{
    const f=fixture();f.fire('input',f.a,{isComposing:true});f.doc.emit('selectionchange');f.flush();assert.equal(f.pans.length,0);
    f.fire('compositionend');f.flush();assert.equal(f.pans.length,1);
    f.fire('compositionstart');f.controller.cancel();f.active(f.b);f.fire('focusin',f.b);f.flush();assert.equal(f.pans.length,2);f.controller.destroy();
});

test('manual navigation cancels and suppresses selection notifications until next editing intent',()=>{
    const f=fixture();f.fire('input');f.controller.suspend();f.doc.emit('selectionchange');f.fire('select');f.flush();assert.equal(f.pans.length,0);
    f.fire('keyup',f.a,{key:'End'});f.flush();assert.equal(f.pans.length,1);
    f.controller.suspend();f.fire('keyup',f.a,{key:'s',ctrlKey:true});f.flush();assert.equal(f.pans.length,1);f.controller.destroy();
});

test('pointer selection does not move the viewport during drag; release rechecks collapsed current selection',()=>{
    const f=fixture();f.fire('pointerdown',f.a,{button:0});f.fire('focusin');f.doc.emit('selectionchange');f.flush();assert.equal(f.pans.length,0);
    f.selection.isCollapsed=false;f.doc.emit('pointerup',{target:f.a.editor});f.flush();assert.equal(f.pans.length,0);
    f.selection.isCollapsed=true;f.fire('pointerdown',f.a,{button:0});f.doc.emit('pointerup',{target:f.a.editor});f.flush();assert.equal(f.pans.length,1);f.controller.destroy();
});

test('cancel/destroy/pagehide release pending work and listeners without late focus or pan',()=>{
    const f=fixture();f.fire('input');f.controller.cancel();f.flush();assert.equal(f.pans.length,0);
    f.fire('input');f.win.emit('pagehide');f.doc.emit('selectionchange');f.flush();assert.equal(f.pans.length,0);
    f.fire('input');assert.equal(f.frames.size,1);f.controller.destroy();f.controller.destroy();f.flush();
    assert.equal(f.root.count()+f.doc.count()+f.win.count(),0);assert.equal(f.frames.size,0);assert.deepEqual(f.pans,[]);assert.deepEqual(f.writes,[]);
});

test('view reveal pan uses only existing viewport navigation and manual routes explicitly suspend it',()=>{
    assert.match(binding,/pan\(\{dx,dy\}\)\{state\.viewport\.x-=dx;state\.viewport\.y-=dy;navigate\(\);\}/);
    assert.doesNotMatch(binding,/\.focus\(|\.blur\(|scrollLeft|scrollTop|history\.(begin|end|amend)|dirty\(/);
    assert.match(viewSource,/function setZoom\(factor\)\{caretReveal\.suspend\(\)/);
    assert.match(viewSource,/function fit\(\)\{\s*caretReveal\.suspend\(\)/);
    assert.match(viewSource,/panBy\(dx,dy\)\{[\s\S]*?caretReveal\.suspend\(\)/);
});

test('real post-Tab TD and button geometry is revealed without changing focus or native history facts',()=>{
    const tableRects=[rect(-145.63021850585938,316.3333435058594,-85.63021850585938,437.4479293823242),rect(-391.2604370117187,382.6666870117187,-271.26043701171875,624.8958587646484),rect(-636.890625,449,-456.890625,812.34375)];
    for(const [width,height] of [[680,720],[1280,720],[1920,1080]])for(const bounds of tableRects){
        const f=fixture();f.doc.documentElement={clientWidth:width,clientHeight:height};f.root.bounds=rect(58,96,width,height);
        const target=f.control(f.a,'TD',bounds),delta=revealDelta(bounds,f.root.bounds);f.tabTo(target);f.flush();
        assert.equal(f.doc.activeElement,target);assert.equal(f.pans.length,1);assert.deepEqual(f.pans[0],{x:50-delta.dx,y:200-delta.dy,zoom:1.5});assert.deepEqual(f.writes,[]);
        const after=structuredClone(f.tracker);for(const saved of [after.initialState,after.activeState,...after.undoQueue,...after.redoQueue])saved.extra.daelabCreativeCanvasV1.viewport={x:0,y:0,zoom:1};assert.deepEqual(after,f.beforeSnapshots);f.controller.destroy();
    }
    for(const owner of ['a','b'])for(const bounds of [rect(918.671875,341.8125,1072,398.40625),rect(645.78125,311.2083435058594,748,348.9375114440918)]){
        const f=fixture(),target=f.control(f[owner],'BUTTON',bounds);f.tabTo(target,{shiftKey:owner==='b'});f.flush();assert.equal(f.doc.activeElement,target);assert.equal(f.pans.length,1);assert.equal(f.pans[0].x,50-(bounds.right-664));assert.deepEqual(f.writes,[]);f.controller.destroy();
    }
});

test('noneditor focus needs a current trusted Tab intent; selection changes cannot replace that target',()=>{
    const f=fixture(),target=f.control();f.doc.activeElement=target;f.root.emit('focusin',{target,isTrusted:true,relatedTarget:f.a.editor});f.flush();assert.equal(f.pans.length,0);
    f.active(f.a);f.tabTo(target,{isTrusted:false});f.flush();assert.equal(f.pans.length,0);
    f.active(f.a);f.tabTo(target);f.doc.emit('selectionchange');f.flush();assert.equal(f.pans.length,1);assert.equal(f.rangeReads.length,0);assert.equal(f.doc.activeElement,target);f.controller.destroy();
});

test('Tab intent survives inline focusout but expires and never follows a different focus transition',()=>{
    for(const change of [f=>f.flush(),f=>f.controller.suspend(),f=>f.controller.cancel(),f=>f.root.emit('pointerdown',{button:0}),f=>f.root.emit('keydown',{target:f.a.editor,key:'x',isTrusted:true})]){
        const f=fixture(),target=f.control();f.root.emit('keydown',{target:f.a.editor,key:'Tab',isTrusted:true});change(f);f.root.emit('focusout',{target:f.a.editor});f.doc.activeElement=target;f.root.emit('focusin',{target,isTrusted:true,relatedTarget:f.a.editor});f.flush();assert.equal(f.pans.length,0,String(change));f.controller.destroy();
    }
    const f=fixture(),target=f.control();f.tabTo(target,{relatedTarget:f.b.editor});f.flush();assert.equal(f.pans.length,0);f.controller.destroy();
});

test('Tab handoff permits inline editing to end but requires the original lease through focus transfer',()=>{
    for(const invalidate of [false,true]){
        const f=fixture(),target=f.control(f.b,'TD',rect(700,300,820,420));
        f.root.emit('keydown',{target:f.a.editor,key:'Tab',isTrusted:true});
        f.a.editor.isContentEditable=false;if(invalidate)f.a.node.mode=4;
        f.root.emit('focusout',{target:f.a.editor,relatedTarget:target});f.doc.activeElement=target;
        f.root.emit('focusin',{target,relatedTarget:f.a.editor,isTrusted:true});f.flush();
        assert.equal(f.pans.length,invalidate?0:1);assert.equal(f.doc.activeElement,target);assert.deepEqual(f.writes,[]);f.controller.destroy();
    }
});

test('post-Tab control rejects changed owner/mode, detached/disabled targets and foreign focus',()=>{
    const changes=[(f,t)=>f.view.replaceGraph({}),(f,t)=>f.a.panel={},(f,t)=>f.a.release=()=>{},(f,t)=>f.nodes.set(1,{id:1,mode:0}),
        (f,t)=>f.a.node.mode=2,(f,t)=>f.a.node.mode=4,(f,t)=>t.hidden=true,(f,t)=>t.inert=true,(f,t)=>t.disabled=true,
        (f,t)=>t.isConnected=false,(f,t)=>t.parentElement=null,(f,t)=>f.doc.activeElement=f.b.editor,(f,t)=>f.doc.hidden=true];
    for(const change of changes){const f=fixture(),target=f.control();f.tabTo(target);change(f,target);f.flush();assert.equal(f.pans.length,0,String(change));f.controller.destroy();}
    for(const tag of ['DIALOG','SECTION']){const f=fixture(),target=f.control();target.parentElement=tag==='DIALOG'?f.element(tag,f.a.panel):f.root;f.tabTo(target);f.flush();assert.equal(f.pans.length,0);f.controller.destroy();}
});

test('Tab cannot bypass IME or reveal hidden, oversized, internally clipped or already visible controls',()=>{
    for(const setup of [f=>f.fire('compositionstart'),f=>f.fire('keydown',f.a,{keyCode:229,isComposing:true})]){const f=fixture();setup(f);f.tabTo(f.control());f.flush();assert.equal(f.pans.length,0);f.controller.destroy();}
    for(const options of [{isComposing:true},{keyCode:229}]){const f=fixture();f.tabTo(f.control(),options);f.flush();assert.equal(f.pans.length,0);f.controller.destroy();}
    for(const bounds of [rect(100,200,150,240),rect(0,200,900,240),rect(0,0,0,0)]){const f=fixture();f.tabTo(f.control(f.a,'BUTTON',bounds));f.flush();assert.equal(f.pans.length,0);f.controller.destroy();}
    const clipped=fixture(),target=clipped.control();clipped.a.panel.css={overflowX:'hidden'};clipped.a.panel.bounds=rect(600,280,700,500);clipped.tabTo(target);clipped.flush();assert.equal(clipped.pans.length,0);clipped.controller.destroy();
});

test('whole-control bounds skip self overflow, retain geometry lease validation and cancel on teardown',()=>{
    const f=fixture(),target=f.control();target.css={overflowX:'hidden',overflowY:'hidden'};target.clientWidth=20;target.clientHeight=10;
    f.tabTo(target);f.flush();assert.equal(f.pans.length,1);assert.ok(!f.styleReads.includes(target));assert.deepEqual(f.writes,[]);f.controller.destroy();
    const changed=fixture(),other=changed.control();const read=other.getBoundingClientRect;other.getBoundingClientRect=()=>{const r=read();changed.a.release=()=>{};return r;};changed.tabTo(other);changed.flush();assert.equal(changed.pans.length,0);changed.controller.destroy();
    for(const close of [f=>f.controller.destroy(),f=>f.win.emit('pagehide')]){const f=fixture();f.root.emit('keydown',{target:f.a.editor,key:'Tab',isTrusted:true});close(f);f.flush();assert.equal(f.frames.size,0);assert.equal(f.pans.length,0);f.controller.destroy();assert.equal(f.root.count()+f.doc.count()+f.win.count(),0);}
});

// Actual 7b5 stable post-Tab geometry. The 150% follow-up supplied the shared
// computed border/used-size values; 50% retains its original measured rectangles.
// writingMode/individual transforms are explicit supported-domain test inputs,
// not fields claimed to have been captured in the old operator JSON.
function fractionalScrollport(zoom){
    const f=fixture(),shell=f.a.panel;
    shell.css={overflowX:'auto',overflowY:'auto',width:'1140px',height:'620.229px',boxSizing:'border-box',
        borderLeftWidth:'0.666667px',borderRightWidth:'0.666667px',borderTopWidth:'0.666667px',borderBottomWidth:'0.666667px',
        paddingLeft:'0px',paddingRight:'0px',paddingTop:'0px',paddingBottom:'0px',
        direction:'ltr',writingMode:'horizontal-tb',scrollbarGutter:'auto',transform:'none',rotate:'none',scale:'none',zoom:'1'};
    Object.assign(shell,{offsetWidth:1140,offsetHeight:620,clientLeft:1,clientTop:1,clientWidth:1139,clientHeight:609});
    shell.bounds=zoom===.5?rect(-145.9635467529297,221.33334350585935,424.0364532470703,531.4479370117188)
        :rect(-637.890625,163.99998474121094,1072.109375,1094.343734741211);
    const bounds=zoom===.5?rect(-145.63021850585938,316.3333435058594,-85.63021850585938,437.4479293823242)
        :rect(-636.890625,449,-456.890625,812.34375);
    const target=f.control(f.a,'TD',bounds);
    return {f,shell,target};
}
for(const zoom of [.5,1.5])test(`fractional scrollport leading edge permits actual ${zoom*100}% Tab geometry`,()=>{
    const {f,target}=fractionalScrollport(zoom),delta=revealDelta(target.bounds,f.root.bounds);
    f.tabTo(target);f.flush();assert.equal(f.pans.length,1);
    assert.deepEqual(f.pans[0],{x:50-delta.dx,y:200-delta.dy,zoom:1.5});
    assert.equal(f.doc.activeElement,target);assert.deepEqual(f.writes,[]);f.controller.destroy();
});

test('fractional leading correction still rejects real .001px and .01px clipping on both axes',()=>{
    for(const zoom of [.5,1.5])for(const amount of [.001,.01])for(const axis of ['left','top']){
        const {f,shell,target}=fractionalScrollport(zoom);
        if(axis==='left'){target.bounds.left-=amount;target.bounds.right-=amount;}
        else {target.bounds.top=shell.bounds.top+(2/3)*zoom-amount;target.bounds.bottom=target.bounds.top+20;}
        f.tabTo(target);f.flush();assert.equal(f.pans.length,0,`${zoom}/${axis}/${amount}`);f.controller.destroy();
    }
});

test('fractional correction preserves legacy right/bottom scrollbar limits exactly',()=>{
    for(const edge of ['right','bottom'])for(const beyond of [0,.001,1]){
        const {f,shell,target}=fractionalScrollport(1.5);
        const sx=shell.bounds.width/shell.offsetWidth,sy=shell.bounds.height/shell.offsetHeight;
        const legacy=edge==='right'?(shell.bounds.left+shell.clientLeft*sx)+shell.clientWidth*sx
            :(shell.bounds.top+shell.clientTop*sy)+shell.clientHeight*sy;
        if(edge==='right'){target.bounds.right=legacy+beyond;target.bounds.left=target.bounds.right-180;}
        else {target.bounds.bottom=legacy+beyond;target.bounds.top=target.bounds.bottom-40;}
        f.tabTo(target);f.flush();assert.equal(f.pans.length,beyond===0?1:0,`${edge}/${beyond}`);f.controller.destroy();
    }
});

test('short fractional borders, unsupported style and leading gutters retain the old conservative path',()=>{
    const changes=[s=>s.css.borderLeftWidth='.5px',s=>s.css.borderLeftWidth='1px',s=>s.css.borderLeftWidth='calc(2px / 3)',
        s=>s.css.width='auto',s=>s.css.width='0px',s=>s.css.width='NaNpx',s=>s.css.boxSizing='unknown',
        s=>s.css.direction='rtl',s=>s.css.writingMode='vertical-rl',s=>delete s.css.writingMode,s=>s.css.scrollbarGutter='stable both-edges',
        s=>s.css.transform='matrix(1, .2, 0, 1, 0, 0)',s=>s.css.rotate='10deg',s=>s.css.scale='-1',s=>s.css.zoom='2',
        s=>s.clientLeft=11];
    for(const change of changes){const {f,shell,target}=fractionalScrollport(1.5);change(shell);f.tabTo(target);f.flush();
        assert.equal(f.pans.length,0,String(change));f.controller.destroy();}
});

test('fractional top uses floating used height and content-box leading border includes padding only in scale',()=>{
    for(const boxSizing of ['border-box','content-box']){
        const {f,shell,target}=fractionalScrollport(1.5);
        if(boxSizing==='content-box')Object.assign(shell.css,{boxSizing,width:'1130.67px',height:'610.896px',paddingLeft:'4px',paddingRight:'4px',paddingTop:'4px',paddingBottom:'4px'});
        target.bounds.top=shell.bounds.top+1;target.bounds.bottom=target.bounds.top+20;
        f.tabTo(target);f.flush();assert.equal(f.pans.length,1,boxSizing);assert.deepEqual(f.writes,[]);f.controller.destroy();
    }
});

test('fractional correction requires an axis-aligned ancestor path and rechecks ownership after its reads',()=>{
    for(const css of [{transform:'matrix(1, .2, 0, 1, 0, 0)'},{transform:'matrix(-1, 0, 0, 1, 0, 0)'},{perspective:'300px'},{rotate:'1deg'},{transform:undefined}]){
        const {f,target}=fractionalScrollport(1.5);f.a.body.css=css;f.tabTo(target);f.flush();assert.equal(f.pans.length,0);f.controller.destroy();
    }
    const {f,target}=fractionalScrollport(.5);f.a.body.css={transform:'matrix(0.5, 0, 0, 0.5, -30, 20)'};
    f.tabTo(target);f.flush();assert.equal(f.pans.length,1);f.controller.destroy();
    const changed=fractionalScrollport(1.5),read=changed.f.win.getComputedStyle;
    changed.f.win.getComputedStyle=e=>{const style=read(e);if(e===changed.f.a.body)changed.f.a.panel={};return style;};
    changed.f.tabTo(changed.target);changed.f.flush();assert.equal(changed.f.pans.length,0);changed.f.controller.destroy();
});
