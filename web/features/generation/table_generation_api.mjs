import {businessJson} from '../../contracts/business.js';
import {isLocalGenerationModel,isComfyGenerationModel} from './table_generation_model.mjs';

export async function request(action,body){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),action==='submit'?120000:30000);
 try{
 return await businessJson('generation',action,body?{contractVersion:1,...body}:undefined,controller.signal);
 }catch(error){if(error.name==='AbortError')throw new Error('请求超时；原任务仍保留，请刷新任务状态，不要重复生成');throw error;}
 finally{clearTimeout(timer);}
}
export async function modelCapabilities(config){
 const local=isLocalGenerationModel(config.model);
 const restart='本地模型服务尚未加载，请重启 ComfyUI 后刷新页面；本地模型无需云端积分。';
 try{
  const caps=await request('capabilities?'+new URLSearchParams({kind:config.kind,model:config.model}));
  if(local&&caps.local!==true)throw new Error(restart);
  // Also enforce the capability contract against already-running older backends.
  if(local&&caps.schema)caps.schema.config={...caps.schema.config,strictModes:true};
  if(isComfyGenerationModel(config.model)&&caps.provider!=='comfy')throw new Error('Comfy 积分生成服务尚未加载，请重启 ComfyUI 后刷新；未提交生成');
  return caps;
 }catch(error){if(local&&error.message==='Unsupported model')throw new Error(restart);throw error;}
}
