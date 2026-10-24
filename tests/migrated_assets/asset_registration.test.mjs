import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {service,memoryPort} from './asset_test_modules.mjs';
const code=ts.transpileModule(readFileSync(new URL('../../frontend/src/application/asset_registration.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {createTextSnapshotRegistration}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {resolve,reject,promise};};
const receipt={kind:'text',assetId:'stable-text',contentSha256:'a'.repeat(64),byteSize:4,status:'available'};

test('text typing/invalidation and reloading cause no registration; only explicit commit registers',async()=>{
  let text='first',calls=0,applied=0;const errors=[];
  const options={read:()=>text,source:()=>({operation:'text-commit',documentId:'a',nodeId:'1'}),current:()=>true,register:async input=>{calls++;assert.equal(input.text,text);return receipt;},apply:()=>applied++,error:e=>errors.push(e)};
  const a=createTextSnapshotRegistration(options);a.invalidate();text='second';a.invalidate();assert.equal(calls,0);
  await a.commit();assert.equal(calls,1);assert.equal(applied,1);assert.equal(text,'second');
  a.dispose();const reload=createTextSnapshotRegistration(options);assert.equal(calls,1);reload.dispose();assert.deepEqual(errors,[]);
});
test('late text registration on changed input/workflow/disposal cannot write metadata or editable text',async()=>{
  for(const change of ['text','source','current','dispose']){
    const wait=deferred();let text='original',documentId='a',current=true,applied=0;
    const controller=createTextSnapshotRegistration({read:()=>text,source:()=>({operation:'text-commit',documentId}),current:()=>current,register:()=>wait.promise,apply:()=>applied++,error:()=>{}});
    const result=controller.commit();if(change==='text')text='new';if(change==='source')documentId='b';if(change==='current')current=false;if(change==='dispose')controller.dispose();
    wait.resolve(receipt);assert.equal(await result,null);assert.equal(applied,0);assert.equal(text,change==='text'?'new':'original');
  }
});
test('text storage failure leaves original text and reports no registration success',async()=>{
  let text='keep',applied=0;const errors=[];
  const c=createTextSnapshotRegistration({read:()=>text,source:()=>({operation:'text-commit'}),current:()=>true,register:async()=>{throw Error('write failed');},apply:()=>applied++,error:e=>errors.push(e.message)});
  assert.equal(await c.commit(),null);assert.equal(text,'keep');assert.equal(applied,0);assert.deepEqual(errors,['write failed']);
});
test('public service rejects incomplete or wrong-source media receipts before callers mutate widgets',async t=>{
  const port=memoryPort(),release=service.bindAssetLibraryService(port);t.after(release);
  const input={kind:'image',name:'a',asset:{version:1,kind:'image',name:'a',filename:'a.png',subfolder:'',type:'input'}};
  port.register=async()=>({...receipt,kind:'image'});await assert.rejects(service.registerAsset(input),/不完整/);
  port.register=async()=>({...receipt,kind:'image',referenceId:'r',asset:{...input.asset,filename:'other.png',assetId:receipt.assetId,referenceId:'r',contentSha256:receipt.contentSha256,byteSize:4}});
  await assert.rejects(service.registerAsset(input),/另一来源/);
});
