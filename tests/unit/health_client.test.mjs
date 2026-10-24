import test from 'node:test';
import assert from 'node:assert/strict';
import {checkStudioHealth} from '../../web/integrations/comfyui/health_client.js';
import {STUDIO_VERSION,FRONTEND_BUILD_ID} from '../../web/integrations/comfyui/index.js';

test('cached frontend mismatch and missing backend are explicit unavailable results', async () => {
  const data = {schemaVersion:1,core:'available',version:'0.1.0.dev0',frontendVersion:STUDIO_VERSION,frontendBuildId:FRONTEND_BUILD_ID,buildFingerprint:'a'.repeat(64),compatible:true,reason:null};
  const healthy = await checkStudioHealth(async () => new Response(JSON.stringify(data)));
  assert.equal(healthy.available,true);
  const stale = await checkStudioHealth(async () => new Response(JSON.stringify({...data,frontendVersion:'0.0.0'})));
  assert.equal(stale.available,false);
  assert.match(stale.reason,/版本不一致/);
  const sameVersionOldBuild = await checkStudioHealth(async () => new Response(JSON.stringify({...data,frontendBuildId:'0'.repeat(64)})));
  assert.equal(sameVersionOldBuild.available,false);
  const missing = await checkStudioHealth(async () => new Response('',{status:404}));
  assert.equal(missing.available,false);
  assert.match(missing.reason,/后端未加载/);
});
test('untrusted server error content never enters user diagnostics', async () => {
  const sentinel = 'secret-sentinel-never-echo';
  const result = await checkStudioHealth(async () => { throw Error(sentinel); });
  assert.equal(result.available,false);
  assert.ok(!JSON.stringify(result).includes(sentinel));
});
