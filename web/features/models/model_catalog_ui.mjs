import {MODEL_STATUS} from './model_catalog.mjs';

export function modelOptionPresentation(model){
    const checking=model?.status===MODEL_STATUS.checking;
    return {
        text:`${model?.label||model?.id||'模型'}${checking?' ◌':''}`,
        disabled:model?.status===MODEL_STATUS.unavailable||model?.status===MODEL_STATUS.unknown,
        checking,
        available:model?.status===MODEL_STATUS.available,
        unverified:model?.status===MODEL_STATUS.unverified,
        statusLabel:checking?'正在检测此模型':model?.status===MODEL_STATUS.unknown?
            (model.code==='probe_timeout'?'检测超时·结果未知，可重新检测':model.code==='probe_transport_error'?'检测中断·结果未知，可重新检测':'检测结果未知，可重新检测'):
            model?.status===MODEL_STATUS.unavailable?(model.code==='provider_unavailable'?'不可用：模型配置或组件未就绪':'不可用'):'',
    };
}

export function updateModelOption(option,model){
    const presentation=modelOptionPresentation(model);
    if(option.textContent!==presentation.text)option.textContent=presentation.text;
    option.disabled=presentation.disabled;
    option.value=model?.id||option.value;
    if(presentation.statusLabel)option.setAttribute('aria-label',presentation.statusLabel);
    else option.removeAttribute('aria-label');
    option.setAttribute('data-model-status',model?.status||MODEL_STATUS.unverified);
    return option;
}

export function canSubmitModel(model){
    return model?.status!==MODEL_STATUS.checking&&model?.status!==MODEL_STATUS.unavailable&&model?.status!==MODEL_STATUS.unknown;
}

/** Reuse the caller's existing button/control; no independent probe lifecycle. */
export function bindModelProbeRetry(control,{catalog,getModel,active=()=>true,retry}){
    control.textContent='重新检测';control.dataset.modelRetry='true';
    const sync=()=>{const entry=catalog.get(getModel());control.hidden=!active()||entry?.status!==MODEL_STATUS.unknown;control.disabled=!active();control.title=modelOptionPresentation(entry).statusLabel;};
    const click=()=>{if(!active()||catalog.get(getModel())?.status!==MODEL_STATUS.unknown)return;void Promise.resolve().then(retry).catch(()=>{});};
    control.addEventListener('click',click);const stop=catalog.subscribe(sync);
    const release=()=>{stop();control.removeEventListener('click',click);};release.sync=sync;return release;
}
