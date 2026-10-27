import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {wheelViewport} from '../../frontend/src/canvas/creative_navigation.mjs';

// Source ownership guards, not a browser scrolling simulation. Real focus,
// internal scrolling and overlay visibility still need ComfyUI inspection.
const read=path=>readFileSync(new URL('../../frontend/src/'+path,import.meta.url),'utf8');
function rules(source){return [...source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/@import\s+[^;]+;/g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([,selector,body])=>({selector:selector.trim(),declarations:body.split(';').map(value=>value.trim()).filter(Boolean).map(value=>{const colon=value.indexOf(':');return [value.slice(0,colon).trim(),value.slice(colon+1).trim()];})}));}
function declarations(source,selector){const matches=rules(source).filter(rule=>rule.selector===selector);assert.ok(matches.length,selector);return Object.fromEntries(matches.flatMap(rule=>rule.declarations));}
const canvas=read('canvas/creative_canvas.css');

test('fixed Canvas viewport clips both axes without becoming a programmatic scroll container',()=>{
 const shell=declarations(canvas,'.dae-creative');
 assert.equal(shell.position,'fixed');
 assert.equal(shell.overflow,'clip','hidden can scroll on focus or scrollIntoView and displace root overlays');
 assert.equal(shell['overflow-x'],undefined);assert.equal(shell['overflow-y'],undefined);
 const rootOverflow=rules(canvas).filter(rule=>/^\.dae-creative(?:\[[^\]]*\]|:[\w-]+)*$/.test(rule.selector)).flatMap(rule=>rule.declarations.filter(([name])=>/^overflow(?:-[xy])?$/.test(name)));
 assert.deepEqual(rootOverflow,[['overflow','hidden'],['overflow','clip']],'legacy fallback precedes clip; root states must not restore scrolling');
 assert.equal(shell.contain,undefined,'do not change descendant layout containment');
 assert.equal(shell.display,undefined,'fixed positioning already establishes the formatting context');
 assert.deepEqual(rules(canvas).filter(rule=>rule.declarations.some(([name,value])=>name==='overflow'&&value==='clip')).map(rule=>rule.selector),['.dae-creative']);
});

test('clipping belongs only to the root; text, panel, table and picker scrolling remains owned inside it',()=>{
 assert.equal(declarations(canvas,'.dae-creative-body').overflow,'auto');
 assert.equal(declarations(canvas,'.dae-creative-workspace>.dae-creative-body').overflow,'auto');
 assert.equal(declarations(canvas,'.dae-creative-picker>div').overflow,'auto');
 assert.equal(declarations(read('features/table/editor_runtime.mjs'),'.dae-table-scroll').overflow,'auto');
 assert.equal(declarations(read('features/table/table_ui.css'),'.dae-table-panel .dae-table td>textarea:focus').overflow,'auto');
 assert.equal(declarations(read('features/prompt/llm_style_preview.css'),'.llm-io .llm-io-comparison').overflow,'auto');
});

test('world panning remains transform-owned and independent of another viewport',()=>{
 const view=read('canvas/creative_canvas_view.mjs');
 assert.match(view,/world\.style\.transform=`translate\(\$\{v\.x\}px,\$\{v\.y\}px\) scale\(\$\{v\.zoom\}\)`/);
 assert.doesNotMatch(view,/root\.(?:scrollLeft|scrollTop)\s*=/,'do not repair native scrolling by continually resetting offsets');
 assert.equal(declarations(canvas,'.dae-creative-zoom').position,'absolute');
 assert.equal(declarations(canvas,'.dae-creative-status').position,'absolute');
 for(const zoom of [.5,1,1.5]){
  const a={x:20,y:30,zoom},b={x:70,y:80,zoom},beforeB={...b};
  const moved=wheelViewport(a,{x:200,y:150},{deltaX:0,deltaY:60,shiftKey:true,deltaMode:0});
  assert.deepEqual(moved,{x:-40,y:30,zoom});assert.deepEqual(a,{x:20,y:30,zoom});assert.deepEqual(b,beforeB);
  const scaled=wheelViewport(a,{x:200,y:150},{deltaX:0,deltaY:-40,ctrlKey:true,deltaMode:0});
  assert.ok(Math.abs((200-scaled.x)/scaled.zoom-(200-a.x)/a.zoom)<1e-10);
  assert.deepEqual(b,beforeB);
 }
});
