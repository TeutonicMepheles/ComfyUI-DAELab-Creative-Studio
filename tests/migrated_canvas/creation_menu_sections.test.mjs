import test from 'node:test';
import assert from 'node:assert/strict';
import {creationSection,orderedCreationEntries} from '../../frontend/src/canvas/creation_menu.ts';
test('creation groups retain item identity and source order within each group',()=>{
 const entries=[{type:'DAELAB.VideoEdit'},{type:'DAELAB.ImageGenerate'},{type:'DAELAB.Table'},{type:'DAELAB.LLMStylePreviewB'},{type:'DAELAB.VideoGenerate'},{type:'DAELAB.MediaUpload'}],before=[...entries];
 const result=orderedCreationEntries(entries);
 assert.deepEqual(entries,before);assert.deepEqual(result,[entries[2],entries[5],entries[1],entries[3],entries[4],entries[0]]);
 assert.deepEqual(result.map(item=>creationSection(item.type)),['输入','输入','生成','生成','生成','剪辑']);
});
