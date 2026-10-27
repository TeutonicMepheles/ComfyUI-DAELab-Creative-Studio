import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../frontend/src/features/table/editor_runtime.mjs',import.meta.url),'utf8');
function fixture({native=true}={}){
  const calls=[],frames=[];
  const nativeDocument=native?{undo(){calls.push('undo');},redo(){calls.push('redo');},invalidate(){calls.push('invalidate');}}:null;
  const onRestore=()=>calls.push('onRestore');
  const startRestore=source.indexOf(' function restore(redo=false){'),endRestore=source.indexOf('\n const undo=',startRestore);
  const restore=native?new Function('nativeDocument','onRestore','notify',source.slice(startRestore,endRestore)+'\nreturn restore;')(nativeDocument,onRestore,error=>{throw error;}):redo=>calls.push(redo?'local-redo':'local-undo');
  const nativeHistory=native?{prepareNativeShortcut(){calls.push('prepare');return true;}}:null;
  let keydown;
  const start=source.indexOf(" root.addEventListener('keydown',e=>{");
  const end=source.indexOf("\n for(const event of ['pointerdown'",start);
  assert.ok(start>=0&&end>start);
  new Function('root','nativeDocument','nativeHistory','displayContent','restore','onRestore','cellSelection',source.slice(start,end))(
    {addEventListener(type,fn){keydown=fn;}},nativeDocument,nativeHistory,()=>true,restore,onRestore,{end:null});
  async function press(key,options={}){
    const e={key,ctrlKey:true,metaKey:false,shiftKey:false,altKey:false,repeat:false,isComposing:false,
      target:{isContentEditable:false,matches:()=>false,closest:()=>true},preventDefault(){this.defaultPrevented=true;},...options};
    if(native&&!e.repeat&&!e.altKey&&!e.isComposing&&e.keyCode!==229&&!e.target.isContentEditable&&!e.target.matches()){
      const k=key.toUpperCase();if(k==='Z'||(k==='Y'&&!e.shiftKey))frames.push(()=>calls.push(k==='Y'||e.shiftKey?'redo':'undo'));
    }
    keydown(e);await Promise.resolve();while(frames.length)frames.shift()();return e;
  }
  return {calls,press,restore};
}
test('table native document keyboard undo/redo runs once and still invalidates pending reviews',async()=>{
  for(const [key,options,action] of [['z',{},'undo'],['Z',{shiftKey:true},'redo'],['y',{},'redo']]){
    const f=fixture();await f.press(key,options);
    assert.deepEqual(f.calls.filter(c=>c==='undo'||c==='redo'),[action]);
    assert.equal(f.calls.filter(c=>c==='prepare').length,1);assert.equal(f.calls.filter(c=>c==='invalidate').length,1);assert.equal(f.calls.filter(c=>c==='onRestore').length,1);
  }
});
test('table toolbar restore keeps direct native document history and standalone local history remains local',async()=>{
  const f=fixture();await f.restore();await f.restore(true);
  assert.deepEqual(f.calls,['onRestore','undo','onRestore','redo']);
  const local=fixture({native:false});await local.press('z');await local.press('z',{shiftKey:true});
  assert.deepEqual(local.calls,['local-undo','local-redo']);
});
test('table keyboard leaves text undo, IME, Alt and repeated keys outside native document dispatch',async()=>{
  const f=fixture();
  for(const options of [{isComposing:true},{keyCode:229},{altKey:true},{repeat:true},{target:{isContentEditable:true,matches:()=>false}},{target:{isContentEditable:false,matches:()=>true}}]){
    await f.press('z',options);
  }
  assert.deepEqual(f.calls,[]);
});
