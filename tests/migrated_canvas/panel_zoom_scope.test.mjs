import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

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
 ['canvas/creative_canvas.css','.dae-creative .dae-creative-card > .dae-creative-body > .dae-ui.dae-text-input[data-canvas-panel=true]'],
 ['features/prompt/llm_style_preview.css','.dae-creative .dae-creative-card > .dae-creative-body > .dae-ui.llm-style-B[data-canvas-panel=true]'],
];

test('zoom resets whitelist exactly the leased TextInput and formal LLM B body roots',()=>{
 for(const [file,selector] of scopes){
  const declarations=rules(read(file)).filter(rule=>reset.test(rule.body));
  assert.equal(declarations.length,1,`${file}: exactly one owned boundary, never all panels/cards`);
  assert.equal(declarations[0].selector,selector);
  assert.deepEqual(declarations[0].body.split(';').map(value=>value.trim()).filter(Boolean),[
   '--dae-canvas-zoom:initial','--dae-canvas-inverse-zoom:initial',
  ],'reset only unused inherited values; do not change geometry, overflow, containment or transforms');
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

test('new CSS zoom consumers require reviewing both owned body boundaries',()=>{
 const actual=[];
 for(const file of files().filter(file=>file.endsWith('.css'))){
  const relative=path.relative(root,file).replaceAll('\\','/');
  for(const rule of rules(readFileSync(file,'utf8')))if(variable.test(rule.body))actual.push(relative+' :: '+rule.selector);
 }
 // These consumers are card siblings or belong to untouched upload/table
 // subtrees. A new descendant consumer in either owned body is incompatible
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
