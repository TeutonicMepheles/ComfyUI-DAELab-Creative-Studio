import {createCreativeButton,bindCreativeButton} from '../../ui/creative_button.mjs';
import {lookupFavorite,assetKey,saveFavorite,removeFavorite,subscribeLibrary,createAssetRequestScope} from './asset_library_model.mjs';

export function libraryIcon(name){const i=document.createElement('i');i.className='dae-creative-icon';i.style.setProperty('--dae-icon',`url("${new URL('../../design/vendor/remixicon/'+name+'.svg',import.meta.url).href}")`);i.setAttribute('aria-hidden','true');return i;}
export function createFavoriteButton(snapshot,{available=()=>true,onError=()=>{}}={}){
    let disposed=false,current=null,loadError=null,lastKey=null,loading=false;
    const requests=createAssetRequestScope();
    const button=createCreativeButton('收藏',async()=>{
        try{
            if(disposed||!available())return;
            const value=snapshot();if(!value)return;
            const entry=await lookupFavorite(value);
            if(disposed)return;
            if(entry)await removeFavorite(entry.id);else await saveFavorite(value);
            if(!disposed)refresh();
        }catch(error){if(!disposed)onError(error.message);}
    });
    button.classList.add('dae-asset-favorite');button.dataset.assetFavorite='true';
    const star=libraryIcon('star-line');button.replaceChildren(star);
    const releaseButton=bindCreativeButton(button);
    function paint(value){
        button.hidden=!value;button.disabled=!available()||loading;
        star.style.setProperty('--dae-icon',`url("${new URL('../../design/vendor/remixicon/'+(current?'star-fill':'star-line')+'.svg',import.meta.url).href}")`);
        const label=current?'取消收藏':'收藏到资产库';button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(!!current));button.title=loadError||label;
    }
    function sync(){
        if(disposed)return;
        let value,key=null;try{value=snapshot();if(value)key=assetKey(value);}catch{value=null;}
        if(key!==lastKey){
            lastKey=key;current=null;loadError=null;loading=!!value;requests.cancel();
            if(value)void requests.run(signal=>lookupFavorite(value,signal),entry=>{
                let fresh;try{fresh=snapshot();}catch{fresh=null;}
                if(!fresh||assetKey(fresh)!==key){lastKey=null;sync();return;}
                current=entry;loading=false;paint(value);
            },error=>{loading=false;loadError=error.message;paint(value);});
        }
        paint(value);
    }
    function refresh(){lastKey=null;sync();}
    const release=subscribeLibrary(refresh);sync();
    return {button,sync,destroy(){disposed=true;requests.dispose();release();releaseButton();}};
}
