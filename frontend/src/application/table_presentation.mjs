import {applyMaterialCellToColumn,applyTextCellToColumn} from './table_material_columns.mjs';
import {isGeneration,rowGenerationConfig,setRowGenerationConfig,generationConfigField} from '../features/generation/table_generation_model.mjs';
import {isPrompt,promptField} from '../features/prompt/table_prompt_model.mjs';
import {addField,addRecord,removeField,clone,uid,reorder,emptyValue} from './table_model.mjs';
import {createTableButton as button} from '../ui/table_controls.mjs';
import {applyPromptToColumn,expandedCellText} from '../features/prompt/table_prompt_template.mjs';
import {previewContentAsset} from './table_content_view.mjs';
import {createPromptOptimizationEntry} from '../features/prompt/prompt_optimization_panel.mjs';
import {isTextColumn} from '../features/prompt/table_prompt_source.mjs';

const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text)e.textContent=text;return e;};
const menuItems=toolbar=>[...toolbar.querySelectorAll('[role=menuitem]:not(:disabled)')];

export function menuNavigationIndex(enabled,current,key){
    const items=enabled.flatMap((item,index)=>item?[index]:[]);
    if(!items.length)return -1;
    if(key==='Home')return items[0];
    if(key==='End')return items.at(-1);
    const at=items.indexOf(current);
    if(key==='ArrowDown')return at<0?items[0]:items[(at+1)%items.length];
    if(key==='ArrowUp')return at<0?items.at(-1):items[(at-1+items.length)%items.length];
    return current;
}

export function clampMenuPosition(anchor,size,bounds){
    const inset=8,left=bounds.left+inset,top=bounds.top+inset;
    const maxLeft=Math.max(left,bounds.right-size.width-inset);
    const maxTop=Math.max(top,bounds.bottom-size.height-inset);
    const flipped=anchor.y+size.height>bounds.bottom-inset?anchor.y-size.height-inset:anchor.y;
    return {left:Math.max(left,Math.min(anchor.x,maxLeft)),top:Math.max(top,Math.min(flipped,maxTop))};
}

