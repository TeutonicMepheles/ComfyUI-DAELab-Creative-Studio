import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeTable} from '../../web/features/table/data_table_model.mjs';

const base=new URL('../fixtures/performance/',import.meta.url);
test('all synthetic tables retain their stable record/field IDs when read by the product model',()=>{
    const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',base),'utf8'));
    for(const entry of manifest.workflows){
        const workflow=JSON.parse(fs.readFileSync(new URL(entry.file,base),'utf8'));
        for(const node of workflow.nodes.filter(n=>n.type==='DAELAB.Table')){
            const original=JSON.parse(node.widgets_values[0]),normalized=normalizeTable(original);
            assert.equal(normalized.records.length,entry.rows);assert.equal(normalized.fields.length,10);
            assert.deepEqual(normalized.records.map(r=>r.id),original.records.map(r=>r.id));assert.deepEqual(normalized.fields.map(f=>f.id),original.fields.map(f=>f.id));
            assert.deepEqual(normalized.records.map(r=>r.values),original.records.map(r=>r.values));
        }
    }
});
test('linked LLM slot shapes match the actual product constructor and existing serialized indices',()=>{
    const source=fs.readFileSync(new URL('../../frontend/src/integrations/comfyui/business/llm_style_preview.js',import.meta.url),'utf8');
    const inputs=[...source.matchAll(/this\.addInput\('([^']+)','([^']+)'\)/g)].map(match=>({name:match[1],type:match[2]}));
    const workflow=JSON.parse(fs.readFileSync(new URL('FX-PERF-S-no-video.json',base),'utf8'));
    const receiver=workflow.nodes.find(n=>n.type==='DAELAB.LLMStylePreviewB');
    assert.deepEqual(receiver.inputs.map(({name,type})=>({name,type})),inputs.slice(0,5));
    assert.deepEqual([0,3,4].map(index=>receiver.inputs[index].type),['STRING','STRING','*']);
});
