import {api} from '/scripts/api.js';
import {bindAssetLibraryService} from '../../application/asset_library_service.js';

const prefix='/daelab/studio/asset-library';
async function request(path,options={}){
    const response=await api.fetchApi(prefix+path,options);
    let body;try{body=await response.json();}catch{throw new Error('资产目录响应无法读取；请保留旧目录并重试');}
    if(!response.ok)throw new Error(body?.error?.message||'资产目录操作失败，未报告成功');
    if(body?.schemaVersion!==1)throw new Error('资产目录响应版本不兼容');
    return body;
}
const json=(value,signal)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),...(signal?{signal}:{})});
/** @type {import('../../contracts/assets.js').AssetLibraryPort} */
const service={
    async register(input,signal){return (await request('/register',json(input,signal))).registration;},
    async resolve(identity,signal){return (await request('/resolve',json(identity,signal))).registration;},
    search({q='',kind,limit=48,offset=0,signal}={}){
        const params=new URLSearchParams({q,limit:String(limit),offset:String(offset)});if(kind)params.set('kind',kind);
        return request('/favorites?'+params,{signal});
    },
    async lookup(input,signal){return (await request('/lookup',json(input,signal))).entry;},
    async save(input){return (await request('/favorites',json(input))).entry;},
    async remove(id){await request('/favorites/'+encodeURIComponent(id),{method:'DELETE'});},
    importLegacy(origin,document){return request('/import',json({origin,document}));},
};
export function installAssetServices(){return bindAssetLibraryService(service);}
