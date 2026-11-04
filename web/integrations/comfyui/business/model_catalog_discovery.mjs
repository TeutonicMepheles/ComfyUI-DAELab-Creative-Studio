import {getModelCatalog} from '../../../features/models/model_catalog.mjs';
import {modelCapabilities} from '../../../features/generation/table_generation_api.mjs';
import {createPromptOptimizationApi} from '../../../features/prompt/prompt_optimization_api.mjs';
import {businessJson} from '../../../contracts/business.js';

let started=false,optimizationApi=null,definitionsLoaded=false,lastRefresh=0;

async function generationProbe(model){
    const capability=await modelCapabilities({kind:model.kind,model:model.id});
    return {...capability,available:capability?.available===true,provider:capability?.provider||model.provider};
}

async function optimizationProbe(model){
    if(model.id==='qwen-image-2.1-pe')return generationProbe(model);
    const capability=await optimizationApi.capabilities({model:model.id});
    const selected=capability?.models?.find(item=>item.id===model.id);
    return {...capability,...selected,available:selected?.available===true,provider:selected?.provider||model.provider};
}

export async function loadModelDefinitions(catalog,{force=false,request=businessJson}={}){
    if(definitionsLoaded&&!force)return;
    const result=await request('generation','models');
    catalog.replaceDefinitions(result.models);
    definitionsLoaded=true;
}

export async function refreshModelCatalog({force=false}={}){
    const catalog=getModelCatalog();
    optimizationApi||=createPromptOptimizationApi();
    await loadModelDefinitions(catalog,{force});
    lastRefresh=Date.now();
    return Promise.all([
        catalog.refresh(generationProbe,{force,filters:{family:'generation'}}),
        catalog.refresh(optimizationProbe,{force,filters:{family:'optimization'}}),
    ]);
}

/** Starts one page-owned, non-inference discovery. No GPU model or paid request is created. */
export function startModelCatalogDiscovery(){
    if(started)return;
    started=true;
    optimizationApi||=createPromptOptimizationApi();
    const catalog=getModelCatalog();
    const refresh=()=>{if(Date.now()-lastRefresh<1000)return;catalog.invalidate();void refreshModelCatalog({force:true}).catch(()=>{});};
    globalThis.addEventListener?.('online',refresh);
    globalThis.addEventListener?.('pageshow',refresh);
    globalThis.addEventListener?.('daelab:studio-reconnected',refresh);
    globalThis.document?.addEventListener('visibilitychange',()=>{if(globalThis.document.visibilityState==='visible')refresh();});
    void refreshModelCatalog().catch(()=>{});
}
