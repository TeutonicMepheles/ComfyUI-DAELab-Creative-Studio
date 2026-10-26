import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessDocument} from '../../frontend/src/application/business_document.ts';
import {DocumentController} from '../../frontend/src/application/document_controller.ts';
import {snapshotJson} from '../../frontend/src/contracts/json_snapshot.ts';

const marker='native-replacement-snapshot-fixture';
const initial=()=>JSON.parse('{"marker":"'+marker+'","records":[{"id":"a","value":"original"},{"id":"b","value":"independent"}],"future":{"__proto__":{"kept":true},"nested":[null,false,{"opaque":"retained"}]},"__proto__":{"root":true}}');
const copy=value=>JSON.parse(JSON.stringify(value));
function proxy(value,cache=new WeakMap()){
 if(!value||typeof value!=='object')return value;
 if(!cache.has(value))cache.set(value,new Proxy(value,{get(target,key,receiver){return proxy(Reflect.get(target,key,receiver),cache);}}));
 return cache.get(value);
}
function harness(options={}){
 const {readProxy=false,writeFailure=false,stamp}=options;const value=Object.hasOwn(options,'value')?options.value:initial();
 let state=value,active=true,before,historyVersion=0,writeFailed=false;
 const events=[],undo=[],redo=[];
 const history={
  begin(){events.push('begin');before=copy(state);},
  end(){events.push('end');undo.push(before);redo.length=0;},
  amend(fn){events.push('amend');return fn();},
  undo(){events.push('undo');if(undo.length){redo.push(copy(state));state=undo.pop();historyVersion++;}},
  redo(){events.push('redo');if(redo.length){undo.push(copy(state));state=redo.pop();historyVersion++;}},
 };
 const doc=createBusinessDocument({read:()=>readProxy?proxy(state):state,
  write(next){events.push('write');state=next;historyVersion++;if(writeFailure&&!writeFailed){writeFailed=true;throw Error('write failure');}},
  identity:()=>({workflowSession:'same-native-workflow',epoch:0,documentId:'node'}),current:()=>active,
  stamp:stamp??((table,target)=>target.recordId?table.records.find(row=>row.id===target.recordId):table),
  historyStamp:()=>historyVersion,history});
 return {doc,events,undo,get state(){return state;},external(next){state=next;historyVersion++;},detach(){active=false;}};
}
function validatedEncodings(fn){
 const stringify=JSON.stringify;let count=0;
 JSON.stringify=function(value,replacer,space){if(value?.marker===marker&&typeof replacer==='function')count++;return Reflect.apply(stringify,this,[value,replacer,space]);};
 try{fn();return count;}finally{JSON.stringify=stringify;}
}

test('native whole-table replacement uses two validated snapshots, keeping caller and prior native data isolated',t=>{
 const value=initial();value.fields=Array.from({length:10},(_,i)=>({id:'f'+i}));
 value.records=Array.from({length:500},(_,i)=>({id:'row'+i,values:Object.fromEntries(value.fields.map(field=>[field.id,'synthetic '+i]))}));
 const h=harness({value,readProxy:true}),next=copy(value);next.records[0].values.f0='updated';
 const count=validatedEncodings(()=>h.doc.replace(proxy(next),{group:'input',afterWrite:()=>h.events.push('after')}));
 t.diagnostic('whole-table validated snapshots: '+count);assert.equal(count,2);
 assert.deepEqual(h.events,['begin','write','after','end']);assert.equal(value.records[0].values.f0,'synthetic 0');
 next.records[0].values.f0='late caller mutation';assert.equal(h.state.records[0].values.f0,'updated');
 assert.equal(Object.hasOwn(h.state,'__proto__'),true);assert.equal(h.state.__proto__.root,true);
 assert.equal(Object.hasOwn(h.state.future,'__proto__'),true);assert.equal(h.state.future.__proto__.kept,true);
 h.doc.undo();assert.deepEqual(h.state,value);h.doc.redo();assert.equal(h.state.records[0].values.f0,'updated');
});

