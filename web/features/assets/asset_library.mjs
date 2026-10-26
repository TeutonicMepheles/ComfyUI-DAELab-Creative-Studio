import {createCreativeButton,bindCreativeButton} from '../../ui/creative_button.mjs';
import {bindCreativeField} from '../../ui/creative_field.mjs';
import {stopCanvasPropagation} from '../../ui/creative_events.mjs';
import {readLibrary,lookupFavorite,removeFavorite,subscribeLibrary,readLegacyDocument,importLegacyLibrary,createAssetRequestScope} from './asset_library_model.mjs';
import {assetURL} from './media_upload_model.mjs';
import {libraryIcon} from './asset_favorite.mjs?v=20261015-2';

const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
export function createAssetLibrary(root,{onCreate,onAdd}){
    let alive=true,open=false,entries=[],selected=null,filter='all',query='',epoch=0,controller=null,returnFocus=null,previewId=null,offset=0,total=0,hasMore=false;
    const pageSize=48,requests=createAssetRequestScope();
    const bindings=[],tilesBindings=[];
    const action=(label,icon,fn,collection=bindings,options)=>{const b=createCreativeButton(label,fn,options);collection.push(bindCreativeButton(b));if(icon)b.prepend(libraryIcon(icon));return b;};
    const dock=el('nav','dae-library-dock dae-library-overlay dae-creative-toolbar');dock.setAttribute('aria-label','画布工具');
    const create=action('','add-line',()=>{onCreate();});create.classList.add('dae-library-create');create.setAttribute('aria-label','新建');create.title='新建';
    const toggle=action('资产库','archive-stack-line',()=>setOpen(!open));toggle.setAttribute('aria-expanded','false');
    dock.append(create,el('span','dae-library-divider'),toggle);
    const drawer=el('section','dae-library-drawer dae-library-overlay dae-creative-toolbar');drawer.setAttribute('aria-label','资产库');drawer.hidden=true;
    const header=el('header','dae-library-header'),title=el('strong','','资产库'),count=el('span','dae-library-muted');
    const close=action('收起资产库','arrow-down-line',()=>{setOpen(false);toggle.focus();});close.classList.add('dae-library-icon-only');close.setAttribute('aria-label','收起资产库');close.title='收起资产库';
    count.title='收藏保存在当前 ComfyUI 服务中；媒体引用本地文件';
    header.append(libraryIcon('archive-stack-line'),title,count,el('span','dae-library-spacer'),close);
    const tools=el('div','dae-library-tools'),filters=el('div','dae-library-filters');filters.setAttribute('aria-label','素材类型');
    for(const [key,label] of [['all','全部'],['image','图片'],['video','视频'],['text','文本']]){const b=action(label,null,()=>{filter=key;offset=0;void refresh();});b.dataset.filter=key;filters.append(b);}
    const search=el('input','dae-library-search');search.type='search';search.placeholder='搜索收藏';search.setAttribute('aria-label','搜索收藏');bindings.push(bindCreativeField(search));search.oninput=()=>{query=search.value.trim();offset=0;void refresh();};
    tools.append(filters,search);
    const grid=el('div','dae-library-grid');grid.setAttribute('aria-label','收藏素材');
    const notice=el('p','dae-library-notice');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');notice.hidden=true;
    const footer=el('footer','dae-library-footer'),summary=el('span','dae-library-muted','收藏保存在当前 ComfyUI 服务 · 引用本地文件');
    const preview=action('预览','fullscreen-line',()=>showPreview());
    const add=action('加入画布','file-copy-line',()=>addSelected());add.dataset.primary='true';
    const previous=action('上一页',null,()=>{offset=Math.max(0,offset-pageSize);return refresh();},bindings,{getDisabled:()=>offset===0});
    const next=action('下一页',null,()=>{offset+=pageSize;return refresh();},bindings,{getDisabled:()=>!hasMore});
    const legacy=action('导入此浏览器旧收藏',null,async()=>{try{await importOld(readLegacyDocument(),location.origin);}catch(error){if(alive)say(error.message);}});
    const legacyOrigin=el('input','dae-library-search');legacyOrigin.type='url';legacyOrigin.value=location.origin;legacyOrigin.placeholder='旧服务地址';legacyOrigin.setAttribute('aria-label','旧收藏的服务地址');bindings.push(bindCreativeField(legacyOrigin));
    const legacyFile=el('input');legacyFile.type='file';legacyFile.accept='.json,application/json';legacyFile.hidden=true;
    const importFile=action('导入旧目录文件',null,()=>legacyFile.click());
    legacyFile.onchange=async()=>{const file=legacyFile.files?.[0];if(!file)return;try{
        if(file.size>32*1024*1024)throw new Error('旧目录文件超过 32 MiB');
        const data=JSON.parse(await file.text());
        await importOld(data.document||data,data.origin||legacyOrigin.value.trim());
    }catch(error){if(alive)say(error.message);}finally{legacyFile.value='';}};
    const importTools=el('div','dae-library-tools');importTools.style.flexWrap='wrap';importTools.append(legacy,legacyOrigin,importFile,legacyFile);
    footer.append(summary,el('span','dae-library-spacer'),previous,next,preview,add);
    drawer.append(header,tools,importTools,grid,notice,footer);
    const dialog=el('dialog','dae-ui dae-library-preview dae-library-overlay');dialog.setAttribute('aria-label','素材预览');
    const previewHeader=el('header','dae-library-header'),previewTitle=el('strong'),previewClose=action('关闭',null,()=>closePreview());previewHeader.append(previewTitle,el('span','dae-library-spacer'),previewClose);
    const previewBody=el('div','dae-library-preview-body'),previewNotice=el('p','dae-library-notice');previewNotice.setAttribute('role','status');
    const previewAdd=action('加入画布','file-copy-line',()=>addSelected());previewAdd.dataset.primary='true';dialog.append(previewHeader,previewBody,previewNotice,previewAdd);
    root.append(dock,drawer,dialog);root.dataset.assetLibrary='true';
    function say(text){notice.textContent=text;notice.hidden=!text;if(dialog.open)previewNotice.textContent=text;}
    function media(entry,large=false){
        if(entry.kind==='text'){const text=el(large?'pre':'div','dae-library-text',entry.text);return text;}
        const node=el(entry.kind==='video'?'video':'img');node.draggable=false;
        if(entry.kind==='video'){node.preload=large?'metadata':'none';node.playsInline=true;node.muted=!large;node.controls=large;}else{node.alt=entry.name;node.loading=large?'eager':'lazy';}
        node.src=assetURL(entry.asset);
        node.addEventListener('error',()=>{if(!alive||!node.isConnected)return;node.parentElement?.classList.add('dae-library-unavailable');const message=el('span','dae-library-media-error','文件失效或格式不可预览');node.replaceWith(message);if(large)say('无法预览；请检查原素材文件是否仍存在。');},{once:true});return node;
    }
    function selection(){const entry=entries.find(e=>e.id===selected);preview.disabled=add.disabled=!entry;previewAdd.disabled=!entry;summary.textContent=entry?entry.name:'收藏保存在当前 ComfyUI 服务 · 引用本地文件';summary.title=summary.textContent;for(const b of grid.querySelectorAll('[data-asset-id]'))b.setAttribute('aria-pressed',String(b.dataset.assetId===selected));}
    function render(){
        if(!alive||!open)return;
        const focused=document.activeElement,focusId=focused?.dataset?.assetId||focused?.dataset?.removeId,focusRemove=!!focused?.dataset?.removeId,scroll=grid.scrollTop;
        grid.querySelectorAll('video').forEach(v=>{v.pause();v.removeAttribute('src');v.load();});tilesBindings.splice(0).forEach(release=>release());grid.replaceChildren();
        const list=entries;
        if(!list.some(e=>e.id===selected))selected=list[0]?.id||null;
        for(const entry of list){
            const tile=el('article','dae-library-tile'),thumb=action('',null,()=>{selected=entry.id;selection();},tilesBindings);thumb.className='dae-library-thumb';thumb.dataset.assetId=entry.id;thumb.setAttribute('aria-label',entry.name);thumb.append(media(entry));thumb.addEventListener('dblclick',()=>showPreview());
            if(entry.kind==='video')thumb.append(el('span','dae-library-kind','视频'));
            const line=el('div','dae-library-tile-label'),label=el('span','',entry.name);label.title=entry.name;
            const remove=action('取消收藏','star-fill',async()=>{try{await removeFavorite(entry.id);if(alive){say('已取消收藏，原文件和画布素材保留');search.focus();}}catch(e){say(e.message);}},tilesBindings);remove.dataset.removeId=entry.id;remove.setAttribute('aria-label','取消收藏 '+entry.name);remove.title='取消收藏';remove.className='dae-library-remove';
            line.append(label,remove);tile.append(thumb,line);grid.append(tile);
        }
        if(!list.length){const empty=el('div','dae-library-empty');empty.append(libraryIcon('archive-stack-line'),el('strong','',entries.length?'没有匹配的收藏':'把常用素材留在这里'),el('span','',entries.length?'试试其他类型或名称':'点击素材上的收藏按钮，即可跨工作流复用'));grid.append(empty);}
        count.textContent=total?`${total} 项 · ${offset+1}–${offset+entries.length}`:'0 项';previous.disabled=offset===0;next.disabled=!hasMore;for(const b of filters.children)b.setAttribute('aria-pressed',String(b.dataset.filter===filter));selection();grid.scrollTop=scroll;
        if(focusId){const candidate=[...grid.querySelectorAll(focusRemove?'[data-remove-id]':'[data-asset-id]')].find(b=>(focusRemove?b.dataset.removeId:b.dataset.assetId)===focusId);candidate?.focus({preventScroll:true});}
    }
    async function refresh(){
        if(!alive||!open)return;
        return requests.run(signal=>readLibrary({q:query,...(filter==='all'?{}:{kind:filter}),limit:pageSize,offset,signal}),page=>{
            entries=page.entries;total=page.total;hasMore=page.hasMore;
            if(!entries.length&&offset>0){offset=Math.max(0,offset-pageSize);void refresh();return;}
            if(previewId&&!entries.some(e=>e.id===previewId))closePreview();render();
        },error=>say(error.message));
    }
    async function importOld(document,origin){
        try{const report=await importLegacyLibrary(origin,document);if(!alive)return;
            const details=report.report.filter(item=>item.status==='rejected'||item.status.includes('cancelled')).map(item=>`第 ${item.index+1} 项：${item.error?.message||'保持已取消收藏状态'}`);
            say(`已处理 ${report.accepted} 项，拒绝 ${report.rejected} 项；旧浏览器目录与原文件均保留。`+(details.length?'\n'+details.join('\n'):''));
            offset=0;await refresh();
        }catch(error){if(alive)say(error.message);}
    }
    function closePreview(){if(dialog.open)dialog.close();previewBody.querySelectorAll('video').forEach(v=>{v.pause();v.removeAttribute('src');v.load();});previewBody.replaceChildren();previewId=null;if(returnFocus?.isConnected&&open)returnFocus.focus();returnFocus=null;}
    function showPreview(){const entry=entries.find(e=>e.id===selected);if(!entry)return;returnFocus=document.activeElement;previewId=entry.id;previewTitle.textContent=entry.name;previewNotice.textContent='';previewBody.replaceChildren(media(entry,true));dialog.showModal();previewClose.focus();}
    async function addSelected(){
        const entry=entries.find(e=>e.id===selected);if(!entry)return;
        const token=++epoch;controller?.abort();controller=new AbortController();say('');
        try{
            const current=await lookupFavorite(entry,controller.signal);
            if(!alive||token!==epoch||controller.signal.aborted)return;
            if(!current||current.assetId!==entry.assetId)throw new Error('收藏来源已变更或已取消，请重新选择当前素材后收藏');
            await onAdd(entry,controller.signal);
            if(alive&&token===epoch)say('已加入画布，可使用 Ctrl+Z 撤销');
        }catch(error){if(alive&&token===epoch&&error.name!=='AbortError')say(error.message);}
    }
    function setOpen(value){open=value;drawer.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-pressed',String(open));root.dataset.libraryOpen=String(open);if(open){void refresh();search.focus();}else{requests.cancel();++epoch;controller?.abort();closePreview();grid.querySelectorAll('video').forEach(v=>v.pause());}}
    for(const container of [dock,drawer,dialog]){
        for(const type of ['pointerdown','dblclick','contextmenu','wheel','copy','paste'])container.addEventListener(type,e=>e.stopPropagation());
        for(const type of ['dragover','drop'])container.addEventListener(type,e=>{e.preventDefault();e.stopPropagation();});
        container.addEventListener('keydown',e=>{stopCanvasPropagation(e);if(e.key==='Escape'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();if(dialog.open)closePreview();else{setOpen(false);toggle.focus();}}});
    }
    dialog.addEventListener('cancel',e=>{e.preventDefault();closePreview();});
    const release=subscribeLibrary(refresh);
    return {dock,drawer,close:()=>setOpen(false),destroy(){alive=false;requests.dispose();++epoch;controller?.abort();closePreview();release();tilesBindings.splice(0).forEach(fn=>fn());bindings.splice(0).forEach(fn=>fn());dock.remove();drawer.remove();dialog.remove();delete root.dataset.assetLibrary;delete root.dataset.libraryOpen;}};
}
