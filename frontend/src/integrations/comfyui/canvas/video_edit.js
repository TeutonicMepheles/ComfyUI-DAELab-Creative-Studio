import {app} from '/scripts/app.js';
import {api} from '/scripts/api.js';
import {registerAdapter,adapterFor} from '../../../canvas/creative_contract.mjs';
import {canvasHistory} from './creative_history.mjs?v=20261002-edit-undo';
import {bindPanelAvailability} from '../../../ui/creative_panel_state.mjs';
import {EDIT_TYPE,readEdit,localAsset,isGroupSlot,sourceSlotKey,remapEditSources} from '../../../features/editor/video_edit_model.mjs?v=20261004-copy-sources';
import {createVideoEditor} from '../../../features/editor/video_edit_panel.mjs?v=20261002-edit-undo';
import {createBusinessDocument} from '../../../application/business_document.js';
import {ExportSession} from '../../../features/editor/export_session.js';
import {createMediaExportHttp} from '../media_exports.js';

const sheet=document.createElement('link');sheet.rel='stylesheet';sheet.href=new URL('../../../features/editor/video_edit.css?v=20261001-timeline-background2',import.meta.url).href;document.head.append(sheet);
const resultFor=node=>node.properties?.daelabEditBinding||node.properties?.daelabEditExport?node.__videoEdit?.currentResult?.()||null:node.properties?.daelabEditResultData===node.widgets?.find(w=>w.name==='edit_data')?.value?node.properties?.daelabEditResult:null;
const workflowPlayheads=new WeakMap();
const exportService=createMediaExportHttp((path,options)=>api.fetchApi(path,options));
// Native workflow properties can be reactive proxies in the pinned host.
// Cross the host boundary with the same JSON values that workflow saving owns.
const nativeSnapshot=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value,(_key,item)=>{
    if(typeof item==='number'&&!Number.isFinite(item)||['bigint','function','symbol'].includes(typeof item))throw new Error('剪辑数据包含不可保存的值');
    return item;
}));
const exportOwners=new Set(),workflowSessions=new WeakMap();let workflowSequence=0,loadEpoch=0;
const stateLabels={pending:'等待提交',submitting:'正在提交',submitted:'等待导出',running:'正在导出',fetching:'正在核验成片',succeeded:'导出完成',failed:'导出失败',cancelled:'导出已取消',unknown:'提交结果待核对',needs_recovery:'原任务待核对'};
const taskStates={pending:'queued',submitting:'running',submitted:'queued',running:'running',fetching:'running',succeeded:'success',failed:'error',cancelled:'cancelled',unknown:'recovery',needs_recovery:'recovery'};
function canConnectOutput(node){
    if(resultFor(node))return true;
    app.extensionManager.toast.add({severity:'warn',summary:'暂不能连接',detail:'请先成功导出当前剪辑，再连接下游节点。',life:3500});
    return false;
}
async function request(path,data,signal){const response=await api.fetchApi(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal});const result=await response.json();if(!response.ok)throw new Error(result.error?.message||result.error||'处理失败，请重试');return result;}
function install(node){
    if(node.__videoEdit)return;
    const widget=node.widgets.find(w=>w.name==='edit_data'),history=canvasHistory(app);
    widget.hidden=true;widget.options={...widget.options,hidden:true};widget.computeSize=()=>[0,-4];if(widget.inputEl)widget.inputEl.style.display='none';
    let exportTask=null;const operations=new Map();
    let disposed=false,sourceSignature=null,sourceSync=null,syncTimer=null,playhead=null,playheadWorkflow=null,currentResult=null,displayedResult=null,currentBinding=null;
    let session,resumedWorkflow=null,resumedEpoch=-1,resumedOwner=null,referenceLoadReady=false,liveRequestId=null,finishedAt=null;
    const current=()=>!disposed&&app.isGraphReady!==false&&!!node.graph&&node.graph===app.graph&&node.graph.getNodeById?.(node.id)===node&&!app.configuringGraph;
    const owner=()=>{if(node.graph?.id==null||String(node.graph.id)===''||node.id==null)throw new Error('宿主缺少稳定工作流身份，暂不能导出');return {documentId:String(node.graph.id),nodeId:String(node.id)};};
    const document=createBusinessDocument({
        read:()=>nativeSnapshot({edit_data:widget.value,reference:node.properties.daelabEditExport,binding:node.properties.daelabEditBinding,result:node.properties.daelabEditResult,resultData:node.properties.daelabEditResultData}),
        write(value){
            widget.value=value.edit_data;widget.callback?.(widget.value);
            for(const [key,field]of [['daelabEditExport','reference'],['daelabEditBinding','binding'],['daelabEditResult','result'],['daelabEditResultData','resultData']]){
                if(value[field]===undefined)delete node.properties[key];else node.properties[key]=value[field];
            }
            dirty();
        },
        current,history,
        identity(){const workflow=app.extensionManager?.workflow?.activeWorkflow;if(!workflow)throw new Error('当前工作流尚未就绪');if(!workflowSessions.has(workflow))workflowSessions.set(workflow,++workflowSequence);return {workflowSession:'edit-workflow-'+workflowSessions.get(workflow),epoch:loadEpoch,documentId:owner().documentId+':'+node.id};},
        stamp:value=>({edit_data:value.edit_data,connections:connectionInputs()}),
        historyStamp:()=>JSON.stringify(app.rootGraph?.serialize()),
    });
    async function mediaTask(id,label,detail,path,data,signal){
        const task={id,label,detail,state:'running',startedAt:Date.now(),elapsed:true,order:id==='edit-preview'?60:50};operations.set(id,task);
        try{const result=await request(path,data,signal);if(!disposed&&operations.get(id)===task){if(signal?.aborted)operations.delete(id);else operations.set(id,{...task,state:'success',detail:'准备完成',finishedAt:Date.now()});}return result;}
        catch(error){if(!disposed&&operations.get(id)===task){if(signal?.aborted)operations.delete(id);else operations.set(id,{...task,state:'error',detail:error.message});}throw error;}
    }
    function bindPlayhead(){
        const workflow=app.extensionManager?.workflow?.activeWorkflow;
        if(!workflow||!node.graph)return;
        let positions=workflowPlayheads.get(workflow);
        if(!positions){positions=new Map();workflowPlayheads.set(workflow,positions);}
        const key=JSON.stringify([node.graph.id,node.id]);
        if(!positions.has(key))positions.set(key,{time:0});
        playhead=positions.get(key);
        playheadWorkflow=workflow;
    }
    const dirty=()=>{node.graph?.change?.();node.graph?.setDirtyCanvas?.(true,true);};
    const panel=createVideoEditor({
        read:()=>readEdit(widget.value),view:()=>node.properties.daelabEditView||{},
        isSelected:()=>app.canvas?.selected_nodes?.[node.id]===node,
        savePlayhead(time){if(disposed||app.configuringGraph)return;if(!playhead)bindPlayhead();if(playhead&&playheadWorkflow===app.extensionManager?.workflow?.activeWorkflow)playhead.time=time;},
        write(data,sync=false){
            const previous=readEdit(widget.value),used=new Set(data.clips.map(c=>sourceSlotKey(c.source)).filter(Boolean));
            const removed=new Set(previous.clips.map(c=>sourceSlotKey(c.source)).filter(slot=>slot&&!used.has(slot)));
            const grouped=new Set(data.clips.filter(c=>isGroupSlot(c.source.slot)).map(c=>c.source.nodeId).filter(Boolean));
            const linked=node.inputs.filter(input=>input.link!=null).map(input=>{
                const link=node.graph.links.get?.(input.link)||node.graph.links[input.link];
                return {input,originId:String(link.origin_id),key:sourceSlotKey({slot:input.name,groupId:String(link.origin_id)})};
            });
            for(const {input,originId,key} of linked){
                if(isGroupSlot(input.name)||used.has(key))continue;
                if(grouped.has(originId))removed.add(key);
            }
            if(removed.size&&data.sources)data={...data,sources:data.sources.filter(key=>!removed.has(JSON.parse(key)[0]))};
            const value=JSON.stringify(data);
            if(value!==widget.value){currentResult=null;displayedResult=null;panel.output(null);}
            document.edit('编辑剪辑',draft=>{draft.edit_data=value;},{derived:sync,afterWrite:()=>{
                for(const {input,key} of linked)if(removed.has(key)){const index=node.inputs.indexOf(input);if(index>=0)node.disconnectInput(index);}
                dirty();
            }});
            void session?.inputChanged();
            return data;
        },
        saveView(value){node.properties.daelabEditView=value;dirty();},
        inspect:(asset,signal)=>mediaTask('edit-sources','素材读取','读取连接素材','/daelab/edit/media',{asset},signal),
        proxy:(asset,scale,signal)=>mediaTask('edit-preview','预览准备',`准备 ${scale}× 预览`,'/daelab/edit/preview',{asset,scale},signal),
        exportVideo(){if(resumeExport())return session.start();},
        exportCopy(){if(resumeExport())return session.startCopy();},
        cancelExport(){if(resumeExport())return session.cancel();},
        recoverExport(){if(resumeExport())return session.recover();},
        reviewExport(){if(resumeExport())return session.review();},
    });
    session=new ExportSession(exportService,{
        input:()=>({edit_data:widget.value,connections:connectionInputs(),source:owner()}),current,owner,
        begin:requestId=>document.beginRequest(requestId),canApply:document.canApply,release:document.releaseRequest,
        saveReference(reference){document.edit('记录导出请求',draft=>{draft.reference=reference;});liveRequestId=reference.requestId;finishedAt=null;},
        apply(ticket,binding){return document.controller.applyResult(ticket,'绑定导出成片',draft=>{
            draft.binding=binding;draft.result='/view?'+new URLSearchParams(binding.output);delete draft.resultData;
        });},
        binding:()=>nativeSnapshot(node.properties.daelabEditBinding),
        changed(view){
            const report=view.report,binding=view.currentOutput||view.copiedOutput,url=binding?'/view?'+new URLSearchParams(binding.output):null;
            currentResult=url;
            currentBinding=binding||null;
            const visible=url||(!node.properties.daelabEditBinding&&!node.properties.daelabEditExport?resultFor(node):null);
            const displayStamp=JSON.stringify([visible,!!view.copiedOutput,binding?.reference.source]);
            if(displayStamp!==displayedResult){displayedResult=displayStamp;panel.output(visible,{copied:!!view.copiedOutput,source:binding?.reference.source});}
            const detail=view.error||(view.copied?(view.copiedOutput?'副本正在只读使用原成片；可为此副本另行导出':report?.state==='succeeded'?'副本编辑已改变，原成片不适用于当前输入；可为此副本导出':'副本正在核对原成片绑定'):
                report?.errorCode==='export_input_rejected'?(report.state==='cancelled'?'输入检查未通过，修复素材后可重新导出':'输入检查未通过，请取消原任务记录后重试'):(report?.state==='succeeded'&&!view.currentOutput)?'原剪辑已完成；采用前请核对当前编辑':stateLabels[report?.state]||'核对原导出任务');
            panel.exportState(view,view.reference||view.error?detail:'');
            if(report?.requestId===liveRequestId&&['succeeded','cancelled'].includes(report.state)&&finishedAt===null)finishedAt=Date.now();
            exportTask=report?{id:'edit-export',label:view.copied?'原来源成片（只读）':'成片导出',state:taskStates[report.state],detail,order:40,...(report.requestId===liveRequestId&&finishedAt!==null?{finishedAt}:{})}:view.reference||view.unresolved?{id:'edit-export',label:view.copied?'副本成片引用':'成片导出',state:view.rejected?'error':'recovery',detail,order:40}:null;
        },
    });
    const lifecycle={invalidate(){document.invalidate();session.invalidate();currentResult=null;displayedResult=null;panel.output(null);}};
    exportOwners.add(lifecycle);
    function resumeExport(){
        if(!current())return false;
        const workflow=app.extensionManager?.workflow?.activeWorkflow;
        let identity;
        try{identity=JSON.stringify(owner());}catch(error){session.rejectReference(error.message);return false;}
        if(resumedWorkflow===workflow&&resumedEpoch===loadEpoch&&resumedOwner===identity)return referenceLoadReady;
        // Mark the attempt before snapshotting: a damaged native reference is
        // diagnosed once per load, never retried by every source-sync tick.
        resumedWorkflow=workflow;resumedEpoch=loadEpoch;resumedOwner=identity;liveRequestId=null;referenceLoadReady=false;
        document.invalidate();sourceSync=null;sourceSignature=null;panel.cancelSourceSync();currentBinding=null;currentResult=null;displayedResult=null;panel.output(null);
        try{referenceLoadReady=session.load(nativeSnapshot(node.properties.daelabEditExport));}
        catch(error){session.rejectReference(error instanceof Error?error.message:'宿主引用无法读取');}
        if(!referenceLoadReady){document.invalidate();sourceSync=null;sourceSignature=null;panel.cancelSourceSync();}
        return referenceLoadReady;
    }
    function connectionInputs(){
        const result={};
        for(const input of node.inputs||[]){
            if(input.link==null||input.widget)continue;
            const link=node.graph?.links.get?.(input.link)||node.graph?.links[input.link];
            if(!link)throw new Error('剪辑来源连接已失效');
            const source=node.graph.getNodeById(link.origin_id),adapter=adapterFor(source);
            const collection=adapter?.assets?.(source);
            if(collection?.ready===false)throw new Error('请先导出上游节点的最新成片');
            if(isGroupSlot(input.name)){
                if(!collection)throw new Error('素材组未提供公开素材快照');
                if(input.name==='assets')result.assets=nativeSnapshot(collection);
                else(result.groups??={})[input.name]=nativeSnapshot(collection);
            }else if(input.name.startsWith('videos.')||input.name.startsWith('images.')){
                const media=collection?.assets?.length===1?collection.assets[0]:localAsset(adapter?.preview?.(source)?.url);
                const group=input.name.startsWith('videos.')?'videos':'images';
                (result[group]??={})[input.name]=nativeSnapshot(media.filename?media:{...media,...localAsset(media.url)});
            }else throw new Error('此剪辑输入尚未提供稳定素材快照');
        }
        return result;
    }
    function connected(){
        const assets=[];
        for(const input of node.inputs||[]){
            if(input.link==null||input.widget)continue;
            const link=node.graph.links.get?.(input.link)||node.graph.links[input.link],source=node.graph.getNodeById(link.origin_id),adapter=adapterFor(source);
            const collection=adapter?.assets?.(source);
            if(collection?.ready===false)throw new Error('请先导出上游节点的最新成片');
            if(collection){for(const asset of collection.assets)assets.push({...asset,editSource:isGroupSlot(input.name)?{slot:input.name,groupId:String(source.id),assetId:asset.id,nodeId:asset.nodeId}:{slot:input.name,nodeId:String(source.id)}});}
            else{const preview=adapter?.preview?.(source);assets.push({...localAsset(preview?.url),editSource:{slot:input.name,nodeId:String(source.id)}});}
        }
        return {version:1,assets};
    }
    function syncConnections(){
        const workflow=app.extensionManager?.workflow?.activeWorkflow,tracker=workflow?.changeTracker;
        if(!current()||tracker?._restoringState||tracker?.changeCount>0)return;
        if(!resumeExport())return;
        try{
            void session.inputChanged();
            if(!playhead||playheadWorkflow!==workflow){bindPlayhead();panel.reload(playhead?.time);}
            document.observe();
            const collection=connected(),signature=JSON.stringify(collection);
            if(signature===(sourceSync?.signature??sourceSignature))return;
            const sync=sourceSync={signature};sourceSignature=null;
            panel.syncSources(collection,()=>!disposed&&sourceSync===sync&&!app.configuringGraph&&!tracker?._restoringState&&!(tracker?.changeCount>0)&&app.extensionManager?.workflow?.activeWorkflow===workflow&&signature===JSON.stringify(connected())).then(()=>{
                if(disposed||sourceSync!==sync)return;
                sourceSignature=signature;sourceSync=null;
            },error=>{
                if(disposed||sourceSync!==sync)return;
                sourceSync=null;if(error.name!=='AbortError')panel.error(error.message);
            });
        }catch(error){sourceSync=null;sourceSignature=null;panel.cancelSourceSync();panel.error(error.message);}
    }
    syncTimer=setInterval(syncConnections,400);
    const availability=bindPanelAvailability(node,panel.root);
    const dom=node.addDOMWidget('video_edit','custom',panel.root,{serialize:false,hideOnZoom:false,getValue:()=>'',setValue:()=>{},getMinHeight:()=>660});dom.serialize=false;
    node.__videoEdit={...panel,currentResult:()=>resumeExport()?currentResult:null,currentBinding:()=>resumeExport()&&currentResult?structuredClone(currentBinding):null,tasks:()=>disposed?[]:[...(exportTask?[{...exportTask}]:[]),...[...operations.values()].map(t=>({...t}))],syncConnections,
        output(_url,_data,report){
            // A direct whole-workflow native run is readable history; it has no
            // issued HTTP edit ticket and cannot silently bind the current edit.
            if(report?.state==='succeeded')panel.error('原生剪辑已完成；请从导出任务核对成片引用');
        },
        reload(){sourceSync=null;sourceSignature=null;resumedWorkflow=null;liveRequestId=null;document.invalidate();bindPlayhead();panel.reload(playhead?.time);currentResult=null;displayedResult=null;panel.output(resultFor(node));resumeExport();},
        destroy(){disposed=true;sourceSync=null;clearInterval(syncTimer);exportOwners.delete(lifecycle);session.dispose();document.dispose();availability();panel.destroy();}};
    node.setSize([820,760]);if(resultFor(node))panel.output(resultFor(node));queueMicrotask(resumeExport);
}
registerAdapter('daelab.video-edit',{
    matches:node=>node.type===EDIT_TYPE,width:840,expanded:true,floatingHeader:true,collapsible:false,inputSelection:'first-free',outputLabel:'剪辑成片',
    menu:[{label:'剪辑',type:EDIT_TYPE,icon:'scissors-cut-line'}],
    tasks:node=>node.__videoEdit?.tasks()||[],
    panel:node=>node.__videoEdit,preview:node=>({url:resultFor(node),kind:'video'}),
    summary:node=>`${readEdit(node.widgets?.find(w=>w.name==='edit_data')?.value).clips.length} 个片段`,
    materialOutput:true,
    assets:node=>{const url=resultFor(node),binding=node.__videoEdit?.currentBinding?.(),identity=binding?{id:binding.asset.asset_id,assetId:binding.asset.asset_id,referenceId:binding.asset.reference_id,contentSha256:binding.asset.sha256,byteSize:binding.asset.bytes,provenance:{operation:'video_export',requestId:binding.reference.requestId,fingerprint:binding.fingerprint,inputDigest:binding.reference.inputDigest,source:{...binding.reference.source}}}:{};return {version:1,ready:!!url,assets:url?[{...localAsset(url),...identity,url,kind:'video',name:'剪辑结果.mp4'}]:[]};},
    canConnectOutput,
    inputLabels:{assets:'素材组'},
    prepareCopy(node,serialized){
        const url=resultFor(node);serialized.properties??={};delete serialized.properties.daelabEditExport;delete serialized.properties.daelabEditBinding;
        if(url){serialized.properties.daelabEditResult=url;serialized.properties.daelabEditResultData=node.widgets.find(w=>w.name==='edit_data').value;}
        else{delete serialized.properties.daelabEditResult;delete serialized.properties.daelabEditResultData;}
    },
    remapCopy(node,mapping){
        const widget=node.widgets.find(w=>w.name==='edit_data'),previous=widget.value;
        widget.value=JSON.stringify(remapEditSources(readEdit(previous),mapping));
        // Identity changes do not alter the rendered movie or invalidate copied output links.
        if(node.properties.daelabEditResultData===previous)node.properties.daelabEditResultData=widget.value;
        node.__videoEdit.reload();
    },
});
app.registerExtension({name:'DAELAB.VideoEdit',beforeConfigureGraph(){loadEpoch++;for(const owner of exportOwners)owner.invalidate();},beforeRegisterNodeDef(type,definition){
    if(definition.name!==EDIT_TYPE)return;
    const created=type.prototype.onNodeCreated;type.prototype.onNodeCreated=function(){created?.apply(this,arguments);install(this);};
    const configured=type.prototype.onConfigure;type.prototype.onConfigure=function(){configured?.apply(this,arguments);if(!this.inputs.some(input=>input.name.startsWith('groups.')))this.addInput('groups.group0','DAELAB_ASSETS');install(this);this.__videoEdit.reload();};
    const connections=type.prototype.onConnectionsChange;type.prototype.onConnectionsChange=function(){connections?.apply(this,arguments);requestAnimationFrame(()=>this.__videoEdit?.syncConnections());};
    const connect=type.prototype.onConnectOutput;type.prototype.onConnectOutput=function(){if(!app.configuringGraph&&!canConnectOutput(this))return false;return connect?.apply(this,arguments)??true;};
    const removed=type.prototype.onRemoved;type.prototype.onRemoved=function(){this.__videoEdit?.destroy();removed?.apply(this,arguments);};
    const executed=type.prototype.onExecuted;type.prototype.onExecuted=function(message){executed?.apply(this,arguments);const ref=message?.videos?.[0];if(ref)this.__videoEdit?.output('/view?'+new URLSearchParams(ref),message.edit_data?.[0],message.creative_studio_export?.[0]);};
}});
