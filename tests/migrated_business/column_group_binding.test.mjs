import test from 'node:test';
import assert from 'node:assert/strict';
import {planColumnBinding,columnStamp,groupStamp,clearBoundColumn} from '../../frontend/src/features/table/column_group_binding.ts';
let serial=0;const ports={uid:()=>`new-${++serial}`,text:(_table,row,field)=>String(row.values[field]||'')};
const table=()=>({version:1,fields:[{id:'media',type:'content',name:'Media'},{id:'safe',type:'text',name:'Safe'}],records:[1,2,3].map(n=>({id:'row'+n,values:{media:[],safe:'preserve'+n}})),meta:{}});
const item=(id)=>({identity:'member:'+id,memberId:id,value:{id:'file-'+id,kind:'image',url:'/view?filename='+id+'.png&type=input'}});
const state=(plan,group='g')=>({groupId:group,mapping:plan.mapping,groupStamp:groupStamp(plan.items),columnStamp:columnStamp(plan.table,'media')});
test('initial binding, replacement and disconnect only change the bound references',()=>{
 const original=table(),first=planColumnBinding(original,'media','g',[item('a'),item('b')],undefined,ports);
 assert.deepEqual(first.table.records.map(r=>r.values.media.length),[1,1,0]);assert.deepEqual(original,table());
 const replaced=planColumnBinding(first.table,'media','other',[item('c')],state(first),ports);assert.deepEqual(replaced.table.records.map(r=>r.values.media.length),[1,0,0]);
 const cleared=clearBoundColumn(replaced.table,'media');assert.deepEqual(cleared.records.map(r=>r.values.safe),original.records.map(r=>r.values.safe));assert.equal(cleared.records.length,3);
});
test('same-file references and multi-item cells retain each occurrence and stable rows on round trip',()=>{
 const initial=planColumnBinding(table(),'media','g',[item('a'),item('b')],undefined,ports),edited=structuredClone(initial.table);
 edited.records[0].values.media.push({...edited.records[1].values.media[0]});edited.records[1].values.media=[];
 edited.records[2].values.media=[{...edited.records[0].values.media[0],id:'another-reference'}];
 const reverse=planColumnBinding(edited,'media','g',initial.items,state(initial),ports);assert.equal(reverse.reverse,true);assert.equal(reverse.items.length,3);assert.equal(new Set(reverse.items.map(i=>i.identity)).size,3);
 reverse.items.forEach((i,n)=>{i.memberId='node-'+n;reverse.mapping.find(m=>m.identity===i.identity).memberId=i.memberId;});
 const saved=state(reverse),reloaded=JSON.parse(JSON.stringify(reverse.table));assert.equal(planColumnBinding(reloaded,'media','g',reverse.items,saved,ports),null);
 const add=item('new'),forward=planColumnBinding(reloaded,'media','g',[...reverse.items,add],saved,ports);
 assert.deepEqual(forward.table.records.slice(0,3).map(r=>r.values.media.length),[2,0,1]);assert.equal(forward.table.records.length,4);assert.equal(forward.table.records[3].values.media.length,1);
 const ordered=[reverse.items[1],reverse.items[0],reverse.items[2]],sorted=planColumnBinding(reloaded,'media','g',ordered,saved,ports);assert.deepEqual(sorted.table.records.map(r=>r.values.media.length),[2,0,1]);
 assert.equal(sorted.table.records[0].values.media[0].bindingIdentity,ordered[0].identity);
});
test('removing one occurrence never removes another reference to the same file',()=>{
 const initial=planColumnBinding(table(),'media','g',[item('a')],undefined,ports),edited=structuredClone(initial.table);
 edited.records[1].values.media=[{...edited.records[0].values.media[0],id:'duplicate-file-ref'}];
 const reverse=planColumnBinding(edited,'media','g',initial.items,state(initial),ports),prior=state(reverse),removed=structuredClone(reverse.table);removed.records[0].values.media=[];
 const next=planColumnBinding(removed,'media','g',reverse.items,prior,ports);assert.equal(next.items.length,1);assert.equal(next.mapping[0].recordId,'row2');assert.equal(next.table.records[1].values.media.length,1);
});
