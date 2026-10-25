import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {NATIVE_PAUSE_PINS as PINS, readNativePauseFixture, createNativeCanvasPauseDiagnostic, mountNativeCanvasPauseDiagnostic} from '../host_fixture/web/native_canvas_pause_diagnostic.js';

const original = fs.readFileSync(new URL('../fixtures/performance/FX-PERF-M-no-video.json', import.meta.url));
const graphJSON = JSON.parse(original);
const fixture = await readNativePauseFixture(original, crypto.webcrypto);
const trusted = {isTrusted: true};
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

class Element extends EventTarget {
  constructor() { super(); this.isConnected = true; this.hidden = false; this.attributes = new Map(); this.listeners = new Set(); this.queries = new Map(); this.textContent = ''; }
  addEventListener(type, fn, options) { super.addEventListener(type, fn, options); this.listeners.add(fn); }
  removeEventListener(type, fn, options) { super.removeEventListener(type, fn, options); this.listeners.delete(fn); }
  querySelectorAll(selector) { return this.queries.get(selector) || []; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
}

function setup(options = {}) {
  const root = new Element(), native = new Element(), document = new Element(), window = new Element();
  native.width = 1132; native.height = 638; document.body = Object.assign(new Element(), {dataset: {daelabCreative: 'true'}}); document.visibilityState = 'visible';
  document.queries.set('.dae-creative', [root]); document.queries.set('#graph-canvas', [native]);
  const cards = Array.from({length: 300}, () => new Element()), tables = [], editors = [];
  for (const [index, spec] of fixture.targets.entries()) {
    const table = new Element(), cell = new Element(), editor = new Element();
    editor.parentElement = cell; editor.textContent = spec.initial;
    cell.queries.set('.content-display', [editor]); cell.setAttribute('data-record', spec.recordId); cell.setAttribute('data-field', spec.fieldId);
    const rows = Array.from({length: 500}, (_, rowIndex) => {
      const row = new Element(), record = `M-table-0${index}-row-${String(rowIndex).padStart(4, '0')}`;
      row.setAttribute('data-record-id', record);
      const cells = Array.from({length: 10}, (_, fieldIndex) => {
        const value = rowIndex === 1 && fieldIndex === 0 ? cell : new Element();
        value.setAttribute('data-record', record); value.setAttribute('data-field', `field-${String(fieldIndex).padStart(2, '0')}`); value.parentElement = row; return value;
      });
      row.queries.set('td[data-record][data-field]', cells); return row;
    });
    table.queries.set('tr[data-record-id]', rows); table.queries.set('td[data-record][data-field]', rows.flatMap(row => row.querySelectorAll('td[data-record][data-field]')));
    table.queries.set(`td[data-record="${spec.recordId}"][data-field="${spec.fieldId}"]`, [cell]);
    cards[index].queries.set('.dae-table', [table]); root.queries.set(`.dae-creative-card[data-node-id="${spec.nodeId}"]`, [cards[index]]);
    tables.push(table); editors.push(editor);
  }
  root.queries.set('.dae-creative-card[data-node-id]', cards); root.queries.set('.dae-table', tables);
  const graph = {_nodes: fixture.nodes.map(node => ({...node, id: Number(node.id)})), links: new Map(fixture.links.map(t => [t[0], {id: t[0], origin_id: t[1], origin_slot: t[2], target_id: t[3], target_slot: t[4], type: t[5]}]))};
  let dirtyCalls = 0, forbiddenCalls = 0;
  const canvas = {canvas: native, graph, pause_rendering: false, _maximumFrameGap: 0, is_rendering: true, frame: 10, dirty_canvas: true, dirty_bgcanvas: false,
    setDirty(fg, bg) { dirtyCalls++; if (fg) this.dirty_canvas = true; if (bg) this.dirty_bgcanvas = true; },
    startRendering() { forbiddenCalls++; }, stopRendering() { forbiddenCalls++; }, draw() { forbiddenCalls++; }};
  const view = {root, active: true}, workflow = {activeMode: 'graph'}, app = {canvas, rootGraph: graph, graph, isGraphReady: true, daelabCreativeCanvas: view, extensionManager: {workflow: {activeWorkflow: workflow}}};
  const environmentRoot = 'B:/isolated/.local/host-native-pause-unit';
  const registration = {origin: 'http://127.0.0.1:8269', receiptSHA256: 'a'.repeat(64), manifestSHA256: 'b'.repeat(64), revision: PINS.revision, build: PINS.build, assets: {...PINS.assets}, environmentRoot,
    argv: ['isolated/main.py', '--base-directory', environmentRoot, ...['user', 'input', 'output', 'temp'].flatMap(name => [`--${name}-directory`, `${environmentRoot}/${name}`]), '--listen', '127.0.0.1', '--port', '8269', '--cpu', '--offline', '--disable-all-custom-nodes', '--whitelist-custom-nodes', 'ComfyUI-DAELab-Creative-Studio', 'creative_studio_test_fixture']};
  let time = 0, next = 0;
  const rafs = new Map(), timers = new Map(), observers = [], requests = [], responses = new Map();
  const json = object => new TextEncoder().encode(JSON.stringify(object));
  const queue = () => json({queue_running: [], queue_pending: []});
  responses.set('/queue', queue); responses.set('/system_stats', () => json({system: {argv: registration.argv}, devices: [{type: 'cpu'}]}));
  responses.set('/daelab/studio/health', () => json({compatible: true, frontendBuildId: PINS.build}));
  for (const path of Object.keys(PINS.assets)) responses.set(path, () => new TextEncoder().encode(path));
  Object.assign(window, {location: {origin: registration.origin}, performance: {now: () => time, timeOrigin: 100000},
    getComputedStyle: () => ({visibility: 'hidden'}),
    crypto: {subtle: {digest: async (_algorithm, bytes) => {
      const path = new TextDecoder().decode(bytes), value = PINS.assets[path] || '0'.repeat(64); return Uint8Array.from(Buffer.from(value, 'hex')).buffer;
    }}},
    fetch: async (url, request) => {
      requests.push({url, request, pausedAtRequest: canvas.pause_rendering});
      if (request.signal?.aborted) throw Error('aborted');
      const path = new URL(url).pathname, handler = responses.get(path); if (!handler) throw Error('unexpected URL');
      const bytes = await handler(); return {ok: true, redirected: false, url, arrayBuffer: async () => bytes.slice().buffer};
    },
    requestAnimationFrame: fn => { const id = ++next; rafs.set(id, fn); return id; }, cancelAnimationFrame: id => rafs.delete(id),
    setTimeout: (fn, delay) => { const id = ++next; timers.set(id, {fn, at: time + delay}); return id; }, clearTimeout: id => timers.delete(id),
    MutationObserver: class { constructor(fn) { this.fn = fn; this.connected = false; observers.push(this); } observe() { this.connected = true; } disconnect() { this.connected = false; } takeRecords() { return []; } },
  });
  const advanceFrame = () => { time += 16; if (!canvas.pause_rendering && canvas.is_rendering) canvas.frame++; const current = [...rafs]; rafs.clear(); for (const [, fn] of current) fn(time); };
  const elapse = ms => { time += ms; const due = [...timers].filter(([, timer]) => timer.at <= time); for (const [id, timer] of due) { timers.delete(id); timer.fn(); } };
  const controller = createNativeCanvasPauseDiagnostic({document, window, app, registration, ...options});
  const drive = async promise => { let done = false, result, failure; promise.then(value => {done = true; result = value;}, error => {done = true; failure = error;}); for (let i = 0; !done && i < 100; i++) {await nextTurn(); advanceFrame();} if (failure) throw failure; assert(done, 'bounded async preparation'); return result; };
  const start = (mode = 'paused', args = {}) => drive(controller.start(trusted, {fixture, mode, explicit: true, ...args}));
  return {root, native, document, window, tables, editors, app, graph, canvas, view, workflow, controller, registration, requests, responses, observers, rafs, timers, advanceFrame, elapse, drive, start, dirtyCalls: () => dirtyCalls, forbiddenCalls: () => forbiddenCalls};
}

test('fixed original M bytes are hashed, detached and unforgeable; fixed served pins are complete', async () => {
  assert.equal(fixture.nodes.length, 300); assert.equal(fixture.links.length, 400); assert.equal(fixture.workflowId, graphJSON.id);
  assert.equal(PINS.assets['/extensions/ComfyUI-DAELab-Creative-Studio/canvas/creative_canvas_view.mjs'], '9c620bbb0002ac42eeb345ae70c875347fb9c0dc4c646f95a84fe944a6fa93c3');
  const wrong = Uint8Array.from(original); wrong[20] ^= 1; await assert.rejects(readNativePauseFixture(wrong, crypto.webcrypto), /original-M/);
  assert(Object.isFrozen(fixture) && Object.isFrozen(fixture.targets[0]));
});

test('construction and untrusted/nonexplicit starts do not read host or install resources', async () => {
  const d = setup();
  assert.equal(await d.controller.start({isTrusted: false}, {fixture, mode: 'paused', explicit: true}), false);
  assert.equal(await d.controller.start(trusted, {fixture, mode: 'paused'}), false);
  assert.equal(d.requests.length, 0); assert.equal(d.canvas.pause_rendering, false); assert.equal(d.observers.length, 0); assert.equal(d.rafs.size, 0); assert.equal(d.timers.size, 0);
});

test('paused arm changes only captured flag; stop restores before its queue request and retains dirty work', async () => {
  const d = setup(), modelBefore = JSON.stringify(d.graph);
  assert.equal(await d.start(), true); assert.equal(d.canvas.pause_rendering, true);
  const requestCount = d.requests.length; d.advanceFrame(); d.advanceFrame(); assert.equal(d.requests.length, requestCount);
  const stopped = d.controller.stop(); assert.equal(d.canvas.pause_rendering, false, 'synchronous restoration before first await'); await stopped;
  assert.equal(d.canvas.is_rendering, true); assert.equal(d.forbiddenCalls(), 0); assert.equal(d.dirtyCalls(), 1); assert(d.canvas.dirty_canvas && d.canvas.dirty_bgcanvas);
  assert.equal(JSON.stringify(d.graph), modelBefore); assert.equal(d.requests.at(-1).url, d.registration.origin + '/queue'); assert.equal(d.requests.at(-1).pausedAtRequest, false);
  assert.deepEqual(d.controller.resources(), {listeners: 0, observers: 0, raf: 0, timer: 0});
  const run = d.controller.report().runs[0]; assert.equal(run.restore.flag, 'restored'); assert.equal(run.postQueue.empty, true); assert.equal(run.productAcceptance, false);
});

test('baseline and restored-control never pause and do not silently substitute for the paused arm', async () => {
  for (const mode of ['baseline', 'restored']) { const d = setup(); assert(await d.start(mode)); assert.equal(d.canvas.pause_rendering, false); await d.controller.stop(); assert.equal(d.dirtyCalls(), 0); assert.equal(d.controller.report().runs[0].mode, mode); }
});

test('all explicit runtime gates reject without acquiring a pause', async () => {
  const changes = [d => { d.registration.receiptSHA256 = ''; }, d => {d.registration.origin = 'http://127.0.0.1:8000';}, d => {d.registration.build = '0'.repeat(64);}, d => {d.registration.assets = {};}, d => {d.registration.argv.push('--gpu-only');},
    d => {d.responses.set('/system_stats', () => new TextEncoder().encode(JSON.stringify({system: {argv: d.registration.argv}, devices: [{type: 'cuda'}]})));},
    d => {d.responses.set('/queue', () => new TextEncoder().encode('{"queue_running":[1],"queue_pending":[]}'));},
    d => {d.responses.set('/assets/settingStore-CbkuaYBI.js', () => new TextEncoder().encode('wrong'));},
    d => {d.responses.set('/daelab/studio/health', () => new TextEncoder().encode('{"compatible":true,"frontendBuildId":"wrong"}'));}];
  for (const change of changes) {const d = setup(); change(d); assert.equal(await d.start(), false); assert.equal(d.canvas.pause_rendering, false); assert.equal(d.rafs.size, 0);}
});

test('positive and tinypositive manual gaps, nonwritable pause and accessors reject without getter invocation', async () => {
  for (const gap of [60, Number.EPSILON / 2, NaN, Infinity]) {const d = setup(); d.canvas._maximumFrameGap = gap; assert.equal(await d.start(), false); assert.equal(d.canvas.pause_rendering, false);}
  const d = setup(); let reads = 0; Object.defineProperty(d.canvas, '_maximumFrameGap', {get() {reads++; return 0;}}); assert.equal(await d.start(), false); assert.equal(reads, 0);
  const locked = setup(); Object.defineProperty(locked.canvas, 'pause_rendering', {value: false, writable: false}); assert.equal(await locked.start(), false);
});

test('prepaused/stopped/uncovered/hidden/AppMode/subgraph and unknown M projections fail closed', async () => {
  const changes = [d => {d.canvas.pause_rendering = true;}, d => {d.canvas.is_rendering = false;}, d => {d.document.visibilityState = 'hidden';}, d => {d.root.hidden = true;}, d => {d.window.getComputedStyle = () => ({visibility: 'visible'});}, d => {d.workflow.activeMode = 'app';}, d => {d.canvas.subgraph = {};}, d => {d.graph._nodes.pop();}, d => {d.graph.links.delete(1);}, d => {d.editors[0].textContent = 'wrong';}, d => {d.tables[0].queries.get('tr[data-record-id]')[4].setAttribute('data-record-id', 'wrong');}];
  for (const change of changes) {const d = setup(); change(d); const before = d.canvas.pause_rendering; assert.equal(await d.start(), false); assert.equal(d.canvas.pause_rendering, before);}
  const d = setup(); assert.equal(await d.start('paused', {fixture: {...fixture}}), false);
});

test('same-canvas duplicate leases reject while a separate captured canvas remains independent', async () => {
  const d = setup(); assert(await d.start());
  const second = createNativeCanvasPauseDiagnostic({document: d.document, window: d.window, app: d.app, registration: d.registration});
  assert.equal(await second.start(trusted, {fixture, mode: 'paused', explicit: true}), false);
  const other = setup(); assert(await other.start()); await d.controller.stop(); assert.equal(other.canvas.pause_rendering, true); await other.controller.stop();
});

for (const event of ['dae-canvas-hide', 'litegraph:set-graph', 'subgraph-opening', 'pagehide', 'visibilitychange']) {
  test(`${event} synchronously restores captured native instance and clears all resources`, async () => {
    const d = setup(); assert(await d.start());
    const target = event === 'dae-canvas-hide' ? d.root : event === 'pagehide' ? d.window : event === 'visibilitychange' ? d.document : d.native;
    if (event === 'visibilitychange') d.document.visibilityState = 'hidden';
    target.dispatchEvent(new Event(event)); assert.equal(d.canvas.pause_rendering, false); assert.equal(d.controller.active, false); assert.equal(d.rafs.size, 0); assert.equal(d.controller.resources().timer, 0); assert(d.observers.every(o => !o.connected));
    await nextTurn(); assert.equal(d.timers.size, 0, 'bounded post-release queue request has completed');
  });
}

test('actual owning beforeLoadGraph callback releases through synchronous hide before model loading', async () => {
  const d = setup(); assert(await d.start());
  const source = fs.readFileSync(new URL('../../frontend/src/integrations/comfyui/canvas/creative_canvas.js', import.meta.url), 'utf8');
  const match = /beforeLoadGraph\(\)\{([^}]+)\}/.exec(source); assert(match);
  const viewSource = fs.readFileSync(new URL('../../frontend/src/canvas/creative_canvas_view.mjs', import.meta.url), 'utf8');
  const hideBody = /function hide\(save=true\)\{(.+)\}\r?\n/.exec(viewSource); assert(hideBody);
  const hide = new Function('root', 'document', 'host', 'clear', 'closePicker', 'dirty', `let state={active:true}, visible=true; return function hide(save=true){${hideBody[1]}}`)(
    d.root, d.document, {redrawNative() {assert.equal(d.canvas.pause_rendering, false);}}, () => {assert.equal(d.canvas.pause_rendering, false);}, () => {}, () => {});
  const callback = new Function('view', 'restoreLabels', `let modeRevision=0; return function(){${match[1]}}`)(
    {hide}, () => {});
  callback(); assert.equal(d.canvas.pause_rendering, false); await nextTurn();
});

