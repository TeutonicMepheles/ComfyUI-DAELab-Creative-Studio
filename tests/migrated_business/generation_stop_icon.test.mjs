import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('the generation stop mask resolves to a bundled, nonempty SVG resource',()=>{
 const root=new URL('../../frontend/src/',import.meta.url);
 const panel=readFileSync(new URL('features/generation/video_tasks_panel.mjs',root),'utf8');
 assert.match(panel,/busy\?'stop-line'/);
 const tasks=readFileSync(new URL('features/generation/table_generation_tasks.mjs',root),'utf8');
 assert.match(tasks,/'stop-line'/);
 const svg=readFileSync(new URL('design/vendor/remixicon/stop-line.svg',root),'utf8');
 assert.match(svg,/<svg[^>]+viewBox="0 0 24 24"/);
 assert.match(svg,/<path d="[^"]+"/);
 assert.doesNotMatch(svg,/<(?:script|image|use)\b|href=/);
});
