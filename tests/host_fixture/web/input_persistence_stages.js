/** Opt-in diagnostic only. Import/mount never reads a graph or installs hooks.
 * Inclusive synchronous public-method spans are NOT CPU/self-time, input latency,
 * ownership proof, paint completion, or a product-performance acceptance result.
 */
import {readTableSemanticFixture, TABLE_FIXTURES} from './performance_table_semantic.js';

const PRODUCT = '/extensions/ComfyUI-DAELab-Creative-Studio/';
const HEX = /^[a-f0-9]{64}$/;
export const INPUT_STAGE_MODULES = Object.freeze({
  controller: PRODUCT + 'application/document_controller.js',
  revisions: PRODUCT + 'features/prompt/prompt_optimization_model.mjs',
  host: PRODUCT + 'contracts/business.js',
});
export const INPUT_STAGE_TARGETS = Object.freeze([
  Object.freeze({nodeId: '1', recordId: 'M-table-00-row-0001', fieldId: 'field-00'}),
  Object.freeze({nodeId: '2', recordId: 'M-table-01-row-0001', fieldId: 'field-00'}),
]);
const EVENTS = ['input', 'beforeinput', 'change', 'keydown', 'keyup', 'click', 'pointerdown', 'blur', 'compositionstart', 'compositionend'];
const clone = value => JSON.parse(JSON.stringify(value));
const object = value => value !== null && (typeof value === 'object' || typeof value === 'function');

/** Called only by a trusted Start, BEFORE installing input listeners. No query
 * suffix: these URLs must resolve to the product's existing module instances.
 * A fetched manifest does not attest bytes of an already-cached module instance.
 */
export async function loadInputPersistenceBindings({buildFingerprint, fetch, crypto, importModule = url => import(url)}) {
  if (!HEX.test(buildFingerprint || '')) throw Error('invalid-build-fingerprint');
  const response = await fetch(PRODUCT + 'build-manifest.json', {method: 'GET', cache: 'no-store'});
  if (!response.ok) throw Error('build-manifest-unavailable');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 2 * 1024 * 1024) throw Error('build-manifest-too-large');
  const manifest = JSON.parse(new TextDecoder().decode(bytes));
  if (manifest.sourceFingerprint !== buildFingerprint) throw Error('build-manifest-fingerprint-mismatch');
  const manifestSHA256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
  const entries = Object.entries(INPUT_STAGE_MODULES);
  const loaded = await Promise.allSettled(entries.map(([, url]) => importModule(url)));
  const modules = {}, unavailable = [];
  loaded.forEach((result, index) => {
    const [key, url] = entries[index];
    if (result.status === 'fulfilled') modules[key] = result.value;
    else unavailable.push({module: key, url, reason: 'import-unavailable'});
  });
  return {
    DocumentController: modules.controller?.DocumentController,
    OptimizationRevisions: modules.revisions?.OptimizationRevisions,
    businessHost: modules.host?.businessHost,
    preparation: {buildFingerprint, manifestSHA256, moduleURLs: {...INPUT_STAGE_MODULES}, unavailable,
      cachedModuleBytesAttested: false, basis: 'read-only manifest GET and canonical module imports before observation'},
  };
}

function methodDescriptor(target, key) {
  if (!object(target)) return {reason: 'target-unavailable'};
  const own = Object.getOwnPropertyDescriptor(target, key);
  let holder = target, descriptor = own;
  while (!descriptor && (holder = Object.getPrototypeOf(holder))) descriptor = Object.getOwnPropertyDescriptor(holder, key);
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') return {reason: 'data-method-unavailable'};
  if (own && !own.configurable && !own.writable || !own && !Object.isExtensible(target)) return {reason: 'method-not-replaceable'};
  return {own, original: descriptor.value};
}
function sameDescriptor(a, b) {
  return a === undefined && b === undefined || !!a && !!b &&
    ['value', 'get', 'set', 'writable', 'enumerable', 'configurable'].every(key => a[key] === b[key]);
}

/** Dependencies are the REAL loaded exports/port, never a new service. Tests may
 * inject objects, but the browser mount only uses the canonical product exports.
 */
