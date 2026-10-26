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