test('canvas replacement restores the original and never mutates the replacement', async () => {
  const d = setup(); assert(await d.start()); const other = {...d.canvas, pause_rendering: true}; d.app.canvas = other; d.advanceFrame();
  assert.equal(d.canvas.pause_rendering, false); assert.equal(other.pause_rendering, true); assert.equal(d.controller.active, false); await nextTurn();
});

test('async admission rejects changed graph/canvas/visibility and explicit cancel before the first write', async () => {
  for (const change of [d => {d.app.canvas = {...d.canvas};}, d => {d.app.extensionManager.workflow.activeWorkflow = {activeMode: 'graph'};}, d => {d.document.visibilityState = 'hidden';}, d => d.controller.stop()]) {
    const d = setup(); let deliver; d.responses.set('/system_stats', () => new Promise(resolve => {deliver = resolve;}));
    const started = d.controller.start(trusted, {fixture, mode: 'paused', explicit: true});
    for (let i = 0; !deliver && i < 20; i++) await nextTurn(); assert(deliver); change(d); deliver(new TextEncoder().encode(JSON.stringify({system: {argv: d.registration.argv}, devices: [{type: 'cpu'}]})));
    assert.equal(await d.drive(started), false); assert.equal(d.canvas.pause_rendering, false); assert.equal(d.rafs.size, 0);
  }
});

