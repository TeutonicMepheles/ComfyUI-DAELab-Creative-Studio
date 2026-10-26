/** Test-only, opt-in, ONE input-dispatch DOM query counter. Not a latency or CPU
 * observer. Import/construction/mount never hooks Element or observes the graph.
 * A count does not identify the caller (in particular, it is not a refreshStates
 * measurement). Do not run alongside semantic/method/LoAF performance collectors.
 */
import {readTableSemanticFixture} from './performance_table_semantic.js';

const FIXTURE_SHA = '79ecd59cf5bbd3022abda73c2368e3e45e3b9fed824494f813cd6109e381cc79';
const HEX = /^[a-f0-9]{64}$/;
const SELECTOR = 'td[data-field]';
const EVENTS = ['input', 'beforeinput', 'change', 'keydown', 'keyup', 'click', 'pointerdown', 'blur', 'compositionstart', 'compositionupdate', 'compositionend'];
const proofs = new WeakMap();
const failures = new WeakMap();
const sameDescriptor = (a, b) => !!a && !!b && ['value', 'get', 'set', 'writable', 'enumerable', 'configurable'].every(key => a[key] === b[key]);
const fail = reason => { const error = Error(reason); failures.set(error, reason); throw error; };
const one = (root, selector) => { const all = root.querySelectorAll(selector); if (all.length !== 1) fail('DOM-shape'); return all[0]; };

/** File proof only. This does not load, identify or attest the current native graph. */
export async function readRowScanFixture(bytes, crypto) {
  const checked = await readTableSemanticFixture(bytes, crypto);
  if (checked.sha256 !== FIXTURE_SHA) fail('original-M-only');
  const workflow = JSON.parse(new TextDecoder().decode(bytes));
  const identities = ['1', '2'].map(nodeId => {
    const table = JSON.parse(workflow.nodes.find(node => String(node.id) === nodeId).widgets_values[0]);
    return {nodeId, records: table.records.map(row => row.id), fields: table.fields.map(field => field.id),
      recordId: table.records[1].id, fieldId: 'field-00', initialText: table.records[1].values['field-00']};
  });
  const proof = Object.freeze({sha256: checked.sha256, bytes: checked.bytes, file: checked.file});
  proofs.set(proof, identities); return proof;
}

