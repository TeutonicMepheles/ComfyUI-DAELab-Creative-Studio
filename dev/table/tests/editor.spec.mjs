import {test,expect} from '@playwright/test';
const instance=(page,name)=>page.getByRole('region',{name:`实例 ${name}`,exact:true});
const snapshot=async panel=>JSON.parse(await panel.locator('.state').textContent());
async function editNote(panel,id,text){const cell=panel.locator(`td[data-field="note-${id}"]`).first();await cell.dblclick();await cell.locator('[contenteditable="true"]').fill(text);await cell.locator('[contenteditable="true"]').press('Tab');}

test.beforeEach(async({page})=>{await page.goto('/');await expect(page.locator('.dae-table')).toHaveCount(2);});
test('real editors preserve independent edits, history, menus and saved unknown keys',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));const a=instance(page,'A'),b=instance(page,'B');
 await editNote(a,'A','中文 A / English');
 await editNote(b,'B','独立 B');
 expect((await snapshot(a)).records[0].values['note-A']).toBe('中文 A / English');expect((await snapshot(b)).records[0].values['note-B']).toBe('独立 B');
 await a.getByRole('button',{name:'保存预览',exact:true}).click();
 await editNote(a,'A','临时');
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
 await editNote(a,'A','窄视口');await page.keyboard.press('Tab');
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
  const panel=instance(page,name),settings=panel.locator('.table-prompt-toggle[aria-pressed="true"]').first();
  await settings.scrollIntoViewIfNeeded();await page.mouse.move(0,0);const before=await settings.boundingBox();expect(before).not.toBeNull();
  await page.mouse.move(before.x+before.width/2,before.y+before.height/2);
  const hovered=await settings.boundingBox();expect(Math.abs(hovered.x-before.x)).toBeLessThan(.5);expect(Math.abs(hovered.y-before.y)).toBeLessThan(.5);
  await page.mouse.click(before.x+before.width/2,before.y+before.height/2);
  await expect(page.getByRole('button',{name:'应用全部',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
 }
});