test('time limit, root detach, manual-gap change and direct draw invalidate rather than quietly continue', async () => {
  for (const act of [d => d.elapse(180001), d => {d.root.isConnected = false; d.advanceFrame();}, d => {d.canvas._maximumFrameGap = 5; d.advanceFrame();}, d => {d.canvas.frame++; d.advanceFrame();}]) {
    const d = setup(); assert(await d.start()); act(d); assert.equal(d.canvas.pause_rendering, false); assert.equal(d.controller.active, false); await nextTurn(); assert.equal(d.controller.report().runs[0].controlled, false);
  }
});

test('descriptor conflict never invokes a replacement setter or forces ownership; alreadyfalse staysfalse', async () => {
  const d = setup(); assert(await d.start()); let writes = 0; Object.defineProperty(d.canvas, 'pause_rendering', {get() {return true;}, set() {writes++;}, configurable: true});
  await d.controller.stop(); assert.equal(writes, 0); assert.equal(d.dirtyCalls(), 0); assert.equal(d.controller.report().runs[0].restore.flag, 'conflict');
  const e = setup(); assert(await e.start()); e.canvas.pause_rendering = false; await e.controller.stop(); assert.equal(e.canvas.pause_rendering, false); assert.equal(e.controller.report().runs[0].restore.flag, 'already-false');
});

