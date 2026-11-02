import test from 'node:test';
import assert from 'node:assert/strict';
import {GROUP_TYPE,canJoinMaterialGroup,collectionFor,expandGroupSelection,groupMaterialType,remapGroupMembers,selectedMaterialGroup,selectionMaterialType} from '../../frontend/src/features/groups/material_group_model.mjs';
test('group actions require the entire selection to have one unambiguous live owner',()=>{
 const a={id:1},b={id:2},c={id:3},outside={id:4};
 const g={id:10,type:GROUP_TYPE,properties:{members:['1',2]}},h={id:11,type:GROUP_TYPE,properties:{members:[3]}};
 for(const chosen of [[],[outside],[a,outside],[g,outside],[g,h],[a,c],[g,c],[g,h,a]])assert.equal(selectedMaterialGroup(chosen,[g,h]),null);
 for(const chosen of [[g],[a],[a,b],[g,a,b]])assert.equal(selectedMaterialGroup(chosen,[g,h]),g);
 assert.equal(selectedMaterialGroup([h],[g,h]),h);
 assert.equal(selectedMaterialGroup([a],[g,h,{id:12,type:GROUP_TYPE,properties:{members:[1]}}]),null);
 // Ungroup/removal and undo must derive ownership anew, never retain a stale group.
 assert.equal(selectedMaterialGroup([a,b],[h]),null);
 assert.equal(selectedMaterialGroup([g],[h]),null);
 assert.equal(selectedMaterialGroup([a,b],[g,h]),g);
});
test('ordered whole collection preserves identity, media kind and duplicate asset uses',()=>{
 const asset={version:1,id:'a',kind:'image',filename:'a.png',name:'a.png'};
 const nodes=new Map([['a',{type:'DAELAB.MediaUpload',widgets:[{name:'asset_data',value:JSON.stringify(asset)}]}],['b',{type:'DAELAB.MediaUpload',widgets:[{name:'asset_data',value:JSON.stringify({...asset,kind:'video',filename:'a.webm'})}]}]]);
 const group={title:'g',properties:{members:['b','a']},graph:{getNodeById:id=>nodes.get(id)}};
 assert.deepEqual(collectionFor(group).assets.map(a=>[a.nodeId,a.kind]),[['b','video'],['a','image']]);
 group.properties.members.push('missing');assert.deepEqual(collectionFor(group).assets.at(-1),{nodeId:'missing',missing:true});
});
test('group copy/delete includes members and remaps only copied IDs',()=>{
 const g={id:'g',type:GROUP_TYPE,properties:{members:['a','b']}};
 const nodes=new Map([['g',g],['a',{id:'a'}],['b',{id:'b'}]]);
 assert.deepEqual([...expandGroupSelection({getNodeById:id=>nodes.get(id)},['g','a'])],['g','a','b']);
 const clone=structuredClone(g);remapGroupMembers([clone],new Map([['a',{id:'new-a'}],['b',{id:'new-b'}]]));
 assert.deepEqual(clone.properties.members,['new-a','new-b']);assert.deepEqual(g.properties.members,['a','b']);
});
for(const liveStrings of [true,false])test(`group copy resolves mixed member IDs with ${liveStrings?'string':'numeric'} live IDs`,()=>{
 const live=id=>liveStrings?String(id):id,stored=id=>liveStrings?id:String(id);
 const group={id:live(3),type:GROUP_TYPE,properties:{members:[stored(2),stored(1),stored(99)]}};
 const nodes=new Map([group,{id:live(1)},{id:live(2)},{id:live(4)}].map(n=>[String(n.id),n]));
 const graph={_nodes:[...nodes.values()],getNodeById:id=>[...nodes.values()].find(n=>n.id===id)};
 const ids=expandGroupSelection(graph,[group.id,live(4),live(1)],graph._nodes);
 assert.deepEqual([...ids],[group.id,live(4),live(1),live(2),stored(99)]);
 // Canvas cards are keyed by live IDs; each member must resolve exactly once.
 const cards=new Map([...nodes.values()].map(n=>[n.id,n]));
 const copied=[...ids].map(id=>cards.get(id)).filter(Boolean);
 assert.equal(copied.length,4);
 const clone=structuredClone(group),mapping=new Map(copied.map(n=>[n.id,{id:`copy-${n.id}`} ]));
 remapGroupMembers([clone],mapping);
 assert.deepEqual(clone.properties.members,['copy-2','copy-1']);
 assert.deepEqual(group.properties.members,[stored(2),stored(1),stored(99)]);
 assert.equal(mapping.size,4);
});

