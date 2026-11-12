import {modelSourceBadge,modelSourceKind} from '../models/source_badge.js';
import {generationInputDigest} from '../generation/generation_session.js';
import {ensureIdentity} from './prompt_optimization_model.mjs';
import {assertBusinessService} from '../../contracts/business.js';
import {snapshotJson} from '../../contracts/json_snapshot.js';
import {createTableButton} from '../../ui/table_controls.mjs';

import {availableModes} from './llm_io_model.mjs';
import {slotRows,slotSignature,outputText,hasTableInput,optimizationPurpose} from './llm_slot_model.mjs';
import {optimizeRow} from './llm_local_provider.mjs';
import {changeInstructionTarget,processingInstruction} from './text_templates.js';
import {createLLMTask} from './llm_task_model.mjs';
import {getModelCatalog} from '../models/model_catalog.mjs';
import {canSubmitModel,updateModelOption,modelOptionPresentation,bindModelProbeRetry} from '../models/model_catalog_ui.mjs';
// Reconcile against the actual controls, including shared-control changes. Do
// not cache render inputs: Slot validation, task snapshots and native outputs
// must still be refreshed on every render.
const setProperty=(element,key,value)=>{if(element[key]!==value)element[key]=value;};
const setAttribute=(element,key,value)=>{if(element.getAttribute(key)!==value)element.setAttribute(key,value);};
const toggleAttribute=(element,key,enabled)=>{if(element.hasAttribute(key)!==enabled)element.toggleAttribute(key,enabled);};
const toggleClass=(element,key,enabled)=>{if(element.classList.contains(key)!==enabled)element.classList.toggle(key,enabled);};
export function bindIOPanel({node,nativeDocument=null,checkLocalTextModels,root,source,instruction,select,modelControl=null,run,footer,materialHint}){
    const saved=()=>node.properties.llmStylePreview;
    saved().instruction??=instruction.value;
    if(!['polish','reverse'].includes(saved().mode))saved().mode='polish';
    const listeners=[],on=(el,event,fn)=>{el.addEventListener(event,fn);listeners.push(()=>el.removeEventListener(event,fn));};
    const make=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;if(text)e.textContent=text;return e;};
    const status=make('div','llm-style-preview-status');status.setAttribute('role','status');
    footer.before(status);
    const changed=()=>{node.graph?.change?.();render();};
    function publishResult(proposal){
        if(!proposal.complete||proposal.signature!==signature()||!nativeDocument.canApply(proposalTicket))throw new Error('输入或工作流已变化，请重新生成');
        const commit=()=>nativeDocument.controller.applyResult(proposalTicket,'输出优化结果',draft=>{
            draft.appliedIO=snapshotJson(proposal);
            delete draft.ioResult;delete draft.ioUndo;
        });
        const context=globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]?.getPanelContext?.(root);
        const written=context?.confirmOutput&&(!node.outputs?.[1]?.links?.length||node.outputs?.[0]?.links?.length)
            ?context.confirmOutput(commit,proposal.rows.map(row=>row.result))
            :commit();
        if(!written)throw new Error('结果未输出，请重新生成');
        message='';
    }
    const sourceSection=source.closest('.llm-style-source');source.placeholder='输入原始文字，或连接文本节点';
    const imageSection=make('section','llm-style-section llm-style-image-source'),imageBox=make('div','llm-style-image-upload'),image=make('img','llm-style-image-preview'),imageText=make('span','llm-style-image-text','通过 Slot 连接参考图片');
    imageSection.append(make('span','llm-style-label','参考图片'),imageBox);imageBox.append(image,imageText);sourceSection.after(imageSection);materialHint.parentElement.hidden=true;
    const modelCatalog=getModelCatalog(),sourceBadge=make('span','llm-model-source');sourceBadge.hidden=!!modelControl;if(select.parentElement)select.after(sourceBadge);
    let models=[],modelListSignature='';
    const textModels=()=>modelCatalog.snapshot({family:'optimization'}).filter(model=>model.id!=='qwen3.5:9b-q4_K_M');
    const logicalModel=model=>{
        if(model==='qwen'||model==='qwen3.5:9b-q4_K_M')return 'qwen3.8-27b-w4a8';
        if(models.some(option=>option.id===model))return model;
        if(model==='deepseek')return models.find(option=>option.provider===model)?.id||model;
        return model;
    };
    const initialModels=textModels();
    saved().model??=(initialModels.find(model=>model.id==='qwen3.8-27b-w4a8')||initialModels[0])?.id||'';
    function rebuildModelOptions(){
        const discovered=textModels(),signature=JSON.stringify(discovered.map(model=>[model.id,model.label,model.provider]));
        if(signature===modelListSignature)return;
        modelListSignature=signature;
        models=discovered.map(model=>({
            id:model.id,
            label:model.label,
            provider:model.provider,
            logo:model.provider==='comfy'?'openai':model.provider,
        }));
        const previous=saved().model;
        const selectedModel=logicalModel(previous);
        select.replaceChildren(...models.map(model=>updateModelOption(new Option(model.label+(model.logo==='openai'?' · Comfy':''),model.id),modelCatalog.get(model.id))));
        if(!models.some(model=>model.id===selectedModel)){const legacy=new Option('已保存但不可用（历史模型）',previous||'');legacy.disabled=true;select.add(legacy);}
        select.value=selectedModel||'';
    }
    const supported=model=>models.some(option=>option.id===logicalModel(model));
    const modelLabel=model=>models.find(option=>option.id===logicalModel(model))?.label||'未识别模型';
    const syncSourceBadge=model=>{const status=modelCatalog.get(logicalModel(model));sourceBadge.textContent=modelSourceBadge(status);sourceBadge.dataset.source=modelSourceKind(status);};
    function refreshModelOptions(){rebuildModelOptions();syncSourceBadge(saved().model);const current=logicalModel(saved().model);for(const option of select.children||select.options||[]){const model=models.find(item=>item.id===option.value);if(model)updateModelOption(option,modelCatalog.get(model.id));}const model=models.find(item=>item.id===current);select.disabled=!model;const status=model&&modelCatalog.get(current);if(status?.checking)select.setAttribute('aria-busy','true');else select.removeAttribute('aria-busy');}
    rebuildModelOptions();
    const generationTask=createLLMTask();
    const taskRail=make('div','llm-io-task-rail');taskRail.setAttribute('role','tablist');taskRail.setAttribute('aria-label','优化任务');root.append(taskRail);
    let selectedId='',railStamp='';
    let busy=false,disposed=false,message='',task=[],lastInput='',proposalTicket=null;
    function signature(){try{return slotSignature(node);}catch{return '';}}
    function render(){
        if(disposed)return;
        let rows=[],error='',waiting=false;try{rows=slotRows(node);}catch(e){error=e.message;waiting=!!e.waiting;}
        setProperty(select,'value',logicalModel(saved().model));
        const tableInput=hasTableInput(node),pe=logicalModel(saved().model)==='qwen-image-2.1-pe',tableMode=pe?'reverse':'polish',inputKey=JSON.stringify([tableInput,rows,pe]),modes=availableModes(rows);
        // PE processes one reference image per row through the existing reverse
        // provider. Other table models retain the text-optimization contract.
        if(tableInput&&!pe)modes.reverse=false;
        if(pe){modes.polish=false;modes.reverse=modes.reverse&&rows.every(row=>row.image);}
        if(logicalModel(saved().model)==='qwen3.8-27b-w4a8')modes.reverse=false;
        if(!rows.some(row=>row.id===selectedId))selectedId=rows[0]?.id||'';
        const selectedRow=rows.find(row=>row.id===selectedId);
        const nextRailStamp=JSON.stringify([rows.map(row=>[row.id,row.name,row.text]),selectedId]);
        const showTasks=rows.length>1||tableInput&&rows.length>0;
        setProperty(taskRail,'hidden',!showTasks);
        toggleClass(root,'has-task-list',showTasks);
        if(nextRailStamp!==railStamp){
            railStamp=nextRailStamp;taskRail.replaceChildren();
            for(const [index,row] of rows.entries()){
                const item=createTableButton('',()=>{selectedId=row.id;render();});item.setAttribute('role','tab');item.setAttribute('aria-selected',String(row.id===selectedId));
                item.append(make('span','llm-io-task-number',String(index+1)),make('span','llm-io-task-text',row.name||`任务${index+1}`),make('small','llm-io-task-preview',row.text||'参考图片'));
                item.title=row.text||row.name||'参考图片';taskRail.append(item);
            }
        }
        if(inputKey!==lastInput||tableInput&&saved().mode!==tableMode){
            const next=snapshotJson(saved());
            const linkedInstructions=[...new Set(rows.map(r=>r.instruction).filter(Boolean))].join('\n\n');
            if(linkedInstructions){
                if(next.slotInstruction===undefined)next.manualInstruction=next.instruction;
                next.slotInstruction=linkedInstructions;next.instruction=linkedInstructions;setProperty(instruction,'value',linkedInstructions);
            }else if(next.slotInstruction!==undefined){
                next.instruction=next.manualInstruction||'';setProperty(instruction,'value',next.instruction);delete next.slotInstruction;delete next.manualInstruction;
            }
            let mode=tableInput?tableMode:linkedInstructions?'reverse':next.mode;
            if(!tableInput&&!modes[mode]){if(modes.reverse)mode='reverse';else if(modes.polish)mode='polish';}
            changeInstructionTarget(next,'mode',mode);
            try{if(JSON.stringify(next)!==JSON.stringify(saved())){if(nativeDocument)nativeDocument.replace(next,{derived:true});else Object.assign(saved(),next);}lastInput=inputKey;}catch(error){message=error.message;}
        }
        // Native history can replace saved configuration without recreating this
        // panel. Reconcile changed text only; ordinary input already persisted
        // before this render, so equal values keep their caret/selection intact.
        setProperty(instruction,'value',processingInstruction(saved(),selectedRow?.instruction));
        for(const b of root.querySelectorAll('[data-mode]')){const selected=b.dataset.mode===saved().mode;setAttribute(b,'aria-pressed',String(selected));toggleAttribute(b,'data-primary',selected);}
        const mode=saved().mode||'polish',reverse=mode==='reverse',disabled=busy||!!node.mode;
        for(const b of root.querySelectorAll('[data-purpose]')){
            const selected=b.dataset.purpose===(saved().purpose||'video');
            setAttribute(b,'aria-pressed',String(selected));setProperty(b,'disabled',disabled);
        }
        const linked=node.inputs?.some(input=>input.link!=null)||false;
        setProperty(sourceSection,'hidden',reverse||linked);setProperty(imageSection,'hidden',!reverse);
        setProperty(source,'readOnly',linked);
        setProperty(source,'value',linked?selectedRow?.text||'':saved().source||'');
        const first=selectedRow?.image;setProperty(image,'hidden',!first);if(first&&image.getAttribute('src')!==first.url)image.src=first.url;setProperty(image,'alt',first?.name||'参考图片');setProperty(imageText,'hidden',!!first);toggleClass(imageBox,'has-image',!!first);
        for(const control of [source,instruction,select])setProperty(control,'disabled',disabled||control===source&&linked);
        setProperty(instruction,'readOnly',saved().slotInstruction!==undefined);
        const videoPurpose=saved().purpose!=='image';
        for(const picker of root.querySelectorAll('[aria-label="提示词模板"]')){setProperty(picker,'hidden',videoPurpose||reverse);setProperty(picker,'disabled',disabled||saved().slotInstruction!==undefined);}
        for(const target of root.querySelectorAll('[aria-label="目标视频模型"]')){setProperty(target,'hidden',!videoPurpose);setProperty(target,'value',saved().videoTarget||'seedance');setProperty(target,'disabled',disabled);}
        for(const b of root.querySelectorAll('[data-mode]')){setProperty(b,'disabled',disabled||tableInput&&(pe?b.dataset.mode==='polish':b.dataset.mode==='reverse'));setProperty(b,'title',tableInput?(pe?'PE 按行处理参考图片':'表格输入仅支持文字优化'):'');}
        const valid=modes[mode],modelReady=canSubmitModel(modelCatalog.get(logicalModel(saved().model)));
        setProperty(run,'disabled',disabled||!!error||!valid||!modelReady);setProperty(run,'title','生成并输出优化结果');setProperty(run.lastChild,'textContent',busy?'生成中…':saved().appliedIO?'重新生成':'生成');setAttribute(run,'aria-busy',String(busy));
        const receipt=saved().appliedIO;
        setProperty(status,'textContent',error||message||(modelCatalog.get(logicalModel(saved().model))?.status==='unknown'?modelOptionPresentation(modelCatalog.get(logicalModel(saved().model))).statusLabel:'')||(receipt&&receipt.signature===signature()?(receipt.rows.some(row=>row.dialogueFallback)?'模型未完整保留对白，对应任务已按原文输出':'已输出优化结果'):rows.length&&!valid?'当前输入不支持此模式':rows.length?`${rows.length} 项输入 · 等待生成`:'请输入原始文字或连接输入'));
        task=[...generationTask.snapshot(),...(!busy&&error?[{id:'llm-input',label:waiting?'等待输入':'输入异常',state:waiting?'queued':'error',detail:error}]:[])];
        try{node.setOutputData?.(0,outputText(node));}catch{node.setOutputData?.(0,null);}
        modelControl?.sync();
    }
    on(select,'change',()=>{message='';saved().model=select.value;syncSourceBadge(select.value);changed();});for(const field of [source,instruction])on(field,'input',()=>{message='';changed();});
    for(const b of root.querySelectorAll('[data-mode]'))on(b,'click',()=>{message='';changed();});
    on(run,'click',async()=>{
        if(disposed||busy||run.disabled||node.mode)return;
        if(saved().purpose!=='image'&&(!saved().purpose||!saved().videoTarget)&&nativeDocument)nativeDocument.edit('设置视频提示词用途',draft=>{draft.purpose='video';draft.videoTarget??='seedance';});
        const state=saved(),graph=node.graph,stamp=signature();busy=true;message='';render();
        const current=()=>!disposed&&node.graph===graph&&(!nativeDocument||nativeDocument.canApply(proposalTicket))&&!node.mode&&signature()===stamp;
        const rowTickets=[];
        try{
            const rows=slotRows(node),provider=logicalModel(state.model);if(!supported(provider))throw new Error('该历史模型配置不可执行，请明确选择已接入的提供方');if(checkLocalTextModels){
                await checkLocalTextModels();
                if(disposed||node.graph!==graph||node.mode||signature()!==stamp||nativeDocument&&!nativeDocument.isCurrent())throw new Error('输入或工作流已变化，未提交');
            }
            if(!canSubmitModel(modelCatalog.get(provider)))throw new Error('所选模型不可用，请检查模型文件或选择其他模型');
            assertBusinessService('optimization');generationTask.start(rows.length,state.mode,provider);render();
            const proposal={version:1,requestId:crypto.randomUUID(),rows:[],mode:state.mode,instruction:state.instruction||'',signature:stamp,provider,complete:false};if(proposalTicket)nativeDocument?.releaseRequest(proposalTicket);proposalTicket=nativeDocument?.beginRequest(proposal.requestId)||null;
            if(!nativeDocument)throw new Error('原生编辑会话尚未就绪，未提交');const identity=ensureIdentity(graph,node),inputDigest=await generationInputDigest(stamp);if(!current())throw new Error('输入或工作流已变化，未提交');
            if(!node.outputs?.[1]?.links?.length||node.outputs?.[0]?.links?.length)globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]?.getPanelContext?.(root)?.prepareTextOutput?.();
            const createdAt=Date.now(),requests=rows.map((row,index)=>{const requestId=crypto.randomUUID(),ticket=nativeDocument.beginRequest(requestId,{recordId:String(row.id),fieldId:'instruction'});rowTickets.push(ticket);return {requestId,recordId:String(row.id),sourceScope:{...identity,nodeId:ticket.documentId,workflowSession:ticket.workflowSession,epoch:ticket.epoch,recordId:String(row.id),fieldId:'instruction',inputVersion:ticket.inputVersion,operation:'standalone-optimization',groupId:proposal.requestId,rowIndex:index,rowCount:rows.length,inputDigest,createdAt}};});nativeDocument.edit('记录优化请求',draft=>{draft.studioTextRequests={groupId:proposal.requestId,inputDigest,requests};});
            if(supported(provider))for(const row of rows){
                if(!current())throw new Error('输入或节点状态已改变，已停止后续提交');
                message=`${modelLabel(provider)} 处理中 ${proposal.rows.length+1}/${rows.length} · 并发 1`;render();
                const reference=requests[proposal.rows.length],ticket=rowTickets[proposal.rows.length];
                const output=await optimizeRow(row,state.mode,processingInstruction(state,row.instruction),{purpose:optimizationPurpose(state),model:provider,requestId:reference.requestId,sourceScope:reference.sourceScope});if(!nativeDocument.canApply(ticket))throw new Error('输入或工作流已变化，结果保留在账本中');
                if(!current())throw new Error('输入或节点状态已改变，结果未应用');
                proposal.rows.push(output);generationTask.completeRow();render();
            }
            if(current()){proposal.complete=true;publishResult(proposal);generationTask.finish();}
        }catch(e){message='异常：'+e.message;generationTask.fail(e.message);}finally{for(const ticket of rowTickets)nativeDocument?.releaseRequest(ticket);busy=false;render();}
    });
    const retryProbe=createTableButton('\u91cd\u65b0\u68c0\u6d4b',()=>{});if(select.parentElement)select.after(retryProbe);else root.append(retryProbe);
    const stopRetry=bindModelProbeRetry(retryProbe,{catalog:modelCatalog,getModel:()=>logicalModel(saved().model),active:()=>!disposed&&root.isConnected,retry:()=>{const id=logicalModel(saved().model);return modelCatalog.retry(id,{active:()=>!disposed&&root.isConnected&&logicalModel(saved().model)===id});}});
    const unsubscribeModels=modelCatalog.subscribe(()=>{refreshModelOptions();render();});
    const timer=setInterval(()=>{if(root.isConnected)render();},500);render();
    const release=()=>{disposed=true;stopRetry();if(proposalTicket)nativeDocument?.releaseRequest(proposalTicket);clearInterval(timer);unsubscribeModels();for(const off of listeners)off();};release.sync=render;release.tasks=()=>task;return release;
}
