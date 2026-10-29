import {test,expect} from '@playwright/test';
const instance=(page,name)=>page.getByRole('region',{name:`实例 ${name}`,exact:true});
const snapshot=async panel=>JSON.parse(await panel.locator('.state').textContent());
test('row resize controls batch initial layout reads and retain keyboard resizing',async({page})=>{
 await page.evaluate(async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'offsetHeight');
  window.rowHeightReads={count:0,interleaved:0};
  Object.defineProperty(HTMLElement.prototype,'offsetHeight',{...descriptor,get(){
   const height=descriptor.get.call(this);
   if(this.matches('tr[data-record-id]')&&!this.querySelector('.table-row-resize')){
    window.rowHeightReads.count++;
    if(this.parentElement.querySelector('.table-row-resize'))window.rowHeightReads.interleaved++;
   }
   return height;
  }});
  const {createTableEditor}=await import('/web/application/table_editor.mjs');
  const {createMaterialTable}=await import('/web/application/table_material_columns.mjs');
  window.rowResizeFixtures={};
  for(const id of ['A','B']){
   let table=createMaterialTable();const panel=document.createElement('section');panel.id='row-resize-'+id;document.body.append(panel);
   const editor=createTableEditor({getTable:()=>table,setTable:next=>{table=next;},displayContent:()=>true,upload:async()=>{throw Error('No upload in row fixture');}});
   panel.append(editor.root);editor.render();window.rowResizeFixtures[id]={editor,read:()=>table};
  }
 });
 const reads=await page.evaluate(()=>window.rowHeightReads);expect(reads.count).toBeGreaterThanOrEqual(6);expect(reads.interleaved).toBe(0);
 const peer=await page.evaluate(()=>window.rowResizeFixtures.B.read()),row=page.locator('#row-resize-A tbody>tr[data-record-id]').first(),handle=row.locator('.table-row-resize'),before=await row.evaluate(e=>e.offsetHeight);
 await expect(handle).toHaveAttribute('aria-valuenow',String(before));await handle.focus();await page.keyboard.press('ArrowDown');
 await expect.poll(()=>page.evaluate(()=>Number(window.rowResizeFixtures.A.read().records[0].meta.height))).toBeGreaterThan(before);
 expect(await page.evaluate(()=>window.rowResizeFixtures.B.read())).toEqual(peer);
 await page.evaluate(()=>Object.values(window.rowResizeFixtures).forEach(fixture=>fixture.editor.destroy()));
});
test('large plain tables keep all model rows while visible DOM follows focus and undo',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const heights=await page.evaluate(async()=>{
  const {createTableEditor}=await import('/web/application/table_editor.mjs');
  const {normalizeTable}=await import('/web/application/table_model.mjs');window.windowFixtures={};const heights={};
  for(const id of ['A','B']){
   let table=normalizeTable({version:1,view:'table',meta:{},fields:[0,1,2].map(i=>({id:'f'+i,name:'列 '+i,type:'content',width:180})),records:Array.from({length:150},(_,i)=>({id:'r'+i,values:{f0:id+' '+i,f1:'text',f2:''}}))});
   const panel=document.createElement('section');panel.id='window-'+id;document.body.append(panel);
   const editor=createTableEditor({getTable:()=>table,setTable:next=>{table=next;},displayContent:()=>true,upload:async()=>{throw Error('No upload');}});
   panel.append(editor.root);editor.render();heights[id]=panel.querySelector('table').offsetHeight;window.windowFixtures[id]={editor,read:()=>table,panel};
  }return heights;
 });
 await expect.poll(()=>page.locator('#window-A tr[data-record-id]').count()).toBeLessThan(150);
 for(const id of ['A','B']){expect(await page.locator('#window-'+id+' table').evaluate(e=>e.offsetHeight)).toBe(heights[id]);expect(await page.evaluate(id=>window.windowFixtures[id].read().records.length,id)).toBe(150);}
 const peer=await page.evaluate(()=>window.windowFixtures.B.read());
 await page.evaluate(()=>window.windowFixtures.A.editor.focusCell('r0','f0'));
 for(let i=0;i<25;i++)await page.keyboard.press('ArrowDown');
 expect(await page.evaluate(()=>document.activeElement?.closest('td[data-record]')?.dataset.record)).toBe('r25');
 const cell=page.locator('#window-A td[data-record="r25"][data-field="f0"] .content-display');await cell.dblclick();await cell.fill('窗口 A');await page.keyboard.press('Tab');
 expect(await page.evaluate(()=>window.windowFixtures.A.read().records[25].values.f0)).toBe('窗口 A');expect(await page.evaluate(()=>window.windowFixtures.B.read())).toEqual(peer);
 await page.evaluate(()=>window.windowFixtures.A.editor.restore());
 expect(await page.evaluate(()=>window.windowFixtures.A.read().records[25].values.f0)).toBe('A 25');
 await page.evaluate(()=>window.windowFixtures.A.editor.focusCell('r149','f2'));
 expect(await page.evaluate(()=>document.activeElement?.closest('td[data-record]')?.dataset.record)).toBe('r149');
 await expect.poll(()=>page.locator('#window-A tr[data-record-id]').count()).toBeLessThan(150);
 await page.evaluate(()=>window.windowFixtures.A.editor.change(table=>{table.fields[1].readonly=true;}));
 await expect.poll(()=>page.locator('#window-A tr[data-record-id]').count()).toBe(150);
 await expect(page.locator('#window-A [data-table-row-spacer]')).toHaveCount(0);
 await page.evaluate(()=>Object.values(window.windowFixtures).forEach(f=>{f.editor.destroy();f.panel.remove();}));
 await page.waitForTimeout(100);expect(errors).toEqual([]);
});
test.beforeEach(async({page})=>{await page.goto('/');await expect(page.locator('.dae-table')).toHaveCount(2);});
test('real editors preserve independent edits, history, menus and saved unknown keys',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));const a=instance(page,'A'),b=instance(page,'B');
 await a.locator('td[data-field="note-A"] input').first().fill('中文 A / English');
 await b.locator('td[data-field="note-B"] input').first().fill('独立 B');
 expect((await snapshot(a)).records[0].values['note-A']).toBe('中文 A / English');expect((await snapshot(b)).records[0].values['note-B']).toBe('独立 B');
 await a.getByRole('button',{name:'保存预览',exact:true}).click();
 await a.locator('td[data-field="note-A"] input').first().fill('临时');
 await a.getByRole('button',{name:'重载预览',exact:true}).click();
 expect((await snapshot(a)).records[0].values['note-A']).toBe('中文 A / English');expect((await snapshot(a)).fixtureExtension).toEqual({preserve:true});
 await a.getByRole('button',{name:'提示词模板',exact:true}).click();await expect(page.locator('.table-text-side:not([hidden])')).toHaveCount(1);
 await a.getByRole('button',{name:'卸载',exact:true}).click();await expect(page.locator('.table-text-side:not([hidden])')).toHaveCount(0);
 await a.getByRole('button',{name:'挂载',exact:true}).click();expect((await snapshot(b)).records[0].values['note-B']).toBe('独立 B');expect(errors).toEqual([]);
});
test('capability states preserve configuration and late simulated completion cannot write into remount',async({page})=>{
 const a=instance(page,'A'),b=instance(page,'B');const before=await snapshot(b);
 await a.getByRole('button',{name:'模拟生成首行',exact:true}).click();await expect(a.locator('.notice')).toContainText('不可用');
 await page.locator('#mode').selectOption('full');await page.locator('#response').selectOption('loading');
 await a.getByRole('button',{name:'模拟生成首行',exact:true}).click();await expect.poll(async()=>JSON.stringify(await snapshot(a))).toContain('studioGenerationRefs');await a.getByRole('button',{name:'卸载',exact:true}).click();await a.getByRole('button',{name:'挂载',exact:true}).click();
 await expect.poll(async()=>await snapshot(b)).toEqual(before);
 await page.waitForTimeout(3300);const state=await snapshot(a),field=state.fields.find(f=>f.presentation==='generation');expect(state.records[0].values[field.id]).toEqual([]);
 await page.locator('#response').selectOption('error');await a.getByRole('button',{name:'生成设置',exact:true}).click();await expect(page.locator('.table-text-side:not([hidden])')).toContainText('模拟服务错误');
 await page.getByRole('button',{name:'关闭侧栏',exact:true}).click();await page.locator('#response').selectOption('ready');await a.getByRole('button',{name:'生成设置',exact:true}).click();await page.getByRole('button',{name:'重新读取模型选项',exact:true}).click();await expect(page.locator('.table-text-side:not([hidden])')).not.toContainText('模拟服务错误');
 expect((await snapshot(b)).fields).toEqual(before.fields);
});
test('empty table, narrow viewport, focus and internal overflow remain reachable',async({page})=>{
 await page.setViewportSize({width:600,height:800});const a=instance(page,'A');
 await a.locator('td[data-field="note-A"] input').first().fill('窄视口');await page.keyboard.press('Tab');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(await a.locator('.dae-table-scroll').evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);
 await a.getByRole('button',{name:'空表',exact:true}).click();expect((await snapshot(a)).records).toEqual([]);
 await a.getByRole('button',{name:'标准表',exact:true}).click();expect((await snapshot(a)).records).toHaveLength(3);
});
test('simulated result, upload and undo only affect their owning instance',async({page})=>{
 const a=instance(page,'A'),b=instance(page,'B'),before=await snapshot(b);await page.locator('#mode').selectOption('full');
 await a.getByRole('button',{name:'模拟生成首行',exact:true}).click();await expect(a.locator('.notice')).toContainText('模拟任务已完成');
 let t=await snapshot(a);const generated=t.fields.find(f=>f.presentation==='generation');expect(t.records[0].values[generated.id]).toHaveLength(1);expect(await snapshot(b)).toEqual(before);
 await a.getByRole('button',{name:'撤销',exact:true}).click();t=await snapshot(a);expect(t.records[0].values[generated.id]).toEqual([]);
 const chooser=page.waitForEvent('filechooser');await a.getByRole('button',{name:'添加图片',exact:true}).first().click();await (await chooser).setFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGAAAAABJRU5ErkJggg==','base64')});
 await expect.poll(async()=>{const state=await snapshot(a);return state.records[0].values[state.fields[0].id].length;}).toBe(2);expect(await snapshot(b)).toEqual(before);
});
test('structured clipboard exchange is explicit and a late upload cannot change a remounted view',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);const a=instance(page,'A'),b=instance(page,'B');
 const source=await snapshot(a),target=await snapshot(b),af=source.fields[0].id,bf=target.fields[0].id;
 await a.locator(`td[data-field="${af}"]`).first().focus();await page.keyboard.press('Control+c');
 await b.locator(`td[data-field="${bf}"]`).nth(1).focus();await page.keyboard.press('Control+v');
 await expect.poll(async()=>(await snapshot(b)).records[1].values[bf].length).toBe(1);
 expect((await snapshot(b)).records[1].values[bf][0].url).toBe(source.records[0].values[af][0].url);
 await page.locator('#mode').selectOption('full');await page.locator('#response').selectOption('loading');
 const chooser=page.waitForEvent('filechooser');await a.getByRole('button',{name:'添加图片',exact:true}).first().click();await (await chooser).setFiles({name:'late.png',mimeType:'image/png',buffer:Buffer.from('synthetic')});
 await expect(a.locator('.notice')).toContainText('模拟上传中');await a.getByRole('button',{name:'卸载',exact:true}).click();await a.getByRole('button',{name:'挂载',exact:true}).click();await page.waitForTimeout(3200);
 expect((await snapshot(a)).records[0].values[af]).toEqual(source.records[0].values[af]);
});


test('generation settings keep their click target when the prompt hint appears',async({page})=>{
 for(const name of ['A','B']){
  const panel=instance(page,name),settings=panel.locator('[data-generation-defaults]').first();
  await settings.scrollIntoViewIfNeeded();await page.mouse.move(0,0);const before=await settings.boundingBox();expect(before).not.toBeNull();
  await page.mouse.move(before.x+before.width/2,before.y+before.height/2);
  const hovered=await settings.boundingBox();expect(Math.abs(hovered.x-before.x)).toBeLessThan(.5);expect(Math.abs(hovered.y-before.y)).toBeLessThan(.5);
  await page.mouse.click(before.x+before.width/2,before.y+before.height/2);
  await expect(page.locator('.table-text-side:not([hidden])')).toContainText('列默认配置');
  await page.getByRole('button',{name:'关闭侧栏',exact:true}).click();
 }
});
