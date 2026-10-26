import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readRowScanFixture, createTableRowScanDiagnostic, mountTableRowScanDiagnostic} from '../host_fixture/web/table_row_scan_diagnostic.js';

const bytes = fs.readFileSync(new URL('../fixtures/performance/FX-PERF-M-no-video.json', import.meta.url));
const fixture = await readRowScanFixture(bytes, globalThis.crypto);
const originalTables = JSON.parse(bytes).nodes.filter(n => n.type === 'DAELAB.Table').map(n => JSON.parse(n.widgets_values[0]));
const fingerprint = 'd'.repeat(64);
class Hub {
  listeners = new Map();
  addEventListener(type, fn, options = {}) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    options.signal?.addEventListener('abort', () => this.listeners.get(type).delete(fn), {once: true});
  }
  emit(type, event = {}) { event.type = type; return Promise.all([...this.listeners.get(type) || []].map(fn => fn(event))); }
  count() { return [...this.listeners.values()].reduce((n, list) => n + list.size, 0); }
}
function harness() {
  const queries = [], timers = new Map(), microtasks = [], notices = [], downloads = [];
  let nextTimer = 0;
  // Each test gets its own prototype; no Node/browser global prototype is changed.
  class Element extends Hub {
    constructor(tag, cls = '') { super(); Object.assign(this, {tagName: tag.toUpperCase(), className: cls, dataset: {}, attributes: {}, children: [], parentElement: null, style: {}, textContent: '', value: '', hidden: false}); }
    get isConnected() { return this.base || !!this.parentElement?.isConnected; }
    append(...items) { for (const item of items) { item.remove(); item.parentElement = this; this.children.push(item); } }
    remove() { if (this.parentElement) { this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; } }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    matches(selector) {
      const matches = {
        '.dae-creative': () => this.className === 'dae-creative',
        '.dae-creative-card[data-node-id]': () => this.className === 'dae-creative-card' && 'nodeId' in this.dataset,
        '.dae-table': () => this.className === 'dae-table',
        '.content-display': () => this.className === 'content-display',
        'table': () => this.tagName === 'TABLE', 'tbody': () => this.tagName === 'TBODY',
        'tr[data-record-id]': () => this.tagName === 'TR' && 'recordId' in this.dataset,
        'th[data-column]': () => this.tagName === 'TH' && 'column' in this.dataset,
        'td[data-field]': () => this.tagName === 'TD' && 'field' in this.dataset,
      };
      return matches[selector]?.() || false;
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector) {
      queries.push({receiver: this, selector, args: [...arguments]});
      if (this.throwQuery) throw this.throwQuery;
      if (this.queryHook) this.queryHook();
      if (this.returnOverride) return this.returnOverride;
      const out = [], visit = node => { for (const child of node.children) { if (child.matches(selector)) out.push(child); visit(child); } };
      visit(this); return out;
    }
    click() { this.clicked = true; }
  }
  const body = new Element('body'); body.base = true; body.dataset.daelabCreative = 'true';
  const findId = (node, id) => node.id === id ? node : node.children.map(child => findId(child, id)).find(Boolean);
  const document = Object.assign(new Hub(), {body, visibilityState: 'visible', activeElement: null,
    createElement: tag => new Element(tag), getElementById: id => findId(body, id), querySelectorAll: selector => body.querySelectorAll(selector)});
  const window = Object.assign(new Hub(), {Element, event: undefined, crypto: globalThis.crypto,
    location: {hostname: '127.0.0.1', port: '8264'},
    queueMicrotask: fn => microtasks.push(fn), setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
    URL: {createObjectURL: blob => { downloads.push(blob); return 'blob:test'; }, revokeObjectURL: url => downloads.push(url)},
  });
  const root = new Element('section', 'dae-creative'); body.append(root);
  const owners = originalTables.map((t, i) => {
    const card = new Element('article', 'dae-creative-card'), shell = new Element('div', 'dae-table'), table = new Element('table'), head = new Element('thead'), tr = new Element('tr'), tbody = new Element('tbody');
    card.dataset.nodeId = String(i + 1); root.append(card); card.append(shell); shell.append(table); table.append(head, tbody); head.append(tr);
    for (const f of t.fields) { const th = new Element('th'); th.dataset.column = f.id; tr.append(th); }
    const rows = t.records.map(r => { const row = new Element('tr'); row.dataset.recordId = r.id; tbody.append(row);
      for (const f of t.fields) { const cell = new Element('td'); Object.assign(cell.dataset, {record: r.id, field: f.id}); row.append(cell); }
      return row;
    });
    const row = rows[1], cell = row.children[0], editor = new Element('div', 'content-display');
    editor.textContent = t.records[1].values['field-00']; cell.append(editor);
    return {card, shell, table, tbody, rows, row, cell, editor};
  });
  for (let i = 3; i <= 300; i++) { const card = new Element('article', 'dae-creative-card'); card.dataset.nodeId = String(i); root.append(card); }
  const diagnostic = createTableRowScanDiagnostic({document, window, onChange: state => notices.push(state)});
  const start = (registration = {}) => diagnostic.start({isTrusted: true}, {fixture, buildFingerprint: fingerprint, consent: true, ...registration});
  const activate = (i = 0) => { owners[i].cell.dataset.inlineEditing = 'true'; owners[i].editor.setAttribute('contenteditable', 'true'); document.activeElement = owners[i].editor; };
  const flushMicrotasks = () => { for (const fn of microtasks.splice(0)) fn(); };
  const flushTimers = () => { const list = [...timers.values()]; timers.clear(); for (const fn of list) fn(); };
  const begin = (i = 0, extra = {}) => { activate(i); const event = {isTrusted: true, eventPhase: 1, target: owners[i].editor, inputType: 'insertText', data: 'P', isComposing: false, ...extra}; window.event = event; document.emit('input', event); event.eventPhase = 2; return event; };
  const end = event => { event.eventPhase = 0; window.event = undefined; flushMicrotasks(); flushTimers(); };
  const dispatch = (fn, i = 0, extra = {}) => { const event = begin(i, extra); try { return fn(event); } finally { end(event); } };
  return {Element, document, window, body, root, owners, diagnostic, start, activate, begin, end, dispatch, flushMicrotasks, flushTimers, timers, queries, notices, downloads};
}
const descriptor = h => Object.getOwnPropertyDescriptor(h.Element.prototype, 'querySelectorAll');
const sample = h => h.diagnostic.report().sample;