test('controller uses the optional native replacement capability once with this/options and rejects disposal before touching it',()=>{
 const value=initial(),settings={group:'input'},calls=[];
 const port={read:()=>value,identity:()=>({workflowSession:'s',epoch:0,documentId:'n'}),revision:()=>0,
  transact(){throw Error('replacement must not enter mutation path');},
  replace(label,next,options){assert.equal(this,port);calls.push({label,next,options});}};
 const controller=new DocumentController(port);controller.replace('replace',value,settings);
 assert.deepEqual(calls,[{label:'replace',next:value,options:settings}]);
 controller.dispose();Object.defineProperty(port,'replace',{get(){throw Error('disposed touched port');}});
 assert.throws(()=>controller.replace('late',value),/released/);assert.equal(calls.length,1);
});

test('legacy native ports fall back to their transaction and preserve JSON descriptor keys and value isolation',()=>{
 let value=initial();const events=[],port={read:()=>value,identity:()=>({workflowSession:'s',epoch:0,documentId:'n'}),revision:()=>0,
  transact(label,edit,options){events.push({label,options});const next=snapshotJson(value);edit(next);value=snapshotJson(next);}};
 const controller=new DocumentController(port),replacement=initial();delete replacement.records;replacement.future.nested.push({newKey:true});
 controller.replace('fallback',proxy(replacement),{group:'legacy'});
 assert.deepEqual(value,replacement);assert.deepEqual(events,[{label:'fallback',options:{group:'legacy'}}]);
 replacement.future.nested[2].opaque='late';assert.equal(value.future.nested[2].opaque,'retained');assert.equal(Object.hasOwn(value,'__proto__'),true);
});

test('replacement no-op, afterWrite, groups and external native changes retain transaction boundaries',()=>{
 const h=harness(),one=initial();one.records[0].value='one';h.doc.replace(one,{group:'typing'});
 const two=copy(one);two.records[0].value='two';h.doc.replace(two,{group:'typing'});
 assert.deepEqual(h.events,['begin','write','end','amend','write']);assert.equal(h.undo.length,1);
 h.events.length=0;h.doc.replace(copy(two),{group:'unrelated'});assert.deepEqual(h.events,[]);
 h.doc.replace(copy(two),{group:'typing',afterWrite:()=>h.events.push('after')});assert.deepEqual(h.events,['amend','write','after']);
 h.events.length=0;h.external({...h.state,nativeUnknown:true});h.doc.replace({...h.state,changed:true},{group:'typing'});
 assert.deepEqual(h.events,['begin','write','end']);assert.equal(h.state.nativeUnknown,true);
 h.events.length=0;h.doc.replace({...h.state,derived:true},{derived:true});assert.deepEqual(h.events,['amend','write']);
});

test('invalid replacement JSON and cycles fail before history and preserve all native fields',()=>{
 for(const bad of [NaN,Infinity,-Infinity,1n,()=>{},Symbol('bad')]){
  const h=harness(),next=initial();next.future.bad=bad;
  assert.throws(()=>h.doc.replace(proxy(next)),TypeError);assert.deepEqual(h.state,initial());assert.deepEqual(h.events,[]);
 }
 const h=harness(),next=initial();next.future.cycle=next;
 assert.throws(()=>h.doc.replace(next),TypeError);assert.deepEqual(h.events,[]);assert.deepEqual(h.state,initial());
 const invalidBefore=initial();invalidBefore.future.bad=Infinity;const old=harness({value:invalidBefore});
 assert.throws(()=>old.doc.replace(initial()),TypeError);assert.deepEqual(old.events,[]);assert.equal(old.state,invalidBefore);
});

test('native JSON omissions/nulls and unknown property names survive replacement without a parallel truth',()=>{
 const h=harness(),next=initial();next.future.omitted=undefined;next.future.list=[undefined,null,false];next.constructor='own constructor';
 h.doc.replace(proxy(next));assert.equal(Object.hasOwn(h.state.future,'omitted'),false);assert.deepEqual(h.state.future.list,[null,null,false]);
 assert.equal(h.state.constructor,'own constructor');assert.equal(Object.getPrototypeOf(h.state),Object.prototype);
 assert.deepEqual(h.doc.read(),h.state);h.external({...h.state,externalNativeOnly:true});assert.equal(h.doc.read().externalNativeOnly,true);
});