export function createInputPersistenceStageObserver({document, window, app, DocumentController, OptimizationRevisions, businessHost,
  preparation = null, maxSamples = 100, maxSpans = 128, onChange = () => {}}) {
  maxSamples = Math.max(1, Math.min(200, Math.floor(maxSamples) || 100));
  maxSpans = Math.max(1, Math.min(256, Math.floor(maxSpans) || 128));
  let active = false, disposed = false, report = null, lease = null, abort = null, bindings = [], graph = null, graphId, nodes = [], widgets = [], port = null;
  let tokenSequence = 0, sampleSequence = 0, receiving = 0;
  const tokens = new WeakMap(), composing = new WeakSet(), compositionTail = new WeakSet();
  const now = () => window.performance.now();
  const token = value => { if (!object(value)) return null; if (!tokens.has(value)) tokens.set(value, ++tokenSequence); return tokens.get(value); };
  const notify = () => { if (receiving) return; try { onChange({active, samples: report?.samples.length || 0, leasedMethods: lease?.hooks.length || 0}); } catch { /* Diagnostic UI cannot affect product. */ } };
  const reject = reason => { if (report) report.rejected[reason] = (report.rejected[reason] || 0) + 1; };

  function locate(target) {
    if (!target || target.closest?.('.content-display') !== target) return null;
    const cell = target.closest('td[data-record][data-field]'), row = cell?.closest('tr[data-record-id]');
    const table = cell?.closest('.dae-table'), card = table?.closest('.dae-creative-card[data-node-id]'), canvas = card?.closest('.dae-creative');
    if (!cell || !row || !table || !card || !canvas || target.parentElement !== cell || row.dataset.recordId !== cell.dataset.record) return null;
    const fixed = INPUT_STAGE_TARGETS.find(item => item.nodeId === card.dataset.nodeId && item.recordId === cell.dataset.record && item.fieldId === cell.dataset.field);
    if (!fixed || cell.dataset.inlineEditing !== 'true' || target.getAttribute('contenteditable') !== 'true') return null;
    const owner = {editor: target, cell, row, table, card, canvas};
    if (Object.values(owner).some(element => !element.isConnected)) return null;
    return {owner, fixed};
  }
  function current(item) {
    if (!active || lease !== item || item.event?.eventPhase === 0 || !item.event?.isTrusted || item.event.target !== item.owner.editor) return false;
    if (document.visibilityState !== 'visible' || app.isGraphReady !== true || app.rootGraph !== graph || graph.id !== graphId) return false;
    if (nodes.some(node => graph.getNodeById(node.id) !== node || node.graph !== graph)) return false;
    if (nodes.some((node, index) => node.widgets?.find(widget => widget.name === 'table_data') !== widgets[index])) return false;
    if (port && businessHost().history !== port) return false;
    const found = locate(item.event.target);
    return !!found && Object.keys(item.owner).every(key => found.owner[key] === item.owner[key]);
  }
  function safeCurrent(item) { try { return current(item); } catch { return false; } }

  function restore(item, reason) {
    if (!item || item.closed) return;
    item.closed = true;
    window.clearTimeout(item.timer); item.timer = null;
    const conflicts = [];
    for (const hook of [...item.hooks].reverse()) {
      try {
        const actual = Object.getOwnPropertyDescriptor(hook.target, hook.key);
        if (sameDescriptor(actual, hook.own)) continue; // Install may have failed before changing this property.
        if (!sameDescriptor(actual, hook.installed)) { conflicts.push({boundary: hook.label, reason: 'descriptor-replaced'}); continue; }
        if (hook.own) Object.defineProperty(hook.target, hook.key, hook.own);
        else if (!Reflect.deleteProperty(hook.target, hook.key)) throw Error('delete-failed');
        if (!sameDescriptor(Object.getOwnPropertyDescriptor(hook.target, hook.key), hook.own)) throw Error('restore-mismatch');
      } catch { conflicts.push({boundary: hook.label, reason: 'descriptor-restore-failed'}); }
    }
    item.sample.restoration = {reason, at: now(), conflicts, exact: conflicts.length === 0, attempted: item.hooks.length};
    if (conflicts.length) { item.sample.complete = false; report.conflicts.push(...conflicts.map(conflict => ({sampleId: item.sample.id, ...conflict}))); }
    // Queued microtask closures retain only this emptied cell, not Event/DOM/graph.
    item.hooks = []; item.owner = null; item.event = null;
    if (lease === item) lease = null;
  }
  function stop(reason = 'operator-stop') {
    if (!active) return;
    const duringDispatch = !!lease && lease.event?.eventPhase !== 0;
    active = false;
    if (lease) { lease.sample.complete = false; restore(lease, reason); }
    abort?.abort(); abort = null;
    report.stoppedAt = now(); report.stopReason = reason;
    bindings = []; nodes = []; widgets = []; graph = null; port = null;
    if (!duringDispatch) notify();
  }
  function finishLease(item, reason) {
    const duringDispatch = item.event?.eventPhase !== 0;
    restore(item, reason);
    if (report.conflicts.length) stop('restoration-conflict');
    else if (!duringDispatch) notify(); // Only outside dispatch; never called by wrappers.
  }

  function makeWrapper(original, label, association, nodeId, item) {
    // No method target is captured here: if a foreign wrapper keeps this function,
    // teardown still drops our Event/DOM/node references while call-through works.
    return function(...args) {
      if (item.closed) return Reflect.apply(original, this, args);
      if (!safeCurrent(item)) {
        // An async/late call delegates unchanged but cannot borrow the old input.
        item.sample.complete = false;
        restore(item, 'outside-input-dispatch');
        return Reflect.apply(original, this, args);
      }
      let span = null;
      try {
        if (item.sample.spans.length >= maxSpans) { item.sample.truncatedSpans++; item.sample.complete = false; }
        else {
          span = {id: item.sample.spans.length + 1, boundary: label, parentSpan: item.stack.at(-1)?.id ?? null,
            receiverToken: token(this), association, nodeId: nodeId ?? null,
            startedAt: now(), endedAt: null, durationMs: null, outcome: 'pending', asyncSettlementObserved: false};
          item.sample.spans.push(span); item.stack.push(span);
        }
      } catch { item.sample.complete = false; }
      let outcome = 'returned';
      try { return Reflect.apply(original, this, args); }
      catch (error) { outcome = 'threw'; throw error; }
      finally {
        // Do not read return values, then, errors, args, table data, or stacks.
        try { if (span) {
          span.endedAt = now(); span.durationMs = span.endedAt - span.startedAt; span.outcome = outcome;
          span.identityCurrentAtEnd = safeCurrent(item);
          if (!span.identityCurrentAtEnd) item.sample.complete = false;
          item.stack.pop();
        } } catch { item.sample.complete = false; }
      }
    };
  }
  function wrap(binding, item) {
    const before = methodDescriptor(binding.target, binding.key);
    if (before.reason || before.original !== binding.original || !sameDescriptor(before.own, binding.own)) throw Error('method-changed-since-preparation');
    const wrapper = makeWrapper(binding.original, binding.label, binding.association, binding.nodeId, item);
    const installed = before.own ? {...before.own, value: wrapper} : {value: wrapper, writable: true, configurable: true, enumerable: false};
    item.hooks.push({...binding, installed});
    Object.defineProperty(binding.target, binding.key, installed);
  }

  function receive(event) {
    if (!active) return;
    // This runs BEFORE trust/target filters: even a nested synthetic/non-target
    // input must not be counted using the still-dispatching outer Event.
    if (lease) {
      if (event === lease.event) return;
      const nested = lease.event?.eventPhase !== 0;
      lease.sample.complete = false; restore(lease, nested ? 'nested-event-dispatch' : 'next-event');
      if (nested) { reject('nested-event-dispatch'); return; }
    }
    if (event.type === 'compositionstart') { composing.add(event.target); return; }
    if (event.type === 'compositionend') { composing.delete(event.target); compositionTail.add(event.target); return; }
    if (event.type !== 'input') return;
    if (!event.isTrusted || ![1, 2, 3].includes(event.eventPhase)) { reject('untrusted-or-not-dispatching'); return; }
    if (event.isComposing || composing.has(event.target) || /composition/i.test(event.inputType || '')) { reject('composition-input'); return; }
    if (compositionTail.has(event.target)) { compositionTail.delete(event.target); reject('first-post-composition-input-unattributed'); return; }
    if (event.inputType !== 'insertText' || typeof event.data !== 'string' || !/^[\x20-\x7e]$/.test(event.data)) { reject('not-single-ascii-insertText'); return; }
    const found = locate(event.target);
    if (!found) { reject('not-fixed-current-editor'); return; }
    if (report.samples.length >= maxSamples) { reject('sample-capacity'); stop('sample-capacity'); return; }
    const sample = {id: ++sampleSequence, inputType: event.inputType, eventTimeStamp: event.timeStamp, capturedAt: now(),
      identity: {...found.fixed, ...Object.fromEntries(Object.entries(found.owner).map(([key, value]) => [key + 'Token', token(value)]))},
      complete: report.boundaries.every(boundary => boundary.available), spans: [], truncatedSpans: 0, installation: null, restoration: null};
    report.samples.push(sample);
    const item = {event, owner: found.owner, sample, hooks: [], stack: [], closed: false, timer: null}; lease = item;
    if (!safeCurrent(item)) { sample.complete = false; sample.installation = 'owner-no-longer-current'; restore(item, 'identity-invalid'); return; }
    try { for (const binding of bindings) wrap(binding, item); sample.installation = 'installed'; }
    catch { sample.complete = false; sample.installation = 'install-conflict'; restore(item, 'install-rollback'); return; }
    item.timer = window.setTimeout(() => {
      if (item.closed) return;
      if (item.event?.eventPhase !== 0) { sample.complete = false; finishLease(item, 'unexpected-dispatch-at-task-boundary'); }
      else finishLease(item, 'next-task');
    }, 0);
    window.queueMicrotask(() => {
      // UA checkpoints can occur between capture and the target input listener.
      // Never remove that listener's hooks early or recursively enqueue here.
      if (!item.closed && item.event?.eventPhase === 0) finishLease(item, 'post-dispatch-microtask');
    });
  }
  const protectedReceive = event => { receiving++; try { receive(event); } catch { reject('observer-capture-failed'); if (lease) { lease.sample.complete = false; restore(lease, 'capture-failed'); } } finally { receiving--; } };

  function start(event, {fixture, buildFingerprint} = {}) {
    if (disposed || active || !event?.isTrusted || !HEX.test(buildFingerprint || '') || !TABLE_FIXTURES[fixture?.sha256] || document.visibilityState !== 'visible') return false;
    report = {schemaVersion: 1, kind: 'input-persistence-public-method-diagnostic', productAcceptance: false, buildFingerprint,
      preparation: preparation ? clone(preparation) : {basis: 'injected bindings; no served byte attestation'},
      fixture: {sha256: fixture.sha256, file: fixture.file}, targets: clone(INPUT_STAGE_TARGETS), timeOrigin: window.performance.timeOrigin,
      startedAt: now(), stoppedAt: null, environment: {viewport: {width: window.innerWidth, height: window.innerHeight}, dpr: window.devicePixelRatio},
      maxSamples, maxSpans, boundaries: [], samples: [], rejected: {}, conflicts: [], preflight: [],
      limits: ['Diagnostic only; not formal PERF-02 input-to-paint latency or acceptance',
        'Inclusive synchronous public-method envelopes; no self-time subtraction, CPU total, async settlement or serialization attribution',
        'Prototype receiver tokens are dispatch-associated, not proof of table/controller ownership',
        'Fixed DOM target identities and widget shape do not attest all currently loaded workflow contents',
        'No JSON wrapping, method args/results, user text, per-cell scans, Error.stack or UI updates inside measured dispatch',
        'Only single ordinary ASCII insertText; IME, commands, unknown custom nested event types and late asynchronous work are outside this diagnostic',
        'Current server manifest is not proof of already-cached module bytes; prepare/installation/check overhead is not subtracted'],
    };
    if (preparation?.buildFingerprint && preparation.buildFingerprint !== buildFingerprint) { report.preflight.push('prepared-build-mismatch'); return false; }
    try {
      if (app.isGraphReady !== true) throw Error('graph-not-ready');
      graph = app.rootGraph; graphId = graph.id;
      if (typeof graph.getNodeById !== 'function') throw Error('native-node-lookup-unavailable');
      nodes = INPUT_STAGE_TARGETS.map(fixed => {
        const node = graph.getNodeById(Number(fixed.nodeId));
        if (!node || String(node.id) !== fixed.nodeId || node.graph !== graph || (node.type || node.comfyClass) !== 'DAELAB.Table') throw Error('fixed-native-node-unavailable');
        const widget = node.widgets?.find(item => item.name === 'table_data');
        if (!widget || typeof widget.value !== 'string' || widget.value.length > 8 * 1024 * 1024) throw Error('table-widget-unavailable');
        const value = JSON.parse(widget.value);
        if (value.records?.length !== 500 || value.fields?.length !== 10 || !value.records.some(row => row.id === fixed.recordId) || !value.fields.some(field => field.id === fixed.fieldId && field.type === 'content')) throw Error('fixed-table-shape-mismatch');
        return node;
      });
      widgets = nodes.map(node => node.widgets.find(item => item.name === 'table_data'));
      report.graphToken = token(graph); report.graphIdAtStart = graphId ?? null;
    } catch (error) { report.preflight.push(error.message); graph = null; nodes = []; widgets = []; return false; }
    try { port = businessHost?.()?.history ?? null; } catch { port = null; }
    bindings = [];
    const add = (target, key, label, association, nodeId) => {
      let method; try { method = methodDescriptor(target, key); } catch { method = {reason: 'descriptor-unavailable'}; }
      report.boundaries.push({label, association, nodeId: nodeId ?? null, available: !method.reason, reason: method.reason ?? null});
      if (!method.reason) bindings.push({target, key, label, association, nodeId, ...method});
    };
    add(DocumentController?.prototype, 'edit', 'DocumentController.edit', 'dispatch-associated-only');
    for (const key of ['begin', 'end', 'amend']) add(port, key, 'history.' + key, 'shared-history-dispatch');
    add(OptimizationRevisions?.prototype, 'observe', 'OptimizationRevisions.observe', 'dispatch-associated-only');
    add(graph, 'serialize', 'rootGraph.serialize', 'captured-native-root');
    for (const node of nodes) add(node.widgets.find(item => item.name === 'table_data'), 'serializeValue', 'table_data.serializeValue:' + node.id, 'actual-widget-node', String(node.id));
    abort = new AbortController(); active = true;
    for (const type of EVENTS) document.addEventListener(type, protectedReceive, {capture: true, passive: true, signal: abort.signal});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') stop('page-hidden'); }, {signal: abort.signal});
    window.addEventListener('pagehide', () => stop('pagehide'), {signal: abort.signal});
    notify(); return true;
  }
  return {start, stop, report: () => report ? clone(report) : null,
    resources: () => ({active, leasedMethods: lease?.hooks.length || 0, listeners: abort ? EVENTS.length + 2 : 0, timer: lease?.timer != null, disposed}),
    dispose() { stop('disposed'); disposed = true; bindings = []; nodes = []; widgets = []; graph = null; port = null; },
  };
}

