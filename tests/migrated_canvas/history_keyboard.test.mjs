import '../migrated_business/register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {canvasHistory}=await import('../../frontend/src/integrations/comfyui/canvas/creative_history.mjs');

// Fixed host 1.53.10: src/scripts/changeTracker.ts, captureCanvasState (397-429),
// squashState (431-444), before/afterChange (504-512), init keydown (520-570).
// Its window CAPTURE listener queues undoRedo in rAF before the Canvas root's
// BUBBLE listener sees the same event. stopPropagation cannot cancel that rAF.
// Keep that observable ordering, including native nested transactions and the
// delayed squash, instead of an afterChange stub that only counts method calls.
function fixture(){
  let state={nodes:[{id:3,type:'DAELAB.MaterialGroup'}],links:[],extra:{daelabCreativeCanvasV1:{active:true,cards:{3:{x:10}},viewport:{x:0,y:0,zoom:1}}}};
  const graph={serialize:()=>structuredClone(state)},frames=[],calls=[];
  let pendingSquash=false;
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const t={changeCount:0,_restoringState:false,initialState:structuredClone(state),activeState:structuredClone(state),undoQueue:[],redoQueue:[],
    updateModified(){},
    captureCanvasState(){
      if(this.changeCount>0||this._restoringState)return;
      const next=graph.serialize();if(same(this.activeState,next))return;
      this.undoQueue.push(this.activeState);this.activeState=next;this.redoQueue.length=0;pendingSquash=true;
    },
    beforeChange(){this.changeCount++;},afterChange(){if(!--this.changeCount)this.captureCanvasState();},
    async updateState(source,target){
      const previous=source.pop();if(!previous)return;
      target.push(this.activeState);this._restoringState=true;
      try{state=structuredClone(previous);await Promise.resolve();this.activeState=previous;}
      finally{this._restoringState=false;}
    },
    async undo(){calls.push('undo');await this.updateState(this.undoQueue,this.redoQueue);},
    async redo(){calls.push('redo');await this.updateState(this.redoQueue,this.undoQueue);},
    async undoRedo(e){
      if((e.ctrlKey||e.metaKey)&&!e.altKey){
        const key=e.key.toUpperCase();
        if((key==='Y'&&!e.shiftKey)||(key==='Z'&&e.shiftKey)){await this.redo();return true;}
        if(key==='Z'&&!e.shiftKey){await this.undo();return true;}
      }
    },
  };
  t.squashState={flush(){if(!pendingSquash)return;pendingSquash=false;t.activeState=graph.serialize();}};
  const app={graph,rootGraph:graph,extensionManager:{workflow:{activeWorkflow:{changeTracker:t}}}};
  const history=canvasHistory(app,{diagnose:d=>{throw new Error(d.capability);}});
  const view=readFileSync(new URL('../../frontend/src/canvas/creative_canvas_view.mjs',import.meta.url),'utf8');
  const start=view.indexOf("root.addEventListener('keydown',e=>{");
  const end=view.indexOf('\n    function show()',start);
  assert.ok(start>=0&&end>start);
  let handler;
  new Function('root','history','picker',view.slice(start,end))({addEventListener(type,fn){handler=fn;}},history,null);
  async function press(key,{shiftKey=false,altKey=false,repeat=false,editable=false}={}){
    const e={key,ctrlKey:true,metaKey:false,shiftKey,altKey,repeat,isComposing:false,
      target:{closest:()=>editable?{}:null},preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};
    // The host has already captured the event, regardless of bubble cancellation.
    if(!repeat)frames.push(async()=>{if(!editable)await t.undoRedo(e);});
    handler(e);
    await Promise.resolve();while(frames.length)await frames.shift()();
  }
  function createEditor(){
    history.begin();try{state.nodes.push({id:4,type:'DAELAB.VideoEdit',clips:[]});state.extra.daelabCreativeCanvasV1.cards[4]={x:20};}finally{history.end();}
    t.squashState.flush(); // Creation settled long before the later connection.
  }
  function connect(){
    history.begin();try{
      t.beforeChange(); // Native LGraph connection also owns a nested transaction.
      state.links.push([1,3,0,4,0,'DAELAB_ASSETS']);t.afterChange();
    }finally{history.end();}
  }
  function deriveClips(){history.amend(()=>{state.nodes.find(n=>n.id===4).clips=[{source:1,duration:3},{source:2,duration:3}];});}
  return {history,t,press,createEditor,connect,deriveClips,calls,state:()=>state};
}

test('one Canvas Ctrl+Z undoes only connection and Ctrl+Y restores both link and derived clips',async()=>{
  const f=fixture();f.createEditor();f.connect();f.deriveClips();
  assert.equal(f.t.undoQueue.length,2);assert.equal(f.state().nodes[1].clips.length,2);
  await f.press('z');
  assert.deepEqual(f.calls,['undo'],'one physical key must reach native undo only once');
  assert.deepEqual(f.state().nodes.map(n=>n.id),[3,4]);assert.deepEqual(f.state().links,[]);
  assert.deepEqual(f.state().nodes[1].clips,[]);
  await f.press('y');
  assert.deepEqual(f.calls,['undo','redo']);
  assert.deepEqual(f.state().links,[[1,3,0,4,0,'DAELAB_ASSETS']]);
  assert.equal(f.state().nodes[1].clips.reduce((sum,c)=>sum+c.duration,0),6);
});

test('Shift+Ctrl+Z is one native redo and navigation preserves edit history and current viewport',async()=>{
  const f=fixture();f.createEditor();f.connect();f.deriveClips();
  const viewport={x:23,y:45,zoom:.5};f.state().extra.daelabCreativeCanvasV1.viewport={...viewport};f.history.updateViewport(viewport);
  await f.press('z');await f.press('z',{shiftKey:true});
  assert.deepEqual(f.calls,['undo','redo']);assert.equal(f.state().links.length,1);
  assert.deepEqual(f.state().extra.daelabCreativeCanvasV1.viewport,viewport);
  await f.press('z');await f.press('z');
  assert.deepEqual(f.state().nodes.map(n=>n.id),[3],'the next explicit undo owns node creation');
});

test('text focus, Alt shortcuts and repeated keydown do not dispatch Canvas history',async()=>{
  const f=fixture();f.createEditor();f.connect();f.deriveClips();
  await f.press('z',{editable:true});await f.press('z',{altKey:true});await f.press('z',{repeat:true});
  assert.deepEqual(f.calls,[]);assert.equal(f.state().links.length,1);
});
