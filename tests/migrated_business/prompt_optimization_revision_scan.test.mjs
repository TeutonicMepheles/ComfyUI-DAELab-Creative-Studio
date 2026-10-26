import test from 'node:test';
import assert from 'node:assert/strict';
import {OptimizationRevisions,inspectTarget} from '../../frontend/src/features/prompt/prompt_optimization_model.mjs';
import {isTextColumn} from '../../frontend/src/features/prompt/table_prompt_source.mjs';

const copy=value=>JSON.parse(JSON.stringify(value));
const editable=(table,field)=>field&&!field.readonly&&isTextColumn(table,field);

// Pre-optimization registry algorithm: retain its independent per-target
// eligibility check followed by the public inspector's second validation.
class LegacyRevisions {
 constructor(saved={}){this.entries=new Map(Object.entries(saved).map(([key,value])=>[key,{...value}]));}
 key(row,field){return JSON.stringify([row,field]);}
 read(row,field){return this.entries.get(this.key(row,field));}
 observeTarget(table,r,f,known={}){
  const key=this.key(r,f),old=this.entries.get(key);let stamp;
  const row=known.row||table.records.find(row=>row.id===r),field=known.field||table.fields.find(field=>field.id===f);
  if(!row||!editable(table,field)){if(old&&old.stamp!=='deleted')this.entries.set(key,{...old,stamp:'deleted',revision:old.revision+1});return this.read(r,f);}
  try{stamp=inspectTarget(table,r,f,{row,field}).stamp;}catch(error){stamp='invalid:'+error.message;}
  if(!old||old.stamp!==stamp)this.entries.set(key,{stamp,revision:(old?.revision||0)+1,requestSeq:old?.requestSeq||0});
  return this.entries.get(key);
 }
 observe(table){
  const live=new Set(),fields=table.fields.filter(field=>editable(table,field));
  for(const row of table.records)for(const field of fields){live.add(this.key(row.id,field.id));this.observeTarget(table,row.id,field.id,{row,field});}
  for(const [key,old] of this.entries)if(!live.has(key)&&old.stamp!=='deleted')this.entries.set(key,{...old,stamp:'deleted',revision:old.revision+1});
 }
 current(table,r,f){return this.observeTarget(table,r,f);}
 begin(table,r,f){const item=this.current(table,r,f);if(!item)throw new Error('目标不存在');item.requestSeq++;return {...item};}
 merge(saved){for(const [key,value] of Object.entries(saved||{})){const old=this.entries.get(key);if(!old)this.entries.set(key,{...value});else{if((value.revision||0)>old.revision)old.stamp=value.stamp;old.revision=Math.max(old.revision,value.revision||0);old.requestSeq=Math.max(old.requestSeq,value.requestSeq||0);}}}
 serialize(){return Object.fromEntries([...this.entries].map(([key,value])=>[key,{...value}]));}
}

function table(rows=3,columns=2){
 const fields=Array.from({length:columns},(_,i)=>({id:`f${i}`,name:`文本${i}`,type:'content'}));
 return {version:1,fields,records:Array.from({length:rows},(_,r)=>({id:`r${r}`,values:Object.fromEntries(fields.map(f=>[f.id,`第${r}行 ${f.id} 中文 English`]))})),meta:{unknown:{preserved:true}}};
}

function pair(saved){
 const actual=new OptimizationRevisions(saved),legacy=new LegacyRevisions(saved);
 return {actual,legacy,observe(value){const before=JSON.stringify(value);actual.observe(value);legacy.observe(value);assert.deepEqual(actual.serialize(),legacy.serialize());assert.equal(JSON.stringify(value),before);},begin(value,r,f){assert.deepEqual(actual.begin(value,r,f),legacy.begin(value,r,f));},merge(saved){actual.merge(saved);legacy.merge(saved);assert.deepEqual(actual.serialize(),legacy.serialize());}};
}

// Instrument only table.records.some/every, used by content eligibility here.
// Non-enumerable wrappers preserve all JSON values; this is an operation-count
// proof, not an elapsed-time benchmark or a counter for canonical/dependency work.
function eligibilityVisits(value,operation){
 const counts={someCalls:0,everyCalls:0,someVisits:0,everyVisits:0};
 for(const name of ['some','every'])Object.defineProperty(value.records,name,{configurable:true,value(callback,thisArg){counts[name+'Calls']++;return Array.prototype[name].call(this,(...args)=>{counts[name+'Visits']++;return callback.apply(thisArg,args);});}});
 try{operation();return counts;}finally{delete value.records.some;delete value.records.every;}
}

