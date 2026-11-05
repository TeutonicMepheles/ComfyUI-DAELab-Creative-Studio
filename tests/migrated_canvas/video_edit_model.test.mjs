import test from 'node:test';
import assert from 'node:assert/strict';
import {connectedEdit,newClip,remapEditSources,sourceKey,materialIdentityKey,splitClip} from '../../frontend/src/features/editor/video_edit_model.mjs';

const asset={filename:'copy-test.mp4',subfolder:'',type:'input',kind:'video',duration:10,fps:24,width:640,height:360};

test('repeated autogrow routes keep one imported material while retaining intentional timeline copies',()=>{
 const media={...asset,id:'material-a',contentSha256:'a'.repeat(64)},first={slot:'videos.video0',nodeId:'7'},repeat={slot:'videos.video1',nodeId:'7'};
 const initial=connectedEdit(empty(),[{asset:media,source:first}]);
 const edited={...initial,clips:[{...initial.clips[0],start:2,duration:3},{...initial.clips[0],id:'manual-copy',start:5,duration:2}]};
 const next=connectedEdit(edited,[{asset:media,source:first},{asset:media,source:repeat}]);
 assert.equal(next.clips.length,2);assert.deepEqual(next.clips.map(c=>[c.id,c.start,c.duration]),edited.clips.map(c=>[c.id,c.start,c.duration]));
 const remaining=connectedEdit(JSON.parse(JSON.stringify(next)),[{asset:media,source:repeat}]);
 assert.deepEqual(remaining.clips.map(c=>[c.id,c.start,c.duration]),edited.clips.map(c=>[c.id,c.start,c.duration]));
 assert.equal(remaining.clips[0].source.slot,repeat.slot);
 assert.equal(connectedEdit(remaining,[]).clips.length,0);
});
const empty=()=>({version:1,fit:'contain',clips:[]});

test('group legacy and dynamic routes dedupe overlapping members without dropping unique members',()=>{
 const a={...asset,id:'a'},b={...asset,id:'b',filename:'b.mp4'},c={...asset,id:'c',filename:'c.mp4'};
 const member=(media,slot,groupId)=>({asset:media,source:{slot,groupId,nodeId:media.id,assetId:media.id}});
 const inputs=[member(a,'assets','10'),member(b,'assets','10'),member(a,'groups.group0','10'),member(b,'groups.group0','10'),member(b,'groups.group1','11'),member(c,'groups.group1','11')];
 const next=connectedEdit(empty(),inputs);assert.deepEqual(next.clips.map(c=>c.asset.id),['a','b','c']);
 assert.deepEqual(connectedEdit(JSON.parse(JSON.stringify(next)),inputs),next);
 const deleted={...next,clips:next.clips.filter(c=>c.asset.id!=='b')};
 assert.deepEqual(connectedEdit(deleted,inputs).clips.map(c=>c.asset.id),['a','c'],'repeated routes do not revive deleted imported clips');
});

for(const slot of ['assets','groups.group0'])test(`copying ${slot} preserves split, trimmed and deleted clips through sync and reload`,()=>{
    const source={slot,groupId:'10',nodeId:'1',assetId:'same-file'};
    const deletedSource={...source,nodeId:'2'};
    const original={version:1,fit:'contain',resolution:{width:640,height:360},
        clips:splitClip([{...newClip(asset,source,'edited'),start:2,duration:3,mute:true,fit:'cover'}],1,'split'),
        sources:[sourceKey(asset,source),sourceKey(asset,deletedSource)]};
    const before=structuredClone(original);
    const copied=remapEditSources(original,new Map([[1,{id:101}],[2,{id:102}],[10,{id:110}]]));
    const incoming=[source,deletedSource].map((s,i)=>({asset,source:{...s,nodeId:String(101+i),groupId:'110'}}));
    const synced=connectedEdit(JSON.parse(JSON.stringify(copied)),incoming);
    assert.deepEqual(synced.clips.map(c=>[c.id,c.start,c.duration,c.mute,c.fit]),[
        ['edited',2,1,true,'cover'],['split',3,2,true,'cover'],
    ]);
    assert.deepEqual(synced.sources,incoming.map(({asset,source})=>sourceKey(asset,source)));
    assert.deepEqual(synced.clips.map(c=>c.source),[incoming[0].source,incoming[0].source]);
    assert.deepEqual(synced.resolution,original.resolution);
    assert.deepEqual(connectedEdit(synced,incoming),synced);
    assert.deepEqual(original,before);
});

test('copy remaps each dynamic group independently and retains direct and unmapped references',()=>{
    const sources=[
        {slot:'groups.group0',groupId:'group-a',nodeId:'member-a',assetId:'same-file'},
        {slot:'groups.group1',groupId:'group-b',nodeId:'member-b',assetId:'same-file'},
        {slot:'video',nodeId:'member-a'},
        {slot:'groups.group2',groupId:'external-group',nodeId:'external-member',assetId:'same-file'},
    ];
    const edit={version:1,clips:sources.map((s,i)=>newClip(asset,s,String(i))),sources:sources.map(s=>sourceKey(asset,s))};
    const mapping=new Map([['group-a',{id:'copy-a'}],['group-b',{id:'copy-b'}],['member-a',{id:'copy-member-a'}],['member-b',{id:'copy-member-b'}]]);
    const copy=remapEditSources(edit,mapping);
    assert.deepEqual(copy.clips.map(c=>[c.source.groupId,c.source.nodeId]),[
        ['copy-a','copy-member-a'],['copy-b','copy-member-b'],[undefined,'copy-member-a'],['external-group','external-member'],
    ]);
    assert.deepEqual(copy.sources,copy.clips.map(c=>sourceKey(c.asset,c.source)));
    assert.deepEqual(copy.clips.map(c=>c.source.assetId),sources.map(s=>s.assetId));
});

