import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectTarget,OptimizationRevisions,freezeSnapshot,matchesSnapshot,restoreSuggestion} from '../../frontend/src/features/prompt/prompt_optimization_model.mjs';

const copy=value=>JSON.parse(JSON.stringify(value));
function table(rows=1,columns=1){
 const fields=Array.from({length:columns},(_,i)=>({id:'f'+i,type:'content',name:'文字 '+i}));
 return {version:1,fields,records:Array.from({length:rows},(_,r)=>({id:'r'+r,values:Object.fromEntries(fields.map(f=>[f.id,'行'+r+' '+f.id+' 中文 English']))})),meta:{unknown:JSON.parse('{"__proto__":{"literal":true},"kept":[null,{"x":1}]}')}};
}
// Independent fixed-schema legacy stamp for ordinary strings. Do not use the
// new inspector to produce its own expected result.
function stringStamp(value,fieldId){
 return '{"configs":[],"dependencies":[],"field":{"id":'+JSON.stringify(fieldId)+',"readonly":false,"type":"content"},"hasOverride":true,"original":'+JSON.stringify(value)+',"overridePresent":true,"purpose":"general","template":null}';
}
function countRoundTrips(operation){
 const original=JSON.parse;let parses=0;
 JSON.parse=function(...args){parses++;return Reflect.apply(original,this,args);};
 try{operation();return parses;}finally{JSON.parse=original;}
}
function nestedProxy(value,cache=new WeakMap()){
 if(!value||typeof value!=='object')return value;
 if(!cache.has(value))cache.set(value,new Proxy(value,{get(target,key,receiver){return nestedProxy(Reflect.get(target,key,receiver),cache);}}));
 return cache.get(value);
}

test('500x10 strings preserve all legacy stamps without redundant return JSON roundtrips, on every observation',t=>{
 const value=table(500,10),before=JSON.stringify(value),revisions=new OptimizationRevisions();
 const first=countRoundTrips(()=>revisions.observe(value));
 assert.equal(revisions.entries.size,5000);
 for(const row of value.records)for(const field of value.fields)assert.deepEqual(revisions.read(row.id,field.id),{stamp:stringStamp(row.values[field.id],field.id),revision:1,requestSeq:0});
 assert.equal(JSON.stringify(value),before);
 t.diagnostic('ordinary-string return JSON.parse calls, first 5000-target observation: '+first);
 assert.equal(first,0,'fresh string/text-segment results need no JSON roundtrip');
 value.records[237].values.f4+=' changed';
 const repeat=countRoundTrips(()=>revisions.observe(value));
 t.diagnostic('ordinary-string return JSON.parse calls, next 5000-target observation: '+repeat);
 assert.equal(repeat,0);
 for(const row of value.records)for(const field of value.fields)assert.deepEqual(revisions.read(row.id,field.id),{stamp:stringStamp(row.values[field.id],field.id),revision:row.id==='r237'&&field.id==='f4'?2:1,requestSeq:0});
});

test('public string snapshots stay freshly owned across calls, nested proxies, Unicode and lone surrogates',()=>{
 for(const text of ['普通 English','a\n\tb\0c','emoji 😀 \u2028 \u2029','left \ud800 right \udfff']){
  const value=table();value.records[0].values.f0=text;const before=JSON.stringify(value),proxy=nestedProxy(value);
  const a=inspectTarget(proxy,'r0','f0'),b=inspectTarget(proxy,'r0','f0');
  assert.equal(a.original,text);assert.deepEqual(a.segments,copy([{type:'text',text}]));
  assert.notEqual(a.segments,b.segments);assert.notEqual(a.segments[0],b.segments[0]);
  a.segments[0].text='external mutation';a.segments.push({type:'text',text:'extra'});
  assert.deepEqual(b.segments,[{type:'text',text}]);assert.equal(a.content.original,text);
  assert.equal(JSON.stringify(value),before);assert.equal(inspectTarget(proxy,'r0','f0').stamp,stringStamp(text,'f0'));
 }
});

test('inherited string templates and explicit overrides remain different stamps and fresh results',()=>{
 const value=table();value.fields[0].type='text';value.fields[0].promptTemplate='固定模板';delete value.records[0].values.f0;
 const inherited=inspectTarget(value,'r0','f0');assert.equal(inherited.original,'固定模板');assert.equal(inherited.content.overridePresent,false);
 value.records[0].values.f0='固定模板';const explicit=inspectTarget(value,'r0','f0');
 assert.equal(explicit.original,inherited.original);assert.notEqual(explicit.stamp,inherited.stamp);assert.equal(explicit.content.overridePresent,true);
 explicit.segments[0].text='caller edit';assert.equal(value.fields[0].promptTemplate,'固定模板');assert.equal(value.records[0].values.f0,'固定模板');
});