test('construction and mount are inert; only branded original M and trusted explicit Start qualify', async () => {
  const h = harness(), old = descriptor(h); assert.equal(h.document.count(), 0); assert.equal(h.queries.length, 0);
  const panel = mountTableRowScanDiagnostic(h.document, h.window); assert(panel); assert.equal(h.document.count(), 0); assert.equal(h.window.count(), 0); assert.deepEqual(descriptor(h), old); assert.equal(h.timers.size, 0);
  assert.equal(mountTableRowScanDiagnostic(h.document, h.window), null); panel.dispose();
  assert.equal(h.diagnostic.start({isTrusted: false}, {fixture, consent: true, buildFingerprint: fingerprint}), false);
  assert.equal(h.start({consent: false}), false); assert.equal(h.queries.length, 0);
  const f = harness(); assert.equal(f.start({fixture: {...fixture}}), false); assert.equal(f.diagnostic.report().failureReason, 'fixture-proof');
  await assert.rejects(readRowScanFixture(new TextEncoder().encode('{}'), globalThis.crypto));
  assert.equal(h.start(), true); h.diagnostic.stop(); assert.deepEqual(descriptor(h), old);
});

test('one matching row versus all 500 rows are distinguished without reading query results or texts during input', () => {
  for (const count of [1, 500]) {
    const h = harness(), old = descriptor(h); assert(h.start()); const queriesBefore = h.queries.length, noticesBefore = h.notices.length;
    h.dispatch(() => {
      for (const owner of h.owners) Object.defineProperty(owner.editor, 'textContent', {get() { assert.fail('text read during input'); }});
      for (let i = 0; i < count; i++) h.owners[0].rows[i].querySelectorAll('td[data-field]');
      assert.equal(h.notices.length, noticesBefore); assert.equal(h.queries.length - queriesBefore, count);
    });
    assert.deepEqual(sample(h).owners.map(o => [o.calls, o.uniqueRows]), [[count, count], [0, 0]]);
    assert(sample(h).complete); assert(sample(h).restoration.exact); assert.deepEqual(descriptor(h), old);
    assert.equal(h.document.count(), 0); assert.equal(h.window.count(), 0); assert.equal(h.timers.size, 0); assert.equal(h.diagnostic.resources().registeredRows, 0);
    assert.equal(h.start(), false); assert.equal(h.diagnostic.report().productAcceptance, false);
  }
});

