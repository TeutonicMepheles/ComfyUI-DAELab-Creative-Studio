import type { ExportBinding } from '../../../contracts/media_exports.js';

const UPLOAD = 'DAELAB.MediaUpload', KEY = 'daelabCreativeCanvasV1';

/** Materialize a verified export once; the saved media remains independent of later edits. */
export function createEditorOutputs(node:any, app:any, history:any, createNode:(type:string)=>any, ready:()=>boolean) {
  let disposed=false;
  return {
    publish(binding:ExportBinding|undefined) {
      const graph=node.graph;
      if(!binding||disposed||!ready()||!graph||app.graph!==graph||graph.getNodeById(node.id)!==node)return false;
      const ref=binding.reference,asset=binding.asset,output=binding.output;
      if(ref?.source.documentId!==String(graph.id)||ref.source.nodeId!==String(node.id))return false;
      if(!ref.requestId||!asset?.asset_id||!asset.reference_id||!output?.filename||output.type!=='output')throw new Error('成片回执不完整，未输出素材');
      if(Object.hasOwn(node.properties.daelabEditOutputs||{},ref.requestId))return true;
      const saved=(graph._nodes||[]).find((item:any)=>item.type===UPLOAD&&item.properties?.editOutput?.requestId===ref.requestId&&item.properties.editOutput.nodeId===String(node.id));
      let target:any=null;
      history.amend(()=>{
        graph.extra||={};const canvas=graph.extra[KEY]||={version:1,active:false,viewport:{x:60,y:60,zoom:.8},cards:{}};canvas.cards||={};
        try{
          if(!saved){
            target=createNode(UPLOAD);if(!target)throw new Error('素材节点尚未加载');
            graph.add(target);
            const widget=target.widgets?.find((item:any)=>item.name==='asset_data'),input=target.inputs?.findIndex((slot:any)=>slot.name==='source_video'),index=node.outputs?.findIndex((slot:any)=>slot.name==='video_ref'||slot.type==='COMFYTV_VIDEO');
            if(!widget||input==null||input<0||index==null||index<0)throw new Error('成片素材接口尚未就绪');
            widget.value=JSON.stringify({version:1,id:asset.reference_id,kind:'video',name:output.filename,...output,assetId:asset.asset_id,referenceId:asset.reference_id,contentSha256:asset.sha256,byteSize:asset.bytes,provenance:{operation:'video_export',requestId:ref.requestId,fingerprint:binding.fingerprint,inputDigest:ref.inputDigest,source:{...ref.source}}});
            target.title='剪辑成片';target.properties.editOutput={nodeId:String(node.id),documentId:String(graph.id),requestId:ref.requestId,assetId:asset.asset_id,referenceId:asset.reference_id};
            const origin=canvas.cards[node.id]||{x:node.pos[0],y:node.pos[1],width:840};
            let x=origin.x+origin.width+100;const y=origin.y;
            for(let attempts=0;attempts<1000&&Object.entries(canvas.cards).some(([id,c]:[string,any])=>String(id)!==String(target.id)&&x<c.x+c.width+24&&x+350+24>c.x&&y<c.y+(c.height||graph.getNodeById(id)?.size?.[1]||260)+24&&y+220+24>c.y);attempts++)x+=380;
            target.pos=[x,y];canvas.cards[target.id]={x,y,width:350,expanded:true};
            if(!node.connect(index,target,input))throw new Error('无法连接剪辑成片素材');
            target.__mediaUpload?.reload?.();
          }
          node.properties.daelabEditOutputs={...node.properties.daelabEditOutputs,[ref.requestId]:{nodeId:(saved||target).id,referenceId:asset.reference_id}};
          graph.change?.();graph.setDirtyCanvas?.(true,true);app.daelabCreativeCanvas?.sync?.();
        }catch(error){if(target){graph.remove(target);delete canvas.cards[target.id];}throw error;}
      });
      return true;
    },
    dispose(){disposed=true;}
  };
}
