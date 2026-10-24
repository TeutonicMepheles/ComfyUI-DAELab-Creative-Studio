import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessDocument} from '../../web/application/business_document.js';
import {GenerationSession} from '../../web/features/generation/generation_session.js';
import {bindBusinessService,businessRequest,businessJson} from '../../web/contracts/business.js';
import {bindGenerationHttp} from '../../web/integrations/comfyui/business/business_http.js';

function fixture(){
 let document={input:'合成提示词',outputs:[]},epoch=0,steps=0,current=true;const history=[];
 const native=createBusinessDocument({read:()=>document,write:value=>{document=value;},stamp:value=>value.input,current:()=>current,identity:()=>({workflowSession:'w',epoch,documentId:'node'}),history:{begin(){steps++;history.push(structuredClone(document));},end(){},amend(fn){fn();},undo(){document=history.pop();},redo(){}}});
 const scope={documentId:'doc',tableId:'table',nodeId:'node',workflowSession:'w',epoch:0,recordId:'r',fieldId:'f',inputVersion:0,inputDigest:'d'.repeat(64)};
 const reference={requestId:'request',inputDigest:'d'.repeat(64),source:scope,model:'local'};
 const report={requestId:'request',state:'succeeded',phase:'complete',version:3,inputFingerprint:'a'.repeat(64),source:scope,result:{url:'/view?filename=synthetic.png&type=output',kind:'image',asset_id:'asset',reference_id:'ref'},receipt:{kind:'assets',items:[{asset_id:'asset',reference_id:'ref'}]}};
 const session=new GenerationSession({begin:(id,target)=>native.beginRequest(id,target),current:native.canApply,release:native.releaseRequest,apply:(ticket,result)=>native.controller.applyResult(ticket,'应用生成结果',draft=>draft.outputs.push(result.result))});
 const ticket=native.beginRequest('request',{recordId:'r',fieldId:'f'});session.watch(reference,ticket);
 return {native,session,report,reference,get document(){return document;},get steps(){return steps;},switch(){epoch++;},detach(){current=false;}};
}
test('ledger reports are read-only; one verified result applies once and undo does not rewind facts',()=>{
 const f=fixture();assert.equal(f.session.ingest(f.report),true);assert.equal(f.steps,0);assert.equal(f.session.apply('request'),true);assert.equal(f.steps,1);assert.equal(f.session.apply('request'),false);
 f.native.undo();assert.equal(f.document.outputs.length,0);assert.equal(f.session.report('request').state,'succeeded');assert.equal(f.session.apply('request'),false);
});
test('workflow replacement, detachment, editing then undo and disposal reject late receipts',()=>{
 for(const change of [f=>f.switch(),f=>f.detach(),f=>{f.native.edit('编辑',d=>d.input='changed');f.native.undo();},f=>f.session.dispose()]){
  const f=fixture();change(f);f.session.ingest(f.report);assert.equal(f.session.apply('request'),false);assert.equal(f.document.outputs.length,0);
 }
});
test('foreign scopes, missing receipt, mismatched asset reference and regressive versions never apply',()=>{
 for(const override of [{source:{...fixture().report.source,tableId:'other'}},{receipt:null},{receipt:{kind:'assets',items:[{asset_id:'wrong',reference_id:'ref'}]}}]){
  const f=fixture();f.session.ingest({...f.report,...override});assert.equal(f.session.apply('request'),false);
 }
 const f=fixture();f.session.ingest(f.report);assert.equal(f.session.ingest({...f.report,version:2,phase:'running'}),false);
 assert.equal(f.session.ingest({...f.report,phase:'needs_recovery',error:'result_missing_or_changed'}),true);assert.equal(f.session.apply('request'),false);
});
test('loaded references remain read-only until explicit review with matching current input and stable owner',()=>{
 const f=fixture();f.session.invalidate();f.session.ingest(f.report);assert.equal(f.session.apply('request'),false);
 assert.equal(f.session.review('request','wrong',{documentId:'doc',tableId:'table',nodeId:'node'}),false);
 assert.equal(f.session.review('request','d'.repeat(64),{documentId:'doc',tableId:'other',nodeId:'node'}),false);
 assert.equal(f.session.review('request','d'.repeat(64),{documentId:'doc',tableId:'table',nodeId:'node'}),true);
});
test('editable reference digest cannot relabel an immutable old receipt as current input',()=>{
 const f=fixture();f.session.invalidate();
 const altered={...f.reference,inputDigest:'b'.repeat(64)};
 const isolated=new GenerationSession({begin:()=>{throw Error('must not issue a ticket');},current:()=>true,release(){},apply:()=>true});
 isolated.watch(altered);assert.equal(isolated.ingest(f.report),true);
 assert.equal(isolated.review('request','b'.repeat(64),{documentId:'doc',tableId:'table',nodeId:'node'}),false);
});
test('explicit fixture binding restores production and out-of-order disposal cannot resurrect dead bindings',async()=>{
 const calls=[],fetcher=async url=>{calls.push(url);return new Response('{}');};
 const production=bindGenerationHttp(fetcher),first=bindGenerationHttp(fetcher,{prefix:'/fixture/first'}),second=bindGenerationHttp(fetcher,{prefix:'/fixture/second'});
 first();await businessRequest('generation','status',{method:'POST'});second();await businessRequest('generation','status',{method:'POST'});production();
 assert.deepEqual(calls,['/fixture/second/daelab/studio/generation/status','/daelab/studio/generation/status']);await assert.rejects(businessRequest('generation','status',{method:'POST'}));
});
test('HTTP allowlist blocks foreign paths and error submitted=false does not misclassify uncertain acceptance',async()=>{
 const unbind=bindGenerationHttp(async()=>new Response('{"error":"storage unavailable","submitted":false,"originalTaskMayExist":true}',{status:503}));
 try{for(const action of ['../submit','https://elsewhere/capabilities','capabilities?url=elsewhere','status?model=x'])await assert.rejects(businessRequest('generation',action,{method:'GET'}));
  await assert.rejects(businessJson('generation','submit',{jobs:[]}),error=>error.originalTaskMayExist&&error.preflightRejected===false);
 }finally{unbind();}
 const remove=bindBusinessService('generation',{request:async()=>new Response('{"error":"invalid input","originalTaskMayExist":false}',{status:400})});try{await assert.rejects(businessJson('generation','submit',{}),e=>e.preflightRejected);}finally{remove();}
});

test('only matching terminal cancellation proof permits replacement; unknown and active facts stay locked',()=>{
 const f=fixture();assert.equal(f.session.canReplace('request'),false);
 const cancelled={...f.report,state:'cancelled',phase:'needs_input',replacementAllowed:true};
 assert.equal(f.session.ingest({...cancelled,source:{...cancelled.source,nodeId:'other'}}),false);assert.equal(f.session.canReplace('request'),false);
 assert.equal(f.session.ingest({...cancelled,state:'submitting',phase:'running'}),true);assert.equal(f.session.canReplace('request'),false);
 assert.equal(f.session.ingest({...cancelled,replacementAllowed:false}),true);assert.equal(f.session.canReplace('request'),false);
 assert.equal(f.session.ingest(cancelled),true);assert.equal(f.session.canReplace('request'),true);
});
