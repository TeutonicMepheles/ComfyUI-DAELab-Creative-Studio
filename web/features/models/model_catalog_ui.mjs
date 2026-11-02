import {MODEL_STATUS} from './model_catalog.mjs';

export function modelOptionPresentation(model){
    const checking=model?.status===MODEL_STATUS.checking;
    return {
        text:`${model?.label||model?.id||'模型'}${checking?' ◌':''}`,
        disabled:model?.status===MODEL_STATUS.unavailable,
        checking,
        available:model?.status===MODEL_STATUS.available,
        unverified:model?.status===MODEL_STATUS.unverified,
        statusLabel:checking?'正在检测此模型':model?.status===MODEL_STATUS.unavailable?'不可用':'',
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
    return model?.status!==MODEL_STATUS.checking&&model?.status!==MODEL_STATUS.unavailable;
}