test('500x10 content table observes every target with one eligibility pass per field and legacy-identical stamps',t=>{
 const value=table(500,10),actual=new OptimizationRevisions(),legacy=new LegacyRevisions(),before=JSON.stringify(value);
 const measured=eligibilityVisits(value,()=>actual.observe(value));
 legacy.observe(value);
 assert.equal(Object.keys(actual.serialize()).length,5000);
 assert.deepEqual(actual.serialize(),legacy.serialize());
 assert.equal(JSON.stringify(value),before);
 t.diagnostic('eligibility-only first pass: '+JSON.stringify(measured));
 assert.ok(measured.everyCalls<=10,JSON.stringify(measured));
 assert.ok(measured.everyVisits<=5000,JSON.stringify(measured));
 assert.ok(measured.someVisits<=10,JSON.stringify(measured));
 // No cross-edit memoization: a changed value is observed on the next pass.
 value.records[237].values.f4+=' changed';
 const repeat=eligibilityVisits(value,()=>actual.observe(value));legacy.observe(value);
 t.diagnostic('eligibility-only after edit: '+JSON.stringify(repeat));
 assert.deepEqual(actual.serialize(),legacy.serialize());
 assert.equal(actual.read('r237','f4').revision,2);
 assert.equal(actual.read('r238','f4').revision,1);
 assert.ok(repeat.everyVisits<=5000,JSON.stringify(repeat));
});

test('other-row media, readonly, field type/presentation and deletion are reclassified on every observation',()=>{
 const value=table(),p=pair();p.observe(value);p.begin(value,'r0','f0');
 const original=copy(value),initial=p.actual.read('r0','f0');
 value.records[2].values.f0=[{id:'media',url:'/view?filename=synthetic.png',kind:'image'}];p.observe(value);
 assert.equal(p.actual.read('r0','f0').stamp,'deleted');assert.equal(p.actual.read('r0','f0').requestSeq,1);
 assert.ok(p.actual.read('r0','f0').revision>initial.revision);
 Object.assign(value,copy(original));p.observe(value);assert.notEqual(p.actual.read('r0','f0').stamp,'deleted');
 for(const patch of [{readonly:true},{presentation:'generation'},{type:'assets'}]){
  Object.assign(value.fields[0],patch);p.observe(value);assert.equal(p.actual.read('r0','f0').stamp,'deleted');
  value.fields[0]=copy(original.fields[0]);p.observe(value);
 }
 const deletedRow=value.records.shift();p.observe(value);assert.equal(p.actual.read('r0','f0').stamp,'deleted');
 value.records.unshift(deletedRow);p.observe(value);
 const deletedField=value.fields.shift();p.observe(value);assert.equal(p.actual.read('r0','f0').stamp,'deleted');
 value.fields.unshift(deletedField);p.observe(value);p.observe(value);
 assert.equal(p.actual.read('r0','f0').requestSeq,1);
});

test('public inspection, observeTarget/current and begin still validate present eligibility without a bypass',()=>{
 const value=table(),p=pair();p.observe(value);p.begin(value,'r0','f0');
 value.records[2].values.f0=[{id:'asset',url:'/view?filename=x.png'}];
 assert.throws(()=>inspectTarget(value,'r0','f0',{eligible:true}),/目标行或可编辑文本列已删除/);
 assert.deepEqual(p.actual.observeTarget(value,'r0','f0'),p.legacy.observeTarget(value,'r0','f0'));
 assert.equal(p.actual.read('r0','f0').stamp,'deleted');
 // An already-known deleted entry is returned by the original public API;
 // preserve that exact behavior and requestSeq instead of inventing a new throw.
 assert.deepEqual(p.actual.begin(value,'r0','f0'),p.legacy.begin(value,'r0','f0'));
 assert.equal(p.actual.read('r0','f0').requestSeq,2);
 value.records[2].values.f0='text again';
 assert.deepEqual(p.actual.current(value,'r0','f0'),p.legacy.current(value,'r0','f0'));
 value.fields[0].readonly=true;
 assert.throws(()=>inspectTarget(value,'r0','f0',{eligible:true}),/上游同步/);
 assert.deepEqual(p.actual.current(value,'r0','f0'),p.legacy.current(value,'r0','f0'));
 assert.throws(()=>p.actual.begin(value,'missing','f0'),/目标不存在/);
 assert.throws(()=>inspectTarget(value,'missing','f1'),/目标行/);
});

