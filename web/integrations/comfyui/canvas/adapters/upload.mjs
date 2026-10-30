import {registerAdapter} from '../../../../canvas/creative_contract.mjs';
import {readAsset} from '../../../../features/assets/media_upload_model.mjs';
registerAdapter('daelab.upload', {
    matches: node => node.type === 'DAELAB.MediaUpload', width:350, expanded:true,
    menu:[{label:'上传元素',type:'DAELAB.MediaUpload',icon:'upload-2-line'}],
    inputLabels:{source_report:'来源任务'},
    canConnectInput:node=>!!node.properties?.generationOutput&&node.properties.generationOutput.groupId==null,
    prepareCopy(node,data){if(data.properties){delete data.properties.generationOutput;if(data.properties.materialPlaceholder)data.properties.materialPlaceholder={phase:'stopped',label:'副本未绑定任务',detail:'请从生成节点重新生成',busy:false};}},
    tasks: node => node.__mediaUpload?.tasks()||[],
    panel: node => node.__mediaUpload,
    refresh: node => node.__mediaUpload?.render(),
    upload: (node,file) => node.__mediaUpload.upload(file),
    assets: node => {const asset=readAsset(node.widgets?.find(w=>w.name==='asset_data')?.value);return {version:1,assets:asset?[asset]:[]};},
});
