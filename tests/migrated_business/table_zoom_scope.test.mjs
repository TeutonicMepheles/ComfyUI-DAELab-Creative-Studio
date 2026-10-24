import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// A static dependency/ownership guard, not a CSS layout or performance result.
// Adding a zoom consumer requires deciding whether it can occur below the owned
// cell boundary. Do not merely append to this list when the consumer is a cell.
const root=fileURLToPath(new URL('../../frontend/src/',import.meta.url));
const read=name=>readFileSync(path.join(root,name),'utf8');
const zoom=/--dae-canvas-(?:inverse-)?zoom/;
const variable=/var\(\s*--dae-canvas-(?:inverse-)?zoom\b/;
const normalize=value=>value.replace(/\s+/g,' ').trim();
function files(directory=root){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):[path.join(directory,entry.name)]);}
function rules(source){return [...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([,selector,body])=>({selector:normalize(selector),body}));}
const scope='.dae-creative [data-canvas-panel=true] [data-content-presentation=true] .dae-table[data-structure] > .dae-table-scroll > table > tbody > tr > td[data-field][data-record]';
const gutterScope='.dae-creative [data-canvas-panel=true] [data-content-presentation=true] .dae-table[data-structure] > .dae-table-scroll > table > tbody > tr > td.table-choice';

test('layout isolation is limited to the owned sticky row gutter, without size/paint or zoom changes',()=>{
 const source=read('features/table/table_ui.css'),all=rules(source),isolated=all.filter(rule=>/\bcontain\s*:/.test(rule.body));
 assert.equal(isolated.length,1,'new containment boundaries require their own compatibility review');
 assert.equal(isolated[0].selector,gutterScope);
 assert.deepEqual(isolated[0].body.split(';').map(value=>value.trim()).filter(Boolean),['contain:layout']);
 const structure=read('features/table/table_structure.mjs'),editor=read('features/table/data_table_editor.mjs');
 assert.match(editor,/\.dae-table \.table-choice\{[^}]*position:sticky;left:0;z-index:2/);
 assert.match(editor,/\.dae-table th,\.dae-table td\{[^}]*vertical-align:top/);
 // All existing gutter children are absolute; no new size, clipping, public
 // inherited-variable or hit-target contract is introduced by this candidate.
 for(const suffix of ['.table-choice input','.table-choice .content-row-number','.table-choice>.table-move-handle']){
  assert.ok(all.some(rule=>rule.selector.endsWith(suffix)&&/position:absolute/.test(rule.body)),suffix);
 }
 const handle=all.find(rule=>rule.selector==='.dae-ui .dae-table[data-structure] button.table-row-resize');
 assert.match(handle.body,/position:absolute/);assert.match(handle.body,/height:calc\(8px \/ var\(--dae-canvas-zoom,1\)\)/);
 assert.doesNotMatch(handle.body,/transform:|contain:|outline:/);
 assert.match(structure,/row\.getBoundingClientRect\(\)\.height\/row\.offsetHeight/);
 assert.match(structure,/handle\.setPointerCapture\(e\.pointerId\);handle\.focus/);
});

test('zoom inheritance boundary is confined to owned content data cells and resets only unused values',()=>{
 const declarations=rules(read('features/table/table_ui.css')).filter(rule=>/--dae-canvas-(?:inverse-)?zoom\s*:/.test(rule.body));
 assert.equal(declarations.length,1);
 assert.equal(declarations[0].selector,scope);
 assert.deepEqual(declarations[0].body.split(';').map(value=>value.trim()).filter(Boolean),[
  '--dae-canvas-zoom:initial','--dae-canvas-inverse-zoom:initial',
 ]);
 const editor=read('features/table/data_table_editor.mjs'),structure=read('features/table/table_structure.mjs');
 assert.match(editor,/cell\.dataset\.field=f\.id;cell\.dataset\.record=r\.id/);
 assert.match(editor,/element\('td','table-choice',row\)/);
 assert.match(structure,/row\.querySelector\('\.table-choice'\)\.append\(handle\)/,'screen-size row handle must stay outside isolated data cells');
 assert.match(structure,/row\.getBoundingClientRect\(\)\.height\/row\.offsetHeight/,'row drag measures the actual visual scale');
});

test('all CSS zoom consumers remain outside the isolated data-cell subtree',()=>{
 const actual=[];
 for(const file of files().filter(file=>file.endsWith('.css'))){
  const relative=path.relative(root,file).replaceAll('\\','/');
  for(const rule of rules(readFileSync(file,'utf8')))if(variable.test(rule.body))actual.push(relative+' :: '+rule.selector);
 }
 const expected=[
  'canvas/creative_canvas.css :: .dae-creative .dae-creative-card:is([data-floating-header=true],[data-upload=true],[data-presentation=content])>.dae-creative-heading',
  'canvas/creative_canvas.css :: .dae-creative-card[data-compact=true]>.dae-creative-heading, .dae-creative-card[data-compact=true]>.dae-creative-summary',
  'canvas/creative_canvas.css :: .dae-creative .dae-creative-width-handle',
  'canvas/creative_canvas.css :: .dae-creative .dae-creative-width-handle::after',
  'canvas/creative_canvas.css :: .dae-creative .dae-creative-width-handle::before',
  'features/groups/material_groups.css :: .dae-creative[data-group-review=true] .dae-upload-stage[data-review-index]::before',
  'features/groups/material_groups.css :: .dae-creative[data-group-review=true] .dae-creative-card[data-review-member]:has(.dae-upload-stage :is(img,video))>.dae-creative-heading',
  'features/groups/material_groups.css :: .dae-creative[data-group-review=true] .dae-creative-card[data-review-member][data-review-compact-actions=false]:has(.dae-upload-stage :is(img,video))>.dae-creative-heading',
  'features/table/table_ui.css :: .dae-ui .dae-table[data-structure] button.table-row-resize',
 ];
 assert.deepEqual(actual.sort(),expected.sort(),'review new or moved CSS consumers before retaining the cell inheritance boundary');
});

test('public canvas zoom values are still updated at the root, with no hidden JS or inline-CSS consumers',()=>{
 const references=files().filter(file=>/\.(?:mjs|js|ts)$/.test(file)&&zoom.test(readFileSync(file,'utf8'))).map(file=>path.relative(root,file).replaceAll('\\','/'));
 assert.deepEqual(references,['canvas/creative_canvas_view.mjs'],'a new JS/inline-CSS consumer requires an explicit cell-scope review');
 const view=read(references[0]);
 assert.match(view,/root\.style\.setProperty\('--dae-canvas-zoom',String\(v\.zoom\)\)/);
 assert.match(view,/root\.style\.setProperty\('--dae-canvas-inverse-zoom',String\(1\/v\.zoom\)\)/);
 assert.match(view,/world\.style\.transform=`translate\(\$\{v\.x\}px,\$\{v\.y\}px\) scale\(\$\{v\.zoom\}\)`/);
});
