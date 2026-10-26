import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../frontend/src/canvas/creative_canvas_view.mjs',import.meta.url),'utf8');
function body(name,end){
  const start=source.indexOf(`    function ${name}(`);
  if(start<0)return '';
  return source.slice(start,source.indexOf(end,start));
}
const functions=[
  body('animateWires','    const cards='),
  body('setIncomingWire','    function onReceivingSegment'),
  body('nearestIncoming','    function wireAnchor'),
  body('wireAnchor','    function drawWires'),
  body('drawWires','    function clear'),
  body('portCenter','    function '+(source.includes('    function measureMagnet(')?'measureMagnet':'setMagnet')),
  body('measureMagnet','    function paintMagnet'),
  body('paintMagnet','    function setMagnet'),
  body('setMagnet','    function materialTargetAt'),
  body('nearestPort',"    root.addEventListener('pointermove'"),
].join('\n');

// Read/write tracing of the actual production closures. This checks the DOM
// scheduling contract, not browser layout timing or the PERF-01 budget.
function fixture({count=100,zoom=.5,ordinary=false,reduced=false}={}){
  const events=[],frames=[],cards=new Map(),wirePaths=new Map(),wireGeometry=new WeakMap(),portOffsets=new WeakMap();
  const read=name=>events.push(['read',name]),write=name=>events.push(['write',name]);
  const dataset=initial=>new Proxy({...initial},{set(o,k,v){write(`dataset.${String(k)}`);o[k]=v;return true;},deleteProperty(o,k){write(`delete.${String(k)}`);delete o[k];return true;}});
  const style=()=>new Proxy({translate:'',removeProperty(key){write(`remove.${key}`);this[key]='';}},{set(o,k,v){write(`style.${String(k)}`);o[k]=v;return true;}});
  const classes=new Set();
  const root={dataset:dataset({wireSelected:'false'}),classList:{contains:c=>classes.has(c),toggle(c,on){write('root.class');if(on)classes.add(c);else classes.delete(c);}},dispatchEvent(){}};
  const state={viewport:{zoom}},links=[];
  for(let i=0;i<count;i++){
    const node={id:i,type:ordinary?'ThirdParty.Node':'DAELAB.TextInput'},base={left:(150+i*500)*zoom,top:0,width:200*zoom,height:100*zoom};
    base.right=base.left+base.width;base.bottom=base.top+base.height;
    const element={dataset:{unified:String(!ordinary)},getBoundingClientRect(){read(`card.${i}`);return base;}};
    const ports=['input','output'].map(side=>({disabled:false,hidden:false,dataset:dataset({side,slot:'0'}),style:style(),
      matches:()=>true,closest:()=>element,
      getBoundingClientRect(){read(`port.${i}.${side}`);const delta=(this.style.translate||'0px 0px').split(' ').map(parseFloat),cx=(side==='input'?base.left:base.right),cy=base.height/2;
        return {left:cx-16*zoom+(delta[0]||0)*zoom,top:cy-16*zoom+(delta[1]||0)*zoom,width:32*zoom,height:32*zoom};}}));
    const c={node,element,ports:{querySelector:selector=>ports[selector==='output'?1:0],querySelectorAll:()=>ports},materialPorts:new Map()};
    // A third-party adapter can expose its real input as a material target.
    if(ordinary)c.materialPorts.set(ports[0],{port:ports[0]});
    cards.set(i,c);
    const link={id:i,origin_id:i,target_id:(i+1)%count,origin_slot:0,target_slot:0};links.push(link);
    let d='';const path={dataset:dataset({selected:'false',disconnectTarget:'false'}),getAttribute:()=>d,
      setAttribute(_,value){write('path.d');d=value;},getTotalLength(){read('path.length');return 100;},getPointAtLength(n){read('path.point');return{x:n,y:50};},remove(){write('path.remove');}};
    wirePaths.set(i,path);wireGeometry.set(path,{x:0,y:0});
  }
  const graph={links},graphBefore=JSON.stringify(graph),world={getBoundingClientRect(){read('world');return{left:0,top:0};}};
  const wires={getScreenCTM(){read('matrix');return{a:zoom,b:0,c:0,d:zoom,e:0,f:0};}};
  const document={elementFromPoint(){read('hit');return{closest:()=>null};}};
  const host={nodes:()=>[...cards.values()].map(c=>c.node)};
  const globals={root,state,cards,wirePaths,wireGeometry,portOffsets,graph,world,wires,document,host,
    getComputedStyle(port){read('visibility');return{visibility:port.invisible?'hidden':'visible'};},
    requestAnimationFrame(fn){frames.push(fn);return frames.length;},graphLinks:g=>g.links,
    unifiedNode:n=>n.type.startsWith('DAELAB.'),suppressGroupSlots:(_nodes,n)=>!!n.suppressed,
    outputSelector:()=> 'output',inputSelector:()=> 'input',materialDropSnapshot:()=>null,targetChoices:()=>[{}],
    reducedMotion:{matches:reduced},SLOT_MAGNET_RADIUS:32,Event:class{},};
  const api=new Function(...Object.keys(globals),`let wireFrame=0,visible=true,hoverPoint=null,drag=null,selectedLink=null,incomingWire=null,magneticPort=null,picker=null,workspace=null,pickerConnection=null,addPoint=null;const selected=new Set();${functions}
    return {drawWires,setMagnet,nearestPort,frame(point){hoverPoint=point;animateWires();},offset:port=>portOffsets.get(port)};`)(...Object.values(globals));
  api.drawWires();events.length=0;
  const port=(i,side='input')=>cards.get(i).ports.querySelector(side);
  const center=p=>{const r=p.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};};
  return {api,events,port,cards,wirePaths,graph,graphBefore,center,run(point){api.frame(point);frames.shift()();},clear(){events.length=0;}};
}

