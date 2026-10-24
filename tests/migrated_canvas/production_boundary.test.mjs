import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, resolve, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {GROUP_TYPE, collectionFor, groupInputSnapshot} from '../../frontend/src/features/groups/material_group_model.mjs';
import {inputSnapshot as registrySnapshot} from '../../frontend/src/canvas/creative_contract.mjs';
import {inputSnapshot as exchangeSnapshot} from '../../frontend/src/canvas/creative_input_exchange.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sourceRoot=resolve(root,'frontend/src');
const manifest=JSON.parse(readFileSync(resolve(root,'docs/provenance/canvas-files.json'),'utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');

test('migrated production sources and original resources match the reviewed manifest',()=>{
  for(const file of manifest.files){
    assert.equal(hash(readFileSync(resolve(root,file.destination))),file.destinationSha256,file.destination);
    if(file.origin==='authored')assert.equal(file.sourceSha256,null);
    else assert.match(file.sourceSha256,/^[a-f0-9]{64}$/);
  }
});

test('every relative production module, CSS import and literal asset URL resolves inside the package',()=>{
  for(const file of manifest.files.filter(f=>f.kind==='production-source')){
    const path=resolve(root,file.destination),text=readFileSync(path,'utf8');
    const patterns=[/(?:\bfrom\s*|\bimport\s*|@import\s*)['"](\.[^'"]+)['"]/g,
      /new URL\(['"](\.[^'"+]+)['"],\s*import\.meta\.url\)/g,
      /url\(['"](\.[^'"$]+)['"]\)/g];
    for(const pattern of patterns)for(const match of text.matchAll(pattern)){
      let target=resolve(dirname(path),match[1].split('?')[0]);
      // The no-bundle build compiles sibling TypeScript files to these .js URLs.
      if(target.endsWith('.js')&&!existsSync(target)&&existsSync(target.slice(0,-3)+'.ts'))target=target.slice(0,-3)+'.ts';
      assert.ok(!relative(sourceRoot,target).startsWith('..'+sep),`${file.destination}: outside package ${match[1]}`);
      assert.ok(existsSync(target),`${file.destination}: missing ${match[1]}`);
    }
    assert.doesNotMatch(text,/\/extensions\/ComfyUI-DAELab-(?:Creative-Canvas|Custom-Nodes-Library)\//);
    if(text.includes('/scripts/'))assert.ok(file.destination.startsWith('frontend/src/integrations/comfyui/'),file.destination);
    if(!file.destination.startsWith('frontend/src/integrations/')){
      assert.doesNotMatch(text,/\bfrom\s*['"][^'"]*\/integrations\//,file.destination);
    }
  }
});

test('original bundled font bytes retain the supplied vendor SHA-256 identity',()=>{
  const folder=resolve(sourceRoot,'design/vendor/alibaba-puhuiti-3');
  const fonts=readdirSync(folder).filter(name=>name.endsWith('.woff2'));
  assert.equal(fonts.length,3);
  for(const name of fonts){
    const record=manifest.files.find(f=>f.source==='web/vendor/alibaba-puhuiti-3/'+name);
    assert.ok(record);assert.equal(hash(readFileSync(resolve(folder,name))),record.sourceSha256);
  }
});

test('normal group registration never rewrites unknown prototype nodes, slots, links or fields',()=>{
  const text=readFileSync(resolve(sourceRoot,'integrations/comfyui/canvas/material_group.js'),'utf8');
  const definitions=[];
  const app={registerExtension:extension=>definitions.push(extension)};
  runInNewContext(text.replace(/^import .*;\s*$/gm,''),{
    app,registerAdapter(){},GROUP_TYPE,collectionFor,groupInputSnapshot,
  });
  assert.equal(definitions.length,1);
  const workflow={nodes:[{id:'legacy',type:'DAELAB.GroupReviewDemo',properties:{unknown:{keep:1}},
    outputs:[{type:'DAELAB_REVIEW_ASSETS',links:[7]}]},
    {id:'other',type:'Unknown.Node',inputs:[{name:'review',type:'DAELAB_REVIEW_ASSETS',link:7}]}],
    links:[[7,'legacy',0,'other',0,'DAELAB_REVIEW_ASSETS']],extra:{daelabGroupReviewDemoV1:{keep:true}}};
  const before=structuredClone(workflow);
  for(const extension of definitions)extension.beforeConfigureGraph?.(workflow);
  assert.deepEqual(workflow,before);
});

test('test-only gallery is absent from the production closure',()=>{
  for(const file of manifest.files.filter(f=>f.kind==='production-source')){
    assert.doesNotMatch(file.destination,/gallery/i);
    assert.doesNotMatch(readFileSync(resolve(root,file.destination),'utf8'),/createFieldGallery|daelabControlGallery/);
  }
});

test('public contract and exchange entrypoints share one snapshot implementation',()=>{
  assert.equal(exchangeSnapshot,registrySnapshot);
});
