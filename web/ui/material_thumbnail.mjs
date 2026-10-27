import {stopCanvasPropagation} from './creative_events.mjs';
const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text)e.textContent=text;return e;};

export function bindMaterialThumbnail(item,media,index,{cell,remove,bindDrag}={}){
    item.classList.add('dae-table-material');item.tabIndex=0;
    const face=el('div','dae-table-material-face');face.append(media,el('span','dae-table-material-index',String(index+1)));item.append(face);
    media.draggable=false;
    const video=media.tagName==='VIDEO';
    if(!video){media.loading='lazy';media.decoding='async';}
    const seek=()=>{if(media.duration>0)media.currentTime=Math.min(.1,media.duration/2);};
    if(video){media.controls=false;media.muted=true;media.playsInline=true;media.preload='metadata';media.addEventListener('loadedmetadata',seek);}
    let overlay=null,animation=null,closeTimer=null,anchor=null,closing=false,dragging=false,dragFrame=null,dragPreview=null,dragGrab=null,dragOffset=null,zooming=false,pendingHover=null,layoutFrame=null;
    bindDrag?.(item);
    const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
    const eligible=()=>cell.dataset.selected==='true';
    function listen(add){
        const method=add?'addEventListener':'removeEventListener';
        window[method]('resize',scheduleLayout);window[method]('blur',dismiss);window[method]('dae-canvas-layout',scheduleLayout);document[method]('scroll',scheduleLayout,true);document[method]('keydown',escape,true);document[method]('pointerup',release);document[method]('pointermove',trackPointer);
        if(!add&&layoutFrame!==null){cancelAnimationFrame(layoutFrame);layoutFrame=null;}
    }
    function restore(keepFocus=true){pendingHover=null;clearTimeout(closeTimer);closeTimer=null;cancelAnimationFrame(dragFrame);dragFrame=null;dragging=false;dragPreview?.remove();dragPreview=null;for(const type of ['dragenter','dragover'])document.removeEventListener(type,moveDragPreview,true);delete item.dataset.materialDragging;zooming=false;animation?.cancel();animation=null;closing=false;if(!overlay)return;const focused=overlay.contains(document.activeElement);if(video){media.pause();media.controls=false;}const old=overlay;overlay=null;item.append(face);old.remove();anchor=null;listen(false);if(keepFocus&&focused&&eligible())item.focus({preventScroll:true});}
    function animateBounds(to,duration,from=overlay.getBoundingClientRect()){
        animation?.cancel();animation=null;
        const frame=rect=>Object.fromEntries(['left','top','width','height'].map(key=>[key,rect[key]+'px']));
        Object.assign(overlay.style,frame(to));
        if(reduced()){if(closing)restore();return;}
        const motion=overlay.animate([frame(from),frame(to)],{duration,easing:'cubic-bezier(.2,0,0,1)'});animation=motion;
        motion.onfinish=()=>{if(animation!==motion)return;animation=null;if(closing)restore();};
    }
    function close(animate=false){
        if(dragging||!overlay||document.fullscreenElement===media||overlay.contains(document.fullscreenElement))return;
        if(!animate||reduced()||!item.isConnected){restore();return;}
        if(closing)return;closing=true;if(video){media.pause();media.controls=false;}
        animateBounds(item.getBoundingClientRect(),150);
    }
    function previewBounds(rect){
        const nativeWidth=video?media.videoWidth:media.naturalWidth,nativeHeight=video?media.videoHeight:media.naturalHeight;
        if(!nativeWidth||!nativeHeight)return null;
        const ratio=nativeWidth/nativeHeight;
        const limit=Math.min(320,innerWidth-16,innerHeight-16),width=ratio>=1?limit:limit*ratio,height=ratio>=1?limit/ratio:limit;
        const left=Math.max(8,Math.min(rect.left,innerWidth-width-8)),top=Math.max(8,Math.min(rect.top,innerHeight-height-8));
        return {left,top,width,height};
    }
    function mediaReady(){if(overlay)layout();else if(pendingHover&&item.matches(':hover'))show(pendingHover);}
    function show(e){
        if(!eligible()||dragging||e.ctrlKey||e.buttons||!item.isConnected)return;if(overlay){hold();return;}
        const rect=item.getBoundingClientRect(),bounds=previewBounds(rect);
        if(!bounds){pendingHover={ctrlKey:e.ctrlKey,buttons:e.buttons};return;}pendingHover=null;
        const {left,top,width,height}=bounds;
        anchor=rect;
        overlay=el('div','dae-ui dae-table-material-preview');overlay.setAttribute('aria-label',item.getAttribute('aria-label')||'素材预览');overlay.style.cssText=`left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
        overlay.tabIndex=0;overlay.dataset.materialSelected=item.dataset.materialSelected||'false';overlay.addEventListener('click',select);overlay.addEventListener('keydown',key);
        overlay.onpointerenter=hold;overlay.onpointerleave=leave;
        if(bindDrag){
            bindDrag(overlay);overlay.addEventListener('pointerdown',rememberDragGrab);overlay.addEventListener('dragstart',startDrag);overlay.addEventListener('dragend',endDrag);
            if(video)overlay.addEventListener('pointerdown',e=>{overlay.draggable=e.clientY<media.getBoundingClientRect().bottom-48;});
        }
        for(const type of ['pointerdown','pointerup','click','dblclick','keydown'])overlay.addEventListener(type,stopCanvasPropagation);
        overlay.addEventListener('wheel',e=>{
            if(!e.ctrlKey)return;
            const forwarded=new WheelEvent('wheel',{bubbles:true,cancelable:true,composed:true,clientX:e.clientX,clientY:e.clientY,deltaX:e.deltaX,deltaY:e.deltaY,deltaZ:e.deltaZ,deltaMode:e.deltaMode,ctrlKey:true,shiftKey:e.shiftKey,altKey:e.altKey,metaKey:e.metaKey});
            zooming=true;hold();if(!item.dispatchEvent(forwarded)){e.preventDefault();e.stopPropagation();scheduleLayout();}
        },{passive:false});
        overlay.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();restore();item.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));},true);
        if(video){media.controls=true;media.muted=false;}
        overlay.append(face);(item.closest('dialog')||document.body).append(overlay);listen(true);
        animateBounds(bounds,220,rect);
    }
    function hold(){
        clearTimeout(closeTimer);closeTimer=null;
        if(closing){
            const rect=item.getBoundingClientRect(),bounds=previewBounds(rect);if(!bounds)return;
            closing=false;anchor=rect;if(video)media.controls=true;animateBounds(bounds,220);
        }
    }
    function leave(e){
        if(zooming||e.ctrlKey||e.buttons||item.contains(e.relatedTarget)||overlay?.contains(e.relatedTarget))return;
        clearTimeout(closeTimer);closeTimer=setTimeout(()=>{if(!item.matches(':hover')&&!overlay?.matches(':hover'))close(true);},160);
    }
    function release(e){if(overlay&&!item.contains(e.target)&&!overlay.contains(e.target))leave(e);}
    function trackPointer(e){if(e.ctrlKey)return;zooming=false;if(overlay&&!e.buttons&&!item.contains(e.target)&&!overlay.contains(e.target)&&closeTimer===null)leave(e);}
    function scheduleLayout(){if(overlay&&layoutFrame===null)layoutFrame=requestAnimationFrame(()=>{layoutFrame=null;layout();});}
    function layout(){
        if(!overlay||dragging)return;
        const rect=item.getBoundingClientRect();
        if(!eligible()||!item.isConnected||!rect.width||!rect.height){restore(false);return;}
        const bounds=previewBounds(rect);if(!bounds)return;
        const target=closing?rect:bounds;
        if(['left','top','width','height'].some(key=>Math.abs(rect[key]-anchor[key])>.5||Math.abs(parseFloat(overlay.style[key])-target[key])>.5)){
            anchor=rect;
            if(animation||closing)animateBounds(target,closing?150:220);
            else for(const key of ['left','top','width','height'])overlay.style[key]=target[key]+'px';
        }
    }
    function select(e){
        if(e.button!==0)return;
        cell.focus({preventScroll:true});
        item.dataset.materialSelected='true';if(overlay)overlay.dataset.materialSelected='true';
        document.addEventListener('pointerdown',outside,true);
        (overlay?(video?media:overlay):item).focus({preventScroll:true});
    }
    function deselect(){delete item.dataset.materialSelected;document.removeEventListener('pointerdown',outside,true);restore(false);}
    function outside(e){if(!item.contains(e.target)&&!overlay?.contains(e.target))deselect();}
    function selectionChanged(){
        const method=eligible()?'addEventListener':'removeEventListener';item[method]('pointerenter',show);item[method]('pointermove',show);
        if(!eligible())deselect();
    }
    function dismiss(){close();}
    function escape(e){if(e.key==='Escape')close();}
    function rememberDragGrab(e){if(e.button===0){const rect=e.currentTarget.getBoundingClientRect();dragGrab={x:(e.clientX-rect.left)/rect.width,y:(e.clientY-rect.top)/rect.height};}}
    function moveDragPreview(e){if(dragPreview){dragPreview.style.left=e.clientX-dragOffset.x+'px';dragPreview.style.top=e.clientY-dragOffset.y+'px';}}
    function startDrag(e){
        const source=e.currentTarget.getBoundingClientRect(),rect=item.getBoundingClientRect();
        const grab=dragGrab||{x:(e.clientX-source.left)/source.width,y:(e.clientY-source.top)/source.height};
        dragOffset={x:grab.x*rect.width,y:grab.y*rect.height};
        dragging=true;pendingHover=null;clearTimeout(closeTimer);closeTimer=null;animation?.cancel();animation=null;closing=false;
        if(video){media.pause();media.controls=false;}
        // Keep the native drag source attached while returning its face to thumbnail size.
        if(overlay)Object.assign(overlay.style,{left:e.clientX-dragOffset.x+'px',top:e.clientY-dragOffset.y+'px',width:rect.width+'px',height:rect.height+'px'});
        const width=video?media.videoWidth:media.naturalWidth,height=video?media.videoHeight:media.naturalHeight;
        if(width&&height&&(!video||media.readyState>=2)){
            dragPreview=document.createElement('canvas');dragPreview.width=Math.ceil(rect.width);dragPreview.height=Math.ceil(rect.height);dragPreview.className='dae-ui dae-table-material-drag-preview';dragPreview.setAttribute('aria-hidden','true');
            dragPreview.style.cssText=`position:fixed;width:${rect.width}px;height:${rect.height}px;z-index:10050;pointer-events:none;border-radius:12px;box-shadow:0 4px 16px #0006`;
            const scale=Math.max(rect.width/width,rect.height/height),cropWidth=rect.width/scale,cropHeight=rect.height/scale;
            dragPreview.getContext('2d').drawImage(media,(width-cropWidth)/2,(height-cropHeight)/2,cropWidth,cropHeight,0,0,dragPreview.width,dragPreview.height);
            (item.closest('dialog')||document.body).append(dragPreview);moveDragPreview(e);for(const type of ['dragenter','dragover'])document.addEventListener(type,moveDragPreview,true);
            const nativeImage=document.createElement('canvas');nativeImage.width=nativeImage.height=1;e.dataTransfer.setDragImage(nativeImage,0,0);
        }else e.dataTransfer.setDragImage(overlay||item,dragOffset.x,dragOffset.y);
        dragFrame=requestAnimationFrame(()=>{dragFrame=null;item.dataset.materialDragging='true';if(overlay)overlay.dataset.materialDragging='true';});
    }
    function endDrag(){restore();}
    const key=e=>{if(remove&&(e.key==='Delete'||e.key==='Backspace')){e.preventDefault();e.stopPropagation();restore();remove();}};
    if(remove)item.setAttribute('aria-keyshortcuts','Delete Backspace');
    cell.addEventListener('dae-cell-selection-change',selectionChanged);selectionChanged();
    item.addEventListener('pointerleave',leave);item.addEventListener('click',select);item.addEventListener('keydown',key);
    item.addEventListener('pointerdown',rememberDragGrab);item.addEventListener('dragstart',startDrag);item.addEventListener('dragend',endDrag);
    media.addEventListener(video?'loadedmetadata':'load',mediaReady);if(video)media.addEventListener('resize',mediaReady);
    return ()=>{deselect();cell.removeEventListener('dae-cell-selection-change',selectionChanged);media.removeEventListener('loadedmetadata',seek);media.removeEventListener(video?'loadedmetadata':'load',mediaReady);if(video)media.removeEventListener('resize',mediaReady);item.removeEventListener('pointerenter',show);item.removeEventListener('pointermove',show);item.removeEventListener('pointerleave',leave);item.removeEventListener('click',select);item.removeEventListener('keydown',key);item.removeEventListener('pointerdown',rememberDragGrab);item.removeEventListener('dragstart',startDrag);item.removeEventListener('dragend',endDrag);};
}