test('100-node hover frame measures ports, receiving wires and all anchors before its first DOM write',t=>{
  const f=fixture(),p=f.port(0),point=f.center(p);point.x-=9;f.clear();f.run(point);
  const firstWrite=f.events.findIndex(([kind])=>kind==='write');
  t.diagnostic(JSON.stringify({syntheticNodes:100,geometryReads:f.events.filter(([kind])=>kind==='read').length,geometryReadsAfterFirstWrite:f.events.slice(firstWrite).filter(([kind])=>kind==='read').length,domWrites:f.events.filter(([kind])=>kind==='write').length}));
  assert.ok(firstWrite>=0);
  assert.deepEqual(f.events.slice(firstWrite).filter(([kind])=>kind==='read'),[], 'geometry after magnetic/highlight writes forces synchronous style/layout');
  assert.equal(JSON.stringify(f.graph),f.graphBefore,'view scheduling cannot mutate native graph');
});

test('stable hover does not rewrite identical magnetic attributes, translation or root class',()=>{
  const f=fixture(),point=f.center(f.port(0));point.x-=10;f.run(point);f.clear();f.run(point);
  assert.deepEqual(f.events.filter(([kind])=>kind==='write'),[]);
});

test('ordinary port wire endpoints receive this frame translation and previous port reset',()=>{
  for(const zoom of [.5,1,1.5]){
    const f=fixture({count:2,zoom,ordinary:true}),p=f.port(1),point=f.center(p);point.x-=12;f.clear();f.run(point);
    let actual=f.center(p),d=f.wirePaths.get(0).getAttribute('d');
    assert.ok(d.endsWith(`${actual.x/zoom},${actual.y/zoom}`),`${zoom}: endpoint must not lag magnet paint`);
    const next=f.port(0),nextPoint=f.center(next);nextPoint.x-=8;f.run(nextPoint);
    actual=f.center(p);d=f.wirePaths.get(0).getAttribute('d');
    assert.ok(d.endsWith(`${actual.x/zoom},${actual.y/zoom}`),`${zoom}: old endpoint reset must share frame`);
    const output=f.port(0,'output');f.cards.get(0).materialPorts.set(output,{port:output});
    const outputPoint=f.center(output);outputPoint.x+=12;f.run(outputPoint);
    actual=f.center(output);d=f.wirePaths.get(0).getAttribute('d');
    assert.ok(d.startsWith(`M${actual.x/zoom},${actual.y/zoom} `),`${zoom}: source endpoint must share paint`);
  }
});

test('unified wires remain at card edges while magnetic motion is bounded and reduced motion stays still',()=>{
  for(const zoom of [.5,1,1.5])for(const reduced of [false,true]){
    const f=fixture({count:2,zoom,reduced}),p=f.port(1),before=f.wirePaths.get(0).getAttribute('d'),point=f.center(p);point.x-=31;f.run(point);
    assert.equal(f.wirePaths.get(0).getAttribute('d'),before);
    const offset=f.api.offset(p);assert.ok(Math.hypot(offset.x,offset.y)*zoom<=6+1e-10);
    if(reduced)assert.deepEqual(offset,{x:0,y:0});
  }
});

test('direct pointer magnet measures before writes; disabled, suppressed and invisible slots cannot be hit',()=>{
  const f=fixture({count:2}),p=f.port(0),point=f.center(p);point.x-=8;f.clear();f.api.setMagnet(p,point);
  const firstWrite=f.events.findIndex(([kind])=>kind==='write');assert.deepEqual(f.events.slice(firstWrite).filter(([kind])=>kind==='read'),[]);
  p.disabled=true;assert.equal(f.api.nearestPort(point.x,point.y),null);p.disabled=false;
  p.invisible=true;assert.equal(f.api.nearestPort(point.x,point.y),null);p.invisible=false;
  f.cards.get(0).node.suppressed=true;assert.equal(f.api.nearestPort(point.x,point.y),null);
});
