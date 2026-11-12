import {businessFetch,businessAuth} from '../../contracts/business.js';
// Only spoken text is protected here; quotations on signs or props remain scene text.
function spokenLines(source){
    const lines=[];
    const speech=/<d>(?:\[[^\]\n]+\])?([^<]+)<\/d>|(?:说(?:道)?|问(?:道)?|喊(?:道)?|答(?:道)?|回答|对白|台词)\s*(?:[：:]\s*)?(?:“([^”<]+)”|「([^」<]+)」|『([^』<]+)』|"([^"<\n]+)")|(?:说道|问道|喊道|答道|回答|说|问|喊|对白|台词)[：:]\s*([^“「『"<\s][^。！？!?\n]*)|(?:说|喊)\s*((?:你好|您好|谢谢|再见)[^。！？!?，,\n]*)/gu;
    for(const match of source.matchAll(speech)){
        const words=match.slice(1).find(value=>value!==undefined)?.trim();
        if(!words)continue;
        const start=match.index+match[0].lastIndexOf(words);
        lines.push({words,start,tagged:match[1]!==undefined});
    }
    return lines;
}
function keepsSpokenLines(result,lines){
    const spoken=Array.from(result.matchAll(/<d>\s*(?:\[[^\]\n]+\])?([^<]*)<\/d>/gu),m=>m[1].trim());
    let index=0;
    for(const text of spoken){
        const words=lines[index]?.words;
        if(text===words||text.replace(/[。！？!?]+$/u,'')===words)index++;
    }
    return index===lines.length;
}
function tagChineseDialogue(source,lines){
    let scene=source;
    for(const {start,words,tagged} of [...lines].reverse()){
        if(tagged||!/[\p{Script=Han}]/u.test(words)||/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(words))continue;
        scene=scene.slice(0,start)+'<d>[Chinese]'+words+'</d>'+scene.slice(start+words.length);
    }
    return scene;
}
export async function optimizeRow(row,mode,instruction,{fetcher=businessFetch,model='qwen',requestId=crypto.randomUUID(),sourceScope,purpose}={}){
    model=({'qwen3.5:9b-q4_K_M':'qwen','gpt-6-luna':'gpt-6-luna',qwen:'qwen'})[model]||model;
    if(!['qwen','gpt-6-luna','qwen-image-2.1-pe','qwen3.8-27b-w4a8'].includes(model))throw new Error('不支持的模型提供者');
    if(model==='qwen-image-2.1-pe'&&mode!=='reverse')throw new Error('PE 需要参考图文本增强模式');
    let imageDataUrl;
    if(mode==='reverse'){
        const url=row.image?.url;
        if(!url||(!url.startsWith('/view?')&&!/^data:image\/(png|jpeg|webp);base64,/.test(url)))throw new Error('请使用本地参考图片');
        const response=await fetcher(url);if(!response.ok)throw new Error('参考图片读取失败');
        const blob=await response.blob();if(blob.size>8*1024*1024)throw new Error('参考图片超过 8 MB');
        imageDataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('参考图片读取失败'));reader.readAsDataURL(blob);});
    }
    const lines=mode==='polish'&&purpose==='video-minimax'?spokenLines(row.text||''):[];
    if(lines.length){
        const verbatim='镜头中依次说出的原话（逐句照录）'+JSON.stringify(lines.map(line=>line.words));
        if(instruction.length+verbatim.length+1<=4000)instruction+='\n'+verbatim;
    }
    const headers={'Content-Type':'application/json'};
    if(model==='gpt-6-luna'){
        const auth=await businessAuth(true);
        if(auth?.headers?.Authorization)headers.Authorization=auth.headers.Authorization;
        else if(auth?.headers?.['X-API-Key'])headers['X-API-Key']=auth.headers['X-API-Key'];
        else if(auth?.authToken)headers.Authorization=`Bearer ${auth.authToken}`;
        else if(auth?.apiKey)headers['X-API-Key']=auth.apiKey;
        else throw new Error('请先登录 Comfy 账户；GPT 文本生成使用 Comfy 积分');
        auth?.assertCurrent?.();
    }
    const response=await fetcher('/daelab/prompt-optimization/polish',{method:'POST',headers,body:JSON.stringify({contractVersion:1,requestId,model,mode,purpose,source:row.text||'',instruction,imageDataUrl,...(sourceScope?{sourceScope}:{})})});
    const data=await response.json();
    if(!response.ok&&['qwen-image-2.1-pe','qwen3.8-27b-w4a8'].includes(model)&&data.error==='incomplete_text_response')throw new Error('本地模型输出未完成或达到长度上限，结果未应用');
    if(!response.ok)throw new Error(data.error||'模型请求失败，未自动重试');
    if(data.requestId!==requestId||typeof data.result!=='string'||!data.result.trim())throw new Error('返回结果无效，未自动重试');
    if(sourceScope){const same=Object.keys(sourceScope).every(key=>data.source?.[key]===sourceScope[key]);if(!same||data.state!=='succeeded'||data.receipt?.kind!=='text'||data.receipt.text!==data.result||!/^[a-f0-9]{64}$/.test(data.inputFingerprint||''))throw new Error('返回回执身份不一致，结果未应用');}
    let result=data.result;
    if(mode==='polish'&&purpose==='video-seedance'){
        // Drop an added two-person roll call only when both descriptions recur in the scene.
        const cast=result.match(/^\s*(?:一个|一名|一位)([\p{Script=Han}]+?)(?:和|与)(?:一个|一名|一位)([\p{Script=Han}]+)。\s*/u);
        if(cast&&!row.text?.includes(cast[0].trim())){
            const scene=result.slice(cast[0].length);
            if(cast[1]!==cast[2]&&scene.startsWith(cast[1])&&scene.includes(cast[2]))result=scene;
        }
        // Some models return attributed dialogue in ordinary quotation marks.
        result=result.replace(/((?:说道?|问道?|喊道?|答道?|回答|对白|台词)\s*[：:]?\s*)(?:“([^”\n{}]+)”|「([^」\n{}]+)」|"([^"\n{}]+)")/gu,
            (_,speaker,curly,corner,straight)=>speaker+'{'+(curly??corner??straight)+'}');
    }
    let dialogueFallback=false;
    if(lines.length&&!keepsSpokenLines(result,lines)){
        result=tagChineseDialogue(result,spokenLines(result));
        if(!keepsSpokenLines(result,lines)){
            result=tagChineseDialogue(row.text,lines);
            dialogueFallback=true;
        }
    }
    return {...row,result,...(dialogueFallback?{dialogueFallback}:{}),status:'completed',requestId,model:data.model,usage:data.usage};
}
