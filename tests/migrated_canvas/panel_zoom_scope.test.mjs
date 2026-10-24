import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createTaskCapsules} from '../../frontend/src/features/tasks/creative_tasks.mjs';

// Dependency and ownership guards only. CSS layout, browser invalidation cost,
// focus/overflow, modes and save/reload still require the real ComfyUI checks.
const root=fileURLToPath(new URL('../../frontend/src/',import.meta.url));
const read=name=>readFileSync(path.join(root,name),'utf8');
const normalize=text=>text.replace(/\s+/g,' ').trim();
const reset=/--dae-canvas-(?:inverse-)?zoom\s*:/;
const variable=/var\(\s*--dae-canvas-(?:inverse-)?zoom\b/;
function files(directory=root){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):[path.join(directory,entry.name)]);}
function rules(source){return [...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([,selector,body])=>({selector:normalize(selector),body}));}
const scopes=[
 ['canvas/creative_canvas.css','.dae-creative > .dae-creative-world > .dae-creative-card > .dae-creative-heading > :is(strong,.dae-creative-icon,.dae-task-capsules)'],
 ['canvas/creative_canvas.css','.dae-creative .dae-creative-card > .dae-creative-body > .dae-ui.dae-text-input[data-canvas-panel=true]'],
 ['features/prompt/llm_style_preview.css','.dae-creative .dae-creative-card > .dae-creative-body > .dae-ui.llm-style-B[data-canvas-panel=true]'],
];

test('zoom resets whitelist only owned body roots and direct nonconsumer heading children',()=>{
 for(const file of new Set(scopes.map(([file])=>file))){
  const declarations=rules(read(file)).filter(rule=>reset.test(rule.body));
  assert.deepEqual(declarations.map(rule=>rule.selector).sort(),scopes.filter(([owner])=>owner===file).map(([,selector])=>selector).sort(),`${file}: exact owned boundaries, never the heading, all panels or cards`);
  for(const rule of declarations)assert.deepEqual(rule.body.split(';').map(value=>value.trim()).filter(Boolean),[
   '--dae-canvas-zoom:initial','--dae-canvas-inverse-zoom:initial',
  ],'reset only unused inherited values; do not change geometry, overflow, containment or transforms');
 }
});

