import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadMedia} from '../../frontend/src/application/media_upload.ts';

test('reads each host policy; oversized files never POST and smaller files use native upload',async()=>{
  for(const maximum of [100*1024**2,256*1024**2]){
    const calls=[];
    const fetchNative=async(url)=>{calls.push(url);return url==='/features'?{ok:true,json:async()=>({max_upload_size:maximum})}:{ok:true};};
    for(const size of [maximum,maximum+1]){
      await assert.rejects(uploadMedia(fetchNative,{size},new FormData()),/文件过大/);
      assert.equal(calls.includes('/upload/image'),false);
    }
    assert.equal((await uploadMedia(fetchNative,{size:maximum-1},new FormData())).ok,true);
    assert.equal(calls.at(-1),'/upload/image');
  }
});

test('missing policy defers to host; proxy 413 stays readable without inventing a limit',async()=>{
  const fetchNative=async url=>url==='/features'?{ok:false}:{status:413,text:async()=>'<html>proxy</html>'};
  await assert.rejects(uploadMedia(fetchNative,{size:123},new FormData()),error=>{
    assert.match(error.message,/宿主或代理/);assert.doesNotMatch(error.message,/100 MiB|html/);return true;
  });
});

test('aborted policy lookup never submits upload',async()=>{
  const urls=[];const abort=Object.assign(new Error('cancelled'),{name:'AbortError'});
  await assert.rejects(uploadMedia(async url=>{urls.push(url);throw abort;},{size:1},new FormData()),{name:'AbortError'});
  assert.deepEqual(urls,['/features']);
});
