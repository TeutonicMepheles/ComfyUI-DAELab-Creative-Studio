export interface ModelNoteCapability {
 weightBinding?: {model?: string; [key:string]: unknown};
 sampling?: {sampler?: string; steps?: number; turboSteps?:number};
 schema?: {properties?: {modeType?: {items?: Record<string,unknown>}}};
 modes?: string[];
 maxOutputTokens?: number;
}
export interface ModelNoteEntry { capability?: ModelNoteCapability | null }

const modes:Record<string,string>={text2video:'文生视频',singleImage2video:'首帧',frames2video:'首尾帧',image2video:'图片参考',mixed2video:'混合参考',text2image:'文生图',image2image:'图片参考',reverse:'图片反推',polish:'文本润色'};
function precision(name:string){return [...new Set(name.toUpperCase().match(/Q\d+_K(?:_[MSL])?|NVFP4|INT8|BF16|FP16|FP32|W\d+A\d+|AWQ/g)||[])].join(' / ');}
/** Only verified capability fields contribute; labels and tier names are not evidence. */
export function modelNoteText(entry:ModelNoteEntry|null|undefined):string {
 const c=entry?.capability;if(!c)return '';
 const lines:string[]=[],weights=c.weightBinding;
 if(weights){
  const roles:Record<string,string>={diffusion_models:'主模型',video_vae:'视频VAE',text_encoders:'文本编码器'};
  for(const [key,label] of Object.entries(roles)){
   const weight=weights[key];const name=weight&&typeof weight==='object'&&'name' in weight?String(weight.name):'';
   const p=precision(name);if(p)lines.push(`${label} ${p}`);
  }
  if(typeof weights.model==='string'){const p=precision(weights.model);if(p)lines.push(`量化 ${p}`);}
 }
 const sample=c.sampling;if(sample?.sampler||Number.isFinite(sample?.steps))lines.push([sample?.sampler,Number.isFinite(sample?.steps)?`${sample?.steps} 步`:''].filter(Boolean).join(' · '));
 if(Number.isFinite(sample?.turboSteps))lines.push(`加速 ${sample?.turboSteps} 步（已绑定适配器）`);
 const items=c.schema?.properties?.modeType?.items;
 if(items)for(const [mode,range] of Object.entries(items)){
  if(!modes[mode])continue;
  const r=Array.isArray(range)&&range.length===2&&range.every(n=>typeof n==='number')?range as number[]:null;
  lines.push(modes[mode]+(r&&(r[1]??0)>0?` ${r[0]===r[1]?r[0]:r.join('–')} 图`:''));
 }
 for(const mode of c.modes||[])if(modes[mode])lines.push(modes[mode]);
 if(Number.isFinite(c.maxOutputTokens))lines.push(`最大输出 ${c.maxOutputTokens} tokens`);
 return lines.join('；');
}
let serial=0;
/** Inline notes expand in flow, so they cannot cover another option or intercept clicks. */
export function updateModelNote(control:HTMLElement,entry:ModelNoteEntry|null|undefined):void {
 if(!document.getElementById('dae-model-notes-style')){
  const style=document.createElement('style');style.id='dae-model-notes-style';style.textContent='.dae-ui .dae-model-note-owner{flex-wrap:wrap!important}.dae-ui .dae-model-note{display:none;flex:0 0 100%;box-sizing:border-box;min-width:0;max-width:100%;white-space:normal;text-align:left;font:400 11px/1.45 sans-serif;color:var(--dae-text-muted,#aaa);overflow-wrap:anywhere;pointer-events:none}.dae-ui .dae-model-note-owner:is(:hover,:focus-visible)>small.dae-model-note{display:block}';document.head.append(style);
 }
 const text=modelNoteText(entry);let note=control.querySelector<HTMLElement>(':scope > .dae-model-note');
 if(!text){if(note&&control.getAttribute('aria-describedby')===note.id)control.removeAttribute('aria-describedby');note?.remove();control.classList.remove('dae-model-note-owner');return;}
 if(!note){note=document.createElement('small');note.className='dae-model-note';note.id='dae-model-note-'+(++serial);control.append(note);}
 note.textContent=text;control.classList.add('dae-model-note-owner');control.setAttribute('aria-describedby',note.id);
}