test('heading whitelist is native owned DOM; its zoom geometry and capsule container remain dynamic',()=>{
 const view=read('canvas/creative_canvas_view.mjs');
 assert.match(view,/world=el\('div','dae-creative-world'\)/);
 assert.match(view,/root\.append\([^;]*world/);
 assert.match(view,/element=el\('article','dae-creative-card'\)/);
 assert.match(view,/heading=el\('header','dae-creative-heading'\),title=el\('strong','',node\.title\|\|node\.type\)/);
 assert.match(view,/const categoryIcon=item=>\{const icon=el\('i','dae-creative-icon'\)/);
 assert.match(view,/heading\.append\(categoryIcon\(category\)\)/);
 assert.match(view,/heading\.append\(title\)/);
 assert.match(view,/c\.tasks=createTaskCapsules\(\);heading\.append\(c\.tasks\.root\)/);
 assert.match(view,/element\.append\(heading,media,summary,body,typeLabel,portBox\);world\.append\(element\)/);
 assert.match(view,/title\.hidden=true;heading\.prepend\(input\)/,'rename input is a sibling outside the whitelist');
 assert.match(view,/c\.tasks\.update\(adapter\?\.tasks\?\.\(node\)\|\|\[\]\)/,'capsules still consume public readonly task snapshots');
 assert.equal([...view.matchAll(/c\.tasks\?\.destroy\(\)/g)].length,2,'both graph clear and individual removal release capsules');
 const css=read('canvas/creative_canvas.css');
 assert.match(css,/width:calc\(100% \/ var\(--dae-canvas-inverse-zoom,1\)\)/);
 assert.match(css,/margin-bottom:calc\(4px \* var\(--dae-canvas-inverse-zoom,1\)\)/);
 assert.match(css,/transform:scale\(var\(--dae-canvas-inverse-zoom,1\)\)/);
 assert.match(css,/zoom:calc\(1 \/ var\(--dae-canvas-zoom,1\)\)/);
 const tasks=read('features/tasks/creative_tasks.mjs');
 assert.deepEqual([...tasks.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match=>match[1]),['./creative_tasks_model.mjs']);
 assert.match(tasks,/root\.className='dae-task-capsules'/);
 const taskCss=read('features/tasks/creative_tasks.css');
 assert.match(taskCss,/\.dae-creative-heading\{position:relative;container-type:inline-size;container-name:dae-task-heading\}/);
 assert.match(taskCss,/@container dae-task-heading \(max-width:240px\)\{\.dae-creative \.dae-task-detail\{display:none\}/);
 assert.match(taskCss,/@container dae-task-heading \(max-width:110px\)\{\.dae-creative \.dae-task-capsules\{display:none\}\}/);
 assert.match(taskCss,/pointer-events:none/);
 assert.match(taskCss,/@media\(prefers-reduced-motion:reduce\)/);
 assert.doesNotMatch(taskCss,reset);
});

test('two readonly capsule instances update and expire independently without zoom or geometry reads',()=>{
 // DOM behaviour only; actual container thresholds/zoom/focus need host inspection.
 class Element{
  children=[];dataset={};attributes=new Map();parent=null;hidden=false;textContent='';
  setAttribute(name,value){this.attributes.set(name,value);}
  append(...children){for(const child of children){child.remove();child.parent=this;this.children.push(child);}}
  remove(){if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}}
  getBoundingClientRect(){throw new Error('readonly capsules must not read geometry');}
 }
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>new Element()}});
 try{
  const headingA=new Element(),headingB=new Element(),a=createTaskCapsules(),b=createTaskCapsules();
  headingA.append(a.root);headingB.append(b.root);
  const queued=[{id:'export',label:'A 导出',state:'queued',startedAt:1000,elapsed:true}];
  const error=[{id:'export',label:'B 导出',state:'error',detail:'输入已变更'}];
  const original=JSON.stringify([queued,error]);
  a.update(queued,2000);b.update(error,2000);
  const row=a.root.children[0],other=b.root.children[0];
  assert.equal(row.dataset.state,'queued');assert.equal(row.children[1].textContent,'A 导出');
  a.update([{...queued[0],state:'running',done:1,total:3}],3000);
  assert.equal(a.root.children[0],row);assert.equal(row.dataset.state,'running');
  assert.match(row.children[2].textContent,/1\/3/);
  assert.equal(b.root.children[0],other);assert.equal(other.dataset.state,'error');
  assert.match(other.children[2].textContent,/输入已变更/);
  const success=[{id:'export',label:'A 导出',state:'success',finishedAt:3000}];
  a.update(success,4000);assert.equal(a.root.hidden,false);
  a.update(success,7000);assert.equal(a.root.hidden,true);assert.equal(a.root.children.length,0);
  b.update(error,7000);assert.equal(b.root.hidden,false);
  assert.equal(JSON.stringify([queued,error]),original,'display must not mutate task facts');
  a.destroy();assert.equal(headingA.children.length,0);assert.equal(headingB.children[0],b.root);
  b.destroy();assert.equal(headingB.children.length,0);
 }finally{
  if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;
 }
});

