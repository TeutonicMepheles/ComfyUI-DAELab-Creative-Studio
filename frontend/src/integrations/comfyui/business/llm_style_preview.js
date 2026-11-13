import {checkLocalTextModels} from './model_catalog_discovery.mjs';
import {bindBusinessDocument} from './business_document_host.js';
import {appliedSnapshot,outputText,outputRows,slotRows,hasTableInput} from '../../../features/prompt/llm_slot_model.mjs';
import {connectedOutputNode} from '../../../canvas/creative_output.mjs';
import {GROUP_TYPE} from '../../../features/groups/material_group_model.mjs';
import {app} from '/scripts/app.js';
import {createLLMStylePanel, STYLE_VARIANTS} from '../../../features/prompt/llm_style_preview_panel.mjs';
import {removeOwnedWidgets} from './dynamic_widget_lifecycle.mjs';
// Model calls are explicit; output nodes own their completed text.
function bindTextGeneration(type,variant){
    const proto=type.prototype;
    const created=proto.onNodeCreated,added=proto.onAdded,configured=proto.onConfigure,removed=proto.onRemoved;
    function hideResultSockets(node){
        // Older workflows can restore the backend's widget sockets during configure.
        for(let i=node.inputs.length-1;i>=0;i--){
            const input=node.inputs[i];
            if(input.link==null&&['applied_text','applied_rows'].includes(input.name))node.removeInput(i);
        }
    }
    proto.onNodeCreated=function(...args){
        const result=created?.apply(this,args);
        this.properties.llmStylePreview??={version:1,mode:'polish',purpose:'image',rewriteStrength:'faithful',rewriteTask:'text2image',instruction:''};
        hideResultSockets(this);
        this.addInput('原文','STRING');this.addInput('参考图片','IMAGE');this.addInput('素材组','DAELAB_ASSETS');
        this.addInput('多维表格','STRING');this.addInput('其他输入','*');
        for(const widget of this.widgets||[]){
            const read=widget.name==='applied_text'?outputText:widget.name==='applied_rows'?outputRows:null;
            if(!read)continue;
            widget.hidden=true;widget.computeSize=()=>[0,-4];
            if(widget.inputEl)widget.inputEl.hidden=true;
            widget.serializeValue=()=>{try{return read(this);}catch{return '';}};
        }
        this.size=[variant.width,variant.height+80];
        return result;
    };
    function install(node){
        if(node.__llmStylePanel||!node.graph)return;
        const nativeDocument=bindBusinessDocument(node,()=>node.properties.llmStylePreview,value=>{node.properties.llmStylePreview=value;node.graph?.change?.();},value=>({mode:value.mode,purpose:value.purpose,videoTarget:value.videoTarget,instruction:value.instruction,model:value.model,source:value.source,rewriteStrength:value.rewriteStrength,rewriteTask:value.rewriteTask,rewriteDuration:value.rewriteDuration}));
        const panel=createLLMStylePanel(node,variant,{nativeDocument,checkLocalTextModels});node.__llmStylePanel=panel;
        const panelHeight=()=>variant.height+(panel.root.classList.contains('has-task-list')?90:0);
        const widget=node.addDOMWidget('llm_style_preview','custom',panel.root,{serialize:false,hideOnZoom:false,getMinHeight:panelHeight,getHeight:panelHeight,getValue:()=>'',setValue:()=>panel.sync()});
        widget.__studioTextPanel=true;widget.serialize=false;widget.inputEl=panel.root;
        widget.computeSize=width=>[width,panelHeight()];
        widget.computeLayoutSize=()=>({minHeight:panelHeight(),maxHeight:panelHeight(),minWidth:variant.width});
    }
    function dispose(node){
        node.__llmStylePanel?.destroy();delete node.__llmStylePanel;
        removeOwnedWidgets(node,'__studioTextPanel');
    }
    proto.onAdded=function(...args){const result=added?.apply(this,args);install(this);return result;};
    proto.onConfigure=function(...args){
        const result=configured?.apply(this,args);
        hideResultSockets(this);
        if(this.size?.[0]===700||this.size?.[0]<variant.width)this.size=[variant.width,this.size[1]];
        if(['已应用提示词','文本生成 · B 双栏工作台','LLM 优化 · B 双栏工作台'].includes(this.title))this.title='文本生成';
        this.properties.llmStylePreview??={version:1,mode:'polish'};
        dispose(this);install(this);return result;
    };
    proto.onRemoved=function(...args){dispose(this);return removed?.apply(this,args);};
    proto.onExecute=function(){
        try{this.setOutputData(0,outputText(this));this.setOutputData(1,outputRows(this));}
        catch{this.setOutputData(0,null);this.setOutputData(1,null);}
    };
}