test('two owners, repeated receivers, other selectors and outside rows have separate bounded counts; results and arguments delegate exactly', () => {
  const h = harness(); assert(h.start()); const foreign = new h.Element('tr'), result = Object.freeze({notRead: true});
  h.owners[0].row.returnOverride = result;
  h.dispatch(() => {
    assert.equal(h.owners[0].row.querySelectorAll('td[data-field]', 'extra'), result);
    h.owners[0].row.querySelectorAll('td[data-field]'); h.owners[0].row.querySelectorAll(' td[data-field]');
    h.owners[1].rows[7].querySelectorAll('td[data-field]'); foreign.querySelectorAll('td[data-field]');
  }, 1);
  assert.equal(sample(h).inputOwner, '2'); assert.deepEqual(sample(h).owners.map(o => [o.calls, o.uniqueRows]), [[2, 1], [1, 1]]);
  assert.deepEqual(h.queries.find(q => q.args[1] === 'extra').args, ['td[data-field]', 'extra']);
});

test('target/active owner and initial identity failures never install the prototype lease', () => {
  for (const mutation of [h => h.owners[1].editor.textContent = 'wrong', h => h.owners[1].rows[40].dataset.recordId = 'duplicate', h => h.root.hidden = true]) {
    const h = harness(), old = descriptor(h); mutation(h); assert.equal(h.start(), false); assert.deepEqual(descriptor(h), old); assert.equal(h.document.count(), 0);
  }
  const h = harness(), old = descriptor(h); assert(h.start()); h.activate(); h.document.activeElement = h.owners[1].editor;
  const e = {isTrusted: true, eventPhase: 1, target: h.owners[0].editor, inputType: 'insertText', data: 'P'}; h.window.event = e; h.document.emit('input', e);
  assert.equal(sample(h), null); assert.deepEqual(descriptor(h), old); h.diagnostic.stop();
});

test('missing window.event, non ASCII, untrusted and composing inputs cannot borrow a lease', () => {
  for (const extra of [{isTrusted: false}, {data: '中文'}, {data: 'xx'}, {inputType: 'insertFromPaste'}, {isComposing: true}]) {
    const h = harness(), old = descriptor(h); assert(h.start()); h.dispatch(() => h.owners[0].row.querySelectorAll('td[data-field]'), 0, extra);
    assert.equal(sample(h), null); assert.deepEqual(descriptor(h), old); h.diagnostic.stop();
  }
  const h = harness(), old = descriptor(h); assert(h.start()); h.activate(); const e = {isTrusted: true, eventPhase: 1, target: h.owners[0].editor, inputType: 'insertText', data: 'P'};
  h.document.emit('input', e); assert.equal(h.diagnostic.report().rejected['current-event-unavailable'], 1); assert.deepEqual(descriptor(h), old); h.diagnostic.stop();
});

test('composition end tail is excluded even if final commit says insertText and isComposing false', () => {
  const h = harness(); assert(h.start()); const event = {isTrusted: true, target: h.owners[0].editor};
  h.document.emit('compositionstart', event); h.dispatch(() => {}, 0); assert.equal(sample(h), null);
  h.document.emit('compositionend', event); h.dispatch(() => {}, 0); assert.equal(sample(h), null);
  h.dispatch(() => h.owners[0].row.querySelectorAll('td[data-field]')); assert(sample(h).complete);
});

test('known and unknown nested events close attribution and preserve delegation', () => {
  for (const known of [true, false]) {
    const h = harness(), old = descriptor(h); assert(h.start());
    h.dispatch(outer => {
      h.owners[0].row.querySelectorAll('td[data-field]');
      const nested = {target: h.owners[1].editor, isTrusted: false, eventPhase: 2}; h.window.event = nested;
      if (known) h.document.emit('change', nested);
      h.owners[1].row.querySelectorAll('td[data-field]'); h.window.event = outer;
      h.owners[0].row.querySelectorAll('td[data-field]');
    });
    assert.equal(sample(h).complete, false); assert.deepEqual(sample(h).owners.map(o => o.calls), [1, 0]); assert.deepEqual(descriptor(h), old); assert.equal(h.diagnostic.resources().active, false);
  }
});

