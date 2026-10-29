import test from 'node:test';
import assert from 'node:assert/strict';
import {comfySubmissionOptions} from '../../frontend/src/integrations/comfyui/business/comfy_submission_auth.js';

const options=()=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobs:[{input:{config:{provider:'comfy'}}}]})});
function fixture(){
 const auth={currentUser:{uid:'test-user'},getWorkspaceAuthToken:async()=> 'fresh-workspace-token'};
 const keys={getApiKey:()=>null},workspace={activeWorkspaceId:'personal',workspaceTransitionGeneration:0};
 return {auth,keys,workspace,host:{_p:{_s:new Map([['auth',auth],['apiKeyAuth',keys],['teamWorkspace',workspace]])}}};
}

test('logged-in host fetches fresh workspace token for every cloud submission without temporary api fields',async()=>{
 const {host,auth}=fixture(),request=options(),controller=new AbortController();request.signal=controller.signal;
 let calls=0;auth.getWorkspaceAuthToken=async()=>`refreshed-${++calls}`;
 for(let i=1;i<=2;i++){
  const result=await comfySubmissionOptions(host,request);
  assert.equal(result.headers.get('X-DAELAB-Comfy-Token'),`refreshed-${i}`);
  assert.equal(result.headers.get('Content-Type'),'application/json');
  assert.equal(result.signal,request.signal);assert.equal(result.body,request.body);
 }
 assert.equal(request.headers['X-DAELAB-Comfy-Token'],undefined);
});

test('API key login and signed-out state use current credentials, never stale request headers',async()=>{
 const {host,auth,keys}=fixture();auth.currentUser=null;auth.getWorkspaceAuthToken=async()=>undefined;
 keys.getApiKey=()=> 'configured-test-key';
 const request=options();request.headers['X-DAELAB-Comfy-Token']='stale';
 let result=await comfySubmissionOptions(host,request);
 assert.equal(result.headers.get('X-DAELAB-Comfy-Key'),'configured-test-key');
 assert.equal(result.headers.has('X-DAELAB-Comfy-Token'),false);
 keys.getApiKey=()=>null;result=await comfySubmissionOptions(host,request);
 assert.equal(result.headers.has('X-DAELAB-Comfy-Key'),false);
 assert.equal(result.headers.has('X-DAELAB-Comfy-Token'),false);
});

test('rejects account, API key, or workspace changes while token refresh is pending',async()=>{
 for(const change of [f=>f.auth.currentUser=null,f=>f.keys.getApiKey=()=> 'other-key',f=>f.workspace.activeWorkspaceId='team',f=>f.workspace.workspaceTransitionGeneration++]){
  const f=fixture();f.auth.getWorkspaceAuthToken=async()=>{change(f);return 'old-workspace-token';};
  await assert.rejects(comfySubmissionOptions(f.host,options()),/账户或工作区已切换/);
 }
});

test('permits first workspace initialization and propagates token refresh failure',async()=>{
 const {host,auth,workspace}=fixture();workspace.activeWorkspaceId=null;
 auth.getWorkspaceAuthToken=async()=>{workspace.activeWorkspaceId='personal';workspace.workspaceTransitionGeneration++;return 'initialized-token';};
 assert.equal((await comfySubmissionOptions(host,options())).headers.get('X-DAELAB-Comfy-Token'),'initialized-token');
 auth.getWorkspaceAuthToken=async()=>{throw new Error('refresh failed');};
 await assert.rejects(comfySubmissionOptions(host,options()),/refresh failed/);
});

test('local generation needs no auth store; missing cloud auth capability is explicit',async()=>{
 const request=options();request.body=JSON.stringify({jobs:[{input:{config:{provider:'local'}}}]});
 assert.equal(await comfySubmissionOptions({},request),request);
 await assert.rejects(comfySubmissionOptions({},options()),/无法读取 ComfyUI 登录状态/);
});
