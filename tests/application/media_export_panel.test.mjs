import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCreativeButton} from '../../frontend/src/ui/creative_button.mjs';

const source=readFileSync(new URL('../../frontend/src/features/editor/video_edit_panel.mjs',import.meta.url),'utf8');
class Element{
    attrs=new Map();children=[];dataset={};disabled=false;hidden=false;textContent='';
    constructor(tag){this.tag=tag;}
    getAttribute(key){return this.attrs.get(key)??null;}
    setAttribute(key,value){this.attrs.set(key,value);}
    removeAttribute(key){this.attrs.delete(key);}
    append(...values){this.children.push(...values);}
    replaceChildren(...values){this.children=values;}
    querySelector(tag){return this.children.flatMap(child=>[child,...child.children]).find(child=>child.tag===tag);}
    pause(){}
}
function actualMethods(t,host){
    const previous=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};
    t.after(()=>{globalThis.document=previous;});
    const start=source.indexOf("    const exportButton=action("),end=source.indexOf("    const play=",start);
    const methodsStart=source.indexOf("        exportState("),methodsEnd=source.indexOf('\n',source.indexOf('        output(',methodsStart));
    assert.ok(start>0&&end>start&&methodsStart>end&&methodsEnd>methodsStart);
    // Execute the actual owned button callbacks, exported panel projection and
    // output renderer with small DOM objects, not a duplicate implementation.
    return new Function('host','action',`
      let exporting=false,exportBlocked=false,exportHasReference=false,exportCopy=false,edit={clips:[{}]};
      const inspector=new Element('div'),result=new Element('div');let message='';
      const say=value=>{message=value;},el=(tag,cls,text)=>{const e=new Element(tag);e.textContent=text||'';return e;};
      ${source.slice(start,end)}
      const api={${source.slice(methodsStart,methodsEnd)}};
      return {...api,exportButton,cancel,recover,review,result,get message(){return message;}};
    `.replaceAll('new Element(', 'new host.Element('))(Object.assign({Element},host),(label,fn,options)=>createCreativeButton(label,fn,options));
}

test('actual export button exposes explicit copy action and keeps its shared async disabled rule',async t=>{
    const calls=[];let complete;
    const panel=actualMethods(t,{exportVideo(){calls.push('own');},exportCopy(){calls.push('copy');return new Promise(resolve=>{complete=resolve;});}});
    const copy={copied:true,canExportCopy:true,busy:false,unresolved:true,reference:{},canCancel:false,canRecover:false,canReview:false};
    panel.exportState(copy,'readonly');assert.equal(panel.exportButton.textContent,'为此副本导出');assert.equal(panel.exportButton.disabled,false);
    assert.equal(panel.cancel.hidden,true);assert.equal(panel.recover.hidden,true);assert.equal(panel.review.hidden,true);
    const click=panel.exportButton.onclick({});assert.deepEqual(calls,['copy']);assert.equal(panel.exportButton.disabled,true);
    panel.exportState({...copy,canExportCopy:false},'invalid binding');complete();await click;
    assert.equal(panel.exportButton.disabled,true);panel.exportButton.onclick({});assert.deepEqual(calls,['copy']);
    panel.exportState({...copy,copied:false,unresolved:false},'own');assert.equal(panel.exportButton.textContent,'导出视频');panel.exportButton.onclick({});assert.deepEqual(calls,['copy','own']);
});

test('actual copied-output renderer labels original source as text and removing output removes preview/download',t=>{
    const panel=actualMethods(t,{}),source={documentId:'old-doc<script>',nodeId:'node-1'};
    panel.output('/view?filename=verified.mp4',{copied:true,source});
    assert.equal(panel.result.querySelector('summary').textContent,'原成片预览（只读）');
    assert.equal(panel.result.querySelector('a').textContent,'下载原成片（只读）');
    assert.equal(panel.result.querySelector('p').textContent,'原来源：文档 old-doc<script> · 剪辑 node-1');
    assert.equal(panel.result.querySelector('a').href,'/view?filename=verified.mp4');
    panel.output(null);assert.equal(panel.result.hidden,true);assert.equal(panel.result.children.length,0);
    panel.output('/view?filename=own.mp4');assert.equal(panel.result.querySelector('a').textContent,'下载成片');assert.equal(panel.result.querySelector('p'),undefined);
});
