import test from 'node:test';
import assert from 'node:assert/strict';
import {OptimizationRevisions,inspectTarget} from '../../frontend/src/features/prompt/prompt_optimization_model.mjs';
import {effectivePrompt,columnValue,validateColumnPrompt,isColumnPrompt} from '../../frontend/src/features/prompt/table_prompt_template.mjs';
import {validatePrompt,resolvePromptAsset} from '../../frontend/src/features/prompt/table_prompt_model.mjs';
import {generationFrames,rowGenerationConfig} from '../../frontend/src/features/generation/table_generation_model.mjs';
import {isTextColumn} from '../../frontend/src/features/prompt/table_prompt_source.mjs';

// Independent a0fb1d9c39c1de6dab00a17d59dd04d14c6d59be oracle.
// Model source SHA256: 9d3e0078f9d07e1ad1f130123844fc2a8e4462bea870bc6f2d67dbd26ba72b46.
// Canonical, private inspector and registry below are copied verbatim except names.
const copy=value=>JSON.parse(JSON.stringify(value));
const editable=(table,f)=>f&&!f.readonly&&isTextColumn(table,f);
const safeLabel=text=>String(text||'引用').replace(/(?:https?:\/\/|file:\/\/|[A-Z]:[\\/])\S+/gi,'[位置已隐藏]');
function oracleCanonical(value){
 if(Array.isArray(value))return '['+value.map(v=>oracleCanonical(v??null)).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+oracleCanonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
function oracleInspectEditableTarget(table,fieldId,row,field){
 const original=effectivePrompt(table,row,fieldId);
 if(original==null||original==='')throw new Error('提示词为空');
 if(typeof original==='string'){if(!original.trim())throw new Error('提示词为空');}
 else if(isColumnPrompt(original))validateColumnPrompt(original);else validatePrompt(original);
 const segments=typeof original==='string'?[{type:'text',text:original}]:original.segments;
 const dependencies=[],anchors=[];
 for(const s of segments){
  if(s.type==='text')continue;
  let context;
  if(s.type==='column'){
   const value=columnValue(table,row,s.fieldId,s.assetIndex,s.assetId);
   dependencies.push({segment:s,field:{id:value.field.id,type:value.field.type,name:value.field.name},value:value.asset||value.text});
   context=value.asset?{kind:'asset',label:safeLabel(value.asset.name||value.field.name)}:{kind:'text',label:safeLabel(value.field.name),text:value.text};
  }else if(s.type==='ref'){
   const ref=original.references.find(r=>r.refId===s.refId),asset=resolvePromptAsset(table,row,ref);
   if(!ref?.included||!asset)throw new Error('引用素材已删除或已排除');
   dependencies.push({ref,asset});context={kind:'asset',label:safeLabel(asset.name)};
  }else if(s.type==='frame'){
   const generation=table.fields.find(f=>f.id===s.generationFieldId);
   if(!generation?.generation)throw new Error('首尾帧生成配置已删除');
   const config=rowGenerationConfig(row,generation.id,generation.generation),frame=generationFrames(table,row,generation.id,config).find(f=>f.role===s.role);
   if(!frame?.asset||frame.error)throw new Error((s.role==='first'?'首帧':'尾帧')+'引用不完整');
   dependencies.push({segment:s,generation:config,asset:frame.asset,frames:row.meta?.generationFrames?.[s.generationFieldId]??null,tags:row.meta?.generationFrameTags?.[s.generationFieldId]??null});
   context={kind:'frame',label:s.role==='first'?'首帧':'尾帧',role:s.role};
  }else throw new Error('不支持的提示词结构');
  anchors.push({segment:copy(s),context});
 }
 const configs=table.fields.filter(f=>f.generation?.promptFieldId===fieldId).map(f=>({id:f.id,config:row.meta?.generationSettings?.[fieldId]?.[f.id]||f.generation}));
 const kinds=new Set(configs.map(f=>f.config.kind));const purpose=kinds.size===1&&['image','video'].includes([...kinds][0])?[...kinds][0]:'general';
 const content={field:{id:field.id,type:field.type,presentation:field.presentation,readonly:!!field.readonly},hasOverride:!!row.values[fieldId],overridePresent:Object.hasOwn(row.values,fieldId),original,template:field.promptTemplate??null,dependencies,configs,purpose};
 // Primitive text is immutable and its text segment array was created above
 // for this call. Structured prompts still need both independent snapshots.
 const plainText=typeof original==='string';
 return {original:plainText?original:copy(original),segments:plainText?segments:copy(segments),anchors,content,stamp:oracleCanonical(content),purpose};
}

class OracleRevisions{
 constructor(saved={}){this.entries=new Map(Object.entries(saved).map(([k,v])=>[k,{...v}]));}
 key(recordId,fieldId){return JSON.stringify([recordId,fieldId]);}
 read(r,f){return this.entries.get(this.key(r,f));}
 observeTarget(table,r,f,known={}){
  const key=this.key(r,f),old=this.entries.get(key);
  const row=known.row||table.records.find(row=>row.id===r),field=known.field||table.fields.find(field=>field.id===f);
  if(!row||!editable(table,field)){if(old&&old.stamp!=='deleted')this.entries.set(key,{...old,stamp:'deleted',revision:old.revision+1});return this.read(r,f);}
  return this.#observeEditableTarget(table,r,f,row,field);
 }
 #observeEditableTarget(table,r,f,row,field){
  const key=this.key(r,f),old=this.entries.get(key);let stamp;
  try{stamp=oracleInspectEditableTarget(table,f,row,field).stamp;}catch(e){stamp='invalid:'+e.message;}
  if(!old||old.stamp!==stamp)this.entries.set(key,{stamp,revision:(old?.revision||0)+1,requestSeq:old?.requestSeq||0});
  return this.entries.get(key);
 }
 observe(table){
  // Eligibility depends on all rows for content columns. Reuse only within this
  // synchronous pass; the next observation rechecks the current table in full.
  const live=new Set(),fields=table.fields.filter(f=>editable(table,f));for(const row of table.records)for(const field of fields){
   live.add(this.key(row.id,field.id));this.#observeEditableTarget(table,row.id,field.id,row,field);
  }
  for(const [key,old] of this.entries)if(!live.has(key)&&old.stamp!=='deleted')this.entries.set(key,{...old,stamp:'deleted',revision:old.revision+1});
 }
 current(table,r,f){return this.observeTarget(table,r,f);}
 begin(table,r,f){const item=this.current(table,r,f);if(!item)throw new Error('目标不存在');item.requestSeq++;return {...item};}
 merge(saved){for(const [key,value] of Object.entries(saved||{})){const old=this.entries.get(key);if(!old)this.entries.set(key,{...value});else{if((value.revision||0)>old.revision)old.stamp=value.stamp;old.revision=Math.max(old.revision,value.revision||0);old.requestSeq=Math.max(old.requestSeq,value.requestSeq||0);}}}
 serialize(){return Object.fromEntries([...this.entries].map(([k,v])=>[k,{...v}]));}
}

