import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {relocateMarkdownLinks,localMarkdownLinks} from '../../tools/document_links.mjs';
test('generated module documentation links resolve to the same owning sources',()=>{
 const base=path.resolve('synthetic'),source=path.join(base,'frontend/src/features/table/README.md'),output=path.join(base,'web/features/table/README.md');
 const text='[preview](../../../../dev/table/README.md#start) [contracts](contracts.ts) [external](https://example.com/a) [anchor](#here)';
 const actual=relocateMarkdownLinks(text,source,output);
 assert.equal(actual,'[preview](../../../dev/table/README.md#start) [contracts](../../../frontend/src/features/table/contracts.ts) [external](https://example.com/a) [anchor](#here)');
 assert.deepEqual(localMarkdownLinks(actual),['../../../dev/table/README.md#start','../../../frontend/src/features/table/contracts.ts']);
});
test('relative links with escaped spaces retain optional titles and code examples are not checked',()=>{
 const source=path.resolve('a/README.md'),output=path.resolve('b/README.md');
 assert.equal(relocateMarkdownLinks('[doc](<my file.md> "title")',source,output),'[doc](<../a/my%20file.md> "title")');
 assert.deepEqual(localMarkdownLinks('```md\n[example](not-real.md)\n```\n[real](ok.md)'),['ok.md']);
});
