import {createCreativeButton} from '../../ui/creative_button.mjs';
import {businessHost} from '../../contracts/business.js';
export function tableHistory(){return businessHost().history;}
export function createTableButton(label,action,primary=false){
 const button=createCreativeButton(label,e=>{e.preventDefault();e.stopPropagation();return action(e);});
 if(primary)button.dataset.primary='true';return button;
}
export function tableTheme(){
 if(document.getElementById('dae-table-ui-css'))return;
 for(const [id,path] of [['dae-table-bundled-theme','../../design/creative_theme.css'],['dae-table-ui-css','./table_ui.css']]){
  const sheet=document.createElement('link');sheet.id=id;sheet.rel='stylesheet';sheet.href=new URL(path,import.meta.url).href;document.head.append(sheet);
 }
}
export function tableIcon(button,name,label){
 button.title=label;button.setAttribute('aria-label',label);
 const icon=document.createElement('span');icon.className='dae-table-icon';icon.setAttribute('aria-hidden','true');
 icon.style.setProperty('--table-icon',`url("${new URL('../../design/vendor/remixicon/'+name+'.svg',import.meta.url).href}")`);
 button.replaceChildren(icon);return button;
}