test('listener/setup and reporting exceptions cannot leave the captured flag paused', async () => {
  const broken = setup(); broken.native.addEventListener = () => {throw Error('listener failure');}; assert.equal(await broken.start(), false); assert.equal(broken.canvas.pause_rendering, false); assert.equal(broken.rafs.size, 0);
  const d = setup({onChange() {throw Error('own UI failure');}}); assert(await d.start()); await d.controller.stop(); assert.equal(d.canvas.pause_rendering, false); assert.equal(d.controller.resources().listeners, 0);
});

test('postStop busy queue is a retained invalid result after restoration, and reports contain no arbitrary text/argv', async () => {
  const d = setup(); assert(await d.start()); d.responses.set('/queue', () => new TextEncoder().encode('{"queue_running":["private-prompt"],"queue_pending":[]}'));
  await d.controller.stop(); assert.equal(d.canvas.pause_rendering, false); const report = d.controller.report(); assert.equal(report.runs[0].postQueue.empty, false); assert.equal(report.runs[0].controlled, false);
  const encoded = JSON.stringify(report); assert(!encoded.includes('private-prompt')); assert(!encoded.includes('isolated/main.py')); assert.equal(report.productAcceptance, false);
});

test('a hide-and-return ABA during HTTP admission cancels the old request even when final identities match', async () => {
  const d = setup(); let deliver; d.responses.set('/system_stats', () => new Promise(resolve => {deliver = resolve;}));
  const started = d.controller.start(trusted, {fixture, mode: 'paused', explicit: true});
  for (let i = 0; !deliver && i < 20; i++) await nextTurn(); assert(deliver);
  d.root.dispatchEvent(new Event('dae-canvas-hide'));
  deliver(new TextEncoder().encode(JSON.stringify({system: {argv: d.registration.argv}, devices: [{type: 'cpu'}]})));
  assert.equal(await d.drive(started), false); assert.equal(d.canvas.pause_rendering, false); assert.equal(d.controller.resources().listeners, 0); assert(d.observers.every(observer => !observer.connected));
});

