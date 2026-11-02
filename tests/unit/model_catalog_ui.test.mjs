import test from 'node:test';
import assert from 'node:assert/strict';
import {canSubmitModel,modelOptionPresentation,updateModelOption} from '../../frontend/src/features/models/model_catalog_ui.mjs';

test('model options expose checking, unverified and unavailable states without diagnostics',()=>{
 assert.deepEqual(modelOptionPresentation({id:'m',label:'Model',status:'checking',code:'hidden'}),{text:'Model ◌',disabled:false,checking:true,available:false,unverified:false,statusLabel:'正在检测此模型'});
 assert.deepEqual(modelOptionPresentation({id:'m',label:'Model',status:'unverified',code:'hidden'}),{text:'Model',disabled:false,checking:false,available:false,unverified:true,statusLabel:''});
 assert.deepEqual(modelOptionPresentation({id:'m',label:'Model',status:'unavailable',code:'hidden'}),{text:'Model',disabled:true,checking:false,available:false,unverified:false,statusLabel:'不可用'});
 assert.equal(canSubmitModel({status:'checking'}),false);
 assert.equal(canSubmitModel({status:'unavailable'}),false);
 assert.equal(canSubmitModel({status:'unverified'}),true);
});

test('option updates are in place and carry accessible status semantics',()=>{
 const option={textContent:'old',disabled:false,value:'m',attributes:new Map(),setAttribute(name,value){this.attributes.set(name,String(value));},removeAttribute(name){this.attributes.delete(name);}};
 updateModelOption(option,{id:'m',label:'Model',status:'checking'});
 assert.equal(option.textContent,'Model ◌');assert.equal(option.attributes.get('aria-label'),'正在检测此模型');
 updateModelOption(option,{id:'m',label:'Model',status:'available'});
 assert.equal(option.textContent,'Model');assert.equal(option.attributes.has('aria-label'),false);assert.equal(option.disabled,false);
 updateModelOption(option,{id:'m',label:'Model',status:'unavailable'});
 assert.equal(option.disabled,true);assert.equal(option.attributes.get('aria-label'),'不可用');
});
