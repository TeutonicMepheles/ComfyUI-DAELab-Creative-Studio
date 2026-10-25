import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Stylesheet ownership contracts, not a simulated browser positioning engine.
// Real expanded menus, keyboard behavior and edge overflow need ComfyUI checks.
const css=readFileSync(new URL('../../frontend/src/design/creative_theme.css',import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
const selector=':is(.dae-creative,.dae-ui) select:not([multiple]):not([size])::picker(select)';
const originalTries=['self-start span-self-end','self-end span-self-start','self-start span-self-start'];
const boundaryTries=['self-block-end span-all','self-block-start span-all'];
const fallbackList=[...originalTries,...boundaryTries].join(', ');
const normalize=value=>value.replace(/\s+/g,' ').trim();
function rules(source,parents=[],out=[]){
 let start=0;
 while(start<source.length){
  const open=source.indexOf('{',start);if(open<0)break;
  let depth=1,end=open+1;
  while(end<source.length&&depth){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}
  assert.equal(depth,0,'balanced stylesheet blocks');
  const head=normalize(source.slice(start,open)),body=source.slice(open+1,end-1);
  if(head.startsWith('@'))rules(body,[...parents,head],out);
  else out.push({selector:head,parents,declarations:body.split(';').map(normalize).filter(Boolean).map(value=>{const i=value.indexOf(':');return [value.slice(0,i),value.slice(i+1).trim()];})});
  start=end;
 }
 return out;
}
const parsed=rules(css);

test('owned select picker preserves the three native tries before viewport-wide alternatives',()=>{
 const boundary=parsed.filter(rule=>rule.declarations.some(([key])=>key==='position-try-fallbacks'));
 assert.equal(boundary.length,1,'one scoped overflow extension, no global picker override');
 assert.equal(boundary[0].selector,selector);
 assert.deepEqual(boundary[0].declarations,[['position-try-fallbacks',fallbackList]]);
 assert.ok(boundary[0].parents.includes('@supports (appearance:base-select)'));
 assert.ok(boundary[0].parents.includes(`@supports (position-try-fallbacks: ${fallbackList})`),'unsupported complete syntax must retain the native fallback list');
});

test('primary anchor placement, native ordering and picker dimensions remain browser-owned or unchanged',()=>{
 const picker=parsed.filter(rule=>rule.selector===selector);
 const declarations=Object.fromEntries(picker.flatMap(rule=>rule.declarations));
 for(const key of ['position-area','position-try-order','position-anchor','position','inset','left','right','top','bottom','transform','zoom'])assert.equal(declarations[key],undefined,key);
 assert.equal(declarations['min-inline-size'],'anchor-size(self-inline)');
 assert.equal(declarations['inline-size'],'max-content');
 assert.equal(declarations['max-inline-size'],'calc(100vw - 24px)');
 assert.equal(declarations['max-block-size'],'min(320px,calc(100dvh - 24px))');
 assert.equal(declarations['margin-block-start'],'6px');
 assert.equal(declarations.overflow,'auto');
 assert.equal(declarations['overscroll-behavior'],'contain');
});

test('boundary alternatives apply to neither select anchors, multiple lists nor global host menus',()=>{
 const occurrences=parsed.filter(rule=>rule.declarations.some(([,value])=>value.includes('span-all')));
 assert.equal(occurrences.length,1,'only the owned single-select picker receives full-inline-span candidates');
 assert.equal(occurrences[0].selector,selector);
 assert.deepEqual(occurrences[0].declarations.map(([key])=>key),['position-try-fallbacks']);
});
