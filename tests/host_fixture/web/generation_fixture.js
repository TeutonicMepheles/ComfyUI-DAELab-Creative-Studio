/** Explicit test-package UI. No provider binding or request runs on import. */
import {app} from '/scripts/app.js';
import {api} from '/scripts/api.js';
import {bindGenerationHttp} from '/extensions/ComfyUI-DAELab-Creative-Studio/integrations/comfyui/business/business_http.js';
import {bindCreativeField} from '/extensions/ComfyUI-DAELab-Creative-Studio/ui/creative_field.mjs';
import {bindCreativeButton} from '/extensions/ComfyUI-DAELab-Creative-Studio/ui/creative_button.mjs';
import {bindPanelAvailability} from '/extensions/ComfyUI-DAELab-Creative-Studio/ui/creative_panel_state.mjs';

export const FIXTURE_VERSION='studio-generation-fixture-v1';
export const PREFIX='/studio-test/generation-fixture';
export const TYPE='StudioTest.GenerationFixture';
const GENERATION=new Set(['submit','status','recover','cancel','pause','retry-local','reconcile-resource']);
const OPTIMIZATION=new Set(['capabilities','estimate','lease','submit','query','recover','permit','advance','stop','continue','skip','polish']);
let releases=[],frontendFingerprint=null;

export function fixtureServiceRoute(domain,action,method='GET'){
    const parts=String(action).split('?'),name=parts[0],verb=String(method).toUpperCase();
    if(domain==='generation'&&name==='capabilities'&&parts.length<=2&&verb==='GET'){
        const query=new URLSearchParams(parts[1]||'');
        if([...query.keys()].some(key=>!['model','kind'].includes(key)))throw new Error('Unsupported fixture capability query');
        return PREFIX+'/api/daelab/studio/generation/capabilities?'+query;
    }
    const allowed=domain==='generation'?GENERATION:domain==='optimization'?OPTIMIZATION:null;
    if(!allowed?.has(name)||parts.length!==1||verb!=='POST')throw new Error('Unsupported fixture route');
    return PREFIX+'/api'+(domain==='generation'?'/daelab/studio/generation/':'/daelab/prompt-optimization/')+name;
}

async function control(payload){
    const response=await api.fetchApi(PREFIX+(payload?'/control':'/state'),payload?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}:{});
    const value=await response.json();
    if(!response.ok)throw new Error(value.error||'Fixture control unavailable');
    if(value.fixture!==FIXTURE_VERSION)throw new Error('Fixture version differs; refresh the explicit test installation.');
    return value;
}

async function enable(){
    const state=await control();
    if(!state.armed)throw new Error('先应用测试场景；未检查真实模型健康。');
    if(!releases.length){
        releases.push(bindGenerationHttp((url,options)=>{
            if(!url.startsWith(PREFIX+'/api/daelab/'))throw new Error('Fixture binding escaped its explicit namespace');
            return api.fetchApi(url,options);
        },{prefix:PREFIX+'/api'}));
    }
    if(!frontendFingerprint){
        const bytes=await (await fetch(import.meta.url,{cache:'no-store'})).arrayBuffer();
        frontendFingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
    }
    return state;
}

