/** Native Comfy uploads, bounded by the running host's advertised policy. */
export async function uploadMedia(fetchNative:(url:string,options?:RequestInit)=>Promise<Response>,file:Pick<File,'size'>,body:FormData,options:RequestInit={}):Promise<Response>{
    let maximum:number|null=null;
    try{
        const response=await fetchNative('/features',{signal:options.signal??null});
        if(response.ok){
            const value=(await response.json()).max_upload_size;
            if(typeof value==='number'&&Number.isFinite(value)&&value>=0)maximum=Math.round(value);
        }
    }catch(error){if(error instanceof Error&&error.name==='AbortError')throw error;}
    const tooLarge=(limit:number|null)=>{
        const policy=limit!==null&&limit>0?`宿主上传请求上限为 ${Math.round(limit/1024/1024*100)/100} MiB（含表单开销）`:'超出宿主或代理的上传大小上限';
        return new Error(`文件过大（${(file.size/1024/1024).toFixed(2)} MiB），${policy}。请压缩视频或选择较小文件后重试；如需更大文件，请联系管理员调整上传上限。`);
    };
    if(maximum!==null&&maximum>0&&file.size>=maximum)throw tooLarge(maximum);
    const response=await fetchNative('/upload/image',{...options,method:'POST',body});
    if(response.status===413){
        const text=await response.text().catch(()=>'');
        const actual=Number(/Maximum request body size (\d+) exceeded\./.exec(text)?.[1]);
        // A reverse proxy may impose a lower limit; never expose its raw HTML.
        throw tooLarge(Number.isSafeInteger(actual)&&actual>0?actual:null);
    }
    return response;
}
