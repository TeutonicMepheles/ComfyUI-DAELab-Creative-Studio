import {businessFetch,businessAuth} from '../../contracts/business.js';
// Provider adapter only; UI, review, apply and undo stay in the shared IO panel.
export async function optimizeRow(row,mode,instruction,{fetcher=businessFetch,model='qwen',requestId=crypto.randomUUID(),sourceScope}={}){
    if(!['qwen','deepseek','gpt-6-luna'].includes(model))throw new Error('不支持的模型提供者');
    let imageDataUrl;
    if(mode==='reverse'){
        const url=row.image?.url;
        if(!url||(!url.startsWith('/view?')&&!/^data:image\/(png|jpeg|webp);base64,/.test(url)))throw new Error('请使用本地参考图片');
        const response=await fetcher(url);if(!response.ok)throw new Error('参考图片读取失败');
        const blob=await response.blob();if(blob.size>8*1024*1024)throw new Error('参考图片超过 8 MB');
        imageDataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('参考图片读取失败'));reader.readAsDataURL(blob);});
    }
    const headers={'Content-Type':'application/json'};
    if(model==='gpt-6-luna'){
        const auth=await businessAuth(true);
        if(auth?.headers?.Authorization)headers.Authorization=auth.headers.Authorization;
        else if(auth?.headers?.['X-API-Key'])headers['X-API-Key']=auth.headers['X-API-Key'];
        else if(auth?.authToken)headers.Authorization=`Bearer ${auth.authToken}`;
        else if(auth?.apiKey)headers['X-API-Key']=auth.apiKey;
        else throw new Error('请先登录 ComfyUI 账户；GPT 优化使用 Comfy 积分');
        auth?.assertCurrent?.();
    }
    const response=await fetcher('/daelab/prompt-optimization/polish',{method:'POST',headers,body:JSON.stringify({contractVersion:1,requestId,model,mode,source:row.text||'',instruction,imageDataUrl,...(sourceScope?{sourceScope}:{})})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'模型请求失败，未自动重试');
    if(data.requestId!==requestId||typeof data.result!=='string'||!data.result.trim())throw new Error('返回结果无效，未自动重试');
    if(sourceScope){const same=Object.keys(sourceScope).every(key=>data.source?.[key]===sourceScope[key]);if(!same||data.state!=='succeeded'||data.receipt?.kind!=='text'||data.receipt.text!==data.result||!/^[a-f0-9]{64}$/.test(data.inputFingerprint||''))throw new Error('返回回执身份不一致，结果未应用');}
    return {...row,result:data.result,status:'completed',requestId,model:data.model,usage:data.usage};
}
