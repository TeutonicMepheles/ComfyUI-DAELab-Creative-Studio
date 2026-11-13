import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const target=process.env.STUDIO_TEST_URL;
assert.ok(target,'Set STUDIO_TEST_URL to an isolated loopback ComfyUI host.');
const url=new URL(target);
assert.ok(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&url.port&&url.port!=='8000');
const stats=await(await fetch(new URL('/system_stats',url))).json();
assert.ok((stats.system?.argv||[]).some(value=>/[\\/]\.local[\\/]/.test(value)),'Requires an isolated .local host.');
const port=url.port,candidate=false;await mkdir('.local',{recursive:true});
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1700,height:1100}});const errors=[],submissions=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/prompt',r=>{submissions.push(r.request().url());return r.abort()});await page.route('**/daelab/studio/generation/submit',r=>{submissions.push(r.request().url());return r.abort()});
 await page.goto(`http://127.0.0.1:${port}`);await page.waitForTimeout(2500);await page.keyboard.press('Escape');
 const config={version:1,kind:'video',model:'MiniMax H3 FL 低配（本地）',promptFieldId:'p',mode:'singleImage2video',settings:{width:512,height:288,duration:2,turbo:false,seed:-1}};
 const data={version:1,fields:[{id:'p',name:'画面描述',type:'json',presentation:'prompt',width:320,generation:config},{id:'n',name:'备注',type:'text',width:300}],records:[{id:'r1',name:'任务1',selected:false,values:{p:'保留这段提示词。',n:'备注文字。'},meta:{future:{kept:true}}}],meta:{material_columns:true,generationInput:{version:1,promptFieldId:'p'},future:{kept:true}}};
 await page.evaluate(async data=>{const {app}=await import('/scripts/app.js');app.graph.clear();for(let i=0;i<2;i++){const n=LiteGraph.createNode('DAELAB.Table');n.pos=[80+i*810,160];n.widgets.find(w=>w.name==='table_data').value=JSON.stringify(data);app.graph.add(n);}app.graph.extra.daelabCreativeCanvasV1={version:1,active:false,viewport:{x:60,y:60,zoom:.75},cards:Object.fromEntries(app.graph._nodes.map((n,i)=>[n.id,{x:i*1000,y:80,width:800,expanded:true}]))};app.canvas.ds.scale=.65;app.canvas.ds.offset=[0,0];app.canvas.setDirty(true,true)},data);await page.waitForTimeout(1100);
 const roots=page.locator('.dae-ui').filter({has:page.locator('.table-prompt-toggle')});
 console.log('roots',await roots.count(),'toggles',await page.locator('.table-prompt-toggle').count());
 // Each actual table owns exactly one button per editable text column.
 const tables=page.locator('.dae-table').filter({has:page.locator('.table-prompt-toggle')});assert.equal(await tables.count(),2);
 async function read(){return page.evaluate(async()=>{const {app}=await import('/scripts/app.js');return app.graph._nodes.filter(n=>n.type==='DAELAB.Table').map(n=>{const w=n.widgets.find(w=>w.name==='table_data');return JSON.parse(w.serializeValue?w.serializeValue():w.value)})})}
 const initial=await read();assert.deepEqual(initial.map(t=>t.meta.generationInput.promptFieldId),['p','p']);
 async function noPopup(){assert.equal(await page.locator('.generation-column-settings').count(),0);assert.equal(await page.getByText('整列模型配置',{exact:true}).count(),0)}
 const click=async(index,id)=>{const control=tables.nth(index).locator(`.table-prompt-toggle[data-field-id="${id}"]`);await control.evaluate(el=>{const root=el.closest('.dae-creative');if(root){const r=el.getBoundingClientRect(),b=root.getBoundingClientRect();root.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:(r.left+r.right-b.left-b.right)/2,deltaY:(r.top+r.bottom-b.top-b.bottom)/2,clientX:b.left+20,clientY:b.top+20}));}});await control.click();};
 await click(0,'p');await click(0,'p');await noPopup();assert.deepEqual(await read(),initial);
 await click(0,'n');await page.waitForTimeout(250);await noPopup();let current=await read();assert.equal(current[0].meta.generationInput.promptFieldId,'n');assert.deepEqual(current[1],initial[1]);assert.deepEqual(current[0].fields.find(f=>f.id==='p').generation,initial[0].fields.find(f=>f.id==='p').generation);assert.deepEqual(current[0].records[0].values,initial[0].records[0].values);
 await click(0,'n');await noPopup();assert.deepEqual(await read(),current);
 // A stale caller cannot resurrect the removed event handler either.
 await tables.nth(0).evaluate(el=>el.closest('.dae-ui').dispatchEvent(new CustomEvent('dae-prompt-column-settings',{detail:{fieldId:'n',anchor:el.querySelector('.table-prompt-toggle')},bubbles:true})));await page.waitForTimeout(150);await noPopup();
 const saved=await page.evaluate(async()=>{const {app}=await import('/scripts/app.js');return app.graph.serialize()});await page.reload();await page.waitForTimeout(1400);await page.evaluate(async saved=>{const {app}=await import('/scripts/app.js');await app.loadGraphData(saved)},saved);await page.waitForTimeout(500);assert.deepEqual(await read(),current);await click(0,'n');await noPopup();
 await page.locator('[data-testid="view-mode-toggle"] button[aria-haspopup="menu"]').click();await page.getByRole('menuitem',{name:'切换到创作画布',exact:true}).click();await page.waitForTimeout(400);
 const geometry=[];
 for(const [width,height] of [[1700,1100],[1000,800]]){await page.setViewportSize({width,height});for(const zoom of [.5,1,1.5]){await page.locator('.dae-creative:visible').evaluate((el,zoom)=>{const current=parseInt(el.querySelector('.dae-creative-zoom').textContent.match(/(\d+)%/)[1])/100;el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-Math.log(zoom/current)*1000,clientX:400,clientY:300}))},zoom);await page.waitForTimeout(100);await click(0,'n');await noPopup();const result=await tables.nth(0).locator('.table-prompt-toggle[data-field-id="n"]').evaluate(el=>({focused:document.activeElement===el,width:el.getBoundingClientRect().width,disabled:el.disabled,label:el.getAttribute('aria-label')}));assert.ok(result.focused);assert.ok(result.width>0);assert.ok(!result.disabled);assert.match(result.label,/已设为提示词/);geometry.push({width,height,zoom,result})}}
 await page.setViewportSize({width:1700,height:1100});await page.locator('.dae-creative:visible .dae-creative-zoom button').filter({hasText:'适应'}).click();await page.screenshot({path:`.local/${port}-prompt-header-${candidate?'candidate':'actual'}.png`});
 await page.evaluate(async()=>{const {app}=await import('/scripts/app.js');app.graph._nodes.filter(n=>n.type==='DAELAB.Table')[0].mode=4});await page.waitForTimeout(600);assert.equal(await tables.nth(0).isVisible(),false);assert.equal(await tables.nth(1).isVisible(),true);await page.evaluate(async()=>{const {app}=await import('/scripts/app.js');app.graph._nodes.filter(n=>n.type==='DAELAB.Table')[0].mode=0});await page.waitForTimeout(600);assert.equal(await tables.nth(0).isVisible(),true);
 assert.deepEqual(errors,[]);assert.deepEqual(submissions,[]);await writeFile(`.local/${port}-prompt-header-${candidate?'candidate':'actual'}.json`,JSON.stringify({errors,submissions,geometry,initial,after:await read()},null,2));console.log('PASS',port,candidate?'candidate':'actual','selected no-op, designate only, no popup/event handler, configs preserved, independent tables, save/reload, zoom, focus, modes');
}finally{await browser.close()}