test('copy keeps standalone clips and legacy source keys compatible',()=>{
    const source={slot:'assets',assetId:'legacy-file'};
    const edit={version:1,clips:[newClip(asset,source,'legacy'),newClip(asset,undefined,'local')]};
    const copy=remapEditSources(edit,new Map([[1,{id:101}]]));
    assert.deepEqual(copy,edit);
    const synced=connectedEdit(copy,[{asset,source:{...source,nodeId:'101',groupId:'110'}}]);
    assert.deepEqual(synced.clips.map(c=>c.id),['legacy','local']);
});

test('clip imports dedupe by material identity and fingerprint without collapsing legal timeline copies',()=>{
 const source={slot:'assets',nodeId:'1'};
 const first={...asset,id:'asset-occurrence',filename:'first.mp4',contentSha256:'a'.repeat(64)};
 const sameMaterial={...first,filename:'renamed.mp4'};
 const sameNameDifferentBytes={...first,id:'other-occurrence',contentSha256:'b'.repeat(64)};
 assert.equal(materialIdentityKey(first),materialIdentityKey(sameMaterial));
 const deduped=connectedEdit({version:1,fit:'contain',clips:[]},[
  {asset:first,source},
  {asset:sameMaterial,source},
  {asset:sameNameDifferentBytes,source},
 ]);
 assert.equal(deduped.clips.length,2);
 assert.deepEqual(deduped.clips.map(clip=>clip.asset.contentSha256),['a'.repeat(64),'b'.repeat(64)]);
 const repeated={...deduped,clips:[deduped.clips[0],{...structuredClone(deduped.clips[0]),id:'intentional-repeat'}]};
 const resynced=connectedEdit(repeated,[{asset:first,source}]);
 assert.deepEqual(resynced.clips.map(clip=>clip.id),repeated.clips.map(clip=>clip.id));
});

test('renamed or reordered material keeps its trimmed clips and copies',()=>{
 const source={slot:'assets',nodeId:'1',assetId:'same-file'};
 const original={...asset,filename:'old.mp4',contentSha256:'a'.repeat(64)};
 const renamed={...original,filename:'renamed.mp4'};
 assert.equal(materialIdentityKey(original,source),materialIdentityKey(renamed,source));
 const edited={version:1,fit:'contain',clips:[
  {...newClip(original,source,'trimmed'),start:2,duration:3,mute:true},
  {...newClip(original,source,'copy'),start:2,duration:3},
 ],sources:[sourceKey(original,source)]};
 const before=structuredClone(edited);
 // The renamed occurrence is listed first, so identity dedupe keeps it and drops the
 // occurrence the saved clips point at.
 const renamedFirst=[{asset:renamed,source},{asset:original,source}];
 const synced=connectedEdit(edited,renamedFirst);
 assert.deepEqual(synced.clips.map(clip=>[clip.id,clip.start,clip.duration,clip.mute]),[['trimmed',2,3,true],['copy',2,3,false]]);
 assert.deepEqual(synced.clips.map(clip=>clip.asset.filename),['renamed.mp4','renamed.mp4']);
 assert.deepEqual(synced.clips.map(clip=>[clip.source.assetId,clip.source.nodeId]),[['same-file','1'],['same-file','1']]);
 assert.deepEqual(synced.sources,[sourceKey(renamed,source)]);
 assert.deepEqual(edited,before,'sync must not mutate the saved edit');
 assert.deepEqual(connectedEdit(structuredClone(before),[{asset:original,source},{asset:renamed,source}]).clips.map(clip=>[clip.id,clip.start,clip.duration]),[['trimmed',2,3],['copy',2,3]],'listing order must not change the clips');
 const reloaded=JSON.parse(JSON.stringify(synced));
 assert.deepEqual(connectedEdit(reloaded,renamedFirst),reloaded,'reloading a saved edit must be stable');
});

test('a disconnected material still drops its clips while connected material stays',()=>{
 const kept={slot:'assets',nodeId:'1',assetId:'kept-file'},gone={slot:'assets',nodeId:'2',assetId:'gone-file'};
 const a={...asset,filename:'a.mp4'},b={...asset,filename:'b.mp4'};
 const edited={version:1,fit:'contain',clips:[newClip(a,kept,'keep'),newClip(b,gone,'drop')],sources:[sourceKey(a,kept),sourceKey(b,gone)]};
 const synced=connectedEdit(edited,[{asset:a,source:kept}]);
 assert.deepEqual(synced.clips.map(clip=>clip.id),['keep']);
 assert.deepEqual(synced.sources,[sourceKey(a,kept)]);
});

test('same filename with different bytes keeps distinct source identities',()=>{
 const source={slot:'assets',nodeId:'1'},a={...asset,filename:'same.mp4',contentSha256:'c'.repeat(64)},b={...asset,filename:'same.mp4',contentSha256:'d'.repeat(64)};
 assert.notEqual(sourceKey(a,source),sourceKey(b,source));
 assert.equal(connectedEdit({version:1,fit:'contain',clips:[]},[{asset:a,source},{asset:b,source}]).clips.length,2);
});
