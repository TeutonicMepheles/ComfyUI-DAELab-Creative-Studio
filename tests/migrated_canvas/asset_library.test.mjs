import test from 'node:test';
import assert from 'node:assert/strict';
import {model,service,memoryPort} from '../migrated_assets/asset_test_modules.mjs';
const {LIBRARY_KEY,normalizeAsset,assetKey,readLegacyLibrary,readLegacyDocument,readLibrary,saveFavorite,removeFavorite,subscribeLibrary}=model;
const image={kind:'image',name:'参考图',filename:'reference.png',subfolder:'DAELAB/uploads',type:'input',url:'https://private.invalid/key',provenance:{secret:'not stored'}};
const storageFor=raw=>({getItem:key=>key===LIBRARY_KEY?raw:null,setItem(){throw new Error('legacy must remain read-only');},removeItem(){throw new Error('legacy must remain intact');}});
test('media identity ignores node id labels and unowned metadata through server port',async()=>{
 const release=service.bindAssetLibraryService(memoryPort());try{
  await saveFavorite(image);await saveFavorite({...image,name:'renamed',id:'other-node'});
  const list=(await readLibrary()).entries;assert.equal(list.length,1);assert.equal(list[0].name,'参考图');assert.equal(list[0].asset.url,undefined);assert.equal(list[0].asset.provenance,undefined);
  list[0].asset.filename='mutated.png';assert.equal((await readLibrary()).entries[0].asset.filename,'reference.png');
 }finally{release();}
});
test('server text snapshots stay independent and cancel preserves other favorites',async()=>{
 const release=service.bindAssetLibraryService(memoryPort());try{
  await saveFavorite({kind:'text',text:'original',name:'A'});await saveFavorite({kind:'text',text:'edited',name:'A'});
  const list=(await readLibrary()).entries;assert.deepEqual(list.map(e=>e.text),['edited','original']);await removeFavorite(list[0].id);assert.equal((await readLibrary()).entries[0].text,'original');
 }finally{release();}
});
test('invalid directories media types and oversized text never reach persistence',()=>{
 for(const a of [{...image,filename:'../x.png'},{...image,subfolder:'../'},{...image,subfolder:'C:/private'},{...image,type:'temp'},{...image,kind:'video'},{kind:'text',text:' '},{kind:'text',text:'x'.repeat(100001)}])assert.throws(()=>normalizeAsset(a));
 assert.equal(assetKey({...image,subfolder:'.'}),assetKey({...image,subfolder:''}));
});
test('corrupt or future old storage is reported without overwrite or deletion',()=>{
 for(const raw of ['{broken',JSON.stringify({version:2,entries:[]})]){const storage=storageFor(raw);assert.throws(()=>readLegacyLibrary(storage));assert.throws(()=>readLegacyDocument(storage));assert.equal(storage.getItem(LIBRARY_KEY),raw);}
 const original={version:1,entries:[{...normalizeAsset(image),id:'old-id',createdAt:1,future:{preserved:true}}]};
 const storage=storageFor(JSON.stringify(original));assert.equal(readLegacyLibrary(storage)[0].id,'old-id');assert.deepEqual(readLegacyDocument(storage),original);
});
test('failed server writes emit no success and subscription releases are independent',async()=>{
 const port=memoryPort(),release=service.bindAssetLibraryService(port);let changes=0;const unsubscribe=subscribeLibrary(()=>changes++);
 try{await saveFavorite(image);assert.equal(changes,1);port.save=async()=>{throw new Error('server storage failure');};await assert.rejects(saveFavorite(image),/server storage failure/);assert.equal(changes,1);unsubscribe();await removeFavorite('favorite-1');assert.equal(changes,1);}finally{unsubscribe();release();}
 await assert.rejects(saveFavorite(image),/尚未接入/);
});