test('write failure and afterWrite failure restore all fields, finish history and keep a pending unchanged-input ticket usable',()=>{
 for(const failure of ['write','after']){
  const h=harness({readProxy:true,writeFailure:failure==='write'}),ticket=h.doc.beginRequest('pending',{recordId:'a'}),before=copy(h.state),next=copy(before);next.records[0].value='partial';
  assert.throws(()=>h.doc.replace(proxy(next),{group:'typing',afterWrite:()=>{h.events.push('after');if(failure==='after')throw Error('after failure');}}),new RegExp(failure+' failure'));
  assert.deepEqual(h.events,failure==='write'?['begin','write','write','end']:['begin','write','after','write','end']);
  assert.deepEqual(h.state,before);assert.equal(h.doc.canApply(ticket),true);assert.equal(Object.hasOwn(h.state,'__proto__'),true);
  h.events.length=0;h.doc.replace(next,{group:'typing'});assert.deepEqual(h.events,['begin','write','end']);assert.equal(h.doc.canApply(ticket),false);
 }
});

test('replacement observes stable target revisions, rejects old tickets after undo and isolates two instances',()=>{
 const a=harness(),b=harness(),ticket=a.doc.beginRequest('same',{recordId:'a'}),other=b.doc.beginRequest('same',{recordId:'a'});
 const independent=copy(a.state);independent.records[1].value='other';a.doc.replace(independent);assert.equal(a.doc.canApply(ticket),true);
 const changed=copy(a.state);changed.records[0].value='changed';a.doc.replace(changed);assert.equal(a.doc.canApply(ticket),false);assert.equal(b.doc.canApply(other),true);
 assert.equal(b.state.records[0].value,'original');assert.equal(b.doc.canApply(ticket),false);
 a.doc.undo();assert.equal(a.state.records[0].value,'original');assert.equal(a.doc.canApply(ticket),false);
});

test('async replacement keeps the mutation path, full validation and once-only ticket consumption',()=>{
 const h=harness(),ticket=h.doc.beginRequest('review',{recordId:'a'}),next=initial();next.records[0].value='reviewed';
 const count=validatedEncodings(()=>assert.equal(h.doc.replaceResults([ticket],proxy(next),{afterWrite:()=>h.events.push('after')}),true));
 assert.equal(count,4);assert.deepEqual(h.events,['begin','write','after','end']);assert.equal(h.doc.canApply(ticket),false);
 assert.equal(h.doc.replaceResults([ticket],initial()),false);assert.equal(h.state.records[0].value,'reviewed');
});

test('detached or disposed sessions reject replacement and preserve native state',()=>{
 for(const mode of ['detach','dispose']){
  const h=harness();if(mode==='detach')h.detach();else h.doc.dispose();
  assert.throws(()=>h.doc.replace({...initial(),newKey:true}),mode==='dispose'?/released/:/\u5931\u6548/);
  assert.deepEqual(h.events,[]);assert.deepEqual(h.state,initial());
 }
});

test('nonmatching root containers keep legacy enumerable-descriptor semantics rather than silently changing the API',()=>{
 for(const [before,next,expected] of [[{old:true},['a'],{'0':'a'}],[[1,2],{0:'a'},['a',null]],[[1,2],['a'],['a']],[{old:true},'ab',{'0':'a','1':'b'}]]){
  const h=harness({value:before});h.doc.replace(next);assert.deepEqual(h.state,expected);
 }
 for(const [before,next] of [[null,{x:1}],[undefined,{x:1}],[{x:1},null]]){
  const h=harness({value:before});assert.throws(()=>h.doc.replace(next),TypeError);assert.deepEqual(h.events,[]);assert.deepEqual(h.state,before);
 }
});

test('root compatibility is based on isolated JSON after toJSON, including null rejection and array/string conversion',()=>{
 for(const [result,expected] of [[['item'],{'0':'item'}],['ab',{'0':'a','1':'b'}]]){
  const h=harness({value:{old:true}});let calls=0;
  h.doc.replace({toJSON(){calls++;return result;}});assert.equal(calls,1);assert.deepEqual(h.state,expected);
 }
 const h=harness({value:{old:true}});let calls=0;
 assert.throws(()=>h.doc.replace({toJSON(){calls++;return null;}}),TypeError);assert.equal(calls,1);assert.deepEqual(h.state,{old:true});assert.deepEqual(h.events,[]);
});
