import {updateModelNote} from '../models/model_notes.js';
// @ts-expect-error Shared ESM popover owns placement, scale, escape and cleanup.
import {createSettingsPopover,promptSettingsStyle} from './table_prompt_settings.mjs';
// @ts-expect-error Existing shared controls retain native button semantics.
import {createTableButton} from '../../ui/table_controls.mjs';
// @ts-expect-error Existing generation model icon presentation is reused unchanged.
import {prependGenerationModelIcon} from '../generation/generation_model_icons.mjs';
// @ts-expect-error The model catalog remains the only availability owner.
import {getModelCatalog} from '../models/model_catalog.mjs';
import {modelSourceBadge,modelSourceKind} from '../models/source_badge.js';
// @ts-expect-error Existing model status presentation sanitizes provider errors.
import {modelOptionPresentation} from '../models/model_catalog_ui.mjs';

interface Menu {root:HTMLDivElement;close:()=>void;reposition:()=>void;}
const label=(value:string)=>value.replace(/（(?:本地|Comfy|来源未知)）\s*(?:◌)?$/,'').replace(/\s*◌$/,'').trim();

/** The native select remains the business value/event owner; only its view changes. */
export function createLLMModelPicker(select:HTMLSelectElement,{active=()=>true}:{active?:()=>boolean}={}){
 if(!document.getElementById('dae-llm-model-picker-css')){const style=document.createElement('style');style.id='dae-llm-model-picker-css';style.textContent=promptSettingsStyle;document.head.append(style);}
 const catalog=getModelCatalog();let menu:Menu|null=null,stamp='',menuStamp='',disposed=false;
 const root=createTableButton('',()=>{if(menu)menu.close();else open();}) as HTMLButtonElement;
 root.className='llm-model-trigger generation-prompt-setting';root.setAttribute('aria-haspopup','dialog');root.setAttribute('aria-expanded','false');
 select.hidden=true;select.tabIndex=-1;
 const options=()=>Array.from(select.options);
 const available=()=>!disposed&&active()&&select.isConnected&&!select.disabled;
 const render=(control:HTMLButtonElement,option:HTMLOptionElement|null)=>{
  const entry=catalog.get(option?.value||''),name=document.createElement('span'),badge=document.createElement('span');
  name.className='generation-prompt-setting-label';name.textContent=label(option?.textContent||'选择模型');badge.className='generation-model-source';badge.textContent=modelSourceBadge(entry||null);badge.dataset.source=modelSourceKind(entry||null);
  control.replaceChildren(name,badge);prependGenerationModelIcon(control,option?.value||'');
  if(entry?.checking){const spinner=document.createElement('span');spinner.className='generation-model-loading';spinner.textContent='◌';spinner.setAttribute('aria-label','正在检测此模型');control.append(spinner);}
  updateModelNote(control,entry);control.title=modelOptionPresentation(entry).statusLabel;control.dataset.modelStatus=entry?.status||'unverified';
 };
 function renderOptions(){
  if(!menu)return;const list=document.createElement('div');list.className='llm-model-options';list.setAttribute('role','listbox');list.setAttribute('aria-label','文本模型');
  for(const option of options()){
   const control=createTableButton('',()=>{
    const current=options().find(item=>item.value===option.value);if(!available()||!current||current.disabled)return;
    if(select.value!==current.value){select.value=current.value;select.dispatchEvent(new Event('change',{bubbles:true}));}
    menu?.close();root.focus({preventScroll:true});
   }) as HTMLButtonElement;
   render(control,option);control.disabled=option.disabled;control.dataset.modelId=option.value;control.setAttribute('role','option');control.setAttribute('aria-selected',String(option.value===select.value));control.setAttribute('aria-pressed',String(option.value===select.value));list.append(control);
  }
  menu.root.querySelector('.llm-model-options')?.remove();menu.root.append(list);menu.reposition();
 }
 function open(){
  if(!available())return;
  menu=createSettingsPopover(root,'选择模型',()=>{menu=null;menuStamp='';},{placement:'above'}) as Menu;menu.root.classList.add('generation-model-popover');renderOptions();
  menu.root.addEventListener('keydown',event=>{
   if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();
   const controls=Array.from(menu?.root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]),index=controls.indexOf(document.activeElement as HTMLButtonElement);
   const next=event.key==='Home'?0:event.key==='End'?controls.length-1:(index+(event.key==='ArrowUp'?-1:1)+controls.length)%controls.length;controls[next]?.focus();
  });
  (menu.root.querySelector<HTMLButtonElement>('[aria-selected=true]:not(:disabled)')||menu.root.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({preventScroll:true});
 }
 function sync(){
  const next=JSON.stringify([select.value,select.disabled,options().map(option=>[option.value,option.textContent,option.disabled,catalog.get(option.value)?.status,catalog.get(option.value)?.capability])]);
  if(stamp!==next){stamp=next;const option=options().find(option=>option.value===select.value)||null;render(root,option);root.disabled=select.disabled;root.setAttribute('aria-label','选择文本模型，当前：'+label(option?.textContent||'未选择'));}
  if(menu&&!available())menu.close();else if(menu&&menuStamp!==next){menuStamp=next;renderOptions();}
 }
 select.addEventListener('change',sync);sync();
 return {root,sync,close:()=>menu?.close(),dispose(){disposed=true;menu?.close();select.removeEventListener('change',sync);root.remove();}};
}