function table(rows=3,columns=2){
 const fields=Array.from({length:columns},(_,i)=>({id:`f${i}`,name:`Field ${i}`,type:'content'}));
 return {version:1,fields,records:Array.from({length:rows},(_,i)=>({id:`r${i}`,values:Object.fromEntries(fields.map(f=>[f.id,`Text ${i} ${f.id} 中文`]))})),meta:{unknown:{preserved:true}}};
}
function pair(saved){
 const actual=new OptimizationRevisions(saved),oracle=new OracleRevisions(saved);
 return {actual,oracle,observe(value){const before=JSON.stringify(value);actual.observe(value);oracle.observe(value);assert.deepEqual(actual.serialize(),oracle.serialize());assert.equal(JSON.stringify(value),before);},
  begin(value,r,f){assert.deepEqual(actual.begin(value,r,f),oracle.begin(value,r,f));},merge(saved){actual.merge(saved);oracle.merge(saved);assert.deepEqual(actual.serialize(),oracle.serialize());}};
}
function countFixedFieldEncoding(operation){
 const original=JSON.stringify;let calls=0;
 JSON.stringify=function(value,...args){if(value==='readonly')calls++;return Reflect.apply(original,this,[value,...args]);};
 try{operation();return calls;}finally{JSON.stringify=original;}
}

