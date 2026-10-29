import {isLocalGenerationModel,isComfyGenerationModel} from './table_generation_model.mjs';
// Brand identity is presentation only; model IDs and provider routing stay unchanged.
export function generationModelLabel(model=''){
 if(!model)return '';
 if(isLocalGenerationModel(model))return model;
 const name=model==='Minimax H3'?'MiniMax H3':model;
 return name+(isComfyGenerationModel(model)?'（Comfy）':'（来源未知）');
}
export function generationModelIconURL(model=''){
 const name=/^seedance\b/i.test(model)?'bytedance':/^minimax\b/i.test(model)?'minimax':/^qwen[-\s]/i.test(model)?'qwen':/^lib image\b/i.test(model)?'libtv':null;
 return new URL(name?`../../design/vendor/model-icons/${name}.svg`:'../../design/vendor/remixicon/box-3-line.svg',import.meta.url).href;
}
export function prependGenerationModelIcon(control,model){
 const icon=document.createElement('span');icon.className='dae-table-icon generation-model-icon';icon.setAttribute('aria-hidden','true');icon.style.setProperty('--table-icon',`url("${generationModelIconURL(model)}")`);control.prepend(icon);return control;
}