test('capture-to-target microtask is not event end; post dispatch and late calls restore exactly', () => {
  const h = harness(), old = descriptor(h); assert(h.start()); const e = h.begin(); h.flushMicrotasks();
  assert.notEqual(descriptor(h).value, old.value); h.owners[0].row.querySelectorAll('td[data-field]'); e.eventPhase = 0; h.window.event = undefined;
  const retained = descriptor(h).value; retained.call(h.owners[0].row, 'td[data-field]');
  assert.equal(sample(h).complete, false); assert.equal(sample(h).owners[0].calls, 1); assert.deepEqual(descriptor(h), old); h.end(e);
  const r = retained.call(h.owners[1].row, 'td[data-field]'); assert.equal(r.length, 10); assert.equal(h.diagnostic.resources().registeredRows, 0);
});

test('timer fallback at dispatch end succeeds; impossible still-dispatch timer closes invalid', () => {
  for (const ended of [true, false]) {
    const h = harness(), old = descriptor(h); assert(h.start()); const e = h.begin(); h.owners[0].row.querySelectorAll('td[data-field]');
    if (ended) { e.eventPhase = 0; h.window.event = undefined; } h.flushTimers();
    assert.equal(sample(h).complete, ended); assert.deepEqual(descriptor(h), old); h.end(e);
  }
});

test('row reparent, table replacement, hidden state, explicit stop, disposal and event error release without UI work inside input', () => {
  for (const mutation of [h => h.owners[0].row.remove(), h => h.owners[1].table.remove(), h => h.root.hidden = true,
    h => { h.document.visibilityState = 'hidden'; h.document.emit('visibilitychange'); }, h => h.window.emit('pagehide'),
    h => h.root.emit('dae-canvas-hide'), h => h.diagnostic.stop(), h => h.diagnostic.dispose(), h => h.window.emit('error')]) {
    const h = harness(), old = descriptor(h); assert(h.start()); const n = h.notices.length;
    h.dispatch(() => { mutation(h); h.owners[0].row.querySelectorAll('td[data-field]'); assert.equal(h.notices.length, n); });
    assert.equal(sample(h).complete, false); assert(sample(h).restoration.exact); assert.deepEqual(descriptor(h), old); assert.equal(h.document.count(), 0); assert.equal(h.window.count(), 0);
  }
});

test('descriptor replacement before input rejects; external conflict during input is preserved and retained wrapper only delegates', () => {
  const a = harness(); assert(a.start()); const original = descriptor(a), foreign = function(...args) { return Reflect.apply(original.value, this, args); };
  Object.defineProperty(a.Element.prototype, 'querySelectorAll', {...original, value: foreign}); a.dispatch(() => {});
  assert.equal(a.diagnostic.report().failureReason, 'descriptor-changed'); assert.equal(descriptor(a).value, foreign);
  const h = harness(); assert(h.start()); const old = descriptor(h); let retained;
  h.dispatch(() => { retained = descriptor(h).value; Object.defineProperty(h.Element.prototype, 'querySelectorAll', {...old, value: foreign}); });
  assert.equal(sample(h).complete, false); assert.equal(sample(h).restoration.exact, false); assert.equal(descriptor(h).value, foreign);
  assert.equal(retained.call(h.owners[0].row, 'td[data-field]').length, 10); assert.equal(h.diagnostic.resources().registeredRows, 0);
});

test('original exception object is preserved and capacity stops before counting beyond the fixed cap', () => {
  const h = harness(), old = descriptor(h), failure = Error('not included in report'); assert(h.start()); h.owners[0].row.throwQuery = failure;
  assert.throws(() => h.dispatch(() => h.owners[0].row.querySelectorAll('td[data-field]')), e => e === failure);
  assert.equal(sample(h).complete, false); assert.deepEqual(descriptor(h), old); assert(!JSON.stringify(h.diagnostic.report()).includes(failure.message));
  const b = harness(); assert(b.start()); b.dispatch(() => { for (let i = 0; i < 1201; i++) b.owners[0].row.querySelectorAll('td[data-field]'); });
  assert.equal(sample(b).owners[0].calls, 1200); assert.equal(sample(b).complete, false); assert.equal(b.diagnostic.report().stopReason, 'query-limit');
});

