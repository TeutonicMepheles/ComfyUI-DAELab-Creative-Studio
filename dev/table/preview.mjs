import {createTableEditor} from '/web/application/table_editor.mjs';
import {createMaterialTable} from '/web/application/table_material_columns.mjs';
import {createBusinessDocument} from '/web/application/business_document.js';
import {normalizeTable} from '/web/application/table_model.mjs';
import {createPromptEditor} from '/web/features/prompt/table_prompt_editor.mjs';
import {attachGenerationColumns} from '/web/features/generation/table_generation_panel.mjs';
import {bindBusinessService} from '/web/contracts/business.js';
import {createStructuredClipboard} from '/web/ui/structured_clipboard.js';

const mode=document.querySelector('#mode'),response=document.querySelector('#response'),capability=document.querySelector('#capability');
const instances=[],reports=new Map(),clipboard=createStructuredClipboard(text=>navigator.clipboard.writeText(text));
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
async function simulate(signal){
 if(mode.value==='basic'||response.value==='unavailable')throw Error('模拟服务不可用；编辑和已保存配置仍保留');
 if(response.value==='error')throw Error('模拟服务错误；未产生结果');
 if(response.value==='loading')await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,3000);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('实例已卸载','AbortError'));},{once:true});});
 if(signal?.aborted)throw new DOMException('实例已卸载','AbortError');
}
bindBusinessService('generation',{async request(action,options){
 const body=options.body?JSON.parse(options.body):{};
 if(action==='status')return json({jobs:[...reports.values()].filter(x=>body.requestIds?body.requestIds.includes(x.requestId):Object.entries(body.source||{}).every(([k,v])=>x.source[k]===v)),nextOffset:null});
 try{await simulate(options.signal);}catch(error){return json({error:error.message,code:'preview-unavailable',originalTaskMayExist:false},503);}
 if(action.startsWith('capabilities'))return json({local:true,available:true,schema:{properties:{modeType:{items:{text2image:'文生图',text2video:'文生视频'}}},config:{strictModes:true}}});
 if(action==='submit'){
  for(const job of body.jobs){reports.set(job.requestId,{requestId:job.requestId,source:job.source,inputFingerprint:'a'.repeat(64),version:3,state:'succeeded',phase:'complete',result:{url:'/view?filename=simulated.png&type=output',kind:'image',asset_id:'synthetic',reference_id:job.requestId},receipt:{kind:'assets',items:[{asset_id:'synthetic',reference_id:job.requestId}]}});}
  return json({jobs:body.jobs.map(x=>reports.get(x.requestId))});
 }
 return json({error:'预览未实现此模拟动作',code:'preview-unsupported',originalTaskMayExist:false},400);
}});
function fixture(name){const t=createMaterialTable();t.fixtureExtension={preserve:true};t.records[0].values[t.fields[0].id]=[{id:`asset-${name}`,url:'/view?filename=synthetic.png&type=input',kind:'image',name:'合成素材'}];const prompt=t.fields.find(f=>f.presentation==='prompt');t.records[0].values[prompt.id]=`实例 ${name} 的合成提示词`;t.fields.push({id:`note-${name}`,name:'备注',type:'text',width:240});for(const r of t.records)r.values[`note-${name}`]=`${name} 独立文字`;return t;}
function button(parent,label,action){const b=document.createElement('button');b.textContent=label;b.onclick=action;parent.append(b);return b;}
function build(name){
 const section=document.createElement('section');section.className='instance';section.dataset.instance=name;section.setAttribute('aria-label',`实例 ${name}`);section.innerHTML=`<h2>实例 ${name}</h2><div class="controls"></div><div class="mount"></div><p class="notice" role="status"></p><details><summary>当前 JSON（只读）</summary><pre class="state"></pre></details>`;document.querySelector('#instances').append(section);
 const controls=section.querySelector('.controls'),mountPoint=section.querySelector('.mount'),notice=section.querySelector('.notice'),state=section.querySelector('.state');let table=fixture(name),editor,promptUI,generationUI,alive=false,epoch=0,saved=null;
 const show=()=>state.textContent=JSON.stringify(table,null,2),notify=message=>notice.textContent=message;
 const unmount=()=>{if(!alive)return;alive=false;epoch++;generationUI?.destroy();promptUI?.destroy();editor.destroy();mountPoint.replaceChildren();notify('已卸载；保存的数据保留');};
 function mount(){if(alive)return;alive=true;const ownEpoch=++epoch,undo=[],redo=[];let before;
  const history={begin(){before=structuredClone(table);},end(){undo.push(before);redo.length=0;},amend(change){change();},undo(){if(undo.length){redo.push(structuredClone(table));table=undo.pop();show();editor.render();}},redo(){if(redo.length){undo.push(structuredClone(table));table=redo.pop();show();editor.render();}}};
  promptUI=null;generationUI=null;
  editor=createTableEditor({getTable:()=>table,setTable:value=>{table=value;promptUI?.observe();show();},notify,
   documentFactory:(read,write)=>createBusinessDocument({read,write,current:()=>alive&&epoch===ownEpoch,identity:()=>({workflowSession:`preview-${name}-${ownEpoch}`,epoch:ownEpoch,documentId:`node-${name}`}),history}),
   clipboard,upload:async(_file,{signal})=>{notify('模拟上传中');await simulate(signal);return '/view?filename=uploaded.png&type=input';},
   renderCell:args=>promptUI?.renderCell(args),decorateAsset:(...args)=>promptUI?.decorateAsset(...args),onRestore:()=>{promptUI?.invalidate();generationUI?.invalidate();}});
  editor.taskIdentity={documentId:'preview-document',tableId:`table-${name}`,nodeId:`node-${name}`};
  promptUI=createPromptEditor({editor,getTable:()=>table,notify,request:async()=>{await simulate();throw Error('此预览只模拟生成结果；提示词解析未提交');}});
  generationUI=attachGenerationColumns({editor,getTable:()=>table,notify,editPromptTemplate:field=>promptUI.editTemplate(field),canGenerate:()=>mode.value==='full',onRefresh:show});
  editor.render();editor.root.classList.add('dae-ui','dae-table-panel');mountPoint.append(editor.root);show();notify('已挂载');
 }
 button(controls,'卸载',unmount);button(controls,'挂载',mount);button(controls,'空表',()=>{unmount();table=normalizeTable({fields:[],records:[],meta:{}});mount();});button(controls,'标准表',()=>{unmount();table=fixture(name);mount();});
 button(controls,'保存预览',()=>{saved=JSON.stringify(table);notify('已保存到本页面内存');});button(controls,'重载预览',()=>{if(saved){unmount();table=normalizeTable(JSON.parse(saved));mount();notify('已从本页面内存重载');}});
 button(controls,'提示词模板',()=>{const f=table.fields.find(f=>f.presentation==='prompt');if(alive&&f)promptUI.editTemplate(f.id);});
 button(controls,'生成设置',()=>{const f=table.fields.find(f=>f.presentation==='generation');if(alive&&f)generationUI.open(f.id);});
 button(controls,'模拟生成首行',()=>{const f=table.fields.find(f=>f.presentation==='generation');if(!alive||!f||!table.records.length)return;if(mode.value!=='full'){notify('生成服务不可用；可编辑并保留配置');return;}notify('模拟任务：正在处理');void generationUI.generate(f.id,table.records[0].id).then(()=>{if(alive){show();if(generationUI.stateFor(table.records[0],f.id)?.phase==='complete')notify('模拟任务已完成：合成图片，未调用模型');}});});
 instances.push({unmount,mount});mount();
}
function capabilities(){capability.textContent=mode.value==='basic'?'生成/优化服务不可用：未连接模型。提示词、生成配置和未知字段保留，可继续编辑。':'模拟扩展：生成结果是合成图片；不连接模型。优化服务未连接。';}
mode.onchange=()=>{capabilities();};response.onchange=capabilities;build('A');build('B');capabilities();
window.addEventListener('pagehide',()=>instances.forEach(x=>x.unmount()),{once:true});