export function createTableRowScanDiagnostic({document, window, onChange = () => {}}) {
  let active = false, disposed = false, attempted = false, report = null, abort = null, owners = [], rows = null, lease = null;
  let prototype = null, prepared = null, notifyTimer = null, receiving = 0;
  const composing = new WeakSet(), compositionTail = new WeakSet();
  const notify = () => { try { onChange({active, attempted, leased: !!lease}); } catch { /* UI cannot change product behavior. */ } };
  const reject = reason => { report.rejected[reason] = (report.rejected[reason] || 0) + 1; };
  const ownerCurrent = owner => owner.canvas.isConnected && !owner.canvas.hidden && document.body.dataset.daelabCreative === 'true' &&
    owner.card.isConnected && owner.shell.isConnected && owner.table.isConnected && owner.tbody.isConnected && owner.row.isConnected && owner.cell.isConnected && owner.editor.isConnected &&
    owner.card.dataset.nodeId === owner.nodeId && owner.card.closest('.dae-creative') === owner.canvas && owner.shell.closest('.dae-creative-card[data-node-id]') === owner.card &&
    owner.table.closest('.dae-table') === owner.shell && owner.tbody.parentElement === owner.table && owner.row.parentElement === owner.tbody &&
    owner.row.dataset.recordId === owner.recordId && owner.cell.parentElement === owner.row && owner.cell.dataset.record === owner.recordId && owner.cell.dataset.field === owner.fieldId && owner.editor.parentElement === owner.cell;
  function current(item) {
    try {
      return active && lease === item && document.visibilityState === 'visible' && item.event?.eventPhase > 0 && window.event === item.event &&
        item.event.isTrusted && item.event.target === item.owner.editor && document.activeElement === item.owner.editor &&
        item.owner.cell.dataset.inlineEditing === 'true' && item.owner.editor.getAttribute('contenteditable') === 'true' && owners.every(ownerCurrent) &&
        sameDescriptor(Object.getOwnPropertyDescriptor(prototype, 'querySelectorAll'), item.installed);
    } catch { return false; }
  }
  function finish(reason, complete = false) {
    if (!active) return;
    const item = lease, duringDispatch = receiving > 0 || !!item?.event && item.event.eventPhase !== 0;
    active = false;
    if (item) {
      item.closed = true; window.clearTimeout(item.timer);
      let exact = false, conflict = null;
      try { if (complete && (document.visibilityState !== 'visible' || !owners.every(ownerCurrent) || document.activeElement !== item.owner.editor)) complete = false; }
      catch { complete = false; }
      try {
        const actual = Object.getOwnPropertyDescriptor(prototype, 'querySelectorAll');
        if (sameDescriptor(actual, item.installed)) Object.defineProperty(prototype, 'querySelectorAll', prepared);
        else if (!sameDescriptor(actual, prepared)) conflict = 'descriptor-replaced';
        else { complete = false; conflict = 'descriptor-changed-back'; }
        exact = sameDescriptor(Object.getOwnPropertyDescriptor(prototype, 'querySelectorAll'), prepared);
      } catch { conflict = 'descriptor-restore-failed'; }
      item.sample.owners.forEach((summary, i) => { summary.uniqueRows = item.seen[i].size; });
      item.sample.complete = complete && exact && !conflict;
      item.sample.restoration = {exact, conflict, reason};
      // A foreign reference to the wrapper can only call through after this point.
      // No retained event, DOM, row collection or installed descriptor in that cell.
      item.event = item.owner = item.seen = item.installed = null; lease = null;
    }
    abort?.abort(); abort = null; owners = []; rows = null; prototype = prepared = null;
    report.stopReason = reason;
    if (!duringDispatch) notify();
    else if (notifyTimer === null) notifyTimer = window.setTimeout(() => { notifyTimer = null; if (!disposed) notify(); }, 0);
  }
  function collect(identities) {
    const canvas = one(document, '.dae-creative');
    if (canvas.hidden || !canvas.isConnected || document.body.dataset.daelabCreative !== 'true') fail('canvas-inactive');
    const cards = [...canvas.querySelectorAll('.dae-creative-card[data-node-id]')];
    if (cards.length !== 300) fail('M-card-count');
    rows = new WeakMap();
    return identities.map(identity => {
      const matches = cards.filter(card => card.dataset.nodeId === identity.nodeId);
      if (matches.length !== 1) fail('M-owner');
      const card = matches[0], shell = one(card, '.dae-table'), table = one(shell, 'table'), tbody = one(table, 'tbody');
      const headers = [...table.querySelectorAll('th[data-column]')], tableRows = [...tbody.querySelectorAll('tr[data-record-id]')];
      if (headers.length !== 10 || headers.some((header, i) => header.dataset.column !== identity.fields[i]) || tableRows.length !== 500) fail('M-table-shape');
      tableRows.forEach((row, i) => {
        if (row.parentElement !== tbody || row.dataset.recordId !== identity.records[i]) fail('M-row-identity');
        rows.set(row, {ownerIndex: identities.indexOf(identity), index: i, recordId: identity.records[i], tbody});
      });
      const row = tableRows[1], cells = [...row.querySelectorAll(SELECTOR)], cell = cells.find(cell => cell.dataset.field === identity.fieldId);
      if (cells.length !== 10 || !cell || cell.dataset.record !== identity.recordId || cell.parentElement !== row) fail('M-target-cell');
      const editor = one(cell, '.content-display');
      if (editor.parentElement !== cell || editor.textContent !== identity.initialText) fail('M-target-original-value');
      const owner = {canvas, card, shell, table, tbody, row, cell, editor, nodeId: identity.nodeId, recordId: identity.recordId, fieldId: identity.fieldId};
      if (!ownerCurrent(owner)) fail('M-owner-identity');
      return owner;
    });
  }
  function wrap(original, item) {
    return function(...args) {
      if (item.closed) return Reflect.apply(original, this, args);
      if (!current(item)) { finish('outside-input-lease'); return Reflect.apply(original, this, args); }
      try {
        const match = args[0] === SELECTOR ? rows.get(this) : null;
        if (match) {
          if (!this.isConnected || this.parentElement !== match.tbody || this.dataset.recordId !== match.recordId) finish('row-identity-changed');
          else if (item.total >= 1200) finish('query-limit');
          else { item.total++; item.sample.owners[match.ownerIndex].calls++; item.seen[match.ownerIndex].add(match.index); }
        }
      } catch { finish('diagnostic-read-error'); }
      try { return Reflect.apply(original, this, args); }
      catch (error) { finish('query-threw'); throw error; }
      finally { if (!item.closed && !current(item)) finish('lease-changed-during-query'); }
    };
  }
  function receive(event) {
    receiving++;
    try { receiveEvent(event); }
    catch { if (active) { report.failureReason = 'event-read-error'; finish('event-read-error'); } }
    finally { receiving--; }
  }
  function receiveEvent(event) {
    if (!active) return;
    // This runs before qualification: synthetic/external known nested events also
    // invalidate the outer sample. Other nested types are caught by window.event.
    if (lease) { if (event !== lease.event) finish('nested-event'); return; }
    const owner = owners.find(owner => owner.editor === event.target);
    if (owner && event.isTrusted && event.type === 'compositionstart') { composing.add(event.target); return; }
    if (owner && event.isTrusted && event.type === 'compositionend') { composing.delete(event.target); compositionTail.add(event.target); return; }
    if (event.type !== 'input') return;
    if (!owner || !event.isTrusted || !event.eventPhase || event.isComposing || composing.has(event.target) || event.inputType !== 'insertText' || !/^[\x20-\x7e]$/.test(event.data || '')) { reject('unsupported-input'); return; }
    if (compositionTail.has(event.target)) { compositionTail.delete(event.target); reject('post-composition-input'); return; }
    if (window.event !== event) { reject('current-event-unavailable'); return; }
    if (document.activeElement !== owner.editor || owner.cell.dataset.inlineEditing !== 'true' || owner.editor.getAttribute('contenteditable') !== 'true') { reject('editor-not-active'); return; }
    try {
      if (document.visibilityState !== 'visible' || !owners.every(ownerCurrent)) fail('owner-changed');
      if (!sameDescriptor(Object.getOwnPropertyDescriptor(prototype, 'querySelectorAll'), prepared)) fail('descriptor-changed');
      const sample = {inputOwner: owner.nodeId, complete: false, owners: owners.map(o => ({nodeId: o.nodeId, calls: 0, uniqueRows: 0})), restoration: null};
      const item = {event, owner, sample, seen: [new Set(), new Set()], total: 0, closed: false, timer: null, installed: null};
      report.sample = sample; lease = item; item.installed = {...prepared, value: wrap(prepared.value, item)};
      Object.defineProperty(prototype, 'querySelectorAll', item.installed);
      if (!sameDescriptor(Object.getOwnPropertyDescriptor(prototype, 'querySelectorAll'), item.installed)) fail('install-mismatch');
      // A UA microtask checkpoint may occur between capture and target listeners.
      window.queueMicrotask(() => { if (!item.closed && item.event.eventPhase === 0) finish('post-dispatch-microtask', true); });
      item.timer = window.setTimeout(() => { if (!item.closed) finish(item.event.eventPhase === 0 ? 'post-dispatch-task' : 'dispatch-not-ended', item.event.eventPhase === 0); }, 0);
    } catch (error) { report.failureReason = failures.get(error) || 'install-error'; finish('input-admission-failed'); }
  }
  return {
    start(event, {fixture, buildFingerprint, consent = false} = {}) {
      if (disposed || attempted || !event?.isTrusted || !consent || !HEX.test(buildFingerprint || '')) return false;
      attempted = true;
      report = {schema: 'table-row-scan-dispatch/v1', productAcceptance: false, buildFingerprint, buildAttested: false,
        fixture: null, nativeWorkflowAttested: false, scope: 'exact selector on pre-registered row receivers, single trusted ASCII input dispatch',
        limitations: ['counts do not identify callers or measure CPU/latency', 'prototype wrapping affects all querySelectorAll calls during this dispatch',
          'no native graph/history/values attestation; no continuous identity ABA proof', 'only queried rows have their current row identity rechecked; the two target owners are checked on each call',
          'unknown nested events without a query are not observed; nested queries require the public window.event to equal the captured input',
          'same-value external descriptor writes are not detectable; no proof that the original method is unwrapped'],
        preflight: null, rejected: {}, failureReason: null, sample: null, stopReason: null};
      try {
        const identities = proofs.get(fixture); if (!identities) fail('fixture-proof');
        report.fixture = {...fixture};
        if (!['localhost', '127.0.0.1', '[::1]'].includes(window.location?.hostname) || !/^\d+$/.test(window.location?.port || '') || window.location.port === '8000') fail('isolated-loopback-only');
        if (document.visibilityState !== 'visible') fail('document-hidden');
        prototype = window.Element?.prototype; prepared = Object.getOwnPropertyDescriptor(prototype, 'querySelectorAll');
        if (!prepared || !('value' in prepared) || typeof prepared.value !== 'function' || !prepared.configurable || !prepared.writable) fail('replaceable-own-data-method-required');
        owners = collect(identities);
        report.preflight = {cards: 300, tables: 2, rowsPerTable: 500, headerFieldsPerTable: 10, twoOriginalTargets: true};
        abort = new AbortController(); const options = {capture: true, signal: abort.signal};
        for (const type of EVENTS) document.addEventListener(type, receive, options);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') finish('document-hidden'); }, options);
        window.addEventListener('pagehide', () => finish('pagehide'), options);
        window.addEventListener('error', () => { if (lease) finish('event-error'); }, options);
        owners[0].canvas.addEventListener('dae-canvas-hide', () => finish('canvas-hide'), options);
        active = true; notify(); return true;
      } catch (error) {
        report.failureReason = failures.get(error) || 'preflight-error';
        abort?.abort(); abort = null; owners = []; rows = null; prototype = prepared = null; notify(); return false;
      }
    },
    stop() { finish('operator-stop'); },
    dispose() { disposed = true; finish('disposed'); if (notifyTimer !== null) window.clearTimeout(notifyTimer); notifyTimer = null; },
    report: () => report ? JSON.parse(JSON.stringify(report)) : null,
    resources: () => ({active, attempted, leased: !!lease, registeredRows: rows ? 1000 : 0}),
  };
}