function install(node){
    if(node.studioGenerationFixture)return;
    const root=document.createElement('section');root.className='dae-ui dae-studio';
    root.style.cssText='padding:12px;box-sizing:border-box;min-width:0;overflow:auto';
    const title=document.createElement('strong');title.textContent='仅隔离测试 · 无模型推理';
    const note=document.createElement('p');note.textContent='用产品表格/优化面板发起请求；这里仅设置故障、释放响应与查看证据。合成图片固定 8×8，不能用于生成质量验收。';
    const select=(label,values)=>{const wrap=document.createElement('label');wrap.textContent=label+' ';wrap.style.display='block';const input=document.createElement('select');for(const value of values)input.add(new Option(value,value));wrap.append(input);root.append(wrap);return input;};
    root.append(title,note);
    const scenario=select('Provider 场景',['success','fail-429','uncertain-500','uncertain-no-id','delayed','overlapping']);
    const fault=select('下一次提交 HTTP 故障',['none','preflight-429','before-submit-500','after-submit-500','input-error','version-mismatch']);
    const jobs=select('原始请求',[]);
    const actions=document.createElement('div');actions.style.cssText='display:flex;flex-wrap:wrap;gap:6px;margin:8px 0';root.append(actions);
    const output=document.createElement('pre');output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;max-height:260px;overflow:auto';output.textContent='未启用。请先应用场景，再显式启用本页测试服务。';root.append(output);
    const controls=[],bindings=[bindCreativeField(scenario),bindCreativeField(fault),bindCreativeField(jobs),bindPanelAvailability(node,root)];let alive=true,busy=false;
    const show=state=>{if(!alive)return;const selected=jobs.value;jobs.replaceChildren();for(const job of state.jobs)jobs.add(new Option(`${job.requestId} · ${job.state} · ${job.source?.documentId||'standalone'}`,job.requestId));if([...jobs.options].some(o=>o.value===selected))jobs.value=selected;
        output.textContent=JSON.stringify({pageTestServicesEnabled:!!releases.length,frontendFixtureFingerprint:frontendFingerprint,...state},null,2);};
    const action=(label,run)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=async()=>{if(busy||!alive)return;busy=true;controls.forEach(b=>b.disabled=true);try{show(await run());}catch(error){if(alive)output.textContent=String(error.message||error);}finally{busy=false;if(alive)controls.forEach(b=>b.disabled=false);}};actions.append(button);controls.push(button);bindings.push(bindCreativeButton(button));};
    action('应用场景',()=>control({action:'arm',scenario:scenario.value,httpFault:fault.value}));
    action('启用本页测试服务',enable);
    action('刷新证据',()=>control());
    action('释放选中响应',()=>control({action:'release',requestId:jobs.value}));
    action('仅查询恢复选中任务',()=>control({action:'recover',requestId:jobs.value}));
    action('模拟服务重启',()=>control({action:'restart'}));
    action('禁用并刷新页面',async()=>{releases.splice(0).forEach(fn=>fn());location.reload();return control();});
    for(const event of ['pointerdown','keydown','dblclick','wheel'])root.addEventListener(event,e=>{if(event==='keydown'&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&!e.isComposing&&e.keyCode!==229)return;e.stopPropagation();});
    node.addDOMWidget('generation-fixture','custom',root,{serialize:false,getMinHeight:()=>350,hideOnZoom:false});
    node.studioGenerationFixture={root,fields:[scenario,fault,jobs],buttons:controls,destroy(){alive=false;bindings.forEach(fn=>fn());root.remove();delete node.studioGenerationFixture;}};
    node.setSize([520,500]);
}
function registerAdapter(){
    const canvas=globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')];if(!canvas||registerAdapter.done)return;
    canvas.registerAdapter('studio.generation.fixture',{matches:node=>node.type===TYPE,width:520,minWidth:340,expanded:true,resizable:true,fullHeight:true,panel:node=>node.studioGenerationFixture,menu:[{label:'生成故障夹具（仅隔离验收）',type:TYPE,icon:'flask-line'}]});registerAdapter.done=true;
}
globalThis.addEventListener('daelab:creative-canvas-ready',registerAdapter);registerAdapter();
app.registerExtension({name:'Studio.GenerationFixture',beforeRegisterNodeDef(type,definition){
    if(definition.name!==TYPE)return;
    for(const method of ['onNodeCreated','onConfigure']){const previous=type.prototype[method];type.prototype[method]=function(){const result=previous?.apply(this,arguments);install(this);return result;};}
    const previous=type.prototype.onRemoved;type.prototype.onRemoved=function(){this.studioGenerationFixture?.destroy();return previous?.apply(this,arguments);};
}});
globalThis.addEventListener('pagehide',()=>releases.splice(0).forEach(fn=>fn()),{once:true});