// One instance-owned menu. Selection, table editing and host history stay owned by
// the existing editor; this module only presents commands for the current object.
export function installContentPresentation({root,editor,getTable,notify,editPromptTemplate,extractText=null,outputTable=null,columnOutputs=true,enabled=()=>true,onPresentationChange=()=>{}}){
    const toolbar=el('aside','dae-ui content-context');toolbar.setAttribute('role','menu');toolbar.setAttribute('aria-label','表格操作菜单');toolbar.hidden=true;document.body.append(toolbar);
    let selected=null,signature='',disposed=false,menuOpen=false,menuTrigger=null,menuPoint=null,columnGrid=null,columnSelection=null,rowGrid=null,rowSelection=null,outputSignature='',cellAnchor=null,columnAnchor=null,rowAnchor=null,optimizationEntry=null;
    const context=()=>editor.panelContext?.();
    const active=()=>{const panel=context();return enabled()&&panel?.presentation==='content'&&root.isConnected&&(typeof panel.active==='boolean'?panel.active:!!panel.getViewport());};
    const menuAvailable=()=>enabled()&&root.isConnected&&(active()||!context());
    const findCell=()=>{if(!selected?.record)return null;if(!cellAnchor?.isConnected||cellAnchor.dataset.field!==selected.field||cellAnchor.dataset.record!==selected.record)cellAnchor=root.querySelector(`td[data-field="${CSS.escape(selected.field)}"][data-record="${CSS.escape(selected.record)}"]`);return cellAnchor;};
    const field=()=>getTable().fields.find(f=>f.id===selected?.field);
    const mutate=fn=>{try{editor.change(fn);signature='';tick();}catch(e){notify(e.message);}};
    const icon=name=>{const i=el('i','content-context-icon');i.style.setProperty('--dae-icon',`url("${new URL('../design/vendor/remixicon/'+name+'.svg',import.meta.url).href}")`);i.setAttribute('aria-hidden','true');return i;};
    function closeMenu(restoreFocus=false){
        menuOpen=false;menuPoint=null;if(!toolbar.hidden)toolbar.hidden=true;
        if(restoreFocus&&menuTrigger?.isConnected)menuTrigger.focus({preventScroll:true});
        menuTrigger=null;
    }
    function item(label,fn,iconName,danger=false){
        const b=button(label,()=>{closeMenu();fn();});
        b.classList.add('content-context-item');
        if(danger)b.classList.add('content-context-danger');
        b.setAttribute('role','menuitem');
        if(iconName)b.prepend(icon(iconName));
        return b;
    }
    function addGroup(groups,...items){const visible=items.filter(Boolean);if(visible.length)groups.push(visible);}
    function decorateOutputSources(){
        const fields=getTable().fields.filter(item=>!item.hidden),signatureKey=JSON.stringify(fields.map(item=>[item.id,item.name||'',isGeneration(item)]));
        const current=new Set(fields.map(item=>item.id)),headers=new Map([...root.querySelectorAll('th[data-column]')].map(header=>[header.dataset.column,header]));
        const complete=fields.every(field=>{
            const header=headers.get(field.id);if(!header)return false;
            const own=header.querySelector(`[data-table-source="${CSS.escape(field.id)}"]`),generated=header.querySelector('[data-generation-source]');
            return isGeneration(field)?Boolean(generated)&&!own:Boolean(own);
        });
        if(signatureKey===outputSignature&&complete)return;
        for(const element of root.querySelectorAll('[data-table-source]'))if(!current.has(element.dataset.tableSource))element.remove();
        for(const field of fields){
            const header=headers.get(field.id);if(!header)continue;
            let source=header.querySelector(`[data-table-source="${CSS.escape(field.id)}"]`);
            if(isGeneration(field)&&header.querySelector('[data-generation-source]')){source?.remove();continue;}
            if(!source){
                source=el('button','content-column-output');source.type='button';source.dataset.tableSource=field.id;
                header.append(source);
            }
            source.setAttribute('aria-label',`${field.name||'当前列'}输出为素材组`);
            source.title=`${field.name||'当前列'} · 拖出或点击输出素材组`;
        }
        outputSignature=signatureKey;
    }
    function rename(){
        const row=selected?.kind==='row',entry=row?getTable().records.find(r=>r.id===selected.record):field();if(!entry)return;
        const title=row?'行':'列',d=editor.openDialog('重命名'+title),input=el('input');input.value=entry.name||(row?'任务'+(getTable().records.indexOf(entry)+1):'');input.setAttribute('aria-label',title+'名称');
        const save=()=>{if(!input.value.trim())return;mutate(t=>(row?t.records:t.fields).find(x=>x.id===entry.id).name=input.value.trim());d.remove();};
        d.append(input,button('保存',save),button('取消',()=>d.remove()));input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing)save();};input.focus();input.select();
    }
    function build(){
        const prompt=isPrompt(field()),groups=[];
        optimizationEntry?.destroy();optimizationEntry=null;
        toolbar.replaceChildren();toolbar.append(el('div','content-context-label',selected.kind==='table'?'表格':selected.kind==='column'?field()?.name:selected.kind==='row'?'行':'单元格'));
        if(selected.kind==='table'){
            addGroup(groups,
                item('提示词模板',()=>{let id=promptField(getTable());if(!getTable().fields.some(f=>f.id===id)){mutate(t=>{const f=addField(t,{name:'最终提示词',type:'json',presentation:'prompt',width:360});id=f.id;t.meta.prompt_config||={};t.meta.prompt_config.bindings||={};t.meta.prompt_config.bindings.final_prompt=id;});}editPromptTemplate?.(id);},'file-text-line'),
                item('撤销',()=>{editor.restore();signature='';},'arrow-go-back-line'),
                item('重做',()=>{editor.restore(true);signature='';},'arrow-left-right-line'));
            const density=el('label','content-context-field');density.append(document.createTextNode('内容显示'));
            const select=el('select');select.setAttribute('aria-label','内容显示');for(const [v,n] of [['comfortable','舒适'],['compact','紧凑']])select.add(new Option(n,v));select.value=getTable().meta.density||'comfortable';select.onchange=()=>mutate(t=>t.meta.density=select.value);density.append(select);groups.push([density]);
        }else if(selected.kind==='column'){
            let optimize=null;
            if(isTextColumn(getTable(),field())&&editor.openPromptOptimization){
                const menuEditor={openPromptOptimization:target=>editor.openPromptOptimization({...target,anchor:columnAnchor||target.anchor})};
                optimizationEntry=createPromptOptimizationEntry({editor:menuEditor,target:{scope:'column',fieldId:selected.field},menu:true});optimize=optimizationEntry.element;
            }
            addGroup(groups,
                menuPoint&&outputTable?item('输出为素材组',()=>outputTable({scope:'column',fieldId:selected.field,anchor:columnAnchor}),'box-3-line'):null,
                menuPoint?optimize:null,item('重命名',rename,'edit-line'),item('复制列',()=>mutate(t=>{const old=t.fields.find(f=>f.id===selected.field),next=addField(t,{...clone(old),id:uid(),name:old.name+' 副本'});reorder(t.fields,next.id,old.id,true);for(const r of t.records){r.values[next.id]=clone(r.values[old.id]??emptyValue(old));if(Array.isArray(r.values[next.id]))for(const a of r.values[next.id])a.id=uid();}selected={kind:'column',field:next.id};}),'file-copy-line'));
            addGroup(groups,item('删除列',()=>mutate(t=>{removeField(t,selected.field);selected={kind:'table'};}),'delete-bin-line',true));
        }else if(selected.kind==='row'){
            const recordId=selected.record;
            addGroup(groups,item('重命名',rename,'edit-line'),item('复制行',()=>mutate(t=>{const source=clone(t.records.find(row=>row.id===recordId)),copy=addRecord(t,source.values,recordId);Object.assign(copy,source,{id:copy.id,name:(source.name||'任务'+(t.records.findIndex(r=>r.id===recordId)+1))+' 副本',selected:true});if(copy.meta){delete copy.meta.generation;delete copy.meta.generationColumns;}selected={kind:'row',record:copy.id};}),'file-copy-line'));
            addGroup(groups,item('删除行',()=>mutate(t=>{t.records=t.records.filter(r=>r.id!==recordId);selected={kind:'table'};}),'delete-bin-line',true));
        }else{
            const f=field(),value=getTable().records.find(r=>r.id===selected.record)?.values[f?.id];
            const region=editor.selection().flat(),many=region.length>1;
            let optimize=null;
            if(isTextColumn(getTable(),f)&&editor.openPromptOptimization&&!many){
                const menuEditor={openPromptOptimization:target=>editor.openPromptOptimization({...target,anchor:findCell()||target.anchor})};
                optimizationEntry=createPromptOptimizationEntry({editor:menuEditor,target:{scope:'cell',fieldId:selected.field,recordId:selected.record},menu:true});optimize=optimizationEntry.element;
            }
            addGroup(groups,
                outputTable&&!many?item('输出为素材',()=>outputTable({scope:'cell',fieldId:selected.field,recordId:selected.record,anchor:findCell()}),'box-3-line'):null,
                optimize);
            if(!many&&['assets','content'].includes(f?.type)&&!f?.readonly)addGroup(groups,item('添加图片',()=>findCell()?.dispatchEvent(new Event('dae-upload')),'image-line'));
            if(!many&&prompt&&!f?.readonly){
                const fill=item('应用到整列',()=>mutate(t=>{const source=t.records.find(row=>row.id===selected.record);applyPromptToColumn(t,selected.field,selected.record);for(const target of new Set(t.fields.filter(field=>isGeneration(field)&&field.generation.promptFieldId===selected.field).map(field=>generationConfigField(t,field.id)))){const config=rowGenerationConfig(source,target.id,target.generation);for(const row of t.records)setRowGenerationConfig(row,target.id,config);}}),'arrow-down-line');fill.title='覆盖本列所有行的提示词和当前生成配置；@列引用仍读取各自行的素材，配置不再跟随默认值，可撤销';groups.push([fill]);
            }else if(!many&&!f?.readonly&&isTextColumn(getTable(),f)&&typeof value==='string'){
                const fill=item('应用到整列',()=>mutate(t=>applyTextCellToColumn(t,selected.field,selected.record)),'arrow-down-line');fill.title='将当前单文本按原样（包括换行）填入本列所有行，可撤销';groups.push([fill]);
            }
            if(!many&&['assets','content'].includes(f?.type)&&!f?.readonly&&Array.isArray(value)&&value.length){
                const fill=item('应用到整列',()=>mutate(t=>applyMaterialCellToColumn(t,selected.field,selected.record)),'arrow-down-line');fill.title='用当前格全部素材覆盖本列其他行，保留素材顺序，可撤销';groups.push([fill]);
            }
            if(!many&&['assets','content'].includes(f?.type)&&!f?.readonly)addGroup(groups,item('清空单元格',()=>editor.clearCells([{row:{id:selected.record},field:f}]),'delete-bin-line',true));
        }
        for(const [index,group] of groups.entries()){
            if(index)toolbar.append(el('div','content-context-separator'));
            for(const entry of group){entry.classList.add('content-context-item');toolbar.append(entry);}
        }
    }
    function targetFor(eventTarget){
        const cell=eventTarget.closest?.('td[data-field]'),header=eventTarget.closest?.('th[data-column]'),row=eventTarget.closest?.('.table-choice[data-content-row]');
        return cell?{kind:'cell',field:cell.dataset.field,record:cell.dataset.record}
            :header?{kind:'column',field:header.dataset.column}
                :row?{kind:'row',record:row.dataset.contentRow}
                    :eventTarget.closest?.('table')?{kind:'table'}:null;
    }
    function applyTarget(target){
        selected=target;signature='';
        if(target.kind==='column')editor.selectColumn(target.field);else if(target.kind!=='cell')editor.clearSelection();
    }
    function open(target,trigger,point=null,keyboard=false){
        if(!target||!menuAvailable())return;
        applyTarget(target);menuOpen=true;menuTrigger=trigger;menuPoint=point;signature='';tick();
        if(keyboard)queueMicrotask(()=>menuItems(toolbar)[0]?.focus({preventScroll:true}));
    }
    toolbar.addEventListener('click',e=>{if(e.target.closest?.('button'))closeMenu();});
    function choose(e){
        if(toolbar.contains(e.target)||e.target.closest?.('.prompt-opt-popover,.table-prompt-toggle,dialog,.dae-table-material-preview,.table-text-side,.table-column-popover,.table-structure-control,.table-choice input,.generation-actions,.generation-cell-state'))return;
        if(e.type==='focusin'&&!root.contains(e.target))return;
        const inside=root.contains(e.target);
        if(!active()||!inside){
            closeMenu();selected=null;editor.clearSelection();queueMicrotask(tick);return;
        }
        if(e.target.closest('[data-inline-editing=true]')){closeMenu();selected=null;editor.clearSelection();root.querySelectorAll('[data-column-selected=true]').forEach(node=>delete node.dataset.columnSelected);queueMicrotask(tick);return;}
        if(menuOpen&&menuTrigger?.isConnected){const scope=menuTrigger.closest?.('th[data-column],.table-choice')||menuTrigger;if(scope.contains(e.target)){if(e.type==='pointerdown'&&e.target.closest?.('.field-title,.content-row-number'))closeMenu();return;}}
        const target=targetFor(e.target),capsule=e.type==='pointerdown'&&!e.target.closest('input,textarea,select')?e.target.closest('.field-title,.content-row-number'):null;
        if(capsule&&target&&['column','row'].includes(target.kind)&&menuAvailable()){e.preventDefault();open(target,capsule);return;}
        if(target)applyTarget(target);closeMenu();tick();
    }
    function tick(){
        if(disposed)return;
        const showing=String(Boolean(active()));if(root.dataset.contentPresentation!==showing){root.dataset.contentPresentation=showing;onPresentationChange(showing==='true');editor.render();}
        const chosen=String(active()&&!!selected);if(root.dataset.contentSelected!==chosen)root.dataset.contentSelected=chosen;
        if(!menuAvailable()){selected=null;closeMenu();}
        const grid=root.querySelector('table'),column=selected?.kind==='column'?selected.field:null;
        if(grid!==columnGrid||column!==columnSelection){
            columnGrid=grid;columnSelection=column;
            root.querySelectorAll('th[data-column],td[data-field]').forEach(node=>{const activeColumn=String(Boolean(column)&&(node.dataset.column||node.dataset.field)===column);if(node.dataset.columnSelected!==activeColumn)node.dataset.columnSelected=activeColumn;if(node.matches('th')&&node.getAttribute('aria-selected')!==activeColumn)node.setAttribute('aria-selected',activeColumn);});
        }
        if(columnOutputs)decorateOutputSources();
        const row=selected?.kind==='row'?selected.record:null;
        if(grid!==rowGrid||row!==rowSelection){
            rowGrid=grid;rowSelection=row;
            root.querySelectorAll('tr[data-record-id]').forEach(node=>{const activeRow=String(Boolean(row)&&node.dataset.recordId===row);if(node.dataset.rowActive!==activeRow)node.dataset.rowActive=activeRow;const gutter=node.querySelector('.table-choice');if(gutter&&gutter.getAttribute('aria-selected')!==activeRow)gutter.setAttribute('aria-selected',activeRow);});
        }
        if(!menuOpen||!selected){if(!toolbar.hidden)toolbar.hidden=true;return;}
        const key=JSON.stringify([selected,getTable().fields,editor.selection().reduce((count,entry)=>count+entry.length,0),selected.kind==='cell'?getTable().records.find(entry=>entry.id===selected.record)?.values[selected.field]:null]);
        if(key!==signature){signature=key;build();}
        positionMenu();
    }
    function positionMenu(){
        if(!menuOpen||!selected)return;
        if(selected.kind==='column'&&(!columnAnchor?.isConnected||columnAnchor.dataset.column!==selected.field))columnAnchor=root.querySelector(`th[data-column="${CSS.escape(selected.field)}"]`);
        if(selected.kind==='row'&&(!rowAnchor?.isConnected||rowAnchor.dataset.contentRow!==selected.record))rowAnchor=root.querySelector(`.table-choice[data-content-row="${CSS.escape(selected.record)}"]`);
        const anchor=selected.kind==='cell'?findCell():selected.kind==='column'?columnAnchor:selected.kind==='row'?rowAnchor:null;
        if(!anchor&&selected.kind!=='table'){selected={kind:'table'};signature='';build();}
        const rect=anchor?.getBoundingClientRect(),bounds={left:0,top:0,right:document.documentElement.clientWidth,bottom:document.documentElement.clientHeight};
        toolbar.hidden=false;const size={width:toolbar.getBoundingClientRect().width,height:toolbar.getBoundingClientRect().height};
        const point=menuPoint||{x:rect?.left??bounds.left+8,y:(rect?.bottom??bounds.top+8)+6};
        const placed=clampMenuPosition(point,size,bounds);toolbar.style.left=placed.left+'px';toolbar.style.top=placed.top+'px';
    }
    const double=e=>{if(e.target.closest('button,input,.dae-column-divider'))return;const row=e.target.closest('.table-choice[data-content-row]');if(row&&root.contains(row)&&active()){e.preventDefault();e.stopPropagation();selected={kind:'row',record:row.dataset.contentRow};rename();return;}const th=e.target.closest('th[data-column]');if(th&&root.contains(th)&&active()){e.preventDefault();e.stopPropagation();selected={kind:'column',field:th.dataset.column};rename();}};
    const capsule=e=>{const trigger=e.target.closest?.('.field-title,.content-row-number');if(!trigger||!menuAvailable()||e.target.closest('input,textarea,select'))return;const target=targetFor(trigger);if(!target||!['column','row'].includes(target.kind))return;e.preventDefault();e.stopPropagation();if(menuOpen)return;open(target,trigger);};
    const showPreview=e=>previewContentAsset(editor,e.detail);
    const contextMenu=e=>{
        const target=targetFor(e.target);if(!target||!menuAvailable()||e.target.closest('[data-inline-editing=true],input,textarea,select'))return;
        const trigger=e.target.closest('td[data-field],th[data-column],.table-choice[data-content-row],table')||e.target;
        e.preventDefault();e.stopPropagation();open(target,trigger,{x:e.clientX+8,y:e.clientY+8});
    };
    const contextKey=e=>{
        if(e.key!=='ContextMenu'&&!(e.shiftKey&&e.key==='F10'))return;
        if(!root.contains(e.target)||!menuAvailable()||e.target.closest('input,textarea,select,[contenteditable=true]'))return;
        const target=targetFor(e.target)||selected;if(!target)return;
        e.preventDefault();e.stopPropagation();const anchor=target.kind==='cell'?findCell():target.kind==='column'?root.querySelector(`th[data-column="${CSS.escape(target.field)}"]`):target.kind==='row'?root.querySelector(`.table-choice[data-content-row="${CSS.escape(target.record)}"]`):null;
        const rect=anchor?.getBoundingClientRect();open(target,e.target,rect?{x:rect.left,y:rect.bottom+6}:null,true);
    };
    const menuKey=e=>{
        if(!menuOpen)return;
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeMenu(true);tick();return;}
        if(e.target.matches?.('input,textarea,select,[contenteditable=true]'))return;
        if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
        e.preventDefault();e.stopPropagation();const items=menuItems(toolbar),current=items.indexOf(document.activeElement);items[menuNavigationIndex(items.map(()=>true),current,e.key)]?.focus({preventScroll:true});
    };
    const layout=()=>{if(root.dataset.contentPresentation!==String(Boolean(active())))tick();else if(menuOpen)positionMenu();};
    const escape=e=>{if(e.defaultPrevented||e.key!=='Escape'||e.isComposing||e.target.matches?.('input,textarea,select'))return;if(menuOpen){e.preventDefault();closeMenu(true);}else{selected=null;editor.clearSelection();if(!toolbar.hidden)toolbar.hidden=true;tick();}};
    for(const type of ['pointerdown','focusin'])document.addEventListener(type,choose,true);
    document.addEventListener('keydown',menuKey,true);document.addEventListener('keydown',escape,true);
    root.addEventListener('click',capsule);root.addEventListener('dblclick',double,true);root.addEventListener('dae-preview',showPreview);root.addEventListener('contextmenu',contextMenu);root.addEventListener('keydown',contextKey,true);
    globalThis.addEventListener('dae-canvas-layout',layout);
    const timer=setInterval(tick,100);
    return {
        close(){closeMenu();if(selected)editor.clearSelection();selected=null;if(!toolbar.hidden)toolbar.hidden=true;},
        destroy(){disposed=true;clearInterval(timer);optimizationEntry?.destroy();toolbar.remove();for(const type of ['pointerdown','focusin'])document.removeEventListener(type,choose,true);document.removeEventListener('keydown',menuKey,true);document.removeEventListener('keydown',escape,true);root.removeEventListener('click',capsule);root.removeEventListener('dblclick',double,true);root.removeEventListener('dae-preview',showPreview);root.removeEventListener('contextmenu',contextMenu);root.removeEventListener('keydown',contextKey,true);globalThis.removeEventListener('dae-canvas-layout',layout);}
    };
}
