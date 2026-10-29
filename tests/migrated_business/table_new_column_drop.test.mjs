import test from 'node:test';
import assert from 'node:assert/strict';
import {createMaterialTable,addMaterialColumns} from '../../frontend/src/application/table_material_columns.mjs';
import {normalizeTable} from '../../frontend/src/application/table_model.mjs';

test('new columns fill one row per item, extend checked rows and preserve existing values',()=>{
 for(const kind of ['image','video','text']){
  const table=createMaterialTable(),before=structuredClone(table);
  const collection=count=>kind==='text'?{texts:Array.from({length:count},(_,i)=>`文字${i}\n第二行`)}:{assets:Array.from({length:count},(_,i)=>({filename:`${i}.${kind==='image'?'png':'mp4'}`,kind}))};
  addMaterialColumns(table,collection(1));let field=table.fields.at(-1);
  assert.equal(table.records.length,3);
  assert(kind==='text'?!table.records[1].values[field.id]||!table.records[1].values[field.id].segments?.length:!table.records[1].values[field.id].length);
  addMaterialColumns(table,collection(5));field=table.fields.at(-1);assert.equal(table.records.length,5);
  table.records.forEach((row,i)=>assert.equal(kind==='text'?row.values[field.id].segments[0].text:row.values[field.id][0].name,kind==='text'?`文字${i}\n第二行`:`${i}.${kind==='image'?'png':'mp4'}`));
  assert(table.records.slice(3).every(r=>r.selected));
  for(const field of before.fields)assert.deepEqual(table.records.slice(0,3).map(r=>r.values[field.id]),before.records.map(r=>r.values[field.id]));
  assert.deepEqual(normalizeTable(JSON.stringify(table)),JSON.parse(JSON.stringify(table)));
 }
});

test('mixed groups create both column types; invalid snapshots do not partially mutate',()=>{
 const table=createMaterialTable(),count=table.fields.length;
 addMaterialColumns(table,{assets:[{filename:'a.png',kind:'image'}],texts:['甲','乙']});
 assert.equal(table.fields.length,count+2);assert.equal(table.fields.at(-1).presentation,'prompt');
 assert.equal(table.records[0].values[table.fields.at(-2).id][0].name,'a.png');
 for(const collection of [{assets:[{missing:true}]},{texts:[null]},{ready:false,texts:['a']},{texts:Array(501).fill('a')},{}]){
  const before=structuredClone(table);assert.throws(()=>addMaterialColumns(table,collection));assert.deepEqual(table,before);
 }
});