test('placeholder members stay visible but only ready media enters the group output',()=>{
 const complete={id:1,type:'DAELAB.MediaUpload',properties:{materialPlaceholder:{phase:'complete'}},widgets:[{name:'asset_data',value:JSON.stringify({filename:'ready.png',kind:'image'})}]};
 const pending={id:2,type:'DAELAB.MediaUpload',properties:{materialPlaceholder:{phase:'running'}},widgets:[{name:'asset_data',value:'{}'}]};
 const group={properties:{members:[2,1]},graph:{getNodeById:id=>[complete,pending].find(node=>node.id===id)}};
 assert.deepEqual(collectionFor(group).assets.map(asset=>asset.nodeId),['1']);assert.equal(collectionFor(group).ready,true);
 group.properties.members=[2];assert.equal(collectionFor(group).ready,false);
 delete pending.properties.materialPlaceholder;assert.equal(collectionFor(group).assets[0].missing,true);
});
test('new groups require one material type and only accept members of that type',()=>{
 const image=kind=>kind==='text'
  ?{id:kind,type:'DAELAB.TextInput',widgets:[{name:'text',value:'caption'}]}
  :{id:kind,type:'DAELAB.MediaUpload',widgets:[{name:'asset_data',value:JSON.stringify({kind,filename:kind==='image'?'a.png':'a.webm'})}]};
 const images=[image('image'),{...image('image'),id:'image-2'}],videos=[image('video')],texts=[image('text')];
 assert.equal(selectionMaterialType(images),'image');
 assert.equal(selectionMaterialType([...images,...videos]),null);
 assert.equal(selectionMaterialType([...images,...texts]),null);
 const byId=new Map([...images,...videos,...texts].map(node=>[node.id,node]));
 const group={properties:{members:['image','image-2']},graph:{getNodeById:id=>byId.get(id)}};
 assert.equal(groupMaterialType(group),'image');
 assert.equal(canJoinMaterialGroup(group,image('image')),true);
 assert.equal(canJoinMaterialGroup(group,image('video')),false);
 assert.equal(canJoinMaterialGroup(group,image('text')),false);
 const empty={properties:{members:[],materialType:'video'},graph:{getNodeById:id=>byId.get(id)}};
 assert.equal(canJoinMaterialGroup(empty,image('video')),true);
 assert.equal(canJoinMaterialGroup(empty,image('image')),false);
});
test('legacy mixed groups reject new members but still allow their existing members to reorder',()=>{
 const image={id:'image',type:'DAELAB.MediaUpload',widgets:[{name:'asset_data',value:JSON.stringify({kind:'image',filename:'a.png'})}]};
 const text={id:'text',type:'DAELAB.TextInput',widgets:[{name:'text',value:'caption'}]};
 const byId=new Map([[image.id,image],[text.id,text]]);
 const group={properties:{members:['image','text']},graph:{getNodeById:id=>byId.get(id)}};
 assert.equal(canJoinMaterialGroup(group,image),false);
 assert.equal(canJoinMaterialGroup(group,text),false);
 assert.equal(canJoinMaterialGroup(group,image,{existingMember:true}),true);
 assert.equal(canJoinMaterialGroup(group,text,{existingMember:true}),true);
 const unknown={properties:{members:['missing']},graph:{getNodeById:()=>null}};
 assert.equal(canJoinMaterialGroup(unknown,image),false,'unverifiable membership cannot accept a new type');
});
