import {TEXT_TEMPLATES,DEFAULT_TEXT_INSTRUCTION,changeInstructionTarget} from './text_templates.js';
import {stopCanvasPropagation} from '../../ui/list_editor_controls.mjs';
import {bindIOPanel} from './llm_io_panel.mjs';
import {createTableButton,tableTheme} from '../../ui/table_controls.mjs';
import * as sharedFields from '../../ui/creative_field.mjs';
import * as sharedPanels from '../../ui/creative_panel_state.mjs';
import {bindUnfocusedHistoryGuard} from '../../ui/unfocused_history_guard.js';
import {createLLMModelPicker} from './llm_model_picker.js';

export const STYLE_VARIANTS=Object.freeze([
    {id:'A',label:'A 紧凑单栏',width:420,height:610},
    {id:'B',label:'B 文本生成',width:420,height:574},
    {id:'C',label:'C 指令优先',width:460,height:610},
    {id:'D',label:'D 分步编辑',width:460,height:610},
    {id:'E',label:'E 对照审阅',width:700,height:610},
].map(v=>Object.freeze({...v,type:`DAELAB.LLMStylePreview${v.id}`})));
const MODES=[['polish','提示词润色'],['reverse','图片反推'],['custom','自定义']];
const SOURCE='清晨，一只白色小猫坐在窗边，窗外是被薄雾笼罩的城市。画面安静、温暖。';
const INSTRUCTION='保留原意，补充主体、环境、光线与构图。使用自然、清晰的中文，不添加与原文无关的情节。';
const RESULT='清晨的柔光透过窗帘，一只白色小猫安静地坐在木质窗台上。窗外的城市隐于淡淡晨雾之中，背景柔和虚化。以平视中景构图，暖色室内与冷色晨雾形成细腻对比，整体氛围宁静、温暖。';
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;}
function icon(name){const e=el('span','llm-style-icon');e.setAttribute('aria-hidden','true');e.style.setProperty('--llm-icon',`url("${new URL((name==='upload-2-line'?'../../design/vendor/remixicon/':'../../design/vendor/remixicon/')+name+'.svg',import.meta.url).href}")`);return e;}
export function createLLMStylePanel(node,variant,{nativeDocument=null,checkLocalTextModels}={}){
    tableTheme();
    if(!document.getElementById('dae-llm-style-css')){const link=el('link');link.id='dae-llm-style-css';link.rel='stylesheet';link.href=new URL('./llm_style_preview.css',import.meta.url).href;document.head.append(link);}
    const root=el('section',`dae-ui llm-style llm-style-${variant.id}`);root.dataset.variant=variant.id;root.setAttribute('aria-label',`文本生成 ${variant.label}`);
    const releases=[],fields=[],buttons=[];let interaction=null,modelControl=null;
    const saved=()=>node.properties.llmStylePreview||={version:1,mode:'polish'};
    const write=(key,value,group=null)=>{if(nativeDocument)nativeDocument.edit('编辑 LLM 配置',draft=>{draft[key]=value;},{group});else{saved()[key]=value;node.graph?.change?.();}};
    const switchTarget=(key,value)=>{if(nativeDocument)nativeDocument.edit('切换提示词模板',draft=>changeInstructionTarget(draft,key,value));else{changeInstructionTarget(saved(),key,value);node.graph?.change?.();}sync();};
    const button=(label,fn,primary=false)=>{const b=createTableButton(label,fn,primary);buttons.push(b);return b;};
    const top=el('div','llm-style-top');const badge=el('span','llm-style-badge',variant.id);top.append(badge,el('span','llm-style-caption',variant.label.slice(2)),el('span','llm-style-preview-tag','样式预览'));if(variant.id!=='B')root.append(top);
    const tabs=el('div','llm-style-modes');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','处理方式');
    const modes=variant.id==='B'?MODES.slice(0,2):MODES;
    const modeButtons=modes.map(([value,label])=>{const b=button(label,()=>{if(variant.id==='B')switchTarget('mode',value);else{write('mode',value);sync();}});b.dataset.mode=value;tabs.append(b);return b;});
    if(variant.id==='B'){
        const purposes=el('div','dae-media-types llm-prompt-purpose');purposes.setAttribute('role','group');purposes.setAttribute('aria-label','提示词用途');
        for(const [value,label,glyph] of [['video','视频提示词','film-line'],['image','图片提示词','image-line']]){
            const b=button(label,()=>{if((saved().purpose||'video')!==value)switchTarget('purpose',value);});
            b.classList.add('dae-media-type');b.prepend(icon(glyph));b.title=label;b.dataset.purpose=value;purposes.append(b);
        }
        root.append(purposes);
    }
    function editor(label,key,fallback,cls){const section=el('label',`llm-style-section ${cls}`),caption=el('span','llm-style-label',label);section.append(caption);const input=el('textarea');input.setAttribute('aria-label',`${variant.id} ${label}`);input.spellcheck=false;input.value=saved()[key]??fallback;let group=null;input.addEventListener('focus',()=>{group=crypto.randomUUID();});input.addEventListener('blur',()=>{group=null;});input.addEventListener('input',()=>write(key,input.value,group));section.append(input);fields.push(input);const release=sharedFields?.bindCreativeField(input);if(release)releases.push(release);return {section,input,key,fallback,caption};}
    const source=editor('原始文字','source',variant.id==='B'?'':SOURCE,'llm-style-source');
    const instruction=editor('处理要求','instruction',variant.id==='B'?DEFAULT_TEXT_INSTRUCTION:INSTRUCTION,'llm-style-instruction');
    if(variant.id==='B'){
        const templates=el('select');templates.setAttribute('aria-label','提示词模板');templates.add(new Option('选择模板（应用后可编辑）',''));
        for(const template of TEXT_TEMPLATES)templates.add(new Option(template.label,template.id));
        templates.addEventListener('change',()=>{const template=TEXT_TEMPLATES.find(item=>item.id===templates.value);if(!template||instruction.input.disabled||instruction.input.readOnly)return;instruction.input.value=template.text;instruction.input.dispatchEvent(new Event('input',{bubbles:true}));templates.value='';});
        const target=el('select');target.setAttribute('aria-label','目标视频模型');target.add(new Option('Seedance','seedance'));target.add(new Option('MiniMax H3','minimax'));
        target.addEventListener('change',()=>switchTarget('videoTarget',target.value));
        const heading=el('div','llm-style-instruction-head');heading.append(instruction.caption,target,templates);instruction.section.prepend(heading);fields.push(target,templates);
    }
    if(nativeDocument)for(const field of [source,instruction])releases.push(bindUnfocusedHistoryGuard(field.input,{isCurrent:()=>nativeDocument.isCurrent()}));
    const materials=el('div','llm-style-materials');
    const upload=button('上传图片',()=>{});upload.prepend(icon('upload-2-line'));upload.disabled=true;upload.title='仅样式预览，暂不上传文件';
    const materialHint=el('span','llm-style-caption','可接入文字与图片');materials.append(upload,materialHint);
    const result=variant.id==='B'?null:el('section','llm-style-result');
    if(result){
        const heading=el('div','llm-style-result-head');
        heading.append(el('span','llm-style-label','优化结果'),el('span','llm-style-caption','示例'));
        result.append(heading,el('p','',RESULT));
    }
    const footer=el('footer','llm-style-footer');const select=el('select');select.setAttribute('aria-label',`${variant.id} 模型`);select.add(new Option('Qwen · 待接入','qwen'));select.add(new Option('GPT · 待接入','gpt'));select.value=saved().model||'qwen';select.addEventListener('change',()=>write('model',select.value));fields.push(select);const fieldRelease=sharedFields?.bindCreativeField(select);if(fieldRelease)releases.push(fieldRelease);
    if(variant.id==='B'){modelControl=createLLMModelPicker(select,{active:()=>!node.mode&&(!nativeDocument||nativeDocument.isCurrent())});buttons.push(modelControl.root);releases.push(()=>modelControl.dispose());footer.append(modelControl.root);}
    const run=button('生成',()=>{},true);run.prepend(icon('sparkling-line'));run.disabled=true;run.title='仅样式预览，未接入生成逻辑';footer.append(select,run);
    const body=el('div','llm-style-body');
    const foldedResult=()=>{const d=el('details','llm-style-details');d.append(el('summary','','优化结果 · 示例'),result);return d;};
    if(variant.id==='A'){body.append(tabs,source.section,materials,instruction.section,foldedResult());}
    if(variant.id==='B'){root.append(tabs);const column=el('div','llm-style-column');column.append(source.section,materials,instruction.section);body.append(column);}
    if(variant.id==='C'){body.append(tabs,instruction.section);const details=el('details','llm-style-details');details.append(el('summary','','输入内容 · 1 段文字'),source.section,materials);body.append(details,result);}
    if(variant.id==='D'){const steps=[['01','输入内容',[source.section,materials]],['02','处理方式',[tabs,instruction.section]],['03','查看结果',[foldedResult()]]];for(const [num,label,children] of steps){const step=el('section','llm-style-step');const h=el('div','llm-style-step-heading');h.append(el('span','llm-style-number',num),el('span','llm-style-label',label));step.append(h,...children);body.append(step);}}
    if(variant.id==='E'){body.append(tabs);const compare=el('div','llm-style-compare');compare.append(source.section,result);body.append(compare,materials,instruction.section);}
    root.append(body,footer);
    const note=el('div','llm-style-note','仅供样式确认 · 不会调用模型');if(variant.id!=='B')root.append(note);
    for(const event of ['pointerdown','dblclick','keydown','wheel'])root.addEventListener(event,stopCanvasPropagation);
    const availability=sharedPanels?.bindPanelAvailability(node,root);if(availability)releases.push(availability);
    function sync(){for(const b of modeButtons){const selected=b.dataset.mode===(saved().mode||'polish');b.setAttribute('aria-pressed',String(selected));b.toggleAttribute('data-primary',selected);}for(const field of [source,instruction])if(document.activeElement!==field.input)field.input.value=saved()[field.key]??field.fallback;if(!interaction)select.value=saved().model||'qwen';interaction?.sync();modelControl?.sync();}
    sync();
    if(variant.id==='B')releases.push(interaction=bindIOPanel({node,nativeDocument,checkLocalTextModels,root,source:source.input,instruction:instruction.input,select,modelControl,run,footer,materialHint}));
    return {root,fields,buttons,sync,close:()=>modelControl?.close(),invalidate:()=>nativeDocument?.invalidate(),tasks:()=>interaction?.tasks?.()||[],acceptMaterials:collection=>interaction?.acceptMaterials?.(collection),destroy(){nativeDocument?.dispose();for(const release of releases)release();root.remove();}};
}
