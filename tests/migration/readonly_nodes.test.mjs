import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {Element as BaseElement} from '../migrated_business/prompt_optimization_dom.mjs';
import {readStoryboard} from '../../frontend/src/features/storyboard/storyboard_table_adapter.mjs';
import {canvasHistory} from '../../frontend/src/integrations/comfyui/canvas/creative_history.mjs';

const root = new URL('../../frontend/src/', import.meta.url);
const uri = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
function compiled(path) { return uri(ts.transpileModule(readFileSync(new URL(path,root),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText); }
const coreUrl = compiled('compat/readonly_nodes.ts'), controllerUrl = compiled('application/document_controller.ts');
const core = await import(coreUrl);
const integrationFile = new URL('integrations/comfyui/compat_readonly.js', root);
const integrationCode = readFileSync(integrationFile,'utf8').replace(/from (['"])([^'"]+)\1/g, (_,quote,path) => `from ${quote}${path==='../../compat/readonly_nodes.js'?coreUrl:path==='../../application/document_controller.js'?controllerUrl:new URL(path,integrationFile).href}${quote}`);
const integration = await import(uri(integrationCode));
const fixture = JSON.parse(readFileSync(new URL('./fixtures/legacy-readonly-workflow.json',import.meta.url),'utf8'));
const sourceContract = JSON.parse(readFileSync(new URL('./fixtures/legacy-source-contract.json',import.meta.url),'utf8'));
const clone = structuredClone;
const hostContract = JSON.parse(readFileSync(new URL('./fixtures/host-1.53.10-contract.json',import.meta.url),'utf8'));

// Reproduce constructor ordering from pinned addInputs: physical sockets first,
// then widgets, excluding socketless widgets. No node parameters are copied.
function constructedInputs(type) {
  const specs = sourceContract.nativeInputs[type];
  return [...specs.filter(slot=>slot.options.force_input), ...specs.filter(slot=>!slot.options.force_input && !slot.options.socketless)]
    .map(slot=>({name:slot.name,type:slot.type,...(!slot.options.force_input ? {widget:{name:slot.name}} : {})}));
}
function pinnedComfyNode(method) {
  const pick = (value, keys) => Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
  const zip = (a,b) => Array.from({length:Math.max(a.length,b.length)},(_,i)=>[a[i],b[i]]);
  // When provided, execute the actual pinned bundle method unchanged. Its base
  // graph/store is a bounded double; the schema-reordering code is the host's.
  return new Function('NativeNode','oe','le','migrateWidgetsValues','outputAsSerialisable',`return class ComfyNode extends NativeNode {
    static nodeData={inputs:{}};
    ${method || `configure(raw) {
      const keys=['name','type','shape','localized_name'];
      const saved=new Map(raw.inputs?.map(slot=>[slot.name,slot]) || []), names=new Set(this.inputs.map(slot=>slot.name));
      raw.inputs=[...this.inputs.map(slot=>saved.has(slot.name)?{...saved.get(slot.name),...oe(slot,keys.concat('widget'))}:slot),...(raw.inputs?.filter(slot=>!names.has(slot.name))||[])];
      raw.outputs=le(this.outputs,raw.outputs||[]).map(([slot,saved])=>slot?(saved?{...saved,...oe(slot,keys)}:slot):saved);
      super.configure(raw);
    }`}
  }`)(NativeNode,pick,zip,(_specs,_widgets,values)=>values,slot=>clone(slot));
}

class NativeNode {
  constructor(title='') { this.title=title;this.inputs=[];this.outputs=[];this.properties={};this.widgets=[];this.id=-1;this.pos=[0,0];this.size=[460,400];this.mode=0; }
  addInput(name,type) { const slot={name,type,link:null};this.inputs.push(slot);return slot; }
  addOutput(name,type) { const slot={name,type,links:null};this.outputs.push(slot);return slot; }
  configure(raw) { for(const key of ['id','type','pos','size','mode','inputs','outputs','properties','widgets_values','title'])if(raw[key]!==undefined)this[key]=clone(raw[key]); }
  serialize() { const data=Object.fromEntries(['id','type','pos','size','mode','inputs','outputs','properties','widgets_values','title'].filter(key=>this[key]!==undefined).map(key=>[key,clone(this[key])]));if(this.type==='DAELAB.Table')data.widgets_values=this.widgets.map(w=>w.value);return data; }
  addDOMWidget(name,type,root,options) {const widget={name,type,inputEl:root,...options};this.widgets.push(widget);return widget;}
}
function native(raw) { class Node extends NativeNode {} integration.installReadonlySerialization(Node);const node=new Node();node.configure(clone(raw));return node; }

function assertPinnedHostRoundtrip(method) {
  const raw=clone(fixture.nodes[0]), Broken=pinnedComfyNode(method);
  const broken=new Broken();broken.inputs=constructedInputs(raw.type);broken.outputs=clone(raw.outputs);
  broken.configure(clone(raw));
  assert.equal(broken.inputs[0].name,'imported_storyboard');
  assert.throws(()=>core.mergeReadonlySerialized(raw,broken.serialize()),/槽位顺序/);
  for (const original of [raw,{...clone(raw),inputs:[...clone(raw.inputs),{name:'imported_storyboard',type:'STRING',link:777}]},fixture.nodes[1]]) {
    const Fixed=pinnedComfyNode(method);
    integration.installReadonlySerialization(Fixed,{configureNative:NativeNode.prototype.configure});
    const node=new Fixed();node.inputs=constructedInputs(original.type);node.outputs=clone(original.outputs);
    node.configure(clone(original));
    assert.deepEqual(node.inputs,original.inputs);
    assert.deepEqual(node.serialize(),original);
    node.inputs[0].type='IMAGE';assert.throws(()=>node.serialize(),/槽位顺序/);
  }
}
test('pinned host constructor-first migration reproduces first failure; base hydration preserves 14/15 slots',()=>assertPinnedHostRoundtrip());
test('installed 1.53.10 actual ComfyNode.configure method reproduces the failure and fixed roundtrip', {skip: !process.env.STUDIO_PINNED_HOST_BUNDLE},()=>{
  const bundle=readFileSync(process.env.STUDIO_PINNED_HOST_BUNDLE);
  assert.equal(createHash('sha256').update(bundle).digest('hex'),hostContract.bundleSha256);
  const text=bundle.toString('utf8'),start=text.indexOf('async function registerNodeDef'),a=text.indexOf('configure(e){',start),b=text.indexOf('}};addNodeContextMenuHandler',a)+1;
  assert.ok(start>=0&&a>start&&b>a);
  const method=text.slice(a,b);assert.equal(createHash('sha256').update(method).digest('hex'),hostContract.configureMethodSha256);
  assertPinnedHostRoundtrip(method);
});
test('historical configure rejects reordered, wrong-typed and unexpected slots before mutating the node',()=>{
  for (const change of [raw=>raw.inputs.reverse(),raw=>raw.inputs[0].type='IMAGE',raw=>raw.outputs[0].name='image',raw=>raw.inputs.push({name:'secret',type:'TOKEN-DO-NOT-LOG'})]) {
    const node=native(fixture.nodes[0]),before=node.serialize(),raw=clone(fixture.nodes[0]);change(raw);
    assert.throws(()=>node.configure(raw),error=>/槽位顺序/.test(error.message)&&!error.message.includes('TOKEN-DO-NOT-LOG'));
    assert.deepEqual(node.serialize(),before);
  }
});

function pinnedGraph(method) {
  class GraphState {
    constructor() { this.clear(); }
    clear() { this.data={nodes:[],groups:[],extra:{},config:{},state:{lastNodeId:0,lastLinkId:0}};this.links=new Map();this.id='host-id';this.revision=0; }
    configure(raw) {
      this.clear();
      // 1.53.10 hydrateExtensionPayload/runExtensionSerializeHook put the old
      // fields in BOTH asSerialisable top-level and extensions. serialize then
      // projects a fixed root schema, dropping the legacy top-level positions.
      this.data=clone(raw);const known=new Set(['id','revision','version','nodes','groups','links','config','extra','definitions','state','extensions','last_node_id','last_link_id','floatingLinks','reroutes','subgraphs','name','category','description','inputNode','outputNode','inputs','outputs','widgets']);
      const legacy=Object.fromEntries(Object.entries(raw).filter(([key])=>!known.has(key)));
      this.data.extensions={...clone(raw.extensions||{}),...clone(legacy)};
      this.data.state={lastNodeId:80,lastLinkId:90};this.data.config ||= {};this.data.extra ||= {};
      this.id=raw.id||'host-id';this.links=new Map((raw.links||[]).map(link=>[link[0],{serialize:()=>clone(link)}]));
    }
    asSerialisable() { return clone(this.data); }
  }
  return new Function('GraphState','Z',`return class LGraph extends GraphState {
    ${method || `serialize() {const {nodes,groups,extra,config,state,extensions,definitions}=this.asSerialisable();return {id:this.id,revision:this.revision,last_node_id:state.lastNodeId,last_link_id:state.lastLinkId,nodes,groups,extra,config,extensions,definitions,links:[...this.links.values()].map(link=>link.serialize()),version:0.4};}`}
  }`)(GraphState,{VERSION:0.4});
}
function assertWorkflowEnvelopeRoundtrip(method) {
  const Root=pinnedGraph(method), raw=clone(fixture);
  raw.extensions={unknownWorkflow:{namespaced:'distinct from top-level'},foreignNamespace:{nested:[1,null,'kept']},nodes:{extensionDataOnly:true}};
  const broken=new Root();broken.configure(raw);
  assert.equal(broken.serialize().unknownWorkflow,undefined);
  assert.deepEqual(broken.serialize().extensions.unknownWorkflow,raw.unknownWorkflow);
  const graph=new Root(),original={configure:graph.configure,serialize:graph.serialize,clear:graph.clear,asSerialisable:graph.asSerialisable};
  const release=integration.installReadonlyWorkflowSerialization(graph);
  assert.equal(integration.installReadonlyWorkflowSerialization(graph),release);
  graph.configure(raw);
  for (const saved of [graph.serialize(),graph.asSerialisable()]) {
    assert.deepEqual(saved.unknownWorkflow,raw.unknownWorkflow);
    assert.deepEqual(saved.extensions,raw.extensions);
    assert.equal(saved.nodes[0].id,raw.nodes[0].id);assert.deepEqual(saved.nodes[0].unknownTopLevel,raw.nodes[0].unknownTopLevel);
  }
  const first=graph.serialize();first.nodes[0].title='explicit title edit';graph.configure(first);
  assert.equal(graph.serialize().nodes[0].title,'explicit title edit');assert.deepEqual(graph.serialize().unknownWorkflow,raw.unknownWorkflow);
  graph.configure({version:0.4,nodes:[],groups:[],links:[],extra:{},otherWorkflow:{fresh:true},extensions:{unknownWorkflow:{secondNamespace:true}}});
  assert.equal(graph.serialize().unknownWorkflow,undefined);assert.deepEqual(graph.serialize().extensions,{unknownWorkflow:{secondNamespace:true}});
  assert.deepEqual(graph.serialize().otherWorkflow,{fresh:true});
  graph.clear();assert.equal(graph.serialize().otherWorkflow,undefined);assert.equal(graph.serialize().unknownWorkflow,undefined);
  graph.configure({version:0.4,nodes:[],groups:[],links:[],extra:{},unknownWorkflow:{onlyLegacy:true}});
  assert.equal(graph.serialize().extensions,undefined);
  graph.configure(first);assert.deepEqual(graph.serialize().extensions,raw.extensions);
  const before=graph.serialize(),bad=clone(first);bad.nodes[0].inputs.reverse();assert.throws(()=>graph.configure(bad),/槽位顺序/);assert.deepEqual(graph.serialize(),before);
  assert.throws(()=>graph.configure({...clone(first),extensions:['malformed']}),/扩展字段/);assert.deepEqual(graph.serialize(),before);
  release();release();for(const [key,value] of Object.entries(original))assert.equal(graph[key],value);
}
test('workflow envelope preserves conflicting unknown fields, native ownership, reload, switch and clear',()=>assertWorkflowEnvelopeRoundtrip());
test('installed 1.53.10 actual LGraph.serialize projection preserves unknown fields through bridge', {skip: !process.env.STUDIO_PINNED_HOST_BUNDLE},()=>{
  const bundle=readFileSync(process.env.STUDIO_PINNED_HOST_BUNDLE);assert.equal(createHash('sha256').update(bundle).digest('hex'),hostContract.bundleSha256);
  const text=bundle.toString('utf8'),start=text.indexOf('class LGraph{'),a=text.indexOf('serialize(e){',start),b=text.indexOf('toJSON(){',a);
  assert.ok(start>=0&&a>start&&b>a);
  assertWorkflowEnvelopeRoundtrip(text.slice(a,b));
});

const nestedFixture = JSON.parse(readFileSync(new URL('./fixtures/nested-readonly-workflow.json',import.meta.url),'utf8'));
function nestedHost(subgraphMethod) {
  const nodeKeys=['title','id','type','pos','size','flags','order','mode','outputs','inputs','properties','widgets_values','widgets_values_named'];
  const linkKeys=['id','origin_id','origin_slot','target_id','target_slot','type','parentId'];
  const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,clone(value[key])]));
  const topology=graph=>({links:[...graph.links.values()].map(link=>pick(link,linkKeys))});
  const nodes=graph=>graph.nodes.map(node=>{
    const result=pick(node,nodeKeys);
    for(const [side,linkKey] of [['inputs','link'],['outputs','links']]) for(const [index,slot] of (result[side]||[]).entries()) {
      delete slot.unknownSlot;
      const live=[...graph.links.values()].filter(link=>side==='inputs'?link.target_id===node.id&&link.target_slot===index:link.origin_id===node.id&&link.origin_slot===index).map(link=>link.id);
      slot[linkKey]=side==='inputs'?(live[0]??null):(live.length?live:null);
    }
    return result;
  });
  class GraphState {
    constructor(root) {this.rootGraph=root||this;this.clear();}
    clear(){this.nodes=[];this.links=new Map();this.groups=[];this.extra={};this.config={};this.state={};this.data={};if(this.rootGraph===this)this.subgraphs=new Map();}
    getNodeById(id){return this.nodes.find(node=>String(node.id)===String(id));}
    remove(node){this.nodes=this.nodes.filter(item=>item!==node);const registry=this.rootGraph.subgraphs;if(registry.has(node.type)&&![this.rootGraph,...registry.values()].some(graph=>graph.nodes.some(item=>item.type===node.type)))registry.delete(node.type);}
    createNormalizedSubgraph(raw){const graph=new Subgraph(this.rootGraph);graph.id=raw.id;this.rootGraph.subgraphs.set(raw.id,graph);return graph;}
    configure(raw){
      this.clear();this.data=clone(raw);for(const key of ['id','revision','config','state','name','description','extra','widgets'])this[key]=clone(raw[key]??(key==='widgets'?[]:{}));
      this.nodes=clone(raw.nodes||[]);this.links=new Map((raw.links||[]).map(link=>[link.id,clone(link)]));
      this.groups=clone(raw.groups||[]);this.inputNode={asSerialisable:()=>clone(raw.inputNode)};this.outputNode={asSerialisable:()=>clone(raw.outputNode)};
      this.inputs=(raw.inputs||[]).map(slot=>({asSerialisable:()=>clone(slot)}));this.outputs=(raw.outputs||[]).map(slot=>({asSerialisable:()=>clone(slot)}));
      const definitions=[];const flatten=list=>{for(const def of list||[]){definitions.push(def);flatten(def.definitions?.subgraphs);}};flatten(raw.definitions?.subgraphs);
      for(const def of definitions)this.createNormalizedSubgraph(def);
      for(const def of definitions){const flat=clone(def);if(flat.definitions)delete flat.definitions.subgraphs;this.rootGraph.subgraphs.get(def.id).configure(flat);}
    }
    serialize(){return this.asSerialisable();}
  }
  const Subgraph = new Function('GraphState','serialiseOwnedTopology','serialiseStoredNodes','serialiseStoredGroups','eu',`return class Subgraph extends GraphState {
    ${subgraphMethod || `asSerialisable(){return {id:this.id,version:1,state:this.state,revision:this.revision,config:this.config,name:this.name,inputNode:this.inputNode.asSerialisable(),outputNode:this.outputNode.asSerialisable(),inputs:this.inputs.map(slot=>slot.asSerialisable()),outputs:this.outputs.map(slot=>slot.asSerialisable()),widgets:[...this.widgets],nodes:serialiseStoredNodes(this),groups:serialiseStoredGroups(this),...serialiseOwnedTopology(this),extra:this.extra};}`}
  }`)(GraphState,topology,nodes,graph=>clone(graph.groups),{serialisedSchemaVersion:1});
  class Root extends GraphState {
    asSerialisable(){
      const used=new Set();const visit=list=>{for(const node of list){const child=this.subgraphs.get(node.type);if(child&&!used.has(child.id)){used.add(child.id);visit(child.nodes);}}};visit(this.nodes);
      return {id:this.id,version:0.4,nodes:nodes(this),links:topology(this).links,extra:clone(this.extra),groups:clone(this.groups),config:clone(this.config),
        ...(used.size?{definitions:{subgraphs:[...used].map(id=>this.subgraphs.get(id).asSerialisable())}}:{})};
    }
  }
  return {Root,Subgraph};
}
function assertNestedRoundtrip(method) {
  const {Root,Subgraph}=nestedHost(method),raw=clone(nestedFixture),[outerRaw,innerRaw]=raw.definitions.subgraphs;
  const broken=new Root();broken.configure(raw);
  assert.equal(broken.serialize().definitions.subgraphs[0].unknownWorkflow,undefined);
  assert.equal(broken.serialize().definitions.subgraphs[0].extensions,undefined);
  const graph=new Root(),release=integration.installReadonlyWorkflowSerialization(graph);graph.configure(raw);
  const outer=graph.subgraphs.get(outerRaw.id),inner=graph.subgraphs.get(innerRaw.id);
  for(const snapshot of [graph.serialize(),graph.asSerialisable()]) {
    assert.deepEqual(snapshot.unknownWorkflow,raw.unknownWorkflow);assert.deepEqual(snapshot.extensions,raw.extensions);
    assert.deepEqual(snapshot.definitions.unknownDefinitions,raw.definitions.unknownDefinitions);
    for(const source of raw.definitions.subgraphs){const saved=snapshot.definitions.subgraphs.find(child=>child.id===source.id);
      assert.deepEqual(saved.unknownWorkflow,source.unknownWorkflow);assert.deepEqual(saved.extensions,source.extensions);
      assert.deepEqual(saved.nodes,source.nodes);assert.deepEqual(saved.links,source.links);
    }
  }
  assert.deepEqual(inner.asSerialisable().extensions,innerRaw.extensions);
  outer.name='User renamed outer';outer.nodes[0].pos=[130,150];outer.nodes[1].properties.savedOpaqueValue='user edit';
  let saved=graph.serialize().definitions.subgraphs.find(child=>child.id===outer.id);
  assert.equal(saved.name,'User renamed outer');assert.deepEqual(saved.nodes[0].pos,[130,150]);assert.equal(saved.nodes[1].properties.savedOpaqueValue,'user edit');
  outer.nodes=outer.nodes.filter(node=>node.id!==12);outer.links.delete(101);
  saved=graph.serialize().definitions.subgraphs.find(child=>child.id===outer.id);assert.ok(!saved.nodes.some(node=>node.id===12));assert.deepEqual(saved.links,[]);
  const replacement={...clone(outerRaw.nodes[1]),unknownNode:undefined,extensions:undefined};delete replacement.unknownNode;delete replacement.extensions;delete replacement.inputs[0].unknownSlot;
  outer.nodes.push(replacement);const newLink={...clone(outerRaw.links[0])};delete newLink.unknownWire;delete newLink.extensions;outer.links.set(101,newLink);
  saved=graph.serialize().definitions.subgraphs.find(child=>child.id===outer.id);
  assert.equal(saved.nodes.find(node=>node.id===12).unknownNode,undefined);assert.equal(saved.links[0].unknownWire,undefined);
  outer.remove(outer.nodes.find(node=>node.id===13));assert.ok(!graph.serialize().definitions.subgraphs.some(child=>child.id===inner.id));assert.equal(inner.asSerialisable,Subgraph.prototype.asSerialisable);
  graph.configure(raw);const oldChild=graph.subgraphs.get(innerRaw.id),second=clone(raw);second.unknownWorkflow={scope:'second root'};second.definitions.subgraphs[1].unknownWorkflow={scope:'second inner'};
  graph.configure(second);assert.equal(oldChild.asSerialisable,Subgraph.prototype.asSerialisable);
  assert.deepEqual(graph.subgraphs.get(innerRaw.id).asSerialisable().unknownWorkflow,{scope:'second inner'});
  // A newly duplicated graph receives its own configure archive, even when it
  // was not present in the root's original definitions snapshot.
  const duplicate=clone(innerRaw);duplicate.id='63eca6da-0a01-4501-9000-000000000004';duplicate.unknownWorkflow={scope:'duplicate'};
  const fresh=graph.createNormalizedSubgraph(duplicate);fresh.configure(duplicate);graph.nodes.push({id:90,type:duplicate.id,inputs:[],outputs:[],properties:{}});
  assert.deepEqual(graph.serialize().definitions.subgraphs.find(child=>child.id===duplicate.id).unknownWorkflow,{scope:'duplicate'});
  for(let i=0;i<20;i++){
    const def={...clone(duplicate),id:`63eca6da-0a01-4501-9100-${String(i).padStart(12,'0')}`};const transient=graph.createNormalizedSubgraph(def);transient.configure(def);
    const wrapper={id:100+i,type:def.id,inputs:[],outputs:[],properties:{}};graph.nodes.push(wrapper);graph.remove(wrapper);
    assert.equal(transient.asSerialisable,Subgraph.prototype.asSerialisable);assert.ok(!graph.subgraphs.has(def.id));
  }
  graph.clear();assert.equal(fresh.asSerialisable,Subgraph.prototype.asSerialisable);assert.equal(graph.serialize().unknownWorkflow,undefined);release();
}
test('nested unknown graph/node/slot/link payloads survive current host projection without undoing edits or deletion',()=>assertNestedRoundtrip());
test('recursively declared definitions follow UUID identity through host flattening and retain container metadata',()=>{
  const {Root}=nestedHost(),raw=clone(nestedFixture),[outer,inner]=raw.definitions.subgraphs;
  outer.definitions={subgraphs:[inner],unknownContainer:{scope:'outer container'}};raw.definitions.subgraphs=[outer];
  const graph=new Root(),release=integration.installReadonlyWorkflowSerialization(graph);graph.configure(raw);
  const saved=graph.serialize().definitions.subgraphs;assert.equal(saved.length,2);
  assert.deepEqual(saved.find(item=>item.id===inner.id).extensions,inner.extensions);
  assert.deepEqual(saved.find(item=>item.id===outer.id).definitions,{unknownContainer:{scope:'outer container'}});release();
});
test('installed 1.53.10 actual Subgraph.asSerialisable preserves nested payloads through bridge', {skip:!process.env.STUDIO_PINNED_HOST_BUNDLE},()=>{
  const bytes=readFileSync(process.env.STUDIO_PINNED_HOST_BUNDLE);assert.equal(createHash('sha256').update(bytes).digest('hex'),hostContract.bundleSha256);
  const text=bytes.toString('utf8'),start=text.indexOf('class Subgraph extends'),a=text.indexOf('asSerialisable(){',start),b=text.indexOf('},InputIndicators',a);
  assert.ok(a>start&&b>a);assertNestedRoundtrip(text.slice(a,b));
});

test('all six actual serialized shapes retain raw unknown data, slots, widgets and links',()=>{
  for (const raw of fixture.nodes.slice(0,6)) {
    const node = native(raw), saved = node.serialize();
    assert.deepEqual(saved,raw);
    const reloaded = native(saved);
    assert.deepEqual(reloaded.serialize(),raw);
    assert.equal(node.onConnectInput(),false);assert.equal(node.onConnectOutput(),false);
    assert.throws(()=>node.onExecute(),/禁止执行/);
  }
  const graph = {...clone(fixture),nodes:fixture.nodes.map(raw=>core.isReadonlyType(raw.type)?native(raw).serialize():clone(raw))};
  assert.deepEqual(graph,fixture);
});
test('old 14-input GPT and appended imported_storyboard slot both keep exact indexes',()=>{
  const raw=clone(fixture.nodes[0]);const old=native(raw);old.inputs.push({name:'imported_storyboard',type:'STRING',link:null});
  assert.equal(old.serialize().inputs.length,14);
  raw.inputs.push({name:'imported_storyboard',type:'STRING',link:777,unknownSlot:true});
  const updated=native(raw);assert.equal(updated.serialize().inputs[14].link,777);assert.equal(updated.serialize().inputs[14].unknownSlot,true);
  updated.inputs.unshift({name:'bad',type:'*',link:null});assert.throws(()=>updated.serialize(),/槽位顺序/);
});
test('readonly projection understands seed control and early shifted widget export without rewriting',()=>{
  const raw=clone(fixture.nodes[0]);const normal=core.projectReadonly(raw);assert.equal(normal.parameters.seed,7);assert.equal(normal.parameters.main_prompt,'合成风格');assert.equal(normal.results[0].id,'shot-public');
  raw.widgets_values.splice(10,1);const before=clone(raw);const shifted=core.projectReadonly(raw);
  assert.equal(shifted.parameters.main_prompt,'合成风格');assert.equal(shifted.storyboard.shots[0].id,'shot-public');assert.match(shifted.warnings[0],/缺少 seed/);assert.deepEqual(raw,before);
});
test('native movement and link edits preserve immutable raw parameters and unknown fields',()=>{
  const raw=clone(fixture.nodes[0]),node=native(raw);node.pos=[50,90];node.title='renamed';node.properties.unknownNested=null;node.widgets_values[11]='unwanted edit';node.outputs[0].links=[];
  const saved=node.serialize();assert.deepEqual(saved.pos,[50,90]);assert.equal(saved.title,'renamed');assert.deepEqual(saved.properties,raw.properties);assert.equal(saved.widgets_values[11],'合成风格');assert.deepEqual(saved.outputs[0].links,[]);assert.deepEqual(saved.unknownTopLevel,raw.unknownTopLevel);
});
test('GPT preview converts actual saved rows and results but strips executable recovery bindings',()=>{
  const raw=clone(fixture.nodes[0]),before=clone(raw);const preview=core.previewGPTConversion(raw,readStoryboard);
  assert.equal(preview.summary.rows,1);assert.equal(preview.table.records[0].id,'shot-public');assert.equal(typeof preview.table.records[0].values.image_prompt,'string');assert.equal(preview.table.records[0].values.image_url[0].url,'/view?filename=synthetic.png&type=input');assert.deepEqual(raw,before);
  const source={table:{version:1,fields:[{id:'g',name:'old result',type:'content',presentation:'generation',generation:{provider:'libtv'}}],records:[{id:'r',values:{g:[]},meta:{generationColumns:{g:{requestId:'old'}},generation:{request:'old'},unknown:'kept'}}],meta:{liveSource:{old:true},generationInput:{old:true}}}};
  raw.widgets_values[12]=JSON.stringify(source);const converted=core.previewGPTConversion(raw,readStoryboard);
  assert.equal(converted.table.records[0].meta.generationColumns,undefined);assert.equal(converted.table.meta.liveSource,undefined);assert.equal(converted.table.fields[0].generation,undefined);assert.equal(converted.table.records[0].meta.unknown,'kept');
});
test('GPT conversion refuses linked, malformed, oversize and silently truncated input',()=>{
  const raw=clone(fixture.nodes[0]);raw.inputs.push({name:'imported_storyboard',type:'STRING',link:55});assert.throws(()=>core.previewGPTConversion(raw,readStoryboard),/上游/);
  raw.inputs.pop();raw.widgets_values[12]='invalid';assert.throws(()=>core.previewGPTConversion(raw,readStoryboard),/解析/);
  raw.widgets_values[12]=JSON.stringify({shots:Array.from({length:501},(_,i)=>({id:String(i),image_prompt:'fixture'}))});assert.throws(()=>core.previewGPTConversion(raw,readStoryboard),/未截断/);
  assert.throws(()=>core.previewGPTConversion(fixture.nodes[0],()=>({fields:[],records:[]})),/记录数量/);
});
function graphSetup() {
  const original=native(fixture.nodes[0]);let nodes=[original];const graph={get _nodes(){return nodes;},getNodeById(id){return nodes.find(n=>n.id===id);},add(node){node.id=99;node.graph=this;nodes.push(node);},remove(node){nodes=nodes.filter(n=>n!==node);node.graph=null;},serialize(){return {nodes:nodes.map(n=>n.serialize()),links:clone(fixture.links)};},change(){},setDirtyCanvas(){}};original.graph=graph;
  graph.configure=snapshot=>{for(const node of nodes)node.graph=null;nodes=snapshot.nodes.map(raw=>{const node=core.isReadonlyType(raw.type)?native(raw):new NativeNode();if(!core.isReadonlyType(raw.type)){node.configure(raw);node.widgets=[{name:'table_data',value:raw.widgets_values[0]}];}node.graph=graph;return node;});};
  const workflow={};const app={graph,rootGraph:graph,isGraphReady:true,extensionManager:{workflow:{activeWorkflow:workflow}}};
  const before=[],after=[];let start,ends=0;const history={begin(){start=graph.serialize();},end(){ends++;if(JSON.stringify(start)!==JSON.stringify(graph.serialize())){before.push(start);after.push(graph.serialize());}}};
  const port=integration.nativeConversionPort(original,app,history);
  return {node:original,graph,app,port,before,after,get ends(){return ends;}};
}
test('confirmed conversion appends one native table in one history boundary and never changes old links',t=>{
  const prior=globalThis.LiteGraph;globalThis.LiteGraph={createNode(){const node=new NativeNode();node.type='DAELAB.Table';node.widgets=[{name:'table_data',value:''}];return node;}};t.after(()=>globalThis.LiteGraph=prior);
  const s=graphSetup(),original=s.graph.serialize(),preview=core.previewGPTConversion(s.port.readSource(),readStoryboard);
  assert.equal(s.graph._nodes.length,1);core.applyGPTConversion(preview,s.port);assert.equal(s.graph._nodes.length,2);assert.equal(s.before.length,1);assert.equal(s.ends,1);assert.deepEqual(s.before[0],original);assert.deepEqual(s.after[0].links,original.links);assert.deepEqual(s.node.serialize(),original.nodes[0]);
  assert.throws(()=>core.applyGPTConversion(preview,s.port),/已应用/);assert.equal(s.graph._nodes.length,2);s.port.dispose();
});
test('stale workflow and failed native add do not apply conversion or change original graph',t=>{
  const prior=globalThis.LiteGraph;globalThis.LiteGraph={createNode(){const node=new NativeNode();node.type='DAELAB.Table';node.widgets=[{name:'table_data',value:''}];return node;}};t.after(()=>globalThis.LiteGraph=prior);
  const s=graphSetup(),preview=core.previewGPTConversion(s.port.readSource(),readStoryboard),original=s.graph.serialize();s.app.extensionManager.workflow.activeWorkflow={};assert.throws(()=>core.applyGPTConversion(preview,s.port),/工作流/);assert.deepEqual(s.graph.serialize(),original);s.port.dispose();
  const f=graphSetup(),p=core.previewGPTConversion(f.port.readSource(),readStoryboard);const add=f.graph.add;f.graph.add=function(n){add.call(this,n);throw Error('synthetic native failure');};const before=f.graph.serialize();assert.throws(()=>core.applyGPTConversion(p,f.port),/synthetic/);assert.deepEqual(f.graph.serialize(),before);assert.equal(f.before.length,0);f.port.dispose();
});

test('native host history bridge undoes and redoes the entire conversion including table content',async t=>{
  const prior=globalThis.LiteGraph;globalThis.LiteGraph={createNode(){const node=new NativeNode();node.type='DAELAB.Table';node.widgets=[{name:'table_data',value:''}];return node;}};t.after(()=>globalThis.LiteGraph=prior);
  const s=graphSetup();s.port.dispose();let start;const undo=[],redo=[];
  s.app.extensionManager.workflow.activeWorkflow.changeTracker={captureCanvasState(){},squashState:{flush(){}},beforeChange(){start=s.graph.serialize();},afterChange(){undo.push(start);},async undo(){redo.push(s.graph.serialize());s.graph.configure(undo.pop());},async redo(){undo.push(s.graph.serialize());s.graph.configure(redo.pop());}};
  const history=canvasHistory(s.app),port=integration.nativeConversionPort(s.node,s.app,history),before=s.graph.serialize();
  const preview=core.previewGPTConversion(port.readSource(),readStoryboard);core.applyGPTConversion(preview,port);const converted=s.graph.serialize();
  assert.equal(undo.length,1);assert.deepEqual(JSON.parse(converted.nodes[1].widgets_values[0]),preview.table);
  await history.undo();assert.deepEqual(s.graph.serialize(),before);await history.redo();assert.deepEqual(s.graph.serialize(),converted);port.dispose();
});

test('queue protection checks root and used subgraph definitions and rejects event modes',()=>{
  for(const mode of [undefined,0,1,3,99]) assert.throws(()=>core.assertReadonlyExecutionAllowed([{type:core.GPT_TYPE,mode}]),/只读节点不可执行/);
  for(const mode of [2,4]) core.assertReadonlyExecutionAllowed([{type:core.GPT_TYPE,mode}]);
  assert.throws(()=>core.assertReadonlyWorkflowExecutionAllowed({nodes:[],definitions:{subgraphs:[{nodes:[{type:core.PROTOTYPE_TYPES[0]}]}]}}),/只读节点不可执行/);
  assert.throws(()=>core.assertReadonlyWorkflowExecutionAllowed({nodes:[],definitions:{subgraphs:{}}}),/子图格式未知/);
});

class Element extends BaseElement { querySelectorAll(){return [];} closest(){return null;} showModal(){this.open=true;} }
function dom(t) {const old=globalThis.document;globalThis.document={createElement:tag=>new Element(tag),body:new Element('body')};t.after(()=>{if(old===undefined)delete globalThis.document;else globalThis.document=old;});}
test('two readonly panels display only their own saved data and release availability timers',t=>{
  dom(t);const a=native(fixture.nodes[0]),raw=clone(fixture.nodes[0]);raw.id=200;raw.widgets_values[11]='second instance';const b=native(raw);
  const pa=integration.createReadonlyPanel(a,{},{}),pb=integration.createReadonlyPanel(b,{},{});t.after(()=>{pa.destroy();pb.destroy();});
  assert.match(pa.fields[0].value,/合成风格/);assert.doesNotMatch(pa.fields[0].value,/second instance/);assert.match(pb.fields[0].value,/second instance/);assert.equal(pa.fields[0].readOnly,true);pa.destroy();pb.sync();assert.match(pb.fields[0].value,/second instance/);
});
test('conversion UI requires a review dialog and confirmation; cancel changes nothing',t=>{
  dom(t);const prior=globalThis.LiteGraph;globalThis.LiteGraph={createNode(){const node=new NativeNode();node.type='DAELAB.Table';node.widgets=[{name:'table_data',value:''}];return node;}};t.after(()=>globalThis.LiteGraph=prior);
  const s=graphSetup(),before=s.graph.serialize();let starts=0,ends=0;
  const panel=integration.createReadonlyPanel(s.node,s.app,{begin(){starts++;},end(){ends++;}});t.after(()=>panel.destroy());
  const previewButton=panel.buttons.find(b=>b.textContent==='预览转换为表格');previewButton.onclick();assert.deepEqual(s.graph.serialize(),before);
  let dialog=document.body.children[0];assert.equal(dialog.open,true);assert.match(dialog.children[1].textContent,/新增 1 行/);dialog.children.at(-1).children[0].onclick();assert.deepEqual(s.graph.serialize(),before);assert.equal(document.body.children.length,0);
  previewButton.onclick();dialog=document.body.children[0];dialog.children.at(-1).children[1].onclick();assert.equal(s.graph._nodes.length,2);assert.equal(starts,1);assert.equal(ends,1);assert.equal(document.body.children.length,0);s.port.dispose();
});

test('constructor-time GPT panel retains conversion control after native type hydration',t=>{
  dom(t);
  class ConstructingComfyNode extends NativeNode {}
  integration.installReadonlySerialization(ConstructingComfyNode);
  const node=new ConstructingComfyNode();node.comfyClass=core.GPT_TYPE;
  assert.equal(node.type,undefined);
  const panel=integration.createReadonlyPanel(node,{},{});t.after(()=>panel.destroy());
  const preview=panel.buttons.find(button=>button.textContent==='预览转换为表格');
  assert.ok(preview,'host constructor exposes conversion before LiteGraph assigns type');
  node.configure(clone(fixture.nodes[0]));panel.sync();
  assert.match(panel.fields[0].value,/合成风格/);
  assert.equal(panel.buttons.filter(button=>button.textContent==='预览转换为表格').length,1);
  preview.onclick();assert.equal(document.body.children[0].open,true);
  panel.close();assert.equal(document.body.children.length,0);
});
test('assembly registers four exact frontend virtual schemas and blocks queue without blocking serialization',async t=>{
  dom(t);let dispose;const keys=['LiteGraph','LGraphNode','addEventListener','removeEventListener'];const previous=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));t.after(()=>{dispose?.();for(const k of keys)if(previous[k]===undefined)delete globalThis[k];else globalThis[k]=previous[k];});
  const types={registered_node_types:{},registerNodeType(type,cls){this.registered_node_types[type]=cls;}};Object.assign(globalThis,{LiteGraph:types,LGraphNode:NativeNode,addEventListener(){},removeEventListener(){}});
  let extension,queued=0;const graph={serialize:()=>clone(fixture)};const app={graph,isGraphReady:true,registerExtension(value){extension=value;},async queuePrompt(){queued++;}};
  dispose=integration.installCompatReadonly(app,{history:{}});extension.registerCustomNodes();assert.equal(Object.keys(types.registered_node_types).length,4);
  assert.deepEqual(core.PROTOTYPE_SLOTS,sourceContract.prototypeSlots);assert.deepEqual([...core.PROTOTYPE_TYPES],Object.keys(sourceContract.prototypeSizes));
  for(const raw of fixture.nodes.slice(2,6)){const cls=types.registered_node_types[raw.type];const node=new cls();assert.deepEqual(node.size,sourceContract.prototypeSizes[raw.type]);node.configure(raw);assert.equal(node.isVirtualNode,true);assert.equal(cls.skip_list,true);assert.deepEqual(node.serialize(),raw);assert.deepEqual(node.inputs.map(({name,type})=>({name,type})),sourceContract.prototypeSlots.inputs);}
  assert.deepEqual(graph.serialize(),fixture);await assert.rejects(app.queuePrompt(),/只读节点不可执行/);assert.equal(queued,0);graph.serialize=()=>({nodes:fixture.nodes.map(node=>({...node,mode:2}))});await app.queuePrompt();assert.equal(queued,1);
});