test('changing the captured writable descriptor during preparation cannot leave an unrestorable lease', async () => {
  const d = setup(); let deliver; d.responses.set('/system_stats', () => new Promise(resolve => {deliver = resolve;}));
  const started = d.controller.start(trusted, {fixture, mode: 'paused', explicit: true});
  for (let i = 0; !deliver && i < 20; i++) await nextTurn(); assert(deliver);
  Object.defineProperty(d.canvas, 'pause_rendering', {value: false, writable: true, configurable: true, enumerable: false});
  deliver(new TextEncoder().encode(JSON.stringify({system: {argv: d.registration.argv}, devices: [{type: 'cpu'}]})));
  assert.equal(await d.drive(started), false); assert.equal(d.canvas.pause_rendering, false);
});

test('no new arm starts while the post-restore queue validity request is unresolved', async () => {
  const d = setup(); assert(await d.start()); let deliver;
  d.responses.set('/queue', () => new Promise(resolve => {deliver = resolve;}));
  const stopped = d.controller.stop(); assert.equal(d.canvas.pause_rendering, false);
  assert.equal(await d.controller.start(trusted, {fixture, mode: 'baseline', explicit: true}), false);
  deliver(new TextEncoder().encode('{"queue_running":[],"queue_pending":[]}')); await stopped;
});