export function mountInputPersistenceStages(document, window, {app, loadBindings = loadInputPersistenceBindings} = {}) {
  if (document.getElementById('studio-input-persistence-stages')) return null;
  const make = (tag, text, parent) => { const element = document.createElement(tag); if (text) element.textContent = text; parent?.append(element); return element; };
  const panel = make('details', '', document.body); panel.id = 'studio-input-persistence-stages';
  panel.style.cssText = 'position:fixed;right:8px;top:160px;z-index:2147483001;width:350px;max-height:65vh;overflow:auto;padding:10px;background:#182027;color:#eee;border:1px solid #71858f;font:12px/1.5 sans-serif';
  make('summary', '输入持久化分段（仅诊断）', panel);
  make('p', '仅固定 M 两个首格的可信 ASCII 输入。五组公开方法的同步包含时间，不是输入延迟/CPU/产品验收。准备阶段核对服务端指纹；不会证明缓存模块字节，不自动编辑、保存或生成。', panel);
  const picker = make('input', '', panel); picker.type = 'file'; picker.accept = '.json'; picker.setAttribute('aria-label', '固定 M 诊断工作流');
  const build = make('input', '', panel); build.placeholder = '实际构建 SHA256'; build.maxLength = 64; build.setAttribute('aria-label', '输入诊断构建指纹');
  const status = make('output', '未开始；未读取 graph', panel); status.style.display = 'block';
  let disposed = false, preparing = false, revision = 0, fixture = null, observer = null, downloaded = true;
  const own = new AbortController();
  const button = (label, action) => { const item = make('button', label, panel); item.type = 'button'; item.onclick = action; return item; };
  const start = button('准备并开始诊断', async event => {
    if (!event?.isTrusted || disposed || preparing || observer?.resources().active) return;
    if (!downloaded) { status.textContent = '先下载上一段原始记录。'; return; }
    if (!fixture || !HEX.test(build.value.trim())) { status.textContent = '需要固定 M 文件与完整构建指纹。'; return; }
    const location = window.location;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(location?.hostname) || location.port === '8000') { status.textContent = '仅显式隔离 loopback 测试宿主；拒绝 8000。'; return; }
    const version = ++revision, fingerprint = build.value.trim(), selectedFixture = fixture;
    preparing = true; status.textContent = '准备中；尚未安装输入监听或方法包装。';
    try {
      const dependencies = await loadBindings({buildFingerprint: fingerprint, fetch: window.fetch.bind(window), crypto: window.crypto});
      if (disposed || version !== revision) return;
      observer?.dispose();
      observer = createInputPersistenceStageObserver({document, window, app, ...dependencies,
        onChange: state => { status.textContent = `${state.active ? '诊断中' : '已停止'}；输入 ${state.samples}；非正式性能验收。`; }});
      if (!observer.start(event, {fixture: selectedFixture, buildFingerprint: fingerprint})) { status.textContent = '准备或图身份检查失败；可下载未观测原因。'; }
      downloaded = false;
    } catch (error) { if (!disposed && version === revision) status.textContent = `未开始：${error.message}`; }
    finally { if (version === revision) preparing = false; }
  });
  const stop = button('停止并释放', event => { if (event?.isTrusted && !disposed) { revision++; preparing = false; observer?.stop(); } });
  const download = button('下载分段原始记录', event => {
    if (!event?.isTrusted || disposed || preparing) return;
    if (observer?.resources().active) { status.textContent = '先停止再下载。'; return; }
    const value = observer?.report(); if (!value) return;
    const url = window.URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}));
    try { const link = make('a', '', panel); link.href = url; link.download = `input-persistence-stages-${Date.now()}.json`; link.click(); link.remove(); downloaded = true; }
    finally { window.URL.revokeObjectURL(url); }
  });
  picker.addEventListener('change', async () => {
    if (observer?.resources().active || preparing) return;
    const version = ++revision; fixture = null; const file = picker.files?.[0]; if (!file) return;
    try { const next = await readTableSemanticFixture(await file.arrayBuffer(), window.crypto); if (!disposed && version === revision) { fixture = next; status.textContent = '固定 M 文件已核对；未加载宿主图。'; } }
    catch (error) { if (!disposed && version === revision) status.textContent = error.message; }
  }, {signal: own.signal});
  for (const type of ['pointerdown', 'keydown', 'dblclick', 'wheel']) panel.addEventListener(type, event => {
    if (type === 'keydown' && !event.isComposing && (event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 's') return;
    event.stopPropagation();
  }, {signal: own.signal});
  function dispose() { if (disposed) return; disposed = true; revision++; preparing = false; observer?.dispose(); own.abort(); start.onclick = stop.onclick = download.onclick = null; panel.remove(); }
  window.addEventListener('pagehide', dispose, {once: true, signal: own.signal});
  return {dispose, report: () => observer?.report() ?? null, resources: () => observer?.resources() ?? {active: false, leasedMethods: 0}};
}
