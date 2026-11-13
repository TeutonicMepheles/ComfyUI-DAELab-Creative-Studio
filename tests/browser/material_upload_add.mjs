import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const target=process.env.STUDIO_TEST_URL;
assert.ok(target,'Set STUDIO_TEST_URL to an isolated loopback ComfyUI host.');
const url=new URL(target);
assert.ok(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&url.port&&url.port!=='8000');
const stats=await(await fetch(new URL('/system_stats',url))).json();
assert.ok((stats.system?.argv||[]).some(value=>/[\\/]\.local[\\/]/.test(value)),'Requires an isolated .local host.');
const port=url.port,candidate=false;await mkdir('.local',{recursive:true});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64');
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1700,height:1050}});const errors=[],submissions=[],uploads=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/prompt',r=>{submissions.push(r.request().url());return r.abort()});await page.route('**/daelab/studio/generation/submit',r=>{submissions.push(r.request().url());return r.abort()});page.on('response',r=>{if(r.url().endsWith('/upload/image'))uploads.push({url:r.url(),status:r.status()})});
 await page.goto(`http://127.0.0.1:${port}`);await page.waitForTimeout(2500);await page.keyboard.press('Escape');
 await page.evaluate(async()=>{const {app}=await import('/scripts/app.js');app.graph.clear();for(let i=0;i<2;i++){const n=LiteGraph.createNode('DAELAB.VideoGenerate');n.pos=[80+i*850,150];const model=n.widgets.find(w=>w.name==='model');if(model)model.value='Seedance 2.5';app.graph.add(n);}app.graph.extra.daelabCreativeCanvasV1={version:1,active:false,viewport:{x:60,y:60,zoom:.8},cards:Object.fromEntries(app.graph._nodes.map((n,i)=>[n.id,{x:i*850,y:80,width:640,height:360,expanded:true}]))};app.canvas.ds.scale=.8;app.canvas.ds.offset=[0,0];app.canvas.setDirty(true,true)});await page.waitForTimeout(1100);
 const panels=page.locator('.dae-video-tasks');assert.equal(await panels.count(),2);const a=panels.nth(0),b=panels.nth(1),add=a.getByRole('button',{name:'添加图片或视频',exact:true});
 async function check(count){await expect(a.locator('.video-task-material')).toHaveCount(count);await expect(add).toHaveCount(1);await expect(add).toBeVisible();await expect(add).toBeEnabled();assert.equal(await a.locator('.video-task-materials').evaluate(el=>el.firstElementChild?.classList.contains('video-task-material-add')),true);assert.equal(await b.locator('.video-task-material').count(),0);await expect(b.getByRole('button',{name:'添加图片或视频',exact:true})).toBeEnabled();}
 async function upload(name){const [chooser]=await Promise.all([page.waitForEvent('filechooser'),add.click()]);await chooser.setFiles({name,mimeType:'image/png',buffer:png});}
 await check(0);await upload('first.png');await check(1);await upload('second.png');await check(2);
 await a.locator('.video-task-material').first().focus();await a.locator('.video-task-material').first().press('Delete');await check(1);await upload('third.png');await check(2);
 const snapshot=await page.evaluate(async()=>{const {app}=await import('/scripts/app.js');return app.graph._nodes.map(n=>JSON.parse(n.widgets.find(w=>w.name==='task_data').value))});
 const saved=await page.evaluate(async()=>{const {app}=await import('/scripts/app.js');return app.graph.serialize()});await page.reload();await page.waitForTimeout(1400);await page.evaluate(async saved=>{const {app}=await import('/scripts/app.js');await app.loadGraphData(saved)},saved);await page.waitForTimeout(650);await check(2);await upload('after-reload.png');await check(3);
 await page.locator('[data-testid="view-mode-toggle"] button[aria-haspopup="menu"]').click();await page.getByRole('menuitem',{name:'切换到创作画布',exact:true}).click();await page.waitForTimeout(350);
 const geometry=[];
 for(const [width,height] of [[1700,1050],[1000,800]]){await page.setViewportSize({width,height});for(const zoom of [.5,1,1.5]){await page.locator('.dae-creative:visible').evaluate((el,zoom)=>{const current=parseInt(el.querySelector('.dae-creative-zoom').textContent.match(/(\d+)%/)[1])/100;el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-Math.log(zoom/current)*1000,clientX:400,clientY:300}))},zoom);await page.waitForTimeout(100);await check(3);const metrics=await a.locator('.video-task-materials').evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,addWidth:el.firstElementChild.getBoundingClientRect().width}));assert.ok(metrics.scrollWidth<=metrics.width+2);assert.ok(metrics.addWidth>0);geometry.push({width,height,zoom,metrics})}}
 await page.setViewportSize({width:1700,height:1050});await page.locator('.dae-creative:visible .dae-creative-zoom button').filter({hasText:'适应'}).click();await page.mouse.move(1650,1000);await page.keyboard.press('Escape');await page.waitForTimeout(350);await page.screenshot({path:`.local/${port}-material-add-${candidate?'candidate':'actual'}.png`});
 await page.evaluate(async()=>{const {app}=await import('/scripts/app.js');app.graph._nodes[0].mode=4});await page.waitForTimeout(600);assert.equal(await a.isVisible(),false);assert.equal(await b.isVisible(),true);await page.evaluate(async()=>{const {app}=await import('/scripts/app.js');app.graph._nodes[0].mode=0});await page.waitForTimeout(650);await check(3);
 assert.deepEqual(errors,[]);assert.deepEqual(submissions,[]);assert.equal(uploads.length,4);assert.ok(uploads.every(r=>r.status===200));await writeFile(`.local/${port}-material-add-${candidate?'candidate':'actual'}.json`,JSON.stringify({errors,uploads,submissions,snapshot,geometry},null,2));console.log('PASS',port,candidate?'candidate':'actual','real uploads, persistent leading plus, repeated add/remove, peer isolation, reload, canvas zoom/viewports, mute/active, no generation');
}finally{await browser.close()}
