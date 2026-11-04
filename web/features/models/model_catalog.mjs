export const MODEL_CATALOG_VERSION=1;
export const MODEL_STATUS=Object.freeze({
    checking:'checking',
    available:'available',
    unverified:'unverified',
    unavailable:'unavailable',
    unknown:'unknown',
});

export const GENERATION_MODEL_DEFINITIONS=Object.freeze([
    {id:'Qwen-Image-2.1 Turbo（本地）',label:'Qwen-Image-2.1 Turbo（本地）',family:'generation',kind:'image',provider:'local'},
    {id:'Qwen-Image-2.1（本地）',label:'Qwen-Image-2.1（本地）',family:'generation',kind:'image',provider:'local'},
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
    {id:'MiniMax H3 FL 低配（本地）',label:'MiniMax H3 FL 低配（本地）',family:'generation',kind:'video',provider:'local'},
    {id:'MiniMax H3 Ref 低配（本地）',label:'MiniMax H3 Ref 低配（本地）',family:'generation',kind:'video',provider:'local'},
    {id:'MiniMax H3 FL 高配（本地）',label:'MiniMax H3 FL 高配（本地）',family:'generation',kind:'video',provider:'local'},
    {id:'MiniMax H3 Ref 高配（本地）',label:'MiniMax H3 Ref 高配（本地）',family:'generation',kind:'video',provider:'local'},
]);

export const OPTIMIZATION_MODEL_DEFINITIONS=Object.freeze([
    {id:'qwen3.8-27b-w4a8',label:'Qwen3.8-27B（本地）',family:'optimization',kind:'text',provider:'local'},
    {id:'qwen-image-2.1-pe',label:'Qwen-Image-2.1 PE（本地）',family:'optimization',kind:'text',provider:'local'},
    {id:'qwen3.5:9b-q4_K_M',label:'Qwen3.5-9B（本地）',family:'optimization',kind:'text',provider:'qwen'},
    {id:'gpt-6-luna',label:'GPT-6 Luna（Comfy）',family:'optimization',kind:'text',provider:'comfy'},
]);

export const MODEL_DEFINITIONS=Object.freeze([...GENERATION_MODEL_DEFINITIONS,...OPTIMIZATION_MODEL_DEFINITIONS]);

function publicEntry(entry){
    return Object.freeze({
        ...entry.definition,
        status:entry.status,
        available:entry.status===MODEL_STATUS.available,
        checking:entry.status===MODEL_STATUS.checking,
        selectable:entry.status!==MODEL_STATUS.checking&&entry.status!==MODEL_STATUS.unavailable&&entry.status!==MODEL_STATUS.unknown,
        capability:entry.capability,
        code:entry.code,
    });
}

export const PROBE_RECHECK_DELAYS=Object.freeze([2000,5000]);

export function classifyModelProbeError(error){
    const code=error?.code,reason=error?.reason;
    if(code==='probe_aborted'||reason==='panel-closed'||reason==='target-replaced')return {code:'probe_aborted',status:null};
    if(code==='probe_timeout'||reason==='probe_timeout')return {code:'probe_timeout',status:MODEL_STATUS.unknown};
    if(code==='provider_unavailable'||['probe_model_missing','probe_model_hash_mismatch','probe_bind_missing','unsupported_model','invalid_model_capability'].includes(code))return {code,status:MODEL_STATUS.unavailable};
    if(code==='probe_transport_error'||error instanceof TypeError||/^(ECONNRESET|ECONNREFUSED|ENETUNREACH|ETIMEDOUT)$/.test(code||'')||/network|socket|connection reset|failed to fetch/i.test(error?.message||''))return {code:'probe_transport_error',status:MODEL_STATUS.unknown};
    return {code:'probe_unknown_error',status:MODEL_STATUS.unknown};
}