test('mounted trusted controls start a single run, auto enable download only after release, and revoke the download URL', async () => {
  const h = harness(), mounted = mountTableRowScanDiagnostic(h.document, h.window);
  const panel = h.document.getElementById('studio-table-row-scan-diagnostic'), nodes = panel.children;
  const picker = nodes.find(n => n.type === 'file'), build = nodes.find(n => n.getAttribute('aria-label') === '行扫描诊断构建指纹'), consent = nodes.find(n => n.tagName === 'LABEL').children[0];
  picker.files = [{arrayBuffer: async () => bytes}]; await picker.emit('change'); build.value = fingerprint; consent.checked = true;
  const start = nodes.find(n => n.textContent === '开始单次行扫描'), download = nodes.find(n => n.textContent === '下载行扫描记录');
  start.onclick({isTrusted: true}); assert(mounted.resources().active); assert(download.disabled);
  h.dispatch(() => h.owners[0].row.querySelectorAll('td[data-field]'));
  assert.equal(mounted.resources().active, false); assert.equal(download.disabled, false); assert(start.disabled);
  download.onclick({isTrusted: true}); assert.equal(h.downloads.at(-1), 'blob:test');
  const json = JSON.parse(await h.downloads[0].text()); assert.equal(json.sample.owners[0].calls, 1); assert(!JSON.stringify(json).includes('性能测试 M /'));
  mounted.dispose(); assert.equal(h.document.getElementById(panel.id), undefined);
});

test('input admission failure cannot notify UI synchronously, including a descriptor changed since Start', () => {
  const h = harness(); assert(h.start()); const old = descriptor(h), n = h.notices.length;
  Object.defineProperty(h.Element.prototype, 'querySelectorAll', {...old, value: function(...args) { return Reflect.apply(old.value, this, args); }});
  const event = h.begin(); assert.equal(h.notices.length, n); h.end(event); assert.equal(h.notices.length, n + 1);
});

test('diagnostic getters throwing during counting or final identity check cannot prevent exact restoration or change the original result', () => {
  for (const atEnd of [false, true]) {
    const h = harness(), old = descriptor(h); assert(h.start()); const event = h.begin();
    if (atEnd) Object.defineProperty(h.owners[1].card, 'isConnected', {get() { throw Error('do not record'); }});
    else {
      Object.defineProperty(h.owners[0].rows[5], 'isConnected', {get() { throw Error('do not record'); }});
      assert.equal(h.owners[0].rows[5].querySelectorAll('td[data-field]').length, 10);
    }
    h.end(event); assert.equal(sample(h).complete, false); assert(sample(h).restoration.exact); assert.deepEqual(descriptor(h), old);
  }
});

test('non-data/nonwritable descriptors and nonisolated hosts fail before pre-reading rows; report copies cannot mutate state', () => {
  for (const mutation of [h => Object.defineProperty(h.Element.prototype, 'querySelectorAll', {value() {}, writable: false}),
    h => Object.defineProperty(h.Element.prototype, 'querySelectorAll', {get() { assert.fail('accessor must not run'); }}),
    h => h.window.location.port = '8000', h => h.window.location.hostname = 'example.com']) {
    const h = harness(); mutation(h); assert.equal(h.start(), false); assert.equal(h.queries.length, 0); assert.equal(h.document.count(), 0);
    h.diagnostic.report().failureReason = 'changed'; assert.notEqual(h.diagnostic.report().failureReason, 'changed');
  }
});

test('unknown preflight errors are not inspected and cannot escape Start', () => {
  const h = harness(), failure = Object.create(null); Object.defineProperty(failure, 'message', {get() { assert.fail('error content must not be read'); }});
  Object.defineProperty(h.window, 'Element', {get() { throw failure; }});
  assert.equal(h.start(), false); assert.equal(h.diagnostic.report().failureReason, 'preflight-error'); assert.equal(h.document.count(), 0);
});