test('dependent references, invalid references and same-visible override changes retain exact stamps without mutating unknown JSON',()=>{
 const value={version:1,fields:[{id:'scene',type:'text',name:'画面'},{id:'p',type:'json',presentation:'prompt',promptTemplate:{kind:'column-template',version:1,segments:[{type:'column',fieldId:'scene'},{type:'text',text:'，完成。'}]}},{id:'assets',type:'assets',name:'素材'},{id:'q',type:'json',presentation:'prompt'}],records:[{id:'r',values:{scene:'雨后的街道',assets:[{id:'a',url:'/view?filename=synthetic.png',name:'图'}],q:{version:1,compilerVersion:1,segments:[{type:'ref',refId:'ref'},{type:'text',text:'看这里'}],references:[{refId:'ref',fieldId:'assets',assetId:'a',included:true,role:'reference'}],unknown:JSON.parse('{"__proto__":{"literal":true},"legacy":[null,{"keep":1}]}')}}}],meta:{unknown:{nested:['kept']}}};
 const p=pair();p.observe(value);p.begin(value,'r','p');p.begin(value,'r','q');
 const inherited=copy(p.actual.read('r','p'));
 value.records[0].values.p=copy(value.fields[1].promptTemplate);p.observe(value);
 assert.ok(p.actual.read('r','p').revision>inherited.revision);
 value.records[0].values.scene='晴天的街道';p.observe(value);
 const valid=copy(p.actual.read('r','q'));
 value.records[0].values.assets[0].id='replacement';p.observe(value);
 assert.match(p.actual.read('r','q').stamp,/^invalid:/);assert.ok(p.actual.read('r','q').revision>valid.revision);
 value.records[0].values.assets[0].id='a';p.observe(value);
 value.fields=value.fields.filter(f=>f.id!=='scene');p.observe(value);assert.match(p.actual.read('r','p').stamp,/^invalid:/);
 assert.equal(Object.hasOwn(value.records[0].values.q.unknown,'__proto__'),true);
 assert.equal(value.records[0].values.q.unknown.__proto__.literal,true);
 assert.equal(p.actual.read('r','p').requestSeq,1);assert.equal(p.actual.read('r','q').requestSeq,1);
});

test('frame/config changes and invalid frame identity remain part of per-target inspection',()=>{
 const value=table(1,1);value.fields=[{id:'p',type:'json',presentation:'prompt'},{id:'frames',type:'assets'},{id:'g',presentation:'generation',generation:{version:1,promptFieldId:'p',kind:'video',mode:'frames2video',model:'fixed',settings:{seed:7}}}];
 value.records[0].values={p:{kind:'column-template',version:1,segments:[{type:'frame',generationFieldId:'g',role:'first'},{type:'text',text:'固定镜头'}]},frames:[{id:'first',kind:'image',url:'/view?filename=first.png'},{id:'last',kind:'image',url:'/view?filename=last.png'}]};
 value.records[0].meta={generationFrames:{g:{first:{fieldId:'frames',assetId:'first'},last:{fieldId:'frames',assetId:'last'}}},unknown:{raw:true}};
 const p=pair();p.observe(value);p.begin(value,'r0','p');const old=copy(p.actual.read('r0','p'));
 value.fields[2].generation.settings.seed=8;p.observe(value);assert.ok(p.actual.read('r0','p').revision>old.revision);
 value.records[0].meta.generationFrames.g.first.assetId='missing';p.observe(value);assert.match(p.actual.read('r0','p').stamp,/^invalid:/);
 value.records[0].meta.generationFrames.g.first.assetId='first';p.observe(value);
 value.fields.pop();p.observe(value);assert.match(p.actual.read('r0','p').stamp,/^invalid:/);
 assert.equal(p.actual.read('r0','p').requestSeq,1);
});

test('undo-like JSON restoration and saved lower-bound merge keep revisions monotonic and owners independent',()=>{
 let value=table();const p=pair(),other=new OptimizationRevisions();p.observe(value);other.observe(copy(value));
 p.begin(value,'r0','f0');const before=copy(value),saved=p.actual.serialize(),unrelated=other.serialize();
 value.records[0].values.f0+=' edit';p.observe(value);const changed=p.actual.read('r0','f0').revision;
 value=copy(before);p.observe(value);assert.ok(p.actual.read('r0','f0').revision>changed);
 p.merge(saved);assert.ok(p.actual.read('r0','f0').revision>saved[p.actual.key('r0','f0')].revision);
 const high=copy(saved);high[p.actual.key('r0','f0')].revision=20;high[p.actual.key('r0','f0')].requestSeq=9;p.merge(high);p.observe(value);
 assert.equal(p.actual.read('r0','f0').revision,20);assert.equal(p.actual.read('r0','f0').requestSeq,9);
 assert.deepEqual(other.serialize(),unrelated);
 const restored=new OptimizationRevisions(p.actual.serialize());restored.observe(value);assert.deepEqual(restored.serialize(),p.actual.serialize());
});
