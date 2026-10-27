import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkArchitecture } from '../../tools/check_architecture.mjs';

function fixture(files, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-architecture-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      const target = path.join(directory, name);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, body);
    }
    run(directory);
  } finally {
    // This exact temp directory is exclusively created by this test.
    fs.rmSync(directory, {recursive: true});
  }
}
test('guard rejects circular dependencies instead of approving the production scan alone', () => {
  fixture({'canvas/a.mjs': "import './b.mjs';", 'canvas/b.mjs': "import './a.mjs';"}, directory => {
    assert.ok(checkArchitecture(directory).errors.some(e => e.includes('Circular dependency')));
  });
});
test('guard rejects forbidden layer edges and old package runtime URLs', () => {
  fixture({
    'ui/control.mjs': "import '../features/table/private.mjs';",
    'features/table/private.mjs': "import '/scripts/app.js'; const url='/extensions/ComfyUI-DAELab-Creative-Canvas/a.mjs';",
  }, directory => {
    const errors = checkArchitecture(directory).errors;
    assert.ok(errors.some(e => e.includes('shared layer depends')));
    assert.ok(errors.some(e => e.includes('host import outside')));
    assert.ok(errors.some(e => e.includes('old package runtime URL')));
  });
});
test('table consumers use explicit public entries, not internals or legacy composition shims',()=>{
 fixture({'features/prompt/consumer.mjs':"import '../table/model_runtime.mjs'; import '../table/data_table_model.mjs';",'features/table/model_runtime.mjs':'export const a=1;', 'features/table/data_table_model.mjs':"export * from '../../application/table_model.mjs';",'application/table_model.mjs':''},root=>{
  assert.equal(checkArchitecture(root).errors.filter(x=>x.includes('private table import')).length,2);
 });
 fixture({'application/consumer.mjs':"import '../features/table/core_model.mjs'; import '../features/table/public_helpers.mjs';",'features/table/core_model.mjs':'export const a=1;', 'features/table/public_helpers.mjs':''},root=>assert.deepEqual(checkArchitecture(root).errors,[]));
});
test('table rejects host backreferences, runtime composition and logic hidden in forwarding entries',()=>{
 fixture({'features/table/editor_runtime.mjs':"import '../../application/compose.mjs'; import '../prompt/private.mjs'; const host=globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')];",'application/compose.mjs':'','features/prompt/private.mjs':'','features/table/data_table_model.mjs':"export * from '../../application/compose.mjs'; console.log('hidden');"},root=>{
  const errors=checkArchitecture(root).errors;assert.ok(errors.some(x=>x.includes('global host')));assert.equal(errors.filter(x=>x.includes('depends on composition')).length,2);assert.ok(errors.some(x=>x.includes('only forward')));
 });
});
