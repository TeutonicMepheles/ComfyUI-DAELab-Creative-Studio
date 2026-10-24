import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {model,service,memoryPort} from './asset_test_modules.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('two view scopes ignore out-of-order responses without cancelling each other',async()=>{
  const a=service.createAssetRequestScope(),b=service.createAssetRequestScope(),first=deferred(),second=deferred(),other=deferred(),results=[];
  const one=a.run(()=>first.promise,value=>results.push('old:'+value),assert.fail);
  const two=a.run(()=>second.promise,value=>results.push('new:'+value),assert.fail);
  const three=b.run(()=>other.promise,value=>results.push('other:'+value),assert.fail);
  second.resolve(2);await two;first.resolve(1);await one;other.resolve(3);await three;
  assert.deepEqual(results,['new:2','other:3']);a.dispose();b.dispose();
});
test('released view ignores late failures and aborts only its own request',async()=>{
  const scope=service.createAssetRequestScope(),pending=deferred();let signal,called=0;
  const running=scope.run(s=>{signal=s;return pending.promise;},()=>called++,()=>called++);
  scope.dispose();assert.equal(signal.aborted,true);pending.reject(new Error('late'));await running;assert.equal(called,0);
});
test('explicit legacy import forwards original fields and origin without browser writes',async()=>{
  const original={version:1,entries:[{id:'old',kind:'text',name:'old',text:'source',future:{raw:true}}]},raw=JSON.stringify(original);
  const storage={getItem:()=>raw,setItem:()=>assert.fail('write'),removeItem:()=>assert.fail('delete')};
  const port=memoryPort();let received;
  port.importLegacy=async(origin,document)=>{received={origin,document};return {schemaVersion:1,origin,source_preserved:true,accepted:1,rejected:0,report:[{index:0,status:'available'}]};};
  const release=service.bindAssetLibraryService(port);try{await model.importLegacyLibrary('http://localhost:8000',model.readLegacyDocument(storage));assert.deepEqual(received,{origin:'http://localhost:8000',document:original});assert.equal(storage.getItem(),raw);}finally{release();}
});
test('one broken subscriber cannot hide a committed server save from other views',async()=>{
  const release=service.bindAssetLibraryService(memoryPort());let updated=0;
  const bad=service.subscribeAssetLibrary(()=>{throw new Error('broken view');});
  const good=service.subscribeAssetLibrary(()=>updated++),original=console.error;console.error=()=>{};
  try{const saved=await model.saveFavorite({kind:'text',name:'fixture',text:'committed'});assert.ok(saved.id);assert.equal(updated,1);}
  finally{bad();good();console.error=original;release();}
});
test('production asset UI has bounded pages and does not preload all video thumbnails',()=>{
  const source=readFileSync(new URL('../../frontend/src/features/assets/asset_library.mjs',import.meta.url),'utf8');
  assert.match(source,/pageSize=48/);assert.match(source,/preload=large\?'metadata':'none'/);assert.match(source,/requests\.dispose\(\)/);assert.doesNotMatch(source,/收藏保存在此浏览器/);
  const modelSource=readFileSync(new URL('../../frontend/src/features/assets/asset_library_model.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(modelSource,/\.setItem\(|\.removeItem\(|writeLibrary|mutateLibrary/);
});