test('500x10 observes every target with oracle-exact counters while encoding stable field metadata once per pass',t=>{
 const value=table(500,10),p=pair(),before=JSON.stringify(value);
 let count=countFixedFieldEncoding(()=>p.actual.observe(value));p.oracle.observe(value);
 assert.equal(p.actual.entries.size,5000);assert.deepEqual(p.actual.serialize(),p.oracle.serialize());
 t.diagnostic('first-pass readonly field-key encodings: '+count);
 assert.ok(count<=10,'5000 targets must share only the pass-local fixed field canonical fragment');
 p.begin(value,'r237','f4');const saved=p.actual.serialize();
 value.records[237].values.f4+=' changed';
 count=countFixedFieldEncoding(()=>p.actual.observe(value));p.oracle.observe(value);
 assert.deepEqual(p.actual.serialize(),p.oracle.serialize());assert.equal(p.actual.read('r237','f4').revision,2);
 assert.ok(count<=10,'next pass must rebuild its fragments, not repeat them per target');
 value.records[237].values.f4='Text 237 f4 中文';p.observe(value);
 assert.equal(p.actual.read('r237','f4').revision,3);assert.equal(p.actual.read('r237','f4').requestSeq,1);
 p.merge(saved);p.observe(value);assert.equal(p.actual.read('r237','f4').revision,3);
 assert.equal(JSON.stringify(value),before);
});

test('all targets remain observed across readonly, other-row media, deletion/reinsert, duplicate IDs and two owners',()=>{
 const value=table(),p=pair(),other=pair();p.observe(value);other.observe(copy(value));p.begin(value,'r0','f0');
 const original=copy(value),unrelated=other.actual.serialize();
 value.records[2].values.f0=[{id:'asset',url:'/view?filename=x.png'}];p.observe(value);
 assert.equal(p.actual.read('r0','f0').stamp,'deleted');
 Object.assign(value,copy(original));p.observe(value);
 for(const patch of [{readonly:true},{presentation:'generation'},{type:'assets'}]){
  Object.assign(value.fields[0],patch);p.observe(value);value.fields[0]=copy(original.fields[0]);p.observe(value);
 }
 const row=value.records.shift();p.observe(value);value.records.unshift(row);p.observe(value);
 const field=value.fields.shift();p.observe(value);value.fields.unshift(field);p.observe(value);
 value.fields.push({...field,type:'text',promptTemplate:'duplicate template'});p.observe(value);
 value.records.push({id:'r0',values:{f0:'duplicate row',f1:'second'}});p.observe(value);
 assert.deepEqual(other.actual.serialize(),unrelated);
});

test('mixed templates, refs, frames, configs, invalid values and unknown JSON stay oracle-exact',()=>{
 const value=table(2,1),p=pair();
 value.fields=[{id:'text',type:'text',name:'source'},
  {id:'plain',type:'text'},
  {id:'templated',type:'json',presentation:'prompt',promptTemplate:{kind:'column-template',version:1,segments:[{type:'column',fieldId:'text'},{type:'text',text:' end'}]}},
  {id:'assets',type:'assets'},
  {id:'rich',type:'json',presentation:'prompt'},
  {id:'framed',type:'json',presentation:'prompt'},
  {id:'g',presentation:'generation',generation:{version:1,promptFieldId:'framed',kind:'video',mode:'frames2video',model:'fixed',settings:{seed:7}}}];
 for(const row of value.records){
  row.values={text:'rain',plain:'normal',assets:[{id:'first',url:'/view?filename=first.png',kind:'image'}],
   rich:{version:1,compilerVersion:1,segments:[{type:'ref',refId:'ref'},{type:'text',text:' look'}],references:[{refId:'ref',fieldId:'assets',assetId:'first',included:true}],unknown:JSON.parse('{"__proto__":{"kept":true},"future":[null,{"x":1}]}')},
   framed:{kind:'column-template',version:1,segments:[{type:'frame',generationFieldId:'g',role:'first'},{type:'text',text:' shot'}]}};
  row.meta={generationFrames:{g:{first:{fieldId:'assets',assetId:'first'}}}};
 }
 p.observe(value);p.begin(value,'r0','rich');p.begin(value,'r0','framed');
 for(const change of [
  ()=>{value.records[0].values.text='sun';},
  ()=>{value.records[0].values.templated=copy(value.fields[2].promptTemplate);},
  ()=>{value.records[0].values.assets[0].id='missing';},
  ()=>{value.records[0].values.assets[0].id='first';},
  ()=>{value.records[0].meta.generationSettings={framed:{g:{...copy(value.fields[6].generation),settings:{seed:8}}}};},
  ()=>{value.fields[6].generation.settings.seed=9;},
  ()=>{value.records[0].meta.generationFrames.g.first.assetId='absent';},
  ()=>{value.fields[2].promptTemplate={kind:'column-template',version:99,segments:[]};},
  ()=>{value.records[1].values.rich={version:99,segments:[{type:'unknown'}]};},
 ]){change();p.observe(value);}
 for(const text of ['',null,undefined,' \n\t ',0,false]){value.records[0].values.plain=text;p.observe(value);}
 assert.equal(value.records[0].values.rich.unknown.__proto__.kept,true);
});