test('test-only UI is idle, requires trusted explicit consent and provides synchronous recovery', async () => {
  const d = setup(); const made = [];
  d.document.createElement = tag => {
    const element = new Element(); element.tagName = tag; element.style = {}; element.children = [];
    element.append = child => {child.parentElement = element; element.children.push(child);}; element.remove = () => {element.isConnected = false;}; element.click = () => {}; made.push(element); return element;
  };
  d.document.body.append = child => {child.parentElement = d.document.body;};
  d.document.getElementById = id => made.find(element => element.id === id && element.isConnected);
  const runtimeCrypto = d.window.crypto; d.window.crypto = crypto.webcrypto;
  let imports = 0; const ui = mountNativeCanvasPauseDiagnostic(d.document, d.window, {registration: d.registration, loadApp: async () => {imports++; return {app: d.app};}});
  assert(ui); assert.equal(d.requests.length, 0); assert.equal(d.observers.length, 0); assert.equal(d.window.listeners.size, 0);
  assert.equal(mountNativeCanvasPauseDiagnostic(d.document, d.window, {registration: d.registration}), null);
  const picker = made.find(element => element.type === 'file'), enabled = made.find(element => element.type === 'checkbox');
  const pause = made.find(element => element.textContent === '启用原生暂停'), restore = made.find(element => element.textContent === '立即恢复');
  picker.files = [{size: original.length, arrayBuffer: async () => Uint8Array.from(original).buffer}];
  await picker.onchange(trusted); d.window.crypto = runtimeCrypto;
  await pause.onclick(trusted); assert.equal(imports, 0); enabled.checked = true;
  await pause.onclick({isTrusted: false}); assert.equal(imports, 0);
  assert.equal(await d.drive(pause.onclick(trusted)), undefined); assert.equal(d.canvas.pause_rendering, true); assert.equal(restore.disabled, false);
  const stopping = restore.onclick(trusted); assert.equal(d.canvas.pause_rendering, false); await stopping;
  ui.destroy(); assert.equal(pause.onclick, null); assert.equal(picker.onchange, null); assert.equal(ui.resources().listeners, 0);
});

test('a cleanup exception retains the failure, releases other resources and refuses a new arm', async () => {
  const d = setup(); assert(await d.start());
  d.observers.at(-1).disconnect = () => {throw Error('cannot disconnect');};
  await d.controller.stop(); assert.equal(d.canvas.pause_rendering, false); assert.equal(d.rafs.size, 0); assert.equal(d.timers.size, 0);
  assert.equal(d.root.listeners.size, 0); assert.equal(d.native.listeners.size, 0);
  const record = d.controller.report().runs[0]; assert.equal(record.controlled, false); assert.deepEqual(record.cleanup, {complete: false, failedResources: ['observer']});
  assert.equal(d.controller.resources().cleanupIncomplete, true); assert.equal(await d.start('baseline'), false);
});
