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
 ['canvas/creative_canvas.css','.dae-creative > .dae-creative-world > svg.dae-creative-wires'],
 ['canvas/creative_canvas.css','.dae-creative .dae-creative-card > .dae-creative-body > .dae-ui.dae-text-input[data-canvas-panel=true]'],
 ['features/prompt/llm_style_preview.css','.dae-creative .dae-creative-card > .dae-creative-body > .dae-ui.llm-style-B[data-canvas-panel=true]'],
];

test('zoom resets whitelist exactly the owned wire SVG and leased TextInput/LLM B body roots',()=>{
 for(const file of new Set(scopes.map(([file])=>file))){
  const declarations=rules(read(file)).filter(rule=>reset.test(rule.body));
  assert.deepEqual(declarations.map(rule=>rule.selector).sort(),scopes.filter(([owner])=>owner===file).map(([,selector])=>selector).sort(),`${file}: exact owned boundaries, never all panels/cards/SVGs`);
  for(const declaration of declarations)assert.deepEqual(declaration.body.split(';').map(value=>value.trim()).filter(Boolean),[
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

test('wire boundary matches the actual Canvas-owned SVG without including Slots or adapter DOM',()=>{
 const view=read('canvas/creative_canvas_view.mjs'),groups=read('features/groups/material_groups.mjs');
 assert.match(view,/world=el\('div','dae-creative-world'\)/);
 assert.match(view,/const wires=document\.createElementNS\('http:\/\/www\.w3\.org\/2000\/svg','svg'\);wires\.classList\.add\('dae-creative-wires'\);world\.append\(wires\)/);
 assert.match(view,/root\.append\(grid,world,status,empty,zoom\)/);
 assert.match(view,/path=document\.createElementNS\(wires\.namespaceURI,'path'\)/);
 assert.match(view,/wires\.append\(path\)/);
 assert.match(groups,/pulse=document\.createElementNS\(svg\.namespaceURI,'path'\)/);
 assert.match(groups,/svg\.append\(pulse\)/);
 assert.doesNotMatch(view+groups,/foreignObject/);
 assert.match(view,/element\.append\(heading,media,summary,body,typeLabel,portBox\);world\.append\(element\)/,'cards/Slots are siblings of the SVG, not children of its reset scope');
});

test('ordinary, preview, selected and group-pulse wire visual contracts stay independent of zoom variables',()=>{
 const canvas=rules(read('canvas/creative_canvas.css'));
 const normal=canvas.find(rule=>rule.selector==='.dae-creative-wires path').body;
 assert.match(normal,/stroke:var\(--dae-wire\)/);assert.match(normal,/stroke-width:3\b/);
 assert.match(normal,/vector-effect:non-scaling-stroke/);assert.match(normal,/pointer-events:stroke/);
 const preview=canvas.find(rule=>rule.selector==='.dae-creative-wires path[data-preview]').body;
 assert.match(preview,/pointer-events:none/);assert.match(preview,/stroke-dasharray:5 4/);
 assert.match(canvas.find(rule=>rule.selector==='.dae-creative-wires path:hover,.dae-creative-wires path[data-selected=true]').body,/stroke-width:5\b/);
 assert.match(canvas.find(rule=>rule.selector==='.dae-creative-wires path[data-selected=true]').body,/stroke:var\(--dae-wire-selected\)/);
 const pulse=rules(read('features/groups/material_groups.css')).filter(rule=>rule.selector.endsWith('.dae-creative-wires path.gr-wire-pulse'));
 assert.equal(pulse.length,2);
 assert.match(pulse[0].body,/stroke-dasharray:24 176/);assert.match(pulse[0].body,/animation:gr-wire-flow 1s linear infinite/);
 assert.match(pulse[0].body,/vector-effect:non-scaling-stroke/);assert.match(pulse[1].body,/animation:none/);
 assert.match(read('features/groups/material_groups.mjs'),/pulse\.setAttribute\('pathLength','1000'\)/);
 for(const rule of [...canvas,...pulse].filter(rule=>rule.selector.includes('dae-creative-wires')))assert.equal(variable.test(rule.body),false,'adding a wire zoom consumer requires reviewing the inherited reset');
});

test('new CSS zoom consumers require reviewing owned body and wire boundaries',()=>{
 const actual=[];
 for(const file of files().filter(file=>file.endsWith('.css'))){
  const relative=path.relative(root,file).replaceAll('\\','/');
  for(const rule of rules(readFileSync(file,'utf8')))if(variable.test(rule.body))actual.push(relative+' :: '+rule.selector);
 }
 // These consumers are card siblings or belong to untouched upload/table
 // subtrees. A new descendant consumer in either owned body or SVG is incompatible
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