test('string escaping, inherited overrides and null-prototype fields preserve exact public stamps',()=>{
 for(const text of ['中文 English','a\n\t\0b','😀 \u2028 \u2029','left \ud800 right \udfff']){
  const value=table(),p=pair();value.records[0].values.f0=text;
  value.fields[0]=Object.assign(Object.create(null),value.fields[0],{unknown:JSON.parse('{"__proto__":{"keep":1}}')});
  p.observe(value);assert.equal(p.actual.read('r0','f0').stamp,inspectTarget(value,'r0','f0').stamp);
  value.fields[0].type='text';value.fields[0].promptTemplate=text;delete value.records[0].values.f0;p.observe(value);
  value.records[0].values.f0=text;p.observe(value);
 }
});

test('getters, toJSON and non-plain field shapes conservatively retain original field encoding and getter effects',()=>{
 for(const kind of ['getter','toJSON','prototype']){
  const build=()=>{const value=table(3,1);let reads=0;const field=value.fields[0];
   if(kind==='getter')Object.defineProperty(field,'name',{enumerable:true,configurable:true,get(){reads++;return 'name';}});
   if(kind==='toJSON')Object.defineProperty(field,'toJSON',{value(){throw Error('not called by canonical field projection');},configurable:true});
   if(kind==='prototype')Object.setPrototypeOf(field,{future:true});
   return {value,reads:()=>reads};};
  const a=build(),b=build(),actual=new OptimizationRevisions(),oracle=new OracleRevisions();
  const count=countFixedFieldEncoding(()=>actual.observe(a.value));oracle.observe(b.value);
  assert.deepEqual(actual.serialize(),oracle.serialize());assert.equal(a.reads(),b.reads());
  assert.equal(count,3,'special field must remain on the old canonical path');
 }
});

test('public inspector/current/begin are uncached and remain exact on every call and unknown field data',()=>{
 const value=table(1,1),p=pair();p.observe(value);
 const publicCount=countFixedFieldEncoding(()=>{inspectTarget(value,'r0','f0');inspectTarget(value,'r0','f0');});
 assert.equal(publicCount,2);
 for(const replacement of [{type:{future:'type'}},{presentation:{toJSON(){return 'prompt';}}},{id:17}]){
  Object.assign(value.fields[0],replacement);p.observe(value);
  assert.deepEqual(p.actual.current(value,'r0','f0'),p.oracle.current(value,'r0','f0'));
 }
 assert.throws(()=>p.actual.begin(value,'missing','none'));
 assert.throws(()=>p.oracle.begin(value,'missing','none'));
});

test('field data changed within a pass and between passes cannot reuse a stale primitive fragment',()=>{
 const build=()=>{const value=table(3,1);value.fields[0].type='text';let changed=false;
  Object.defineProperty(value.records[1].values,'f0',{enumerable:true,configurable:true,get(){
   if(!changed){changed=true;value.fields[0].presentation='prompt';}return 'second';
  }});
  return value;};
 const a=build(),b=build(),actual=new OptimizationRevisions(),oracle=new OracleRevisions();
 actual.observe(a);oracle.observe(b);assert.deepEqual(actual.serialize(),oracle.serialize());
 for(const patch of [{presentation:undefined},{readonly:true},{readonly:false,type:'longtext'}]){
  Object.assign(a.fields[0],patch);Object.assign(b.fields[0],patch);
  actual.observe(a);oracle.observe(b);assert.deepEqual(actual.serialize(),oracle.serialize());
 }
});
