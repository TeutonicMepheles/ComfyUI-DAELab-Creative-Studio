import {app} from '/scripts/app.js';
import {installVideoTasks} from '../../../features/generation/video_tasks_panel.mjs';
import {ensureIdentity,NAMESPACE} from '../../../features/prompt/prompt_optimization_model.mjs';
import {bindBusinessDocument,tableInputStamp} from './business_document_host.js';
import {scheduleTableInstall} from '../../../features/table/table_node_install.mjs';

const TYPE='DAELAB.LibTV.VideoGenerate';
function dispose(node){
    node.__libtvPanel?.dispose();delete node.__libtvPanel;
    for(const widget of node.widgets||[])if(widget.__daelabLibTVPanel)widget.onRemove?.();
    node.widgets=(node.widgets||[]).filter(widget=>!widget.__daelabLibTVPanel);
}
function install(node){
    if(!node.graph)return;
    if(node.__libtvPanel){node.__libtvPanel.sync();return;}
    const duplicate=node.graph._nodes?.some(other=>other!==node&&other.properties?.[NAMESPACE]?.tableId===node.properties?.[NAMESPACE]?.tableId&&node.properties?.[NAMESPACE]?.tableId);
    const taskIdentity=ensureIdentity(node.graph,node,{duplicate});
    node.__libtvPanel=installVideoTasks(node,app,{taskIdentity,documentFactory:(read,write)=>bindBusinessDocument(node,read,write,(value,target)=>tableInputStamp(value.table,target))});
}
app.registerExtension({name:'DAELab.Studio.GenerationPanel',beforeRegisterNodeDef(type,data){
    if(data.name!==TYPE)return;
    // The backend defines all 17 inputs and 5 outputs. Never rebuild native slots.
    for(const method of ['onNodeCreated','onAdded','onConfigure']){
        const previous=type.prototype[method];
        type.prototype[method]=function(...args){const result=previous?.apply(this,args);if(method==='onConfigure')dispose(this);scheduleTableInstall(this,install);return result;};
    }
    for(const method of ['onDrawForeground','onConnectionsChange']){
        const previous=type.prototype[method];
        type.prototype[method]=function(...args){const result=previous?.apply(this,args);this.__libtvPanel?.sync();return result;};
    }
    const removed=type.prototype.onRemoved;
    type.prototype.onRemoved=function(...args){dispose(this);return removed?.apply(this,args);};
    const executed=type.prototype.onExecuted;
    type.prototype.onExecuted=function(message){const result=executed?.call(this,message);this.__libtvPanel?.acceptResult(message);return result;};
}});
