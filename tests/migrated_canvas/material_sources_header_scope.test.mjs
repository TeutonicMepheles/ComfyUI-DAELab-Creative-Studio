import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

function extract(path,predicate){
 const text=readFileSync(new URL(path,import.meta.url),'utf8'),tree=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),found=[];
 function visit(node){if(predicate(node))found.push(node);ts.forEachChild(node,visit);}visit(tree);
 assert.equal(found.length,1);return found[0].getText(tree);
}
const sourceProperty=extract('../../frontend/src/integrations/comfyui/business/creative_canvas_adapter.js',n=>ts.isPropertyAssignment(n)&&n.name.getText()==='materialSources');
const materialSources=new Function(`return ({${sourceProperty}}).materialSources;`)();
const decorateSource=extract('../../frontend/src/features/generation/table_generation_panel.mjs',n=>ts.isFunctionDeclaration(n)&&n.name?.text==='decorate');

// Traverse a DOM tree, rather than routing selectors to canned result lists.
// Count tbody reads only; this is not a browser selector-cost or timing model.
function tree(){
 const counts={bodyVisits:0};
 function element(tag){
  const e={tagName:tag,children:[],dataset:{},attributes:new Map(),className:'',isConnected:true};
  e.append=(...children)=>{for(const child of children){child.remove();child.parentElement=e;e.children.push(child);}};
  e.remove=()=>{if(e.parentElement){const siblings=e.parentElement.children;siblings.splice(siblings.indexOf(e),1);e.parentElement=null;}};
  e.replaceChildren=(...children)=>{for(const child of [...e.children])child.remove();e.append(...children);};
  e.setAttribute=(name,value)=>e.attributes.set(name,String(value));
  e.getAttribute=name=>e.attributes.get(name)??null;
  e.classList={add(name){e.className=[...new Set(e.className.split(' ').filter(Boolean).concat(name))].join(' ');}};
  e.matches=selector=>{
   if(selector.startsWith('.'))return e.className.split(' ').includes(selector.slice(1));
   const match=selector.match(/^(\w+)?(?:\[data-([a-z-]+)\])?$/);assert(match,'unsupported selector '+selector);
   return (!match[1]||e.tagName===match[1])&&(!match[2]||Object.hasOwn(e.dataset,match[2].replace(/-([a-z])/g,(_,c)=>c.toUpperCase())));
  };
  const walk=function*(parent){for(const child of parent.children){if(child.tagName==='tbody'||child.bodyDescendant)counts.bodyVisits++;yield child;yield*walk(child);}};
  e.querySelector=selector=>{for(const child of walk(e))if(child.matches(selector))return child;return null;};
  e.querySelectorAll=selector=>[...walk(e)].filter(child=>child.matches(selector));
  return e;
 }
 return {element,counts,reset(){counts.bodyVisits=0;}};
}
function fixture(id,fieldIds=['g0','g1'],rows=3){
 const dom=tree(),root=dom.element('section'),table={fields:[],records:Array.from({length:rows},(_,i)=>({id:'r'+i}))};
 const node={id,type:'DAELAB.Table',__dataTable:table,__dataTablePanel:{root}};
 const button=label=>{const e=dom.element('button');e.textContent=label;return e;};
 const collaborators={editor:{root},getTable:()=>table,isGeneration:field=>field.presentation==='generation',
  syncFrameTags(){},refreshFrameTokens(){},refreshSettingBars(){},generationRows:()=>table.records,
  el(tag,parent){const e=dom.element(tag);parent?.append(e);return e;},button,tableIcon:e=>e,
  document:{createElement:dom.element},tasks:{submitting:false,decorate(){}},leavePromptSources(){}};
 const decorate=new Function(...Object.keys(collaborators),`const promptSourceMenu=null,settingsMenu=null,frameAnchor=null,alive=true;${decorateSource};return decorate;`)(...Object.values(collaborators));
 let grid,head,body;
 function rebuild(ids=fieldIds,{generation=true,withHead=true}={}){
  table.fields=ids.map(id=>({id,type:'content',...(generation?{presentation:'generation'}:{})}));
  grid=dom.element('table');head=dom.element('thead');body=dom.element('tbody');
  if(withHead){const row=dom.element('tr');head.append(row);grid.append(head);for(const id of ids){const th=dom.element('th'),title=dom.element('span');th.dataset.column=id;title.className='field-title';title.textContent=id;th.append(title);row.append(th);}}
  grid.append(body);for(const record of table.records){const tr=dom.element('tr');tr.bodyDescendant=true;body.append(tr);for(const id of ids){const td=dom.element('td');td.bodyDescendant=true;td.dataset.field=id;td.dataset.record=record.id;tr.append(td);}}
  root.replaceChildren(grid);decorate();
 }
 rebuild();
 return {node,table,root,dom,decorate,rebuild,get head(){return head;},get body(){return body;}};
}
const legacy=node=>[...(node.__dataTablePanel?.root.querySelectorAll('[data-generation-source]')||[])].map(element=>({element,key:element.dataset.generationSource,label:'输出为素材组'}));
function equalLegacy(f){const expected=legacy(f.node),actual=materialSources(f.node);assert.deepEqual(actual,expected);return actual;}

