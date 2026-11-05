import test from 'node:test';
import assert from 'node:assert/strict';
import {materialItem,takeMaterialItem} from '../../frontend/src/features/table/table_material_item.mjs';

test('a material move removes only the exact editable reference and preserves other occurrences',()=>{
 const table={fields:[{id:'f',type:'content'}],records:[{id:'r',values:{f:[{id:'one',kind:'image',url:'/view?filename=a.png&type=input'},{id:'two',kind:'image',url:'/view?filename=a.png&type=input'}],other:'keep'}}]};
 const key=JSON.stringify(['r','f','one']),snapshot=materialItem(table,key);
 assert.equal(snapshot.scope,'cell');assert.equal(snapshot.movable,true);
 const original=structuredClone(table);takeMaterialItem(table,key,JSON.stringify(snapshot));
 assert.deepEqual(table.records[0].values.f.map(a=>a.id),['two']);assert.equal(table.records[0].values.other,'keep');
 for(const mutate of [t=>{t.fields[0].readonly=true;},t=>{t.records[0].values.f[0].url='/view?filename=changed.png';},t=>{t.records[0].values.f.shift();}]){
  const current=structuredClone(original);mutate(current);const before=JSON.stringify(current);
  assert.throws(()=>takeMaterialItem(current,key,JSON.stringify(snapshot)),/来源已变化|不可编辑/);assert.equal(JSON.stringify(current),before);
 }
});
