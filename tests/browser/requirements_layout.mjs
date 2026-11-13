import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
// Opt-in browser regression against an explicitly supplied isolated host.
const target=process.env.STUDIO_TEST_URL;
assert.ok(target,'Set STUDIO_TEST_URL to an isolated loopback ComfyUI host.');
const url=new URL(target);
assert.ok(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&url.port&&url.port!=='8000');
const stats=await (await fetch(new URL('/system_stats',url))).json();
const argv=stats.system?.argv||[];
assert.ok(argv.some(value=>/[\\/]\.local[\\/]/.test(value)),'Requires an isolated .local host; production is forbidden.');
const port=url.port,candidate=false;
await mkdir('.local',{recursive:true});
const browser=await chromium.launch();
try {
const page=await browser.newPage({viewport:{width:1500,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/prompt',r=>r.abort());await page.route('**/daelab/prompt-optimization/polish',r=>r.abort());
await page.goto(`http://127.0.0.1:${port}`);await page.waitForTimeout(2800);await page.keyboard.press('Escape');
const requirements='第一行：保留原文主体与数量。\n第二行：保留原话和动作顺序。\n第三行：不添加未经说明的情节。\n第四行：明确画面中的空间关系。\n第五行：保留原有素材引用。\n第六行：逐项核对修改范围。\n'+('后续要求：可以滚动阅读，不能压缩输入区。\n'.repeat(12));
await page.evaluate(async({requirements,port})=>{const {app}=await import('/scripts/app.js');app.graph.clear();for(let i=0;i<2;i++){const n=LiteGraph.createNode('DAELAB.LLMStylePreviewB');n.pos=[80+i*450,100];n.properties.llmStylePreview=i===0||port==='8365'?{version:1,mode:'reverse',purpose:'video',videoTarget:'seedance',instruction:requirements,model:'qwen3.8-27b-w4a8'}:{version:1,mode:'reverse',purpose:'image',rewriteStrength:'faithful',rewriteTask:'text2image',instruction:requirements,model:'qwen-image-2.1-pe'};app.graph.add(n);}app.canvas.ds.scale=.85;app.canvas.ds.offset=[0,0];app.canvas.setDirty(true,true);},{requirements,port});await page.waitForTimeout(600);
const panels=page.locator('.llm-style-B');assert.equal(await panels.count(),2);
const metrics=[];
async function check(label){for(let i=0;i<2;i++){const field=panels.nth(i).locator('.llm-style-instruction textarea');await field.scrollIntoViewIfNeeded();await field.focus();await page.waitForTimeout(100);const m=await field.evaluate(el=>{const s=getComputedStyle(el),b=el.closest('.llm-style-body'),r=el.getBoundingClientRect(),br=b.getBoundingClientRect();return {height:el.clientHeight,lineHeight:parseFloat(s.lineHeight),padding:parseFloat(s.paddingTop)+parseFloat(s.paddingBottom),bodyHeight:b.clientHeight,bodyScroll:b.scrollHeight,scrollTop:b.scrollTop,rect:{top:r.top,bottom:r.bottom,bodyTop:br.top,bodyBottom:br.bottom},inside:r.top>=br.top-2&&r.bottom<=br.bottom+2,focused:document.activeElement===el,content:el.value};});assert.ok((m.height-m.padding)/m.lineHeight>=5-0.05,JSON.stringify(m));if(!m.inside)await page.screenshot({path:`.local/${port}-clipped-candidate.png`});assert.ok(m.inside,label+' '+JSON.stringify(m));assert.ok(m.focused);metrics.push({label,i,...m});}}
await check('graph reverse');
await panels.nth(0).locator('.llm-style-instruction textarea').fill(requirements+'本次补充：保留光标。');await page.waitForTimeout(650);assert.equal(await panels.nth(0).locator('.llm-style-instruction textarea').inputValue(),requirements+'本次补充：保留光标。');assert.equal(await panels.nth(1).locator('.llm-style-instruction textarea').inputValue(),requirements);
for(const mode of ['polish','reverse']){await panels.nth(0).locator(`[data-mode="${mode}"]`).click();await page.waitForTimeout(300);await check('graph '+mode);}
const saved=await page.evaluate(async()=>{const {app}=await import('/scripts/app.js');return app.graph.serialize()});await writeFile(`.local/${port}-requirements-workflow.json`,JSON.stringify(saved,null,2));await page.reload();await page.waitForTimeout(1400);await page.evaluate(async saved=>{const {app}=await import('/scripts/app.js');await app.loadGraphData(saved)},saved);await page.waitForTimeout(500);await check('saved reload');
await page.locator('[data-testid="view-mode-toggle"] button[aria-haspopup="menu"]').click();await page.getByRole('menuitem',{name:'切换到创作画布',exact:true}).click();await page.waitForTimeout(450);
for(const [width,height] of [[1500,1050],[1000,800]]){await page.setViewportSize({width,height});for(const target of [.5,1,1.5]){await page.locator('.dae-creative:visible').evaluate((el,target)=>{const current=parseInt(el.querySelector('.dae-creative-zoom').textContent.match(/(\d+)%/)[1])/100;el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-Math.log(target/current)*1000,clientX:400,clientY:300}));},target);await page.waitForTimeout(150);await check(`canvas ${width} ${target}`);}}
await page.setViewportSize({width:1500,height:1050});await page.locator('.dae-creative:visible .dae-creative-zoom button').filter({hasText:'适应'}).click();await page.waitForTimeout(150);await check('canvas fit');await page.screenshot({path:`.local/${port}-requirements-fixed-${candidate?'candidate':'actual'}.png`});
await page.evaluate(async()=>{const {app}=await import('/scripts/app.js');app.graph._nodes[0].mode=4});await page.waitForTimeout(600);assert.equal(await panels.nth(0).isVisible(),false);assert.equal(await panels.nth(1).isVisible(),true);await page.evaluate(async()=>{const {app}=await import('/scripts/app.js');app.graph._nodes[0].mode=0});await page.waitForTimeout(600);assert.equal(await panels.nth(0).isVisible(),true);
assert.deepEqual(errors,[]);await writeFile(`.local/${port}-requirements-${candidate?'candidate':'actual'}.json`,JSON.stringify({port,candidate,metrics,errors},null,2));console.log('PASS',port,candidate?'candidate':'actual','two owners; five visible lines; reverse/polish; focus; save/reload; canvas 2 viewports x 3 zooms; modes');

} finally { await browser.close(); }
