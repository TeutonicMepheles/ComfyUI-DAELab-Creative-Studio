import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../frontend/src/canvas/creative_canvas_view.mjs',import.meta.url),'utf8');
const start=source.indexOf('            const snap=snapshotFor(context);const label='),end=source.indexOf('list.append(output);',start)+'list.append(output);'.length;
assert.ok(start>=0&&end>start);
const picker=new Function('snapshotFor','context','point','button','closePicker','outputMaterials','list',source.slice(start,end));

for(const [name,snapshot,enabled] of [
 ['four texts',{assets:[],texts:['one','two','three','four']},true],
 ['media',{assets:[{kind:'image'}],texts:[]},true],
 ['empty',{assets:[],texts:[]},false],
 ['unready text',{assets:[],texts:['one'],ready:false},false],
])test(`column output picker handles ${name}`,()=>{
 let output,submitted;const context={side:'output',materialKey:'column:scene'},point={x:1,y:2};
 picker(()=>snapshot,context,point,(label,action)=>({label,action}),()=>{},(c,p)=>{submitted={context:c,point:p};},{append(value){output=value;}});
 assert.equal(!output.disabled,enabled);
 if(enabled){output.action();assert.deepEqual(submitted,{context,point});}
});
