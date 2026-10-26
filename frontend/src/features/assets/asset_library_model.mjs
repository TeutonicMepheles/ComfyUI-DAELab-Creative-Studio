// Pure display normalization plus injected server catalog. Browser storage is legacy read-only.
import {searchFavorites,lookupFavorite as lookup,saveFavorite as save,removeFavorite as remove,importLegacyFavorites,subscribeAssetLibrary,createAssetRequestScope} from '../../application/asset_library_service.js';
export {createAssetRequestScope};
export const LIBRARY_KEY='DAELAB.CreativeCanvas.AssetLibrary.v1';
export const LIBRARY_EVENT='daelab:asset-library-changed';
export const MAX_ENTRIES=2000;
const clone=value=>JSON.parse(JSON.stringify(value));
export function normalizeAsset(input){
    if(!input||typeof input!=='object')throw new Error('无效素材');
    const name=String(input.name||'未命名素材').trim().slice(0,240)||'未命名素材';
    const source=input.source?{source:clone(input.source)}:{};
    if(input.kind==='text'){
        if(typeof input.text!=='string'||!input.text.trim())throw new Error('空文本不能收藏');
        if(input.text.length>100000)throw new Error('文本过长，请拆分后收藏');
        return {kind:'text',name,text:input.text,...source};
    }
    const a=input.asset||input;
    const filename=a.filename,subfolder=a.subfolder||'',type=a.type||'input';
    if(typeof filename!=='string'||!filename||filename.length>512||/[\\/\x00]/.test(filename)||filename==='..')throw new Error('素材文件名无效');
    if(typeof subfolder!=='string'||subfolder.length>1024||subfolder.startsWith('/')||/[\\:\x00]/.test(subfolder)||subfolder.split('/').includes('..'))throw new Error('素材目录无效');
    if(!['input','output'].includes(type))throw new Error('只支持本地输入或输出素材');
    const kind=/\.(png|jpe?g|webp)$/i.test(filename)?'image':/\.(mp4|webm|mov)$/i.test(filename)?'video':null;
    if(!kind||kind!==a.kind)throw new Error('不支持的素材格式');
    const identity={};for(const key of ['assetId','referenceId','contentSha256','byteSize'])if(a[key]!==undefined)identity[key]=a[key];
    return {kind,name,asset:{version:1,kind,name,filename,subfolder:subfolder==='.'?'':subfolder,type,...identity},...source};
}
export function assetKey(input){const a=normalizeAsset(input);return JSON.stringify(a.kind==='text'?['text',a.text]:[a.kind,a.asset.type,a.asset.subfolder,a.asset.filename]);}
export function readLegacyLibrary(storage=globalThis.localStorage){
    const raw=storage.getItem(LIBRARY_KEY);if(!raw)return [];
    let data;try{data=JSON.parse(raw);}catch{throw new Error('收藏目录无法读取；原数据已保留，请勿清除站点数据');}
    if(data?.version!==1||!Array.isArray(data.entries))throw new Error('收藏目录版本不兼容，原数据已保留');
    const seen=new Set();
    return data.entries.map(entry=>{
        const a=normalizeAsset(entry),key=assetKey(a);
        if(typeof entry.id!=='string'||!entry.id||seen.has(key))throw new Error('收藏目录格式异常，原数据已保留');
        seen.add(key);return {...a,id:entry.id,createdAt:Number(entry.createdAt)||0};
    });
}

export function readLegacyDocument(storage=globalThis.localStorage){
    const raw=storage.getItem(LIBRARY_KEY);if(!raw)return {version:1,entries:[]};
    let document;try{document=JSON.parse(raw);}catch{throw new Error('旧收藏目录无法读取，原数据已保留');}
    if(document?.version!==1||!Array.isArray(document.entries)||document.entries.length>MAX_ENTRIES)throw new Error('旧收藏目录版本或数量不兼容，原数据已保留');
    return document;
}
export const readLibrary=query=>searchFavorites(query);
export const lookupFavorite=(input,signal)=>lookup(normalizeAsset(input),signal);
export const saveFavorite=input=>save(normalizeAsset(input));
export const removeFavorite=id=>remove(id);
export const subscribeLibrary=listener=>subscribeAssetLibrary(listener);
export const importLegacyLibrary=(origin,document)=>importLegacyFavorites(origin,document);
