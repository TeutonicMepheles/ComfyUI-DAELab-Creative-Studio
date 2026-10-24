import {businessAuth,businessFetch} from '../../contracts/business.js';
import {optimizationProvider} from './prompt_optimization_model.mjs';

// This module lives only in this page. Never expose the value through state,
// serialized payloads, preferences, storage, or diagnostic messages.
let pageDeepSeekKey='';
const keyListeners=new Set();
const keyChanged=()=>{for(const fn of keyListeners)fn(Boolean(pageDeepSeekKey));};

/** Contract K. Only the native account's transient auth reaches local headers. */
export async function nativeOptimizationAuth({required=false}={}){return businessAuth(required);}

export function createPromptOptimizationApi({fetchApi, getAuth} = {}) {
  let serverDeepSeekKeyConfigured=false;
  const batchProviders=new Map();

  const fetcher = fetchApi || businessFetch;
  async function call(action, payload = {}, {beforeSend,localOnly=false} = {}) {
    const headers = {'Content-Type': 'application/json'};
    const provider=payload.provider||batchProviders.get(payload.batchId)||optimizationProvider(payload.model);
    let auth;
    if(provider==='deepseek'&&action==='advance'){
      if(!pageDeepSeekKey&&!serverDeepSeekKeyConfigured)throw new Error('请先保存本页 DeepSeek API 密钥，或配置服务器 DEEPSEEK_API_KEY，再点击继续剩余行');
      if(pageDeepSeekKey)headers['X-DAELab-DeepSeek-Key']=pageDeepSeekKey;
    }else if (provider==='comfy'&&!localOnly&&['advance', 'query', 'recover'].includes(action)) {
      auth = getAuth ? await getAuth() : await nativeOptimizationAuth({required:action==='advance'});
      if (auth?.headers?.Authorization) headers.Authorization=auth.headers.Authorization;
      else if(auth?.headers?.['X-API-Key']) headers['X-API-Key']=auth.headers['X-API-Key'];
      else if (auth?.authToken) headers.Authorization = `Bearer ${auth.authToken}`;
      else if (auth?.apiKey) headers['X-API-Key'] = auth.apiKey;
    }
    auth?.assertCurrent?.();
    if(beforeSend&&beforeSend()===false)throw new Error('当前视图或目标已变化，未发送请求');
    let response;
    try { response = await fetcher(`/daelab/prompt-optimization/${action}`, {
      method: 'POST', headers, body: JSON.stringify({...payload,...(provider!=='comfy'?{provider}:{}),contractVersion: 1}),
    }); } catch(error) {
      if(error?.code==='business-capability-unavailable')throw error;
      if(provider==='deepseek')throw new Error('DeepSeek 请求连接中断；请查询原任务，不要自动重新提交');
      throw error;
    }
    let result;
    try { result = await response.json(); }
    catch { throw new Error('优化服务响应无效；已有任务请恢复查询'); }
    if (!response.ok || result.error && !result.batchId) {
      const message=result.error||'优化服务暂不可用';
      const error=new Error(pageDeepSeekKey?String(message).replaceAll(pageDeepSeekKey,'[已隐藏]'):message);error.code=result.code;error.status=response.status;error.originalTaskMayExist=result.originalTaskMayExist!==false;throw error;
    }
    if(action==='capabilities')serverDeepSeekKeyConfigured=Boolean(result.deepseekKeyConfigured);
    if(result.batchId){const model=result.rows?.[0]?.snapshot?.model;if(model)batchProviders.set(result.batchId,optimizationProvider(model));}
    return result;
  }
  return {...Object.fromEntries(['capabilities', 'estimate', 'lease', 'submit', 'query', 'recover',
    'permit', 'advance', 'stop', 'continue', 'skip', 'fence'].map(name => [name, (payload,options) => call(name, payload,options)])),
    setDeepSeekKey(value){pageDeepSeekKey=String(value||'').trim();keyChanged();return Boolean(pageDeepSeekKey);},
    clearDeepSeekKey(){pageDeepSeekKey='';keyChanged();return false;},
    hasDeepSeekKey:()=>Boolean(pageDeepSeekKey),
    subscribeDeepSeekKey(fn){keyListeners.add(fn);return()=>keyListeners.delete(fn);},
  };
}
