import {UPLOAD_TYPE,readAsset} from '../assets/media_upload_model.mjs';
import {inputSnapshot} from '../../canvas/creative_input_exchange.mjs';

export const GROUP_TYPE='DAELAB.MaterialGroup';
export const GROUP_SOCKET='DAELAB_ASSETS';
export const isGroupMember=node=>[UPLOAD_TYPE,'DAELAB.TextInput'].includes(node?.type);
// A group action requires one unambiguous owner for the entire selection.
export function selectedMaterialGroup(chosen,groups){
    if(!chosen.length)return null;
    let owner=null;
    for(const node of chosen){
        const owners=node.type===GROUP_TYPE?groups.filter(g=>String(g.id)===String(node.id)):
            groups.filter(g=>(g.properties.members||[]).some(id=>String(id)===String(node.id)));
        if(owners.length!==1||(owner&&String(owner.id)!==String(owners[0].id)))return null;
        owner=owners[0];
    }
    return owner;
}
export function groupInputSnapshot(group){
    const collection=collectionFor(group),texts=[];
    for(const id of group.properties.members||[]){
        const node=group.graph?.getNodeById(id);
        if(node?.mode)throw new Error('组内有停用节点，请恢复后重试');
        if(node?.type==='DAELAB.TextInput'){
            const snapshot=inputSnapshot(node);
            if(snapshot?.ready===false)return {version:1,ready:false};
            texts.push(...(snapshot?.texts||[]));
        }
    }
    return {...collection,texts,inputMode:collection.assets.length&&texts.some(t=>t.trim())?'image-instructions':undefined};
}
export function collectionFor(group){
    return {version:1,assets:(group.properties.members||[]).filter(id=>group.graph?.getNodeById(id)?.type!=='DAELAB.TextInput').map(id=>{
        const node=group.graph?.getNodeById(id);
        const asset=node?.type===UPLOAD_TYPE?readAsset(node.widgets?.find(w=>w.name==='asset_data')?.value):null;
        if(!asset)return {nodeId:String(id),missing:true};
        return {...asset,nodeId:String(id)};
    })};
}
export function expandGroupSelection(graph,ids,nodes=[]){
    const result=new Set(ids);
    const liveIds=new Map(nodes.map(node=>[String(node.id),node.id]));
    // Loaded nodes may have string IDs while older member references remain numeric.
    for(const id of ids){const node=graph.getNodeById(id);if(node?.type===GROUP_TYPE)for(const member of node.properties.members||[])result.add(liveIds.get(String(member))??graph.getNodeById(member)?.id??member);}
    return result;
}
export function remapGroupMembers(nodes,mapping){
    const copied=new Map([...mapping].map(([id,node])=>[String(id),node]));
    for(const node of nodes)if(node.type===GROUP_TYPE)node.properties.members=(node.properties.members||[]).flatMap(id=>copied.has(String(id))?[copied.get(String(id)).id]:[]);
}
export function suppressGroupSlots(nodes,node,selected){
    const groups=nodes.filter(n=>n.type===GROUP_TYPE);
    if(node.type===GROUP_TYPE)return !node.properties.collapsed&&(node.properties.members||[]).some(id=>selected.has(id));
    const owner=groups.find(g=>(g.properties.members||[]).includes(node.id));
    return !!owner&&(!!owner.properties.collapsed||!selected.has(node.id));
}
