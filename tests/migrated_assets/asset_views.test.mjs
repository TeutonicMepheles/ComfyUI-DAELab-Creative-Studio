import test from 'node:test';
import assert from 'node:assert/strict';
import {service,modelURL,moduleURL,memoryPort,libraryURL} from './asset_test_modules.mjs';
import {Element as BaseElement} from '../migrated_business/prompt_optimization_dom.mjs';

const favoriteURL=moduleURL('features/assets/asset_favorite.mjs',{'./asset_library_model.mjs':modelURL});
const {createFavoriteButton}=await import(favoriteURL);
const {createAssetLibrary}=await import(libraryURL);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
class Element extends BaseElement{
  append(...nodes){for(const node of nodes){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(item=>item!==node);node.parentNode=this;this.children.push(node);}}
  insertBefore(node,before){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(item=>item!==node);node.parentNode=this;const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,node);}
  prepend(...nodes){for(const node of nodes.reverse()){node.parentNode=this;this.children.unshift(node);}}
  querySelectorAll(selector){const match=e=>selector.startsWith('.')?e.className?.split(' ').includes(selector.slice(1)):selector==='[data-asset-id]'?!!e.dataset.assetId:selector==='[data-remove-id]'?!!e.dataset.removeId:e.tagName===selector;return this.children.flatMap(e=>[...(match(e)?[e]:[]),...e.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(){return null;}
  focus(){document.activeElement=this;}
  pause(){this.paused=true;}
  load(){}
  close(){this.open=false;}
  showModal(){this.open=true;}
}
function dom(t){
  const old=globalThis.document,location=globalThis.location;
  globalThis.document={createElement:tag=>new Element(tag),activeElement:null};globalThis.location={origin:'http://127.0.0.1:8226'};
  t.after(()=>{if(old===undefined)delete globalThis.document;else globalThis.document=old;if(location===undefined)delete globalThis.location;else globalThis.location=location;});
}
test('two favorite buttons keep snapshots independent and ignore stale/destroyed lookups',async t=>{
  dom(t);const port=memoryPort(),pending=[];
  port.lookup=input=>{const wait=deferred();pending.push({input,wait});return wait.promise;};
  const release=service.bindAssetLibraryService(port);t.after(release);
  let value={kind:'text',name:'A',text:'original'};
  const a=createFavoriteButton(()=>value),b=createFavoriteButton(()=>({kind:'text',name:'B',text:'other'}));t.after(()=>{a.destroy();b.destroy();});
  value={...value,text:'edited'};a.sync();assert.equal(pending.length,3);
  pending[0].wait.resolve({id:'stale'});pending[1].wait.resolve({id:'b'});pending[2].wait.resolve(null);await settle();
  assert.equal(a.button.getAttribute('aria-pressed'),'false');assert.equal(b.button.getAttribute('aria-pressed'),'true');
  value={...value,text:'third'};a.sync();a.destroy();pending[3].wait.resolve({id:'late'});await settle();
  assert.equal(a.button.getAttribute('aria-pressed'),'false');
});
test('asset drawers request one page per instance and avoid thousands of video preloaders',async t=>{
  dom(t);const port=memoryPort(),pending=[];
  port.search=query=>{const wait=deferred();pending.push({query,wait});return wait.promise;};
  const release=service.bindAssetLibraryService(port);t.after(release);
  const roots=[new Element('section'),new Element('section')];
  const libraries=roots.map(root=>createAssetLibrary(root,{onCreate(){},onAdd:async()=>{}}));t.after(()=>libraries.forEach(l=>l.destroy()));
  for(const library of libraries)library.dock.children.find(e=>e.textContent==='资产库').onclick();
  assert.equal(pending.length,2);assert.equal(pending[0].query.limit,48);
  const entries=Array.from({length:48},(_,n)=>({id:'f'+n,assetId:'a'+n,kind:'video',name:'video '+n,asset:{kind:'video',filename:n+'.mp4',subfolder:'',type:'input'}}));
  pending[0].wait.resolve({entries,total:2000,hasMore:true});pending[1].wait.resolve({entries:[],total:0,hasMore:false});await settle();
  assert.equal(roots[0].querySelectorAll('video').length,48);assert.equal(roots[1].querySelectorAll('video').length,0);
  assert.ok(roots[0].querySelectorAll('video').every(video=>video.preload==='none'));
  const next=roots[0].querySelectorAll('button').find(e=>e.textContent==='下一页');const moving=next.onclick();
  assert.equal(pending[2].query.offset,48);libraries[0].close();assert.equal(pending[2].query.signal.aborted,true);
  pending[2].wait.resolve({entries:[entries[0]],total:2000,hasMore:true});await moving;
  assert.equal(libraries[0].drawer.hidden,true);assert.equal(libraries[1].drawer.hidden,false);
});

test('paging busy completion retains last-page and first-page disabled eligibility',async t=>{
  dom(t);const port=memoryPort();
  for(let i=0;i<50;i++)await port.save({kind:'text',name:'Text '+i,text:'Body '+i});
  const release=service.bindAssetLibraryService(port);t.after(release);
  const root=new Element('section'),library=createAssetLibrary(root,{onCreate(){},onAdd:async()=>{}});t.after(()=>library.destroy());
  library.dock.children.find(e=>e.textContent==='资产库').onclick();await settle();
  const next=root.querySelectorAll('button').find(e=>e.textContent==='下一页');
  const previous=root.querySelectorAll('button').find(e=>e.textContent==='上一页');
  assert.equal(previous.disabled,true);assert.equal(next.disabled,false);
  await next.onclick();assert.equal(next.disabled,true);assert.equal(previous.disabled,false);
  await previous.onclick();assert.equal(previous.disabled,true);assert.equal(next.disabled,false);
});

test('mounted folders create at the parent, navigate without moving favorites, and preserve view on reopen',async t=>{
 dom(t);const raf=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=fn=>fn();t.after(()=>{if(raf===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=raf;});
 const port=memoryPort(),folders=[];await port.save({kind:'text',name:'Original',text:'Original body'});
 port.listFolders=async()=>structuredClone(folders);
 port.createFolder=async(parentId,name)=>{if(!name.trim())throw Error('Name required');if(folders.some(f=>f.parentId===parentId&&f.name===name))throw Error('Duplicate name');const folder={folderId:'folder-'+(folders.length+1),parentId,name,relativePath:name};folders.push(folder);return structuredClone(folder);};
 const release=service.bindAssetLibraryService(port);t.after(release);const root=new Element('section'),library=createAssetLibrary(root,{onCreate(){},onAdd:async()=>{}});t.after(()=>library.destroy());
 const toggle=library.dock.children.find(e=>e.textContent==='资产库');toggle.onclick();await settle();
 assert.ok(root.querySelector('.library-sidebar'));assert.equal(root.querySelectorAll('.dae-library-tile').length,1);
 root.querySelector('.new-folder').onclick();let form=root.querySelector('.folder-editor');form.onsubmit({preventDefault(){}});await settle();
 assert.match(root.querySelector('.form-error').textContent,/Name required/);assert.equal(folders.length,0);
 form=root.querySelector('.folder-editor');const input=form.children.find(e=>e.tagName==='input');input.value='Characters';input.oninput();form.onsubmit({preventDefault(){}});await settle();
 assert.equal(folders.length,1);assert.equal(folders[0].parentId,'root');assert.equal(root.querySelector('.new-folder').textContent,'新建文件夹');
 root.querySelectorAll('.folder-card').find(e=>e.getAttribute('aria-label')==='进入文件夹 Characters').onclick();await settle();
 assert.equal(root.querySelector('.new-folder').textContent,'新建子文件夹');assert.equal(root.querySelectorAll('.dae-library-tile').length,0);
 library.close();toggle.onclick();await settle();assert.equal(root.querySelector('.new-folder').textContent,'新建子文件夹');
 root.querySelector('.new-folder').onclick();form=root.querySelector('.folder-editor');let prevented=false,stopped=false;form.children.find(e=>e.tagName==='input').onkeydown({key:'Escape',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
 assert.equal(prevented&&stopped,true);assert.equal(library.drawer.hidden,false);assert.equal(folders.length,1);
 root.querySelectorAll('button').find(e=>e.getAttribute('aria-label')==='返回上一级').onclick();await settle();assert.equal(root.querySelectorAll('.dae-library-tile').length,1);
 assert.equal((await port.search()).entries[0].text,'Original body');
});
