import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../migrated_business/register.mjs';
import {createInputPersistenceStageObserver, loadInputPersistenceBindings, mountInputPersistenceStages, INPUT_STAGE_MODULES, INPUT_STAGE_TARGETS} from '../host_fixture/web/input_persistence_stages.js';
import {readTableSemanticFixture} from '../host_fixture/web/performance_table_semantic.js';

// CI runs this directory with plain `node --test`. Register the existing source
// loader before resolving TS (including parameter properties) or its .js imports.
const {DocumentController} = await import('../../frontend/src/application/document_controller.ts');
const {createBusinessDocument} = await import('../../frontend/src/application/business_document.ts');
const {OptimizationRevisions} = await import('../../frontend/src/features/prompt/prompt_optimization_model.mjs');
const {businessHost, installBusinessHost} = await import('../../frontend/src/contracts/business.ts');

const bytes = fs.readFileSync(new URL('../fixtures/performance/FX-PERF-M-no-video.json', import.meta.url));
const fixture = await readTableSemanticFixture(bytes, globalThis.crypto);
const fingerprint = 'd'.repeat(64);
const fixtureValue = index => JSON.stringify({
  fields: Array.from({length: 10}, (_, n) => ({id: `field-${String(n).padStart(2, '0')}`, type: 'content'})),
  records: Array.from({length: 500}, (_, n) => ({id: `M-table-0${index}-row-${String(n + 1).padStart(4, '0')}`, values: {}})),
});
class Hub {
  listeners = new Map();
  addEventListener(type, fn, options = {}) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    options.signal?.addEventListener('abort', () => this.listeners.get(type).delete(fn), {once: true});
  }
  emit(type, event = {}) { event.type = type; return [...(this.listeners.get(type) || [])].map(fn => fn(event)); }
  count() { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0); }
}
class Element extends Hub {
  constructor(tag, kind) { super(); Object.assign(this, {tagName: tag.toUpperCase(), kind, dataset: {}, attributes: new Map(), style: {}, children: [], parentElement: null, textContent: '', value: ''}); }
  get isConnected() { return this.base || !!this.parentElement?.isConnected; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  remove() { if (this.parentElement) { const parent = this.parentElement; this.parentElement = null; parent.children.splice(parent.children.indexOf(this), 1); } }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  closest(selector) {
    const kinds = {'.content-display': 'editor', 'td[data-record][data-field]': 'cell', 'tr[data-record-id]': 'row', '.dae-table': 'table', '.dae-creative-card[data-node-id]': 'card', '.dae-creative': 'canvas'};
    for (let node = this; node; node = node.parentElement) if (node.kind === kinds[selector]) return node;
    return null;
  }
  click() { this.clicked = true; }
}
function harness(options = {}) {
  let time = 100, next = 0;
  const timers = new Map(), microtasks = [], calls = [], body = new Element('body'); body.base = true;
  const find = (node, id) => node.id === id ? node : node.children.map(child => find(child, id)).find(Boolean);
  const document = Object.assign(new Hub(), {body, visibilityState: 'visible', createElement: tag => new Element(tag), getElementById: id => find(body, id)});
  const window = Object.assign(new Hub(), {performance: {now: () => ++time, timeOrigin: 100000}, innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
    location: {hostname: 'localhost', port: '8237'}, crypto: globalThis.crypto,
    setTimeout(fn) { timers.set(++next, fn); return next; }, clearTimeout(id) { timers.delete(id); }, queueMicrotask(fn) { microtasks.push(fn); },
    fetch() { throw Error('No HTTP in unit tests'); }, URL: {createObjectURL() { return 'blob:test'; }, revokeObjectURL() {}},
  });
  const root = new Element('section', 'canvas'); body.append(root);
  const dom = INPUT_STAGE_TARGETS.map(fixed => {
    const card = new Element('article', 'card'), table = new Element('div', 'table'), row = new Element('tr', 'row'), cell = new Element('td', 'cell'), editor = new Element('div', 'editor');
    card.dataset.nodeId = fixed.nodeId; row.dataset.recordId = fixed.recordId; Object.assign(cell.dataset, {record: fixed.recordId, field: fixed.fieldId, inlineEditing: 'true'});
    editor.setAttribute('contenteditable', 'true'); root.append(card); card.append(table); table.append(row); row.append(cell); cell.append(editor);
    return {card, table, row, cell, editor};
  });
  const graphPrototype = {serialize(...args) { calls.push({kind: 'serialize', self: this, args}); for (const node of nodes) node.widgets[0].serializeValue(); return {exactGraph: true}; }};
  const graph = Object.assign(Object.create(graphPrototype), {id: 'synthetic-native-root', getNodeById(id) { return nodes.find(node => String(node.id) === String(id)); }});
  const nodes = INPUT_STAGE_TARGETS.map((fixed, index) => ({id: Number(fixed.nodeId), type: 'DAELAB.Table', graph, widgets: [{name: 'table_data', value: fixtureValue(index), serializeValue(...args) { calls.push({kind: 'widget', nodeId: fixed.nodeId, self: this, args}); return this.value; }}]}));
  const history = {begin(...args) { calls.push({kind: 'begin', self: this, args}); }, end(...args) { calls.push({kind: 'end', self: this, args}); }, amend(fn) { calls.push({kind: 'amend', self: this}); return fn(); }, undo() {}, redo() {}};
  const app = {isGraphReady: true, rootGraph: graph};
  const deps = {document, window, app, DocumentController, OptimizationRevisions, businessHost: () => ({history}), ...options};
  const observer = createInputPersistenceStageObserver(deps);
  const start = () => observer.start({isTrusted: true}, {fixture, buildFingerprint: fingerprint});
  const event = (index = 0, extra = {}) => ({type: 'input', isTrusted: true, eventPhase: 1, target: dom[index].editor, timeStamp: time, inputType: 'insertText', data: 'P', isComposing: false, ...extra});
  const flushMicrotasks = () => { for (const fn of microtasks.splice(0)) fn(); };
  const flushTimers = () => { const all = [...timers.values()]; timers.clear(); for (const fn of all) fn(); };
  const dispatch = (fn = () => {}, index = 0, extra = {}) => {
    const e = event(index, extra); document.emit('input', e); e.eventPhase = 2;
    try { return fn(e); } finally { e.eventPhase = 0; flushMicrotasks(); flushTimers(); }
  };
  return {document, window, body, root, dom, graph, graphPrototype, nodes, app, history, calls, deps, observer, start, event, dispatch, timers, microtasks, flushMicrotasks, flushTimers};
}
const sample = h => h.observer.report().samples.at(-1);
const byName = (sample, name) => sample.spans.filter(span => span.boundary === name);
const descriptor = (target, key) => Object.getOwnPropertyDescriptor(target, key);

test('import, construction, mount, invalid Start are inert and do not read an unready graph', () => {
  let reads = 0; const app = {isGraphReady: false, get rootGraph() { reads++; throw Error('too early'); }};
  const h = harness({app});
  assert.equal(reads, 0); assert.equal(h.document.count(), 0); assert.equal(h.observer.start({isTrusted: false}, {fixture, buildFingerprint: fingerprint}), false);
  assert.equal(h.start(), false); assert.deepEqual(h.observer.report().preflight, ['graph-not-ready']); assert.equal(reads, 0);
  const mounted = mountInputPersistenceStages(h.document, h.window, {app});
  assert.equal(reads, 0); assert.equal(h.observer.resources().leasedMethods, 0); assert.equal(h.timers.size, 0);
  assert.equal(mountInputPersistenceStages(h.document, h.window, {app}), null);
  mounted.dispose(); h.observer.dispose();
});

test('preparation checks manifest before canonical imports and preserves missing export diagnostics', async () => {
  const urls = [], requests = [], raw = new TextEncoder().encode(JSON.stringify({sourceFingerprint: fingerprint}));
  const result = await loadInputPersistenceBindings({buildFingerprint: fingerprint, crypto: globalThis.crypto,
    fetch: async (url, options) => { requests.push({url, options}); return {ok: true, arrayBuffer: async () => raw.buffer}; },
    importModule: async url => { urls.push(url); if (url === INPUT_STAGE_MODULES.host) throw Error('offline'); return url === INPUT_STAGE_MODULES.controller ? {DocumentController} : {OptimizationRevisions}; },
  });
  assert.equal(requests.length, 1); assert.equal(requests[0].options.method, 'GET'); assert.equal(requests[0].options.cache, 'no-store');
  assert.deepEqual(urls, Object.values(INPUT_STAGE_MODULES)); assert(urls.every(url => !url.includes('?')));
  assert.equal(result.DocumentController, DocumentController); assert.equal(result.OptimizationRevisions, OptimizationRevisions); assert.equal(result.businessHost, undefined);
  assert.equal(result.preparation.cachedModuleBytesAttested, false); assert.match(result.preparation.manifestSHA256, /^[a-f0-9]{64}$/);
  assert.equal(result.preparation.unavailable[0].module, 'host');
  await assert.rejects(loadInputPersistenceBindings({buildFingerprint: fingerprint, crypto: globalThis.crypto,
    fetch: async () => ({ok: true, arrayBuffer: async () => new TextEncoder().encode('{}').buffer}), importModule: () => assert.fail('mismatch must not import'),
  }), /fingerprint-mismatch/);
});

test('real public controller, business document, revision class and two widget instances retain nesting and isolation', t => {
  const h = harness(); t.after(() => h.observer.dispose()); assert(h.start());
  const oldEdit = DocumentController.prototype.edit, oldObserve = OptimizationRevisions.prototype.observe;
  const values = [{fields: [{id: 'field-00', type: 'content'}], records: [{id: 'a', values: {'field-00': 'before-a'}}]}, {fields: [{id: 'field-00', type: 'content'}], records: [{id: 'b', values: {'field-00': 'before-b'}}]}];
  const registries = [new OptimizationRevisions(), new OptimizationRevisions()];
  const docs = values.map((_, index) => createBusinessDocument({read: () => values[index], write: value => { values[index] = value; },
    current: () => true, identity: () => ({workflowSession: 'test', epoch: 1, documentId: String(index)}), history: h.history, historyStamp: () => JSON.stringify(h.graph.serialize())}));
  h.dispatch(() => docs[0].edit('real-a', table => { table.records[0].values['field-00'] = 'P'; }, {afterWrite: () => registries[0].observe(values[0])}));
  h.dispatch(() => docs[1].edit('real-b', table => { table.records[0].values['field-00'] = 'z'; }, {derived: true, afterWrite: () => registries[1].observe(values[1])}), 1);
  const [a, b] = h.observer.report().samples;
  assert.equal(values[0].records[0].values['field-00'], 'P'); assert.equal(values[1].records[0].values['field-00'], 'z');
  assert.equal(a.identity.nodeId, '1'); assert.equal(b.identity.nodeId, '2'); assert.notEqual(a.identity.editorToken, b.identity.editorToken);
  for (const s of [a, b]) {
    assert(s.complete); assert(s.restoration.exact); const edit = byName(s, 'DocumentController.edit')[0];
    assert(edit); assert.equal(edit.nodeId, null); assert.equal(edit.association, 'dispatch-associated-only');
    const historyAmend = byName(s, 'history.amend')[0];
    assert.equal(byName(s, 'OptimizationRevisions.observe')[0].parentSpan, historyAmend?.id ?? edit.id);
    const graph = byName(s, 'rootGraph.serialize')[0]; assert.equal(graph.parentSpan, edit.id);
    for (const nodeId of ['1', '2']) { const widget = byName(s, 'table_data.serializeValue:' + nodeId)[0]; assert.equal(widget.parentSpan, graph.id); assert.equal(widget.nodeId, nodeId); }
    assert(s.spans.every(span => span.durationMs >= 0 && span.asyncSettlementObserved === false));
  }
  assert.notEqual(byName(a, 'DocumentController.edit')[0].receiverToken, byName(b, 'DocumentController.edit')[0].receiverToken);
  assert.equal(byName(a, 'history.begin').length, 1); assert.equal(byName(b, 'history.amend').length, 1);
  assert.equal(DocumentController.prototype.edit, oldEdit); assert.equal(OptimizationRevisions.prototype.observe, oldObserve);
  assert.equal(descriptor(h.graph, 'serialize'), undefined); assert.equal(h.observer.report().productAcceptance, false);
  docs.forEach(doc => doc.dispose());
});

test('capture microtask checkpoint leaves hooks for target listener; next task restores without recursive microtasks', t => {
  const h = harness(); t.after(() => h.observer.dispose()); h.start();
  const original = h.graph.serialize, e = h.event(); h.document.emit('input', e);
  assert.notEqual(h.graph.serialize, original); h.flushMicrotasks(); // Real UA may checkpoint while eventPhase is CAPTURING_PHASE.
  assert.notEqual(h.graph.serialize, original); assert.equal(h.microtasks.length, 0); assert.equal(h.timers.size, 1);
  e.eventPhase = 2; h.graph.serialize(); e.eventPhase = 0;
  h.flushTimers(); assert.equal(h.graph.serialize, original); assert.equal(byName(sample(h), 'rootGraph.serialize').length, 1);
  assert.equal(sample(h).restoration.reason, 'next-task'); assert.equal(h.observer.resources().leasedMethods, 0);
});

test('post-dispatch microtask cleanup runs once; late method delegates with no borrowed attribution', t => {
  const h = harness(); t.after(() => h.observer.dispose()); h.start(); const e = h.event(); h.document.emit('input', e); e.eventPhase = 2; h.graph.serialize(); e.eventPhase = 0;
  h.graph.serialize(); // A prior microtask/other callback runs before our queued cleanup.
  assert.equal(byName(sample(h), 'rootGraph.serialize').length, 1); assert.equal(sample(h).restoration.reason, 'outside-input-dispatch');
  assert.equal(h.timers.size, 0); h.flushMicrotasks(); assert.equal(h.observer.resources().leasedMethods, 0);
  assert.equal(h.calls.filter(call => call.kind === 'serialize').length, 2);
});

test('different nested input event cannot borrow outer trust, target or active eventPhase', t => {
  const h = harness(); t.after(() => h.observer.dispose()); h.start();
  h.dispatch(outer => {
    h.graph.serialize(); assert.equal(outer.eventPhase, 2);
    const nested = h.event(1, {isTrusted: false}); h.document.emit('input', nested); h.graph.serialize(); nested.eventPhase = 0;
    h.graph.serialize();
  });
  assert.equal(h.observer.report().samples.length, 1); assert.equal(byName(sample(h), 'rootGraph.serialize').length, 1);
  assert.equal(sample(h).complete, false); assert.equal(sample(h).restoration.reason, 'nested-event-dispatch');
  assert.equal(h.observer.report().rejected['nested-event-dispatch'], 1); assert.equal(h.calls.filter(call => call.kind === 'serialize').length, 3);
});

test('this, args, returned object/Promise/exotic thenable and thrown error identities are transparent', t => {
  const h = harness(); const args = [{private: 'argument'}, Symbol('x')], receiver = {custom: true}, result = {private: 'result'};
  let thenReads = 0; const exotic = Object.defineProperty({}, 'then', {get() { thenReads++; throw Error('must not read'); }});
  const promise = Promise.resolve('untouched'), error = new Error('private exception'); let next = result;
  h.history.begin = function(...actual) { assert.equal(this, receiver); assert.equal(actual[0], args[0]); assert.equal(actual[1], args[1]); if (next === error) throw error; return next; };
  t.after(() => h.observer.dispose()); h.start();
  h.dispatch(() => {
    for (const value of [result, promise, exotic]) { next = value; assert.equal(h.history.begin.apply(receiver, args), value); }
    next = error; assert.throws(() => h.history.begin.apply(receiver, args), actual => actual === error);
  });
  assert.equal(thenReads, 0); assert.deepEqual(byName(sample(h), 'history.begin').map(span => span.outcome), ['returned', 'returned', 'returned', 'threw']);
  const json = JSON.stringify(h.observer.report()); for (const secret of ['private exception', 'argument', 'untouched']) assert(!json.includes(secret));
});

test('exact own/inherited descriptors restore, including configurable read-only and nonconfigurable writable methods', t => {
  const h = harness(); Object.defineProperty(h.history, 'begin', {value: h.history.begin, configurable: true, writable: false, enumerable: false});
  Object.defineProperty(h.history, 'end', {value: h.history.end, configurable: false, writable: true, enumerable: true});
  const begin = descriptor(h.history, 'begin'), end = descriptor(h.history, 'end'); t.after(() => h.observer.dispose()); h.start();
  h.dispatch(() => { h.history.begin(); h.history.end(); h.graph.serialize(); });
  assert.deepEqual(descriptor(h.history, 'begin'), begin); assert.deepEqual(descriptor(h.history, 'end'), end);
  assert.equal(descriptor(h.graph, 'serialize'), undefined); assert(sample(h).restoration.exact);
});

test('missing/unreplaceable/accessor boundaries stay unobserved without constructing another history service', t => {
  let getterReads = 0, hostReads = 0; const h = harness({DocumentController: undefined, businessHost: () => { hostReads++; throw Error('unavailable'); }});
  Object.defineProperty(h.graph, 'serialize', {get() { getterReads++; throw Error('do not execute getter'); }, configurable: true});
  Object.defineProperty(h.nodes[0].widgets[0], 'serializeValue', {value() {}, configurable: false, writable: false});
  t.after(() => h.observer.dispose()); assert(h.start()); assert.equal(getterReads, 0); assert.equal(hostReads, 1);
  h.dispatch(() => h.nodes[1].widgets[0].serializeValue());
  const report = h.observer.report(); assert.equal(report.boundaries.filter(item => !item.available).length, 6);
  assert.equal(sample(h).spans.length, 1); assert.equal(sample(h).spans[0].nodeId, '2'); assert.equal(getterReads, 0);
});

test('a later descriptor owner is preserved and conflict stops new observations after cleanup', () => {
  const h = harness(); h.start(); const e = h.event(); h.document.emit('input', e); e.eventPhase = 2;
  const foreign = function() { return 'foreign'; }; Object.defineProperty(h.history, 'begin', {value: foreign, configurable: true, writable: true, enumerable: false});
  e.eventPhase = 0; h.flushMicrotasks();
  assert.equal(h.history.begin, foreign); assert.equal(h.observer.resources().active, false); assert.equal(sample(h).restoration.exact, false);
  assert.equal(h.observer.report().conflicts[0].boundary, 'history.begin'); assert.equal(descriptor(h.graph, 'serialize'), undefined);
  h.observer.dispose(); assert.equal(h.history.begin, foreign);
});

test('shared public businessHost port is observed by identity; later owners may retain an inert released wrapper', t => {
  const h = harness(), release = installBusinessHost({history: h.history}); t.after(release);
  const observer = createInputPersistenceStageObserver({...h.deps, businessHost}); t.after(() => observer.dispose());
  assert(observer.start({isTrusted: true}, {fixture, buildFingerprint: fingerprint}));
  const original = h.history.begin, e = h.event(); h.document.emit('input', e); e.eventPhase = 2;
  const diagnostic = h.history.begin, later = function(...args) { return Reflect.apply(diagnostic, this, args); };
  h.history.begin = later; h.history.begin('once'); e.eventPhase = 0; h.flushMicrotasks(); observer.dispose();
  const before = observer.report(); h.history.begin('late');
  assert.equal(h.history.begin, later); assert.deepEqual(observer.report(), before);
  assert.equal(h.calls.filter(call => call.kind === 'begin').length, 2); assert.notEqual(diagnostic, original);
  assert.equal(observer.resources().leasedMethods, 0);
  const bootstrap = fs.readFileSync(new URL('../../frontend/src/integrations/comfyui/business/business_bootstrap.js', import.meta.url), 'utf8');
  assert.match(bootstrap, /installBusinessDocuments\(app,history\)/); assert.match(bootstrap, /installBusinessHost\(\{history,/);
});

test('installation race unwinds already-installed hooks and restores a proxy that mutates then throws', t => {
  const h = harness(); let armed = false;
  const target = h.history, original = descriptor(target, 'end');
  const proxy = new Proxy(target, {defineProperty(object, key, desc) { const result = Reflect.defineProperty(object, key, desc); if (armed && key === 'end' && desc.value !== original.value) throw Error('install trap'); return result; }});
  const observer = createInputPersistenceStageObserver({...h.deps, businessHost: () => ({history: proxy})}); t.after(() => observer.dispose());
  assert(observer.start({isTrusted: true}, {fixture, buildFingerprint: fingerprint})); const edit = descriptor(DocumentController.prototype, 'edit'); armed = true;
  h.dispatch(() => { assert.deepEqual(descriptor(target, 'end'), original); });
  assert.deepEqual(descriptor(DocumentController.prototype, 'edit'), edit); assert.equal(descriptor(h.graph, 'serialize'), undefined);
  const result = observer.report().samples[0]; assert.equal(result.installation, 'install-conflict'); assert.equal(result.restoration.reason, 'install-rollback'); assert(result.restoration.exact);
});

test('replacement graph, SaveAs id, DOM, widget and shared history invalidate timing without changing method outcome', t => {
  for (const kind of ['graph', 'graph-id', 'dom', 'widget', 'history']) {
    const h = harness(); let history = h.history;
    const observer = createInputPersistenceStageObserver({...h.deps, businessHost: () => ({history})}); t.after(() => observer.dispose());
    observer.start({isTrusted: true}, {fixture, buildFingerprint: fingerprint});
    const e = h.event(); h.document.emit('input', e); e.eventPhase = 2;
    const originalWrapped = h.graph.serialize;
    if (kind === 'graph') h.app.rootGraph = {...h.graph};
    if (kind === 'graph-id') h.graph.id = 'save-as';
    if (kind === 'dom') h.dom[0].editor.remove();
    if (kind === 'widget') h.nodes[0].widgets = [{...h.nodes[0].widgets[0]}];
    if (kind === 'history') history = {...h.history};
    assert.deepEqual(originalWrapped.call(h.graph), {exactGraph: true}); e.eventPhase = 0; h.flushMicrotasks(); h.flushTimers();
    const result = observer.report().samples[0]; assert.equal(result.spans.length, 0, kind); assert.equal(result.complete, false); assert.equal(result.restoration.reason, 'outside-input-dispatch');
  }
});

test('wrong identities, nontrusted/late input and IME do not install leases; later ordinary input remains observable', t => {
  const h = harness(); t.after(() => h.observer.dispose()); h.start();
  h.dispatch(() => {}, 0, {isTrusted: false}); h.dispatch(() => {}, 0, {eventPhase: 0});
  h.dispatch(() => {}, 0, {inputType: 'insertFromComposition', data: '字'});
  h.document.emit('compositionstart', {target: h.dom[0].editor}); h.dispatch(() => {}); h.document.emit('compositionend', {target: h.dom[0].editor});
  h.dispatch(() => {}); // Conservative first possible IME tail, not ordinary timing.
  const id = h.dom[0].cell.dataset.record; h.dom[0].cell.dataset.record = 'foreign'; h.dispatch(() => {}); h.dom[0].cell.dataset.record = id;
  assert.equal(h.observer.report().samples.length, 0); assert.equal(h.observer.resources().leasedMethods, 0);
  h.dispatch(() => h.graph.serialize()); assert.equal(h.observer.report().samples.length, 1); assert(sample(h).complete);
});

test('sample/span caps preserve truncation; observer UI callbacks are outside input dispatch', t => {
  let dispatching = false, callbacks = 0;
  const h = harness({maxSamples: 2, maxSpans: 2, onChange() { assert.equal(dispatching, false); callbacks++; }}); t.after(() => h.observer.dispose()); h.start();
  for (let i = 0; i < 2; i++) h.dispatch(() => { dispatching = true; try { h.graph.serialize(); h.history.begin(); } finally { dispatching = false; } });
  assert.equal(sample(h).spans.length, 2); assert(sample(h).truncatedSpans > 0); assert.equal(sample(h).complete, false);
  h.dispatch(); assert.equal(h.observer.report().samples.length, 2); assert.equal(h.observer.resources().active, false); assert.equal(h.observer.report().stopReason, 'sample-capacity'); assert(callbacks >= 3);
});

test('stop, pagehide, hidden page and dispose clear hooks/listeners/timers even with a pending capture microtask', () => {
  for (const action of ['stop', 'pagehide', 'hidden', 'dispose']) {
    const h = harness(); h.start(); const edit = descriptor(DocumentController.prototype, 'edit'), e = h.event(); h.document.emit('input', e);
    if (action === 'stop') h.observer.stop();
    if (action === 'pagehide') h.window.emit('pagehide');
    if (action === 'hidden') { h.document.visibilityState = 'hidden'; h.document.emit('visibilitychange'); }
    if (action === 'dispose') h.observer.dispose();
    assert.deepEqual(descriptor(DocumentController.prototype, 'edit'), edit); assert.equal(descriptor(h.graph, 'serialize'), undefined);
    assert.equal(h.document.count(), 0); assert.equal(h.window.count(), 0); assert.equal(h.timers.size, 0); assert.equal(h.observer.resources().leasedMethods, 0);
    e.eventPhase = 0; h.flushMicrotasks(); assert.equal(h.observer.resources().leasedMethods, 0); h.observer.dispose();
  }
});

test('trusted panel preparation is cancellable and never installs after dispose; no 8000 preparation', async () => {
  const h = harness(); let loads = 0, resolve; const pending = new Promise(done => { resolve = done; });
  const mount = mountInputPersistenceStages(h.document, h.window, {app: h.app, loadBindings: async () => { loads++; return pending; }});
  const panel = h.document.getElementById('studio-input-persistence-stages'), inputs = panel.children.filter(node => node.tagName === 'INPUT');
  inputs[0].files = [{arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)}]; await Promise.all(inputs[0].emit('change'));
  inputs[1].value = fingerprint;
  const start = panel.children.find(node => node.textContent === '准备并开始诊断');
  await start.onclick({isTrusted: false}); assert.equal(loads, 0);
  h.window.location.port = '8000'; await start.onclick({isTrusted: true}); assert.equal(loads, 0);
  h.window.location.port = '8237'; const running = start.onclick({isTrusted: true}); assert.equal(loads, 1); assert.equal(h.document.count(), 0);
  mount.dispose(); resolve({DocumentController, OptimizationRevisions, businessHost: () => ({history: h.history})}); await running;
  assert.equal(h.document.count(), 0); assert.equal(descriptor(h.graph, 'serialize'), undefined); assert.equal(h.timers.size, 0); assert.equal(h.document.getElementById('studio-input-persistence-stages'), undefined);
});

test('successful panel requires trusted Start/Stop, downloads only stopped raw, and releases on pagehide', async () => {
  const h = harness(); let downloads = 0;
  h.window.URL.createObjectURL = () => { downloads++; return 'blob:test'; };
  const mount = mountInputPersistenceStages(h.document, h.window, {app: h.app, loadBindings: async () => ({DocumentController, OptimizationRevisions, businessHost: () => ({history: h.history}), preparation: {buildFingerprint: fingerprint}})});
  const panel = h.document.getElementById('studio-input-persistence-stages'), inputs = panel.children.filter(node => node.tagName === 'INPUT');
  inputs[0].files = [{arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)}]; await Promise.all(inputs[0].emit('change'));
  inputs[1].value = fingerprint;
  const start = panel.children.find(node => node.textContent === '准备并开始诊断'), stop = panel.children.find(node => node.textContent === '停止并释放'), download = panel.children.find(node => node.textContent === '下载分段原始记录');
  await start.onclick({isTrusted: true}); assert.equal(mount.resources().active, true); assert.equal(mount.resources().leasedMethods, 0);
  h.dispatch(() => h.graph.serialize()); assert.equal(mount.report().samples.length, 1);
  download.onclick({isTrusted: true}); assert.equal(downloads, 0); stop.onclick({isTrusted: false}); assert.equal(mount.resources().active, true);
  stop.onclick({isTrusted: true}); assert.equal(mount.resources().active, false);
  await start.onclick({isTrusted: true}); assert.equal(mount.resources().active, false); // Previous raw must be downloaded first.
  download.onclick({isTrusted: true}); assert.equal(downloads, 1);
  await start.onclick({isTrusted: true}); assert.equal(mount.resources().active, true);
  const e = h.event(); h.document.emit('input', e); assert(mount.resources().leasedMethods > 0);
  h.window.emit('pagehide'); assert.equal(h.document.count(), 0); assert.equal(h.window.count(), 0); assert.equal(h.timers.size, 0); assert.equal(descriptor(h.graph, 'serialize'), undefined);
  e.eventPhase = 0; h.flushMicrotasks(); assert.equal(mount.resources().disposed, true);
});