test('scope identities come from actual panel constructors and the native lease lifecycle',()=>{
 const text=read('integrations/comfyui/canvas/text_input.js');
 const llm=read('features/prompt/llm_style_preview_panel.mjs');
 const llmAdapter=read('integrations/comfyui/business/llm_style_preview.js');
 const view=read('canvas/creative_canvas_view.mjs');
 assert.match(text,/root\.className='dae-ui dae-text-input'/);
 assert.match(text,/panel:node=>node\.__daeTextPanel/);
 assert.match(llm,/const root=el\('section',`dae-ui llm-style llm-style-\$\{variant\.id\}`\)/);
 assert.match(llm,/new URL\('\.\/llm_style_preview\.css',import\.meta\.url\)/);
 assert.match(llmAdapter,/matches:node=>node\.type==='DAELAB\.LLMStylePreviewB'/);
 assert.match(llmAdapter,/panel:node=>node\.__llmStylePanel/);
 assert.match(view,/c\.panel=panel;c\.release=leasePanel\(panel,c\.body/);
 assert.match(view,/c\.panel\.dataset\.canvasPanel='true'/);
 assert.match(view,/delete c\.panel\.dataset\.canvasPanel/,'release and abandon remove the canvas-only style scope');
 assert.match(view,/element\.append\(heading,media,summary,body,typeLabel,portBox\)/,'public headings, summaries and ports remain siblings outside the body');
 assert.match(view,/c\.widthHandle=handle;element\.append\(handle\)/);
 assert.match(view,/c\.element\.append\(port\);projected=/,'projected Slots remain outside the isolated body');
 assert.match(read('integrations/comfyui/canvas/creative_canvas.js'),/new URL\('\.\.\/\.\.\/\.\.\/canvas\/creative_canvas\.css/);
});

test('new CSS zoom consumers require reviewing owned body and heading-child boundaries',()=>{
 const actual=[];
 for(const file of files().filter(file=>file.endsWith('.css'))){
  const relative=path.relative(root,file).replaceAll('\\','/');
  for(const rule of rules(readFileSync(file,'utf8')))if(variable.test(rule.body))actual.push(relative+' :: '+rule.selector);
 }
 // These consumers are card siblings or belong to untouched upload/table
 // subtrees. A new descendant consumer in an isolated body/heading child is incompatible
 // with the reset; it must not be made green by merely extending this list.
 assert.deepEqual(actual.sort(),[
  'canvas/creative_canvas.css :: .dae-creative .dae-creative-card:is([data-floating-header=true],[data-upload=true],[data-presentation=content])>.dae-creative-heading',
  'canvas/creative_canvas.css :: .dae-creative-card[data-compact=true]>.dae-creative-heading, .dae-creative-card[data-compact=true]>.dae-creative-summary',
  'canvas/creative_canvas.css :: .dae-creative .dae-creative-width-handle',
  'canvas/creative_canvas.css :: .dae-creative .dae-creative-width-handle::after',
  'canvas/creative_canvas.css :: .dae-creative .dae-creative-width-handle::before',
  'features/groups/material_groups.css :: .dae-creative[data-group-review=true] .dae-upload-stage[data-review-index]::before',
  'features/groups/material_groups.css :: .dae-creative[data-group-review=true] .dae-creative-card[data-review-member]:has(.dae-upload-stage :is(img,video))>.dae-creative-heading',
  'features/groups/material_groups.css :: .dae-creative[data-group-review=true] .dae-creative-card[data-review-member][data-review-compact-actions=false]:has(.dae-upload-stage :is(img,video))>.dae-creative-heading',
  'features/table/table_ui.css :: .dae-ui .dae-table[data-structure] button.table-row-resize',
 ].sort());
});

test('no JS or inline-CSS reads were hidden below the owned roots; public root writes stay live',()=>{
 const references=files().filter(file=>/\.(?:mjs|js|ts)$/.test(file)&&/--dae-canvas-(?:inverse-)?zoom/.test(readFileSync(file,'utf8'))).map(file=>path.relative(root,file).replaceAll('\\','/'));
 assert.deepEqual(references,['canvas/creative_canvas_view.mjs']);
 const view=read(references[0]);
 assert.match(view,/root\.style\.setProperty\('--dae-canvas-zoom',String\(v\.zoom\)\)/);
 assert.match(view,/root\.style\.setProperty\('--dae-canvas-inverse-zoom',String\(1\/v\.zoom\)\)/);
 assert.match(view,/world\.style\.transform=`translate\(\$\{v\.x\}px,\$\{v\.y\}px\) scale\(\$\{v\.zoom\}\)`/);
});
