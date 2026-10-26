import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../frontend/src/integrations/comfyui/canvas/media_upload.js',import.meta.url),'utf8');
const start=source.indexOf('    async function upload(file){'),end=source.indexOf('    picker.onchange=',start);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {resolve,reject,promise};};
function fixture(){
  const events=[],wait=deferred(),data={value:'original',callback(){events.push('callback');}},node={id:1,mode:0,outputs:[]};
  const graph={id:'workflow-a',getNodeById:()=>node,setDirtyCanvas(){},change(){events.push('change');}};node.graph=graph;
  const status={},choose={},root={setAttribute(){},removeAttribute(){}},app={api:{fetchApi:async()=>({ok:true,json:async()=>({name:'file.png',subfolder:'DAELAB/uploads'})})}};
  const registration={kind:'image',assetId:'registered',referenceId:'reference',byteSize:12,contentSha256:'a'.repeat(64),asset:{version:1,kind:'image',name:'sample.png',filename:'file.png',subfolder:'DAELAB/uploads',type:'input',assetId:'registered',referenceId:'reference',byteSize:12,contentSha256:'a'.repeat(64)}};
  const registrar=async input=>{events.push(['register',input]);return wait.promise;};
  const history={begin(){events.push('begin');},end(){events.push('end');}};
  const load=new Function('node','data','status','choose','root','app','registerAsset','history',
    "let disposed=false,asset=null,controller=null,epoch=0,task=null;const mediaKind=()=> 'image',render=()=>{},source=operation=>({operation,documentId:String(node.graph.id),nodeId:String(node.id)});"+source.slice(start,end)+'\nreturn {upload,dispose(){disposed=true;}};');
  return {...load(node,data,status,choose,root,app,registrar,history),events,data,node,status,wait,registration};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('upload registers before one workflow edit, keeps occurrence ID separate and does not create a favorite',async()=>{
  const f=fixture(),pending=f.upload(new File(['synthetic'],'sample.png'));await settle();
  assert.equal(f.data.value,'original');assert.equal(f.events.filter(x=>x==='begin').length,0);
  assert.equal(f.events[0][0],'register');assert.equal(f.events[0][1].source.nodeId,'1');
  f.wait.resolve(f.registration);await pending;
  const value=JSON.parse(f.data.value);assert.equal(value.assetId,'registered');assert.equal(value.referenceId,'reference');assert.notEqual(value.id,value.assetId);
  assert.deepEqual(f.events.filter(x=>typeof x==='string'),['begin','callback','change','end']);
});
test('registration failure or stale upload completion preserves previous widget and never opens history',async()=>{
  for(const change of ['failure','workflow','widget','dispose']){
    const f=fixture(),pending=f.upload(new File(['synthetic'],'sample.png'));await settle();
    if(change==='workflow')f.node.graph={...f.node.graph,id:'workflow-b'};
    if(change==='widget')f.data.value='new user edit';if(change==='dispose')f.dispose();
    if(change==='failure')f.wait.reject(Error('storage unavailable'));else f.wait.resolve(f.registration);
    await pending;assert.equal(f.data.value,change==='widget'?'new user edit':'original');assert.equal(f.events.includes('begin'),false);
    if(change==='failure')assert.match(f.status.textContent,/storage unavailable/);
  }
});
