import {createTableButton,tableIcon} from '../../ui/table_controls.mjs';
import {isTextColumn,promptSourceId,setPromptSource} from './table_prompt_source.mjs';

export function promptSourceHeader({table,field,header,title,change,root,notify}) {
    if(!isTextColumn(table,field))return;
    const selected=promptSourceId(table)===field.id,label=selected?'整列模型配置':'设为提示词';
    header.dataset.promptSource=String(selected);
    if(selected){const badge=document.createElement('span');badge.className='table-prompt-badge';badge.textContent='提示词';title.append(badge);}
    const hint=document.createElement('span');hint.className='table-prompt-hint';hint.textContent=label;hint.setAttribute('aria-hidden','true');
    const toggle=tableIcon(createTableButton('',()=>{
        try{
            if(!selected)change(next=>setPromptSource(next,field.id));
            const anchor=[...root.querySelectorAll('.table-prompt-toggle')].find(button=>button.dataset.fieldId===field.id);
            anchor?.focus({preventScroll:true});
            root.dispatchEvent(new CustomEvent('dae-prompt-column-settings',{detail:{fieldId:field.id,anchor}}));
        }catch(error){notify(error.message);}
    }),'chat-ai-line',`${label}：${field.name}`);
    toggle.removeAttribute('title');toggle.classList.add('table-prompt-toggle');toggle.dataset.fieldId=field.id;toggle.setAttribute('aria-pressed',String(selected));
    toggle.onpointerdown=event=>event.stopPropagation();toggle.ondragstart=event=>{event.preventDefault();event.stopPropagation();};
    header.append(hint,toggle);
}
