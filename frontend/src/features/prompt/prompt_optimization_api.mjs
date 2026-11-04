import {businessAuth,businessFetch} from '../../contracts/business.js';
import {optimizationProvider} from './prompt_optimization_model.mjs';

/** Contract K. Only the native account's transient auth reaches local headers. */
export async function nativeOptimizationAuth({required=false}={}){return businessAuth(required);}

export function createPromptOptimizationApi({fetchApi, getAuth} = {}) {
  const batchProviders=new Map();

  const fetcher = fetchApi || businessFetch;
  async function call(action, payload = {}, {beforeSend,localOnly=false} = {}) {
    const headers = {'Content-Type': 'application/json'};
    const provider=payload.provider||batchProviders.get(payload.batchId)||optimizationProvider(payload.model);
    if(provider==='deepseek'&&!['query','stop','fence'].includes(action))throw new Error('已保存的模型已不可用，请显式选择可用模型');
    let auth;
    if (provider==='comfy'&&!localOnly&&['advance', 'query', 'recover'].includes(action)) {
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
      throw error;
    }
    let result;
    try { result = await response.json(); }
    catch { throw new Error('优化服务响应无效；已有任务请恢复查询'); }
    if (!response.ok || result.error && !result.batchId) {
      const message=result.error||'优化服务暂不可用';
      const error=new Error(message);error.code=result.code;error.status=response.status;error.originalTaskMayExist=result.originalTaskMayExist!==false;throw error;
    }
    if(result.batchId){const model=result.rows?.[0]?.snapshot?.model;if(model)batchProviders.set(result.batchId,optimizationProvider(model));}
    return result;
  }
  return {...Object.fromEntries(['capabilities', 'estimate', 'lease', 'submit', 'query', 'recover',
    'permit', 'advance', 'stop', 'interrupt', 'continue', 'skip', 'fence'].map(name => [name, (payload,options) => call(name, payload,options)])),

  };
}
