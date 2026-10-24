import {readFileSync} from 'node:fs';
import ts from 'typescript';
const root=new URL('../../frontend/src/',import.meta.url);
const uri=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
export const serviceURL=uri(ts.transpileModule(readFileSync(new URL('application/asset_library_service.ts',root),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
export const service=await import(serviceURL);
export const modelURL=uri(readFileSync(new URL('features/assets/asset_library_model.mjs',root),'utf8').replace('../../application/asset_library_service.js',serviceURL));
export const model=await import(modelURL);
export function memoryPort(){
  let entries=[],next=0;
  return {
    async search({q='',kind,limit=48,offset=0}={}){const matches=entries.filter(e=>(!kind||e.kind===kind)&&e.name.includes(q));return {schemaVersion:1,entries:structuredClone(matches.slice(offset,offset+limit)),total:matches.length,offset,limit,hasMore:offset+limit<matches.length};},
    async lookup(input){return structuredClone(entries.find(e=>model.assetKey(e)===model.assetKey(input))||null);},
    async save(input){let entry=entries.find(e=>model.assetKey(e)===model.assetKey(input));if(!entry){entry={...structuredClone(input),id:'favorite-'+ ++next,assetId:'asset-'+next,createdAt:'fixture'};entries.unshift(entry);}return structuredClone(entry);},
    async remove(id){entries=entries.filter(e=>e.id!==id);},
    async importLegacy(){return {schemaVersion:1,origin:'http://old',source_preserved:true,accepted:0,rejected:0,report:[]};},
  };
}
export function moduleURL(relative,replacements={}){
  const file=new URL(relative,root);
  let text=readFileSync(file,'utf8').replaceAll('import.meta.url',JSON.stringify(file.href));
  text=text.replace(/from (['"])([^'"]+)\1/g,(all,quote,path)=>'from '+quote+(replacements[path.split('?')[0]]||new URL(path,file).href)+quote);
  return uri(text);
}
export const favoriteURL=moduleURL('features/assets/asset_favorite.mjs',{'./asset_library_model.mjs':modelURL});
export const libraryURL=moduleURL('features/assets/asset_library.mjs',{'./asset_library_model.mjs':modelURL,'./asset_favorite.mjs':favoriteURL});
export const canvasViewURL=moduleURL('canvas/creative_canvas_view.mjs',{'../features/assets/asset_library.mjs':libraryURL,'../application/asset_library_service.js':serviceURL});
