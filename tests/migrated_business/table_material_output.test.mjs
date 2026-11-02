import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTableOutputKey,tableMaterialSnapshot,tableOutputKey} from '../../frontend/src/application/table_material_output.mjs';

const asset=(id,kind,extra={})=>({id,assetId:id,kind,url:`/view?filename=${id}.${kind==='video'?'mp4':'png'}&type=output`,...extra});
function fixture(){
    return {
        fields:[
            {id:'text',name:'描述',type:'text'},
            {id:'mixed',name:'混合素材',type:'content'},
            {id:'result',name:'生成结果',type:'content',presentation:'generation',generation:{kind:'image'}},
        ],
        records:[
            {id:'a',name:'镜头甲',values:{text:'第一行',mixed:[asset('a1','image'),asset('a2','video'),{id:'bad',kind:'image'}]}},
            {id:'b',name:'镜头乙',values:{text:'第二行',mixed:[asset('a1','image'),asset('b1','image'),asset('a2','video')]}},
            {id:'c',name:'镜头丙',values:{text:'',mixed:[]}},
        ],
        meta:{},
    };
}

test('column output keeps row and cell order, skips invalid/empty content, and dedupes by stable material identity',()=>{
    const out=tableMaterialSnapshot(fixture(),'mixed');
    assert.equal(out.ready,true);
    assert.equal(out.scope,'column');
    assert.equal(out.skipped,1);
    assert.equal(out.deduplicated,2);
    assert.deepEqual(out.assets.map(a=>a.assetId),['a1','a2','b1']);
    assert.deepEqual(out.groups.map(g=>[g.kind,g.count]),[['image',2],['video',1]]);
    assert.deepEqual(out.groups[0].assetIndexes,[0,2]);
    assert.deepEqual(out.groups[1].assetIndexes,[1]);
    assert.deepEqual(out.assets.map(a=>a.provenance.recordId),['a','a','b']);
});

test('single-cell output is limited to that cell and splits text without inventing an empty group',()=>{
    const table=fixture();
    const text=tableMaterialSnapshot(table,'text','b');
    assert.equal(text.scope,'cell');
    assert.deepEqual(text.texts,['第二行']);
    assert.deepEqual(text.groups,[{kind:'text',label:'描述 · 文本',assetIndexes:[],textIndexes:[0],count:1}]);
    table.records[2].values.text='';
    const empty=tableMaterialSnapshot(table,'text','c');
    assert.equal(empty.ready,false);
    assert.deepEqual(empty.groups,[]);
});

test('generation results expose a same-type plan while preserving request provenance',()=>{
    const table=fixture();
    table.records[0].values.result=[asset('r1','image')];
    table.records[0].meta={generationColumns:{result:{requestId:'request-a'}}};
    table.records[1].values.result=[asset('r2','video')];
    const out=tableMaterialSnapshot(table,'result');
    assert.deepEqual(out.groups.map(group=>group.kind),['image','video']);
    assert.equal(out.assets[0].provenance.requestId,'request-a');
    assert.equal(out.assets[1].provenance.recordId,'b');
});
test('column and cell output keys round-trip IDs that contain URI separators',()=>{
 for(const [fieldId,recordId] of [['a/b','row:1'],['列:二',null]]){
  const key=tableOutputKey(fieldId,recordId);
  assert.deepEqual(parseTableOutputKey(key),{fieldId,recordId});
 }
});
