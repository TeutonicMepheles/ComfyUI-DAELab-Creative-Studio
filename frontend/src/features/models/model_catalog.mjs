export const MODEL_CATALOG_VERSION=1;
export const MODEL_STATUS=Object.freeze({
    checking:'checking',
    available:'available',
    unverified:'unverified',
    unavailable:'unavailable',
});

export const GENERATION_MODEL_DEFINITIONS=Object.freeze([
    {id:'Qwen-Image-2.1 Turbo（本地）',label:'Qwen-Image-2.1 Turbo（本地）',family:'generation',kind:'image',provider:'local'},
    {id:'GPT Image 2',label:'GPT Image 2',family:'generation',kind:'image',provider:'comfy'},
    {id:'GPT Image 2.5 Flare',label:'GPT Image 2.5 Flare',family:'generation',kind:'image',provider:'comfy'},
    {id:'GPT Image 2.5 Sunburst',label:'GPT Image 2.5 Sunburst',family:'generation',kind:'image',provider:'comfy'},
    {id:'Seedance 2.5',label:'Seedance 2.5',family:'generation',kind:'video',provider:'comfy'},
    {id:'Seedance 2.0',label:'Seedance 2.0',family:'generation',kind:'video',provider:'comfy'},
    {id:'Seedance 2.0 Fast',label:'Seedance 2.0 Fast',family:'generation',kind:'video',provider:'comfy'},
    {id:'Seedance 2.0 Mini',label:'Seedance 2.0 Mini',family:'generation',kind:'video',provider:'comfy'},
    {id:'Minimax H3',label:'Minimax H3',family:'generation',kind:'video',provider:'comfy'},
    {id:'MiniMax H3 FL（本地）',label:'MiniMax H3 FL（本地）',family:'generation',kind:'video',provider:'local'},
    {id:'MiniMax H3 Ref（本地）',label:'MiniMax H3 Ref（本地）',family:'generation',kind:'video',provider:'local'},
]);

export const OPTIMIZATION_MODEL_DEFINITIONS=Object.freeze([
    {id:'deepseek-flash',label:'DeepSeek API',family:'optimization',kind:'text',provider:'deepseek'},
    {id:'qwen3.5:9b-q4_K_M',label:'Qwen3.5-9B（本地）',family:'optimization',kind:'text',provider:'qwen'},
    {id:'gpt-6-luna',label:'GPT-6 Luna（Comfy）',family:'optimization',kind:'text',provider:'comfy'},
]);

export const MODEL_DEFINITIONS=Object.freeze([...GENERATION_MODEL_DEFINITIONS,...OPTIMIZATION_MODEL_DEFINITIONS]);
const byId=new Map(MODEL_DEFINITIONS.map(item=>[item.id,item]));

function publicEntry(entry){
    return Object.freeze({
        ...entry.definition,
        status:entry.status,
        available:entry.status===MODEL_STATUS.available||entry.status===MODEL_STATUS.unverified,
        checking:entry.status===MODEL_STATUS.checking,
        selectable:entry.status!==MODEL_STATUS.checking&&entry.status!==MODEL_STATUS.unavailable,
        capability:entry.capability,
    });
}

export function createModelCatalog({now=()=>Date.now(),log=()=>{}}={}){
    const entries=new Map(MODEL_DEFINITIONS.map(definition=>[definition.id,{definition,status:MODEL_STATUS.unverified,capability:null,code:null,checkedAt:null}])),listeners=new Set(),inFlight=new Map();
    const snapshot=filters=>{
        const family=filters?.family,kind=filters?.kind,provider=filters?.provider;
        return [...entries.values()].filter(entry=>(!family||entry.definition.family===family)&&(!kind||entry.definition.kind===kind)&&(!provider||entry.definition.provider===provider)).map(publicEntry);
    };
    const emit=()=>{const value=snapshot();for(const listener of [...listeners])listener(value);};
    function get(id){const entry=entries.get(id);return entry?publicEntry(entry):null;}
    function setStatus(id,status,{capability=null,code=null}={}){
        const entry=entries.get(id);if(!entry)return null;
        entry.status=status;entry.capability=capability;entry.code=code;entry.checkedAt=now();emit();return publicEntry(entry);
    }
    function check(id,probe,{force=false}={}){
        const entry=entries.get(id);if(!entry)throw new Error('未知逻辑模型');
        if(!force&&entry.checkedAt!=null)return Promise.resolve(publicEntry(entry));
        if(inFlight.has(id))return inFlight.get(id);
        entry.status=MODEL_STATUS.checking;entry.code=null;emit();
        const task=(async()=>{
            try{
                const result=await probe(entry.definition);
                const provider=result?.provider||entry.definition.provider;
                const status=result?.available===false?MODEL_STATUS.unavailable:provider==='deepseek'&&result?.deepseekKeyConfigured===false?MODEL_STATUS.unverified:MODEL_STATUS.available;
                return setStatus(id,status,{capability:result||null});
            }catch(error){
                const code=typeof error?.code==='string'&&/^[a-z0-9_.-]{1,80}$/i.test(error.code)?error.code:'model_probe_failed';
                log({version:MODEL_CATALOG_VERSION,provider:entry.definition.provider,model:id,stage:'probe',code,time:new Date(now()).toISOString()});
                return setStatus(id,MODEL_STATUS.unavailable,{code});
            }finally{inFlight.delete(id);}
        })();
        inFlight.set(id,task);return task;
    }
    async function refresh(probes,{force=false,filters={}}={}){
        const selected=snapshot(filters);
        await Promise.all(selected.map(item=>typeof probes==='function'?check(item.id,()=>probes(item),{force}):probes[item.id]?check(item.id,probes[item.id],{force}):null));
        return snapshot(filters);
    }
    function invalidate(filters={}){
        const family=filters.family,kind=filters.kind,provider=filters.provider;
        for(const entry of entries.values())if((!family||entry.definition.family===family)&&(!kind||entry.definition.kind===kind)&&(!provider||entry.definition.provider===provider)){
            entry.status=MODEL_STATUS.unverified;entry.capability=null;entry.code=null;entry.checkedAt=null;
        }
        emit();return snapshot(filters);
    }
    return {
        version:MODEL_CATALOG_VERSION,
        snapshot,
        get,
        check,
        refresh,
        invalidate,
        markUnavailable(id,code='model_rejected'){
            log({version:MODEL_CATALOG_VERSION,provider:byId.get(id)?.provider||'unknown',model:id,stage:'submit',code,time:new Date(now()).toISOString()});
            return setStatus(id,MODEL_STATUS.unavailable,{code});
        },
        subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},
    };
}

let sharedCatalog=null;
export function getModelCatalog(){
    sharedCatalog||=createModelCatalog({log:event=>console.error('[Creative Studio model catalog]',event)});
    return sharedCatalog;
}

export function resetModelCatalogForTests(){sharedCatalog=null;}