export function mountTableRowScanDiagnostic(document, window) {
  if (document.getElementById('studio-table-row-scan-diagnostic')) return null;
  const make = (tag, text, parent) => { const node = document.createElement(tag); if (text) node.textContent = text; parent?.append(node); return node; };
  const panel = make('details', '', document.body); panel.id = 'studio-table-row-scan-diagnostic';
  panel.style.cssText = 'position:fixed;right:8px;top:204px;z-index:2147483002;width:350px;max-height:60vh;overflow:auto;padding:10px;background:#182027;color:#eee;border:1px solid #71858f;font:12px/1.5 sans-serif';
  make('summary', '表格行扫描（单次诊断）', panel);
  make('p', '仅隔离测试宿主。预读原 M 两表行身份与两个原始首格；一次 ASCII 输入期间临时包装 Element.querySelectorAll，结束恢复。只记录行查询次数，不证明函数来源/CPU/输入延迟。构建为操作者声明；文件选择不代表原生图已加载。不与其他性能观察器并开。', panel);
  const picker = make('input', '', panel); picker.type = 'file'; picker.accept = '.json'; picker.setAttribute('aria-label', '行扫描固定原 M 文件');
  const build = make('input', '', panel); build.maxLength = 64; build.setAttribute('aria-label', '行扫描诊断构建指纹');
  const label = make('label', '', panel), consent = make('input', '', label); consent.type = 'checkbox'; make('span', '同意本次原型方法包装及扰动；其他观察器已停止', label);
  const status = make('output', '未开始；无监听/包装', panel);
  let fixture = null, revision = 0, disposed = false;
  const own = new AbortController();
  const button = (text, fn) => { const node = make('button', text, panel); node.type = 'button'; node.onclick = fn; return node; };
  const diagnostic = createTableRowScanDiagnostic({document, window, onChange: () => update()});
  const start = button('开始单次行扫描', event => { if (!disposed) { diagnostic.start(event, {fixture, buildFingerprint: build.value.trim(), consent: consent.checked}); update(); } });
  const stop = button('停止并释放行扫描', event => { if (event?.isTrusted && !disposed) { diagnostic.stop(); update(); } });
  const download = button('下载行扫描记录', event => {
    if (!event?.isTrusted || disposed || diagnostic.resources().active) return;
    const value = diagnostic.report(); if (!value) return;
    const url = window.URL.createObjectURL(new Blob([JSON.stringify(value)], {type: 'application/json'}));
    try { const link = make('a', '', panel); link.href = url; link.download = `table-row-scan-${Date.now()}.json`; link.click(); link.remove(); }
    finally { window.URL.revokeObjectURL(url); }
  });
  function update() {
    if (disposed) return;
    const state = diagnostic.resources(), record = diagnostic.report();
    start.disabled = state.attempted; stop.disabled = !state.active; download.disabled = state.active || !record;
    picker.disabled = build.disabled = consent.disabled = state.attempted;
    status.textContent = state.active ? '等待一次可信 ASCII 输入；不得并开其他性能观察器' : record ? `已结案：${record.failureReason || record.stopReason}；仅 DOM 查询计数` : '未开始；无监听/包装';
  }
  picker.addEventListener('change', async () => {
    if (diagnostic.resources().attempted) return;
    const id = ++revision; fixture = null; const file = picker.files?.[0]; if (!file) return;
    try { const proof = await readRowScanFixture(await file.arrayBuffer(), window.crypto); if (!disposed && id === revision) { fixture = proof; status.textContent = '固定原 M 文件已核对；尚未证明原生图状态'; } }
    catch { if (!disposed && id === revision) status.textContent = '文件资格失败；只接受固定原 M'; }
  }, {signal: own.signal});
  for (const type of ['pointerdown', 'keydown', 'dblclick', 'wheel']) panel.addEventListener(type, event => {
    if (type === 'keydown' && !event.isComposing && (event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 's') return;
    event.stopPropagation();
  }, {signal: own.signal});
  update();
  return {report: diagnostic.report, resources: diagnostic.resources, dispose() { if (disposed) return; disposed = true; revision++; diagnostic.dispose(); own.abort(); start.onclick = stop.onclick = download.onclick = null; panel.remove(); }};
}