test('real generation decorator produces header sources with exact elements and keys in two independent tables',()=>{
 const a=fixture(1),b=fixture(2),left=equalLegacy(a),right=equalLegacy(b);
 assert.deepEqual(left.map(x=>x.key),['g0','g1']);assert.deepEqual(right.map(x=>x.key),['g0','g1']);
 for(const [f,items] of [[a,left],[b,right]])for(const item of items){assert(f.head.querySelectorAll('[data-generation-source]').includes(item.element));assert(!f.body.querySelectorAll('[data-generation-source]').includes(item.element));assert.equal(item.element.getAttribute('aria-label'),'输出为素材组');}
 assert.notEqual(left[0].element,right[0].element);left[0].key='caller-only';assert.equal(materialSources(a.node)[0].key,'g0');
});

test('two 500x10 no-generation tables preserve empty sources without searching body rows on each poll',t=>{
 for(const id of [1,2]){
  const f=fixture(id,Array.from({length:10},(_,i)=>'f'+i),500);f.rebuild(f.table.fields.map(x=>x.id),{generation:false});
  assert.deepEqual(legacy(f.node),[]);f.dom.reset();
  for(let i=0;i<3;i++)assert.deepEqual(materialSources(f.node),[]);
  t.diagnostic(`owner${id} repeated source-query tbody visits: ${f.dom.counts.bodyVisits}`);
  assert.equal(f.dom.counts.bodyVisits,0,'header-owned sources must not require inspecting the 5000 unrelated body cells');
 }
});

test('fresh queries follow source key changes, column removal/reorder and rebuilt header without stale elements',()=>{
 const a=fixture(1),b=fixture(2),other=equalLegacy(b),before=equalLegacy(a);
 before[0].element.dataset.generationSource='changed-live';before[0].element.disabled=true;
 assert.equal(equalLegacy(a)[0].key,'changed-live');assert.equal(materialSources(a.node)[0].element.disabled,true);
 a.rebuild(['g1','new']);const rebuilt=equalLegacy(a);assert.deepEqual(rebuilt.map(x=>x.key),['g1','new']);assert(rebuilt.every(x=>!before.some(old=>old.element===x.element)));
 const row=a.head.children[0];row.append(row.children[0]);assert.deepEqual(equalLegacy(a).map(x=>x.key),['new','g1']);
 row.children[0].remove();assert.deepEqual(equalLegacy(a).map(x=>x.key),['g1']);assert.deepEqual(materialSources(b.node),other);
});

test('empty records retain real generation header sources; empty fields, absent header and released panel stay empty',()=>{
 const f=fixture(1,['g'],0);assert.equal(equalLegacy(f).length,1,'source existence follows the live header, not row count');
 f.rebuild([]);assert.deepEqual(equalLegacy(f),[]);
 f.rebuild(['g'],{withHead:false});assert.deepEqual(equalLegacy(f),[]);
 delete f.node.__dataTablePanel;assert.deepEqual(materialSources(f.node),[]);
 assert.deepEqual(materialSources({type:'DAELAB.LibTV.VideoGenerate',__libtvPanel:{root:f.root}}),[]);
});

test('panel replacement and externally moved header are observed on the next query without model shortcuts',()=>{
 const a=fixture(1),b=fixture(2,['next']),before=equalLegacy(a);a.node.__dataTablePanel.root=b.root;
 const next=materialSources(a.node);assert.deepEqual(next,legacy(a.node));assert.deepEqual(next.map(x=>x.key),['next']);assert.notEqual(next[0].element,before[0].element);
 // Model metadata is not a no-generation shortcut: producer-created live DOM
 // remains discoverable while an owning renderer transitions its field model.
 b.table.fields=[];assert.deepEqual(materialSources(a.node),next);
 b.head.remove();assert.deepEqual(materialSources(a.node),[]);
});