app.registerExtension({
    name:'DAELab.LLMStylePreview',
    beforeRegisterNodeDef(type,data){
        if(data.name!=='DAELAB.LLMStylePreviewB')return;
        data.display_name='文本生成';
        bindTextGeneration(type,STYLE_VARIANTS.find(v=>v.id==='B'));
    },
});
function connectResult(node,target){
    let index=target.inputs?.findIndex(i=>i.name==='source_report')??-1;
    if(index<0&&target.type==='DAELAB.TextInput'){target.addInput('source_report','STRING');index=target.inputs.length-1;}
    if(index<0||!node.connect(0,target,index))throw new Error('无法连接文本生成结果');
}
let registered=false;
function register(){
    const api=globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')];
    if(registered||api?.version!==1)return;
    api.registerAdapter('daelab.llm-style-preview',{
        matches:node=>node.type==='DAELAB.LLMStylePreviewB',
        menu:[{label:'文本生成',type:'DAELAB.LLMStylePreviewB',icon:'sparkling-line',inputTypes:['STRING','DAELAB_ASSETS']}],
        width:node=>STYLE_VARIANTS.find(v=>v.type===node.type)?.width||460,
        expanded:true,collapsible:false,floatingHeader:true,compactWidth:0,
        panel:node=>node.__llmStylePanel,
        summary:()=> '文本生成',
        inputSelection:'first-free',
        canConnectOutput:node=>node.type==='DAELAB.LLMStylePreviewB',
        outputTargetTypes:()=>[],
        dropOutput:node=>({
            get type(){
                if(hasTableInput(node)||!node.inputs?.some(i=>i.link!=null)&&!node.properties.llmStylePreview?.source?.trim())return GROUP_TYPE;
                try{return slotRows(node).length>1?GROUP_TYPE:'DAELAB.TextInput';}
                catch{return 'DAELAB.TextInput';}
            },
            destination(){
                const group=connectedOutputNode(node,GROUP_TYPE);
                const text=connectedOutputNode(node,'DAELAB.TextInput');
                if(group&&!group.properties.locked&&(this.type===GROUP_TYPE||String(node.properties.textOutputTarget)===String(group.id)))return group;
                if(this.type!=='DAELAB.TextInput')return null;
                return text?.properties.textOutputPending||text?.inputs?.some(i=>i.name==='text'&&i.link!=null)&&!node.properties.llmStylePreview?.appliedIO?text:null;
            },
            existing(){const target=this.destination();return target?.properties.textOutputPending?target:null;},
            bind(target,manual=true){
                const previous=node.properties.llmStylePreview?.appliedIO;
                if(previous?.complete){
                    // Older result boxes linked their editable text directly to the live output.
                    for(const id of [...(node.outputs[0]?.links||[])]){
                        const link=node.graph.links[id],old=link&&node.graph.getNodeById(link.target_id);
                        if(old?.type!=='DAELAB.TextInput'||old.title!=='优化结果'||old.inputs[link.target_slot]?.name!=='text')continue;
                        const widget=old.widgets.find(w=>w.name==='text');
                        connectResult(node,old);old.disconnectInput(link.target_slot);
                        widget.value=previous.rows.map(row=>row.result).join('\n\n');
                    }
                }
                connectResult(node,target);
                target.title='优化结果';
                if(target.type===GROUP_TYPE){
                    target.properties.generationOutputOwner=String(node.id);
                    target.properties.materialType='text';
                }else target.properties.textOutputPending=true;
                if(manual)node.properties.textOutputTarget=target.id;
            },
        }),
        inputSnapshot:node=>appliedSnapshot(node),
        tasks:node=>node.__llmStylePanel?.tasks?.()||[],
        remapCopy(node,mapping){const s=node.properties?.llmStylePreview;if(s?.inputIds)s.inputIds=s.inputIds.map(id=>String(mapping.get(id)??mapping.get(Number(id))??id));if(s)delete s.ioResult;node.__llmStylePanel?.sync();},
        inputLabels:{'原文':'原文','参考图片':'参考图片'},outputLabel:'结果',
    });
    registered=true;
}
globalThis.addEventListener('daelab:creative-canvas-ready',register);register();
