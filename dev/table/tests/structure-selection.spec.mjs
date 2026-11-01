import {test,expect} from '@playwright/test';

test('manual structure additions preserve selection without selecting new rows or cells',async({page})=>{
 await page.goto('/');
 await page.evaluate(async()=>{
  const {createTableEditor}=await import('/web/application/table_editor.mjs');
  const {createMaterialTable}=await import('/web/application/table_material_columns.mjs');
  window.structureFixtures={};
  for(const id of ['A','B']){
   let table=createMaterialTable();table.records.forEach((row,index)=>row.selected=index===0);
   const panel=document.createElement('section');panel.id='structure-'+id;document.body.prepend(panel);
   const editor=createTableEditor({getTable:()=>table,setTable:next=>{table=next;},displayContent:()=>true,upload:async()=>{throw Error('No upload');}});
   panel.append(editor.root);editor.render();window.structureFixtures[id]={editor,read:()=>table};
  }
 });
 const read=()=>page.evaluate(()=>structuredClone(window.structureFixtures.A.read()));
 const peer=await page.evaluate(()=>window.structureFixtures.B.read());
 const before=await read(),panel=page.locator('#structure-A');
 await panel.locator('td[data-field]').first().focus();
 const selection=()=>page.evaluate(()=>window.structureFixtures.A.editor.selection().flat().map(({row,field})=>[row.id,field.id]));
 const originalSelection=await selection();expect(originalSelection.length).toBeGreaterThan(0);
 for(const inserted of [false,true]){
  await page.evaluate(inserted=>{const f=window.structureFixtures.A;f.editor.addRow(inserted?f.read().records[0].id:null,inserted);},inserted);
  const state=await read(),added=state.records.filter(row=>!before.records.some(old=>old.id===row.id));
  expect(added.every(row=>row.selected===false)).toBe(true);
  expect(state.records.filter(row=>row.selected).map(row=>row.id)).toEqual([before.records[0].id]);
  expect(await selection()).toEqual(originalSelection);
  const focused=await page.evaluate(()=>document.activeElement?.dataset.record);
  expect(added.map(row=>row.id)).not.toContain(focused);
 }
 for(const inserted of [false,true]){
  await page.evaluate(inserted=>{const f=window.structureFixtures.A;f.editor.addColumn(inserted?f.read().fields[0].id:null,inserted);},inserted);
  await page.locator('.table-column-popover input').fill('Added column');
  await page.locator('.table-column-popover input').press('Enter');
  await expect(page.locator('.table-column-popover')).toHaveCount(0);
  expect(await selection()).toEqual(originalSelection);
  expect(await page.evaluate(()=>document.activeElement?.matches('td[data-field]'))).toBe(false);
 }
 const final=await read();expect(final.records.length).toBe(before.records.length+2);expect(final.fields.length).toBe(before.fields.length+2);
 for(let cycle=0;cycle<2;cycle++){
  await page.evaluate(()=>window.structureFixtures.A.editor.restore());
  expect((await read()).fields.length).toBe(final.fields.length-1);
  await page.evaluate(()=>window.structureFixtures.A.editor.restore(true));
  expect(await read()).toEqual(final);
 }
 await page.evaluate(()=>window.structureFixtures.A.editor.render());
 expect(await selection()).toEqual(originalSelection);
 expect(await page.evaluate(()=>window.structureFixtures.B.read())).toEqual(peer);
 await page.evaluate(()=>Object.values(window.structureFixtures).forEach(f=>f.editor.destroy()));
});
