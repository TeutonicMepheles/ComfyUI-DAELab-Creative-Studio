import {app} from '/scripts/app.js';
import {registerAdapter} from '../../../canvas/creative_contract.mjs';
import {bindCreativeField} from '../../../ui/creative_field.mjs';
import {stopCanvasPropagation} from '../../../ui/creative_events.mjs';
import {registerAsset} from '../../../application/asset_library_service.js';
import {createTextSnapshotRegistration} from '../../../application/asset_registration.js';
import {canvasHistory} from './creative_history.mjs';
import {bindPanelAvailability} from '../../../ui/creative_panel_state.mjs';
import {createFavoriteButton} from '../../../features/assets/asset_favorite.mjs?v=20261015-2';
import {inputSnapshot} from '../../../canvas/creative_input_exchange.mjs';
import {textSnapshot} from '../../../features/assets/text_input_model.mjs?v=20261015-mixed2';

const TYPE='DAELAB.TextInput';
registerAdapter('daelab.text-input',{
    matches:node=>node.type===TYPE,width:350,expanded:true,floatingHeader:true,
    menu:[{label:'输入文本',type:TYPE,icon:'edit-line'}],
    panel:node=>node.__daeTextPanel,outputLabel:'文本',
    inputSnapshot:node=>textSnapshot(node,inputSnapshot),
});
function install(node){
    if(!node.inputs?.some(i=>i.name==='text'))node.addInput('text','STRING');
    // Expose the existing text widget's STRING socket in the unified canvas port.
    const textInput=node.inputs?.find(i=>i.name==='text');if(textInput)delete textInput.widget;
    if(node.__daeTextPanel)return;
    const widget=node.widgets?.find(w=>w.name==='text');if(!widget)return;
    widget.hidden=true;widget.options={...widget.options,hidden:true};widget.computeSize=()=>[0,-4];
    if(widget.inputEl)widget.inputEl.style.display='none';
    const root=document.createElement('section');root.className='dae-ui dae-text-input';
    const input=document.createElement('textarea');input.setAttribute('aria-label','输入文本');input.placeholder='输入描述或提示词';input.rows=6;
    input.style.cssText='display:block;box-sizing:border-box;width:100%;min-height:140px;resize:vertical;font:inherit';root.append(input);
    const favoriteStatus=document.createElement('span');favoriteStatus.className='dae-text-favorite-status';favoriteStatus.setAttribute('role','status');
    const source=()=>({operation:'text-commit',documentId:String(node.graph?.id||'unsaved'),nodeId:String(node.id)});
    const history=canvasHistory(app);
    const registration=createTextSnapshotRegistration({read:()=>String(widget.value??''),source,current:()=>!!node.graph&&node.graph.getNodeById(node.id)===node&&!node.mode,
        register:registerAsset,apply:receipt=>history.amend(()=>{node.properties??={};node.properties.studioTextAsset={assetId:receipt.assetId,contentSha256:receipt.contentSha256,byteSize:receipt.byteSize};}),
        error:error=>{favoriteStatus.textContent=`文本资产登记失败：${error.message||error}；原文已保留`;} });
    const favorite=createFavoriteButton(()=>{const snapshot=textSnapshot(node,inputSnapshot);return snapshot.ready===false||!snapshot.texts?.join('\n\n').trim()?null:{kind:'text',name:node.title||'输入文本',text:snapshot.texts.join('\n\n'),source:{...source(),operation:'favorite'}};},{available:()=>!node.mode,onError:text=>{favoriteStatus.textContent=text;}});
    const favoriteBar=document.createElement('div');favoriteBar.className='dae-text-favorite-bar';favoriteBar.append(favoriteStatus,favorite.button);root.append(favoriteBar);
    const sync=()=>{
        const linked=node.inputs?.some(i=>i.name==='text'&&i.link!=null);
        input.readOnly=linked;input.placeholder=linked?'等待上游生成并应用结果':'输入描述或提示词';
        const snapshot=textSnapshot(node,inputSnapshot);
        if(linked||document.activeElement!==input)input.value=snapshot.texts?.join('\n\n')||'';
        if(node.graph)node.setOutputData?.(0,snapshot.ready===false?null:input.value);
        favorite.sync();
    };
    input.addEventListener('input',()=>{if(node.mode)return;registration.invalidate();if(node.properties)delete node.properties.studioTextAsset;widget.value=input.value;widget.callback?.(input.value);node.graph?.change?.();node.graph?.setDirtyCanvas?.(true,true);});
    input.addEventListener('change',()=>{if(!input.readOnly)void registration.commit();});
    for(const type of ['pointerdown','dblclick','keydown','wheel'])root.addEventListener(type,stopCanvasPropagation);
    const fieldRelease=bindCreativeField(input),availabilityRelease=bindPanelAvailability(node,root);
    const panel=node.addDOMWidget('text_input','custom',root,{serialize:false,hideOnZoom:false,getValue:()=>'',setValue:sync,getMinHeight:()=>170});panel.serialize=false;
    const timer=setInterval(()=>{if(root.isConnected)sync();},500);
    node.__daeTextPanel={root,fields:[input],sync,registerSnapshot:()=>registration.commit(),invalidateSnapshot:()=>registration.invalidate(),destroy(){registration.dispose();clearInterval(timer);favorite.destroy();fieldRelease();availabilityRelease();root.remove();delete node.__daeTextPanel;}};
    node.setSize([350,220]);sync();
}
app.registerExtension({name:'DAELab.TextInput',nodeCreated(node){if(node.type===TYPE)install(node);},beforeRegisterNodeDef(type,definition){
    if(definition.name!==TYPE)return;
    for(const method of ['onNodeCreated','onConfigure']){const previous=type.prototype[method];type.prototype[method]=function(){const result=previous?.apply(this,arguments);install(this);this.__daeTextPanel?.invalidateSnapshot();this.__daeTextPanel?.sync();return result;};}
    const removed=type.prototype.onRemoved;type.prototype.onRemoved=function(){this.__daeTextPanel?.destroy();return removed?.apply(this,arguments);};
}});
