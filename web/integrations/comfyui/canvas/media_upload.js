import {bindPanelAvailability} from '../../../ui/creative_panel_state.mjs';
import {app} from '/scripts/app.js';
import {createCreativeButton} from '../../../ui/creative_button.mjs';
import {stopCanvasPropagation} from '../../../ui/creative_events.mjs';
import {registerAsset} from '../../../application/asset_library_service.js';
import {canvasHistory} from './creative_history.mjs';
import {createFavoriteButton} from '../../../features/assets/asset_favorite.mjs?v=20261015-2';
import {createUploadVideoControls} from '../../../features/assets/upload_video_controls.mjs?v=20261001-player1';
import {UPLOAD_TYPE,ACCEPT,mediaKind,readAsset,assetURL,slotAllowed} from '../../../features/assets/media_upload_model.mjs?v=20261001-material-references';

const sheet=document.createElement('link');sheet.rel='stylesheet';sheet.href=new URL('../../../features/assets/media_upload.css?v=20261012-client-workflow-r2',import.meta.url).href;document.head.append(sheet);
function install(node){
    if(node.__mediaUpload)return;
    const history=canvasHistory(app);
    const data=node.widgets.find(w=>w.name==='asset_data');
    data.hidden=true;data.options={...data.options,hidden:true};data.computeSize=()=>[0,-4];
    if(data.inputEl)data.inputEl.style.display='none';
    const root=document.createElement('section');root.className='dae-ui dae-upload';
    const toolbar=document.createElement('div');toolbar.className='dae-upload-toolbar';
    const info=document.createElement('span');info.className='dae-upload-info';
    const stage=document.createElement('div');stage.className='dae-upload-stage';
    const status=document.createElement('p');status.className='dae-upload-status';status.setAttribute('role','status');
    const picker=document.createElement('input');picker.type='file';picker.accept=ACCEPT;picker.hidden=true;picker.setAttribute('aria-label','上传图片或视频');
    let task=null;
    let epoch=0,controller=null,disposed=false,signature=null,asset=null,releasePlayer=null;
    const choose=createCreativeButton('上传图片 / 视频',()=>{picker.value='';picker.click();});
    const fullscreen=createCreativeButton('全屏',async()=>{try{await stage.requestFullscreen();}catch{status.textContent='当前浏览器无法进入全屏';}});
    const download=document.createElement('a');download.textContent='下载';download.className='dae-upload-download';
    const source=operation=>({operation,documentId:String(node.graph?.id||'unsaved'),nodeId:String(node.id)});
    const favorite=createFavoriteButton(()=>{const a=readAsset(data.value);return a?{...a,name:node.title||a.name,source:source('favorite')}:null;},{available:()=>!disposed&&!node.mode,onError:text=>{status.textContent=text;}});
    toolbar.append(info,choose,download,fullscreen,favorite.button);root.append(toolbar,stage,status,picker);
    function render(){
        if(disposed)return;
        const previousName=asset?.name;
        asset=readAsset(data.value);favorite.sync();const savedPlaceholder=node.properties?.materialPlaceholder;const detached=node.properties?.generationOutput&&node.inputs?.find(input=>input.name==='source_report')?.link==null;const placeholder=detached&&savedPlaceholder?{phase:'stopped',label:'已断开来源',detail:'重新连接原生成节点以同步状态',busy:false}:savedPlaceholder;const next=JSON.stringify([asset,asset?null:placeholder]);if(next===signature)return;signature=next;
        root.dataset.hasAsset=String(!!asset);
        if(asset&&(!node.title||node.title==='上传'||node.title===UPLOAD_TYPE||node.title===previousName))node.title=asset.name;
        releasePlayer?.();releasePlayer=null;stage.querySelector('video')?.pause();stage.replaceChildren();status.textContent='';
        choose.hidden=!!placeholder&&!asset;favorite.button.hidden=!asset;root.dataset.placeholder=String(!!placeholder&&!asset);
        choose.textContent=asset?'替换素材':'上传图片 / 视频';download.hidden=fullscreen.hidden=!asset;
        info.textContent=asset?.name||'';info.title=info.textContent;
        if(!asset&&placeholder){const hint=document.createElement('div');hint.className='dae-upload-empty dae-upload-placeholder';hint.setAttribute('role','status');hint.setAttribute('aria-live','polite');hint.dataset.phase=placeholder.phase;
            const ring=document.createElement('span');ring.className='dae-upload-placeholder-ring';ring.hidden=!placeholder.busy;ring.setAttribute('aria-hidden','true');
            const label=document.createElement('strong');label.textContent=placeholder.label||'等待结果';const detail=document.createElement('small');detail.textContent=placeholder.detail||'结果将在此处显示';
            hint.append(ring,label,detail);if(placeholder.busy){const progress=document.createElement('progress');progress.max=100;if(Number.isFinite(placeholder.progress))progress.value=placeholder.progress;progress.setAttribute('aria-label',label.textContent);hint.append(progress);}stage.append(hint);return;}
        if(!asset){const hint=document.createElement('div');hint.className='dae-upload-empty';const open=createCreativeButton('选择本地文件',()=>{if(!node.mode){picker.value='';picker.click();}});const formats=document.createElement('small');formats.textContent='PNG · JPG · WebP · MP4 · WebM · MOV';hint.append(open,formats);stage.append(hint);return;}
        const media=document.createElement(asset.kind==='video'?'video':'img');media.src=assetURL(asset);
        if(asset.kind==='video'){
            media.preload='metadata';media.playsInline=true;
            if(asset.thumbnailUrl||asset.poster)media.poster=asset.thumbnailUrl||asset.poster;
            media.addEventListener('loadedmetadata',()=>{if(media.paused&&media.currentTime===0&&Number.isFinite(media.duration)&&media.duration>0)media.currentTime=Math.min(.1,media.duration/2);},{once:true});
        }else{media.alt=asset.name;media.draggable=false;}
        const dimensions=()=>{if(!media.isConnected)return;const w=media.videoWidth||media.naturalWidth,h=media.videoHeight||media.naturalHeight;info.textContent=`${asset.name} · ${w} × ${h}`;};
        media.addEventListener(asset.kind==='video'?'loadedmetadata':'load',dimensions);
        media.addEventListener('error',()=>{status.textContent='无法预览：文件缺失或浏览器不支持此编码，请替换素材。';});
        stage.append(media);download.href=media.src;download.download=asset.name;
        if(asset.kind==='video')releasePlayer=createUploadVideoControls(media,stage,text=>{status.textContent=text;});
    }
    async function upload(file){
        if(!file||disposed||node.mode||node.properties?.materialPlaceholder&&!asset)return;
        const kind=mediaKind(file.name);if(!kind){status.textContent='请选择 PNG、JPG、WebP、MP4、WebM 或 MOV 文件';return;}
        if(asset&&kind!==asset.kind&&node.outputs.some(o=>o.links?.length)){status.textContent='切换素材类型前，请先断开现有输出连线';return;}
        controller?.abort();controller=new AbortController();const token=++epoch,previous=data.value,owner=node.graph,registrationSource=source('upload');
        const current=()=>!disposed&&!node.mode&&token===epoch&&node.graph===owner&&owner?.getNodeById(node.id)===node&&data.value===previous&&JSON.stringify(source('upload'))===JSON.stringify(registrationSource);
        choose.disabled=true;root.setAttribute('aria-busy','true');status.textContent='正在上传…';task={id:'upload',label:'素材上传',state:'running',detail:'正在上传',startedAt:Date.now(),elapsed:true};
        try{
            const form=new FormData();form.append('image',file,crypto.randomUUID()+file.name.slice(file.name.lastIndexOf('.')).toLowerCase());form.append('type','input');form.append('subfolder','DAELAB/uploads');form.append('overwrite','false');
            const response=await app.api.fetchApi('/upload/image',{method:'POST',body:form,signal:controller.signal});
            if(!response.ok)throw new Error(`上传失败（${response.status}），可重新选择文件重试`);
            const result=await response.json();
            if(!current())return;
            const asset={version:1,kind,name:file.name,filename:result.name,subfolder:result.subfolder||'',type:'input'};
            const registration=await registerAsset({kind,name:file.name,asset,source:registrationSource},controller.signal);
            if(!current())return;
            history.begin();try{
                data.value=JSON.stringify({...asset,...registration.asset,id:crypto.randomUUID(),size:registration.byteSize});
                if(node.properties){delete node.properties.generationOutput;delete node.properties.materialPlaceholder;}
                data.callback?.(data.value);node.graph.setDirtyCanvas?.(true,true);node.graph.change?.();
            }finally{history.end();}
            render();task={...task,state:'success',detail:'上传完成',finishedAt:Date.now()};
        }catch(e){if(token===epoch&&!disposed&&e.name!=='AbortError'){status.textContent=e.message;task={...task,state:'error',detail:e.message};}}
        finally{if(token===epoch&&!disposed){if(task?.state==='running')task=null;choose.disabled=false;root.removeAttribute('aria-busy');}}
    }
    picker.onchange=()=>void upload(picker.files[0]);
    root.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();root.dataset.dragging='true';});
    root.addEventListener('dragleave',()=>delete root.dataset.dragging);
    root.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();delete root.dataset.dragging;if(e.dataTransfer.files.length!==1)return;void upload(e.dataTransfer.files[0]);});
    for(const event of ['pointerdown','dblclick','keydown','wheel'])root.addEventListener(event,stopCanvasPropagation);
    const widget=node.addDOMWidget('media_upload','custom',root,{serialize:false,hideOnZoom:false,getValue:()=>'',setValue:()=>render(),getMinHeight:()=>320});widget.serialize=false;
    const releaseAvailability=bindPanelAvailability(node,root);
    node.__mediaUpload={tasks:()=>!disposed&&task?[{...task}]:[],root,render,upload,kind:()=>readAsset(data.value)?.kind,reload(){task=null;++epoch;controller?.abort();choose.disabled=false;root.removeAttribute('aria-busy');signature=null;render();},destroy(){favorite.destroy();releasePlayer?.();releasePlayer=null;releaseAvailability();disposed=true;++epoch;controller?.abort();stage.querySelector('video')?.pause();root.remove();}};
    node.setSize([520,400]);render();
}
app.registerExtension({name:'DAELab.MediaUpload',beforeRegisterNodeDef(type,definition){
    if(definition.name!==UPLOAD_TYPE)return;
    const created=type.prototype.onNodeCreated;type.prototype.onNodeCreated=function(){created?.apply(this,arguments);install(this);};
    const configured=type.prototype.onConfigure;type.prototype.onConfigure=function(){configured?.apply(this,arguments);install(this);this.__mediaUpload.reload();};
    const connections=type.prototype.onConnectionsChange;type.prototype.onConnectionsChange=function(){const result=connections?.apply(this,arguments);this.__mediaUpload?.render();return result;};
    const removed=type.prototype.onRemoved;type.prototype.onRemoved=function(){this.__mediaUpload?.destroy();removed?.apply(this,arguments);};
    const connect=type.prototype.onConnectOutput;type.prototype.onConnectOutput=function(index){if(!slotAllowed(this.__mediaUpload?.kind(),index))return false;return connect?.apply(this,arguments)??true;};
}});