test('structured ref/unknown JSON snapshots keep independent original, segment and anchor copies',()=>{
 const value=table();value.fields=[{id:'p',type:'json',presentation:'prompt'},{id:'assets',type:'assets',name:'素材'}];
 const unknown=JSON.parse('{"__proto__":{"literal":true},"legacy":[null,{"keep":1}]}');
 const doc={version:1,compilerVersion:1,segments:[{type:'ref',refId:'ref',unknown:copy(unknown)},{type:'text',text:'看这里'}],references:[{refId:'ref',fieldId:'assets',assetId:'a',included:true,role:'reference'}],unknown};
 value.records[0].values={p:doc,assets:[{id:'a',url:'/view?filename=synthetic.png',name:'图'}]};
 const before=JSON.stringify(value),local=inspectTarget(nestedProxy(value),'r0','p');
 assert.deepEqual(local.original,doc);assert.notEqual(local.original,doc);assert.notEqual(local.original.unknown,doc.unknown);
 assert.notEqual(local.segments,doc.segments);assert.notEqual(local.segments,local.original.segments);
 assert.notEqual(local.anchors[0].segment,doc.segments[0]);assert.notEqual(local.anchors[0].segment,local.segments[0]);
 assert(Object.hasOwn(local.original.unknown,'__proto__'));assert.equal(local.original.unknown.__proto__.literal,true);
 local.original.unknown.legacy[1].keep=99;local.original.references[0].included=false;local.segments[0].unknown.__proto__.literal=false;local.anchors[0].segment.refId='foreign';
 assert.equal(JSON.stringify(value),before);assert.deepEqual(inspectTarget(value,'r0','p').original,doc);
 value.records[0].values.assets[0].id='changed';assert.throws(()=>inspectTarget(value,'r0','p'),/引用素材已删除或已排除/);
});

test('plain-string path retains strict eligibility/empty validation and structured malformed documents still reject',()=>{
 for(const text of ['',null,' \n\t ']){
  const value=table();value.fields[0].type='text';value.records[0].values.f0=text;assert.throws(()=>inspectTarget(value,'r0','f0'),/提示词为空/);
 }
 const value=table(2);value.fields[0].readonly=true;assert.throws(()=>inspectTarget(value,'r0','f0'),/上游同步/);
 delete value.fields[0].readonly;value.records[1].values.f0=[{id:'media',url:'/view?filename=synthetic.png'}];
 assert.throws(()=>inspectTarget(value,'r0','f0',{eligible:true}),/目标行或可编辑文本列已删除/);
 value.records[1].values.f0='back';assert.throws(()=>inspectTarget(value,'missing','f0'),/目标行/);
 value.fields[0]={id:'f0',type:'json',presentation:'prompt'};
 for(const doc of [{version:2,segments:[]},{kind:'column-template',version:1,segments:[{type:'column',fieldId:''}]},{version:1,compilerVersion:1,segments:[{type:'text',text:'@image_1'}],references:[]}]){
  value.records[0].values.f0=doc;assert.throws(()=>inspectTarget(value,'r0','f0'));
 }
});

test('string requests remain frozen and revision/request sequencing survives edit, undo-like restore and another owner',async()=>{
 const a=table(),b=copy(a),ra=new OptimizationRevisions(),rb=new OptimizationRevisions(),identity={documentId:'doc',tableId:'table'};
 const target={...identity,recordId:'r0',fieldId:'f0'},options={begin:true,nonce:'unit',model:'qwen3.5:9b-q4_K_M'};
 const frozen=await freezeSnapshot(a,target,ra,options),other=await freezeSnapshot(b,target,rb,options);
 assert.equal(matchesSnapshot(a,identity,ra,frozen),true);assert.equal(matchesSnapshot(b,identity,rb,other),true);
 const original=a.records[0].values.f0;a.records[0].values.f0='changed';ra.observe(a);
 assert.equal(frozen.local.original,original);assert.deepEqual(frozen.local.segments,[{type:'text',text:original}]);assert.equal(matchesSnapshot(a,identity,ra,frozen),false);
 a.records[0].values.f0=original;ra.observe(a);assert.equal(matchesSnapshot(a,identity,ra,frozen),false,'undo does not rewind revisions');
 assert.equal(matchesSnapshot(b,identity,rb,other),true);
 const next=await freezeSnapshot(a,target,ra,options);assert.equal(next.wire.requestSeq,frozen.wire.requestSeq+1);assert(next.wire.revision>frozen.wire.revision);
 frozen.local.segments[0].text='mutated caller snapshot';assert.equal(next.local.segments[0].text,original);assert.equal(a.records[0].values.f0,original);
 assert.equal(restoreSuggestion(next,'清晰的新文字').document,'清晰的新文字');
 assert.equal(matchesSnapshot(a,{...identity,tableId:'foreign'},ra,next),false);
});
