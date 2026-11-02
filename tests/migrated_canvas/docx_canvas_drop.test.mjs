import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../../frontend/src/canvas/creative_canvas_view.mjs',import.meta.url),'utf8');
const tree=ts.createSourceFile('canvas.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let handler;function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(tree)==='root.addEventListener'&&node.arguments[0]?.text==='drop'&&node.arguments[1]?.getText(tree).includes('const files='))handler=node.arguments[1].getText(tree);ts.forEachChild(node,visit);}visit(tree);
assert.ok(handler);
function fixture(files,{existingUpload=false,switchAfterUpload=false}={}){
 const graph={},events=[],nodes=[],uploads=[],messages=[];
 let current=graph;
 const env={graph,root:{getBoundingClientRect:()=>({left:0,top:0}),focus(){}},state:{viewport:{zoom:1}},host:{graph:()=>current},UPLOAD_TYPE:'DAELAB.MediaUpload',mediaKind:name=>/\.(png|jpg|webp|mp4|webm|mov)$/i.test(name)?'media':null,closePicker(){},cardWidth:type=>type==='DAELAB.ScriptParser'?1060:350,history:{begin(){events.push('begin');},end(){events.push('end');}},add(type,point){const node={type,id:nodes.length+1,graph};nodes.push({node,point});return node;},selected:new Set(),paintSelection(){},message:text=>messages.push(text),adapterFor:node=>({upload:async(n,file)=>{uploads.push({type:node.type,name:file.name});if(switchAfterUpload)current={};}})};
 const drop=new Function('env',`with(env){return (${handler});}`)(env);
 const event={clientX:100,clientY:200,dataTransfer:{files:files.map(name=>({name}))},target:{closest:s=>existingUpload&&s==='.dae-upload'},preventDefault(){},stopPropagation(){}};
 return {run:()=>drop(event),nodes,uploads,events,messages};
}
test('canvas DOCX drop creates a parser and uses its existing upload capability',async()=>{
 const f=fixture(['script.DOCX']);await f.run();
 assert.deepEqual(f.nodes.map(x=>x.node.type),['DAELAB.ScriptParser']);
 assert.deepEqual(f.uploads,[{type:'DAELAB.ScriptParser',name:'script.DOCX'}]);
 assert.deepEqual(f.events,['begin','end']);
});
test('mixed files retain order, media routing and graph ownership; unsupported sheets never parse',async()=>{
 const f=fixture(['script.docx','reference.png','bad.csv','bad.xlsx']);await f.run();
 assert.deepEqual(f.nodes.map(x=>x.node.type),['DAELAB.ScriptParser','DAELAB.MediaUpload']);
 assert.deepEqual(f.uploads.map(x=>x.name),['script.docx','reference.png']);
 assert.ok(f.nodes[1].point.x>f.nodes[0].point.x);
 const stale=fixture(['one.docx','two.docx'],{switchAfterUpload:true});await stale.run();assert.equal(stale.uploads.length,1);
 const existing=fixture(['reference.png'],{existingUpload:true});await existing.run();assert.equal(existing.nodes.length,0);
 const unsupported=fixture(['bad.csv']);await unsupported.run();assert.equal(unsupported.nodes.length,0);assert.equal(unsupported.events.length,0);assert.match(unsupported.messages[0],/DOCX/);
});

test('parser upload waits for queued panel installation and refuses missing or inactive owners',async()=>{
 const text=readFileSync(new URL('../../frontend/src/integrations/comfyui/business/script_parser.js',import.meta.url),'utf8');
 const ast=ts.createSourceFile('parser.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let body;
 function find(node){if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='upload')body=node.initializer.getText(ast);ts.forEachChild(node,find);}find(ast);
 const upload=new Function(`return (${body});`)(),calls=[],file={name:'one.docx'},node={graph:{},mode:0};
 queueMicrotask(()=>node.__scriptPanel={actions:{uploadDocument:async(f,options)=>calls.push({f,options})}});
 await upload(node,file);assert.deepEqual(calls,[{f:file,options:{mode:'append'}}]);
 await upload({...node,graph:null},file);await upload({...node,mode:2},file);assert.equal(calls.length,1);
 await assert.rejects(upload({graph:{},mode:0},file),/尚未就绪/);
});