export function createModelCatalog({now=()=>Date.now(),log=()=>{},recheckDelays=PROBE_RECHECK_DELAYS}={}){
    const entries=new Map(MODEL_DEFINITIONS.map(definition=>[definition.id,{definition,status:MODEL_STATUS.unverified,capability:null,code:null,checkedAt:null}])),listeners=new Set(),inFlight=new Map(),rechecks=new Map();
    const probes=new Map();
    const current=operation=>entries.get(operation.id)===operation.entry&&operation.owners.some(owner=>owner());
    function clearRecheck(id){const timer=rechecks.get(id);if(timer!==undefined)clearTimeout(timer);rechecks.delete(id);}
    function scheduleRecheck(operation){
        const attempt=operation.attempt;
        if(attempt>=recheckDelays.length||!current(operation))return;
        clearRecheck(operation.id);
        const timer=setTimeout(()=>{
            rechecks.delete(operation.id);
            if(!current(operation)||operation.entry.status!==MODEL_STATUS.unknown)return;
            check(operation.id,operation.probe,{force:true,active:()=>operation.owners.some(owner=>owner()),attempt:attempt+1}).catch(()=>{});
        },recheckDelays[attempt]);
        timer?.unref?.();rechecks.set(operation.id,timer);
    }
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
    function record(id,result){
        const entry=entries.get(id);if(!entry)return null;
        if(!result||typeof result!=='object'||Array.isArray(result)||typeof result.available!=='boolean'){
            const code='invalid_model_capability';
            log({version:MODEL_CATALOG_VERSION,provider:entry.definition.provider,model:id,stage:'probe',code,time:new Date(now()).toISOString()});
            return setStatus(id,MODEL_STATUS.unavailable,{code});
        }
        const provider=result?.provider||entry.definition.provider;
        const status=result.available===false?MODEL_STATUS.unavailable:MODEL_STATUS.available;
        return setStatus(id,status,{capability:result||null});
    }
    function check(id,probe,{force=false,active=()=>true,attempt=0}={}){
        const entry=entries.get(id);if(!entry)throw new Error('未知逻辑模型');
        const running=inFlight.get(id);
        if(running?.entry===entry){running.owners.push(active);return running.task;}
        if(!active())return Promise.resolve(publicEntry(entry));
        if(!force&&entry.checkedAt!=null)return Promise.resolve(publicEntry(entry));
        clearRecheck(id);probes.set(id,probe);
        const operation={id,entry,probe,attempt,owners:[active],task:null,previous:{status:entry.status,capability:entry.capability,code:entry.code,checkedAt:entry.checkedAt}};
        entry.status=MODEL_STATUS.checking;entry.code=null;
        const task=Promise.resolve().then(async()=>{
            try{
                if(!current(operation))return get(id);
                const result=await probe(entry.definition);
                if(!current(operation))return get(id);
                return record(id,result);
            }catch(error){
                if(!current(operation))return get(id);
                const failure=classifyModelProbeError(error);
                if(failure.code==='probe_aborted'){Object.assign(entry,operation.previous);emit();return get(id);}
                log({version:MODEL_CATALOG_VERSION,provider:entry.definition.provider,model:id,stage:'probe',code:failure.code,time:new Date(now()).toISOString()});
                const next=setStatus(id,failure.status,{code:failure.code});
                if(failure.status===MODEL_STATUS.unknown)scheduleRecheck(operation);
                return next;
            }finally{if(inFlight.get(id)===operation){inFlight.delete(id);if(!current(operation)&&entries.get(id)===entry&&entry.status===MODEL_STATUS.checking){Object.assign(entry,operation.previous);emit();}}}
        });
        operation.task=task;inFlight.set(id,operation);emit();return task;
    }
    function retry(id,{active=()=>true}={}){
        const probe=probes.get(id);
        if(!probe)throw new Error('模型检测尚未就绪');
        return check(id,probe,{force:true,active});
    }
    async function refresh(probes,{force=false,filters={}}={}){
        const selected=snapshot(filters);
        await Promise.all(selected.map(item=>typeof probes==='function'?check(item.id,()=>probes(item),{force}):probes[item.id]?check(item.id,probes[item.id],{force}):null));
        return snapshot(filters);
    }
    function invalidate(filters={}){
        const family=filters.family,kind=filters.kind,provider=filters.provider;
        for(const entry of entries.values())if((!family||entry.definition.family===family)&&(!kind||entry.definition.kind===kind)&&(!provider||entry.definition.provider===provider)){
            if(inFlight.get(entry.definition.id)?.entry===entry)continue;
            clearRecheck(entry.definition.id);
            entry.status=MODEL_STATUS.unverified;entry.capability=null;entry.code=null;entry.checkedAt=null;
        }
        emit();return snapshot(filters);
    }
    function replaceDefinitions(definitions){
        if(!Array.isArray(definitions)||!definitions.length)throw new Error('模型目录不能为空');
        const next=new Map();
        for(const definition of definitions){
            if(definition?.provider==='deepseek'||String(definition?.id||'').startsWith('deepseek'))continue;
            if(!definition||typeof definition.id!=='string'||!definition.id||next.has(definition.id)
                    ||!['generation','optimization'].includes(definition.family)
                    ||!['text','image','video'].includes(definition.kind)
                    ||typeof definition.provider!=='string'||!definition.provider)throw new Error('模型目录定义无效');
            const previous=entries.get(definition.id);
            const label=definition.label||'未知模型';
            const sameBinding=previous&&previous.definition.provider===definition.provider
                &&previous.definition.family===definition.family&&previous.definition.kind===definition.kind;
            if(sameBinding)previous.definition={...definition,label};
            else clearRecheck(definition.id);
            next.set(definition.id,sameBinding?previous:{
                definition:{...definition,label},status:MODEL_STATUS.unverified,capability:null,code:null,checkedAt:null,
            });
        }
        for(const id of entries.keys())if(!next.has(id)){clearRecheck(id);probes.delete(id);}
        entries.clear();for(const [id,entry] of next)entries.set(id,entry);emit();return snapshot();
    }
    return {
        version:MODEL_CATALOG_VERSION,
        snapshot,
        get,
        record,
        check,
        retry,
        replaceDefinitions,
        refresh,
        invalidate,
        markUnavailable(id,code='model_rejected'){
            log({version:MODEL_CATALOG_VERSION,provider:entries.get(id)?.definition.provider||'unknown',model:id,stage:'submit',code,time:new Date(now()).toISOString()});
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
