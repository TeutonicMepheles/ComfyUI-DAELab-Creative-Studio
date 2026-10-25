/** Test-only ACTIVE intervention. No import-time mount, host access or listeners.
 * A reviewed external receipt owns process/root attestation. Browser checks below
 * are bounded current HTTP/DOM/model projections, never complete host identity.
 */
export const NATIVE_PAUSE_PINS = Object.freeze({
  revision: '671b79284da3d940e6547ebabc0c95d379278747',
  build: '78b180ea8663ae2e4a50aa81b3fc30492878abb52157a37b4eff4ed53cd94e96',
  fixture: '79ecd59cf5bbd3022abda73c2368e3e45e3b9fed824494f813cd6109e381cc79',
  assets: Object.freeze({
    '/assets/settingStore-CbkuaYBI.js': '084a2689320adc7bd0b4bfc0881b744deb46dd34697e23e0fadb1b72f0be67fa',
    '/extensions/ComfyUI-DAELab-Creative-Studio/build-manifest.json': '0bd2a243807cf29df0b5c671f998359b99c0d79c96ffbf86d2785788eb1e0465',
    '/extensions/ComfyUI-DAELab-Creative-Studio/integrations/comfyui/canvas/creative_canvas.js': 'fc367cd818c72d9b9586e8f7685faff2fd70400df590147a8030564882bd0ee8',
    '/extensions/ComfyUI-DAELab-Creative-Studio/canvas/creative_canvas_view.mjs': '9c620bbb0002ac42eeb345ae70c875347fb9c0dc4c646f95a84fe944a6fa93c3',
  }),
});
const HEX = /^[a-f0-9]{64}$/;
const proofs = new WeakSet();
const copy = value => JSON.parse(JSON.stringify(value));
const admissionFailures = new WeakMap();
const FAILURE_REASONS = new Set(['CPU-argv-mismatch', 'DOM-qualification', 'M-DOM-shape', 'M-initial-value', 'M-link-projection', 'M-node-projection',
  'admission-HTTP', 'admission-cancelled', 'admission-size', 'covered-canvas-required', 'data-property-required', 'duplicate-lease',
  'fixed-argv-required', 'fixed-registration-required', 'invalid-duration', 'isolated-origin-required',
  'origin-changed', 'original-M-required', 'pause-write-failed', 'product-build-mismatch', 'queue-not-empty', 'served-asset-mismatch',
  'native-pause-property', 'native-gap-property', 'native-rendering-property', 'native-frame-property', 'M-nodes-property',
  'host-graph-not-ready', 'host-root-graph-missing', 'host-active-graph-mismatch', 'host-canvas-graph-mismatch', 'host-workflow-missing',
  'host-workflow-mode-missing', 'host-workflow-mode-not-graph', 'host-creative-view-inactive', 'host-subgraph-active',
  'native-pause-not-writable', 'native-pause-not-false', 'native-gap-not-finite', 'native-gap-not-zero', 'native-rendering-not-true',
  'native-frame-not-finite', 'native-frame-negative', 'native-dirty-method-missing', 'identity-lost', 'native-loop-changed']);
const PROPERTY_REASONS = Object.freeze({pause_rendering: 'native-pause-property', _maximumFrameGap: 'native-gap-property', is_rendering: 'native-rendering-property', frame: 'native-frame-property', _nodes: 'M-nodes-property'});
function failure(reason) {
  const safe = FAILURE_REASONS.has(reason) ? reason : 'unexpected-error', error = Error(safe);
  admissionFailures.set(error, safe); return error;
}
const fail = reason => { throw failure(reason); };
const sha = async (bytes, crypto) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const data = (object, key) => {
  const descriptor = object && Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !('value' in descriptor)) fail(PROPERTY_REASONS[key] || 'data-property-required');
  return descriptor;
};
const finite = value => typeof value === 'number' && Number.isFinite(value);
const one = (root, selector) => {
  const nodes = root.querySelectorAll(selector);
  if (nodes.length !== 1) fail('DOM-qualification');
  return nodes[0];
};

export async function readNativePauseFixture(bytes, crypto) {
  const input = ArrayBuffer.isView(bytes) ? Uint8Array.from(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)) : bytes instanceof ArrayBuffer ? new Uint8Array(bytes.slice(0)) : null;
  if (!input || input.byteLength !== 1277808 || await sha(input, crypto) !== NATIVE_PAUSE_PINS.fixture) fail('original-M-required');
  const graph = JSON.parse(new TextDecoder().decode(input));
  const result = Object.freeze({sha256: NATIVE_PAUSE_PINS.fixture, workflowId: graph.id,
    nodes: Object.freeze(graph.nodes.map(node => Object.freeze({id: String(node.id), type: node.type}))),
    links: Object.freeze(graph.links.map(link => Object.freeze([...link]))),
    targets: Object.freeze([0, 1].map(index => Object.freeze({nodeId: String(index + 1), recordId: `M-table-0${index}-row-0001`, fieldId: 'field-00', initial: `性能测试 M / 表 ${index} / 行 0001 / 列 00。固定中文文本与数字 12345。`})))});
  proofs.add(result); return result;
}

/** Registration is fixed by the externally reviewed fresh-host loader. An
 * arbitrary receipt hash is NOT self-authenticating or proof of PID/birth/disk.
 */
function registrationOf(value, location) {
  if (!plain(value) || !HEX.test(value.receiptSHA256 || '') || !HEX.test(value.manifestSHA256 || '') ||
      value.revision !== NATIVE_PAUSE_PINS.revision || value.build !== NATIVE_PAUSE_PINS.build ||
      JSON.stringify(value.assets) !== JSON.stringify(NATIVE_PAUSE_PINS.assets)) fail('fixed-registration-required');
  const origin = new URL(value.origin);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
      !/^\d+$/.test(origin.port) || Number(origin.port) < 1024 || Number(origin.port) > 65535 || [8000, 8237, 8250, 8252, 8253, 8254].includes(Number(origin.port)) || location.origin !== origin.origin) fail('isolated-origin-required');
  if (!Array.isArray(value.argv) || value.argv.length > 60 || value.argv.some(x => typeof x !== 'string' || x.length > 1024) ||
      typeof value.environmentRoot !== 'string' || !/[/\\]\.local[/\\]host-native-pause-[a-z0-9-]+$/.test(value.environmentRoot)) fail('fixed-argv-required');
  const argv = [...value.argv], flag = key => {
    if (argv.filter(x => x === key).length !== 1) fail('fixed-argv-required');
    return argv[argv.indexOf(key) + 1];
  };
  const normal = path => path.replaceAll('\\', '/').replace(/\/$/, '');
  for (const key of ['--cpu', '--offline', '--disable-all-custom-nodes']) if (argv.filter(x => x === key).length !== 1) fail('fixed-argv-required');
  if (flag('--listen') !== '127.0.0.1' || flag('--port') !== origin.port || normal(flag('--base-directory')) !== normal(value.environmentRoot)) fail('fixed-argv-required');
  for (const name of ['user', 'input', 'output', 'temp']) if (normal(flag(`--${name}-directory`)) !== `${normal(value.environmentRoot)}/${name}`) fail('fixed-argv-required');
  const at = argv.indexOf('--whitelist-custom-nodes');
  if (at < 0 || argv.filter(x => x === '--whitelist-custom-nodes').length !== 1 || argv[at + 1] !== 'ComfyUI-DAELab-Creative-Studio' || argv[at + 2] !== 'creative_studio_test_fixture' || argv[at + 3] && !argv[at + 3].startsWith('--')) fail('fixed-argv-required');
  const flags = new Set(), valued = new Set(['--base-directory', '--user-directory', '--input-directory', '--output-directory', '--temp-directory', '--listen', '--port', '--database-url', '--feature-flag']);
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i]; if (flags.has(key)) fail('fixed-argv-required'); flags.add(key);
    if (['--cpu', '--offline', '--disable-all-custom-nodes'].includes(key)) continue;
    if (key === '--whitelist-custom-nodes') {i += 2; continue;}
    if (!valued.has(key) || !argv[++i] || argv[i].startsWith('--')) fail('fixed-argv-required');
    if (key === '--database-url' && argv[i] !== `sqlite:///${normal(value.environmentRoot)}/user/comfyui.db`) fail('fixed-argv-required');
    if (key === '--feature-flag' && argv[i] !== 'enable_telemetry=false') fail('fixed-argv-required');
  }
  return Object.freeze({origin: origin.origin, receiptSHA256: value.receiptSHA256, manifestSHA256: value.manifestSHA256,
    revision: value.revision, build: value.build, assets: NATIVE_PAUSE_PINS.assets, argv: Object.freeze(argv), environmentRoot: value.environmentRoot});
}

async function getBytes(window, registration, path, signal, limit = 2097152) {
  if (window.location.origin !== registration.origin) fail('origin-changed');
  const url = registration.origin + path;
  const response = await window.fetch(url, {method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal});
  if (!response.ok || response.redirected || response.url && response.url !== url) fail('admission-HTTP');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 1 || bytes.byteLength > limit) fail('admission-size');
  return bytes;
}
const getJSON = async (window, registration, path, signal) => JSON.parse(new TextDecoder().decode(await getBytes(window, registration, path, signal, 131072)));
async function emptyQueue(window, registration, signal) {
  const queue = await getJSON(window, registration, '/queue', signal);
  if (!Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending) || queue.queue_running.length || queue.queue_pending.length) fail('queue-not-empty');
  return {running: 0, pending: 0};
}
async function runtimeProof(window, registration, signal) {
  const before = await emptyQueue(window, registration, signal);
  const stats = await getJSON(window, registration, '/system_stats', signal);
  if (JSON.stringify(stats?.system?.argv) !== JSON.stringify(registration.argv) || !Array.isArray(stats.devices) || !stats.devices.length || stats.devices.some(device => device.type !== 'cpu')) fail('CPU-argv-mismatch');
  const health = await getJSON(window, registration, '/daelab/studio/health', signal);
  if (health.compatible !== true || health.frontendBuildId !== registration.build) fail('product-build-mismatch');
  for (const [path, expected] of Object.entries(registration.assets)) {
    const bytes = await getBytes(window, registration, path, signal);
    if (await sha(bytes, window.crypto) !== expected) fail('served-asset-mismatch');
  }
  return {before, after: await emptyQueue(window, registration, signal), cpu: true, argvExact: true, servedAssetsExact: true,
    cachedModuleBytesAttested: false, externalReceiptSHA256: registration.receiptSHA256, externalManifestSHA256: registration.manifestSHA256};
}

function capture(document, window, app, fixture) {
  const canvas = app.canvas, graph = app.rootGraph, workflow = app.extensionManager?.workflow?.activeWorkflow, view = app.daelabCreativeCanvas;
  if (app.isGraphReady !== true) fail('host-graph-not-ready');
  if (!graph) fail('host-root-graph-missing');
  if (app.graph !== graph) fail('host-active-graph-mismatch');
  if (canvas?.graph !== graph) fail('host-canvas-graph-mismatch');
  if (!workflow) fail('host-workflow-missing');
  if (!('activeMode' in workflow)) fail('host-workflow-mode-missing');
  if ((workflow.activeMode ?? workflow.initialMode ?? 'graph') !== 'graph') fail('host-workflow-mode-not-graph');
  if (!view?.active) fail('host-creative-view-inactive');
  if (canvas.subgraph) fail('host-subgraph-active');
  const root = one(document, '.dae-creative'), native = one(document, '#graph-canvas');
  if (view.root !== root || canvas.canvas !== native || !root.isConnected || root.hidden || !native.isConnected ||
      document.visibilityState !== 'visible' || document.body.dataset.daelabCreative !== 'true' || native.width <= 0 || native.height <= 0 || window.getComputedStyle(native).visibility !== 'hidden') fail('covered-canvas-required');
  const pause = data(canvas, 'pause_rendering'), gap = data(canvas, '_maximumFrameGap'), rendering = data(canvas, 'is_rendering'), frame = data(canvas, 'frame');
  if (!pause.writable) fail('native-pause-not-writable');
  if (pause.value !== false) fail('native-pause-not-false');
  if (!finite(gap.value)) fail('native-gap-not-finite');
  if (gap.value !== 0) fail('native-gap-not-zero');
  if (rendering.value !== true) fail('native-rendering-not-true');
  if (!finite(frame.value)) fail('native-frame-not-finite');
  if (frame.value < 0) fail('native-frame-negative');
  if (typeof canvas.setDirty !== 'function') fail('native-dirty-method-missing');
  const nodes = data(graph, '_nodes').value;
  if (!Array.isArray(nodes) || nodes.length !== 300 || nodes.some((node, i) => String(node.id) !== fixture.nodes[i].id || node.type !== fixture.nodes[i].type)) fail('M-node-projection');
  const links = graph.links instanceof Map ? [...graph.links.values()] : Object.values(graph.links || {});
  if (links.length !== 400) fail('M-link-projection');
  const tuples = links.map(link => [link.id, link.origin_id, link.origin_slot, link.target_id, link.target_slot, link.type]).sort((a, b) => a[0] - b[0]);
  if (JSON.stringify(tuples) !== JSON.stringify([...fixture.links].sort((a, b) => a[0] - b[0]))) fail('M-link-projection');
  const cards = root.querySelectorAll('.dae-creative-card[data-node-id]');
  if (cards.length !== 300 || root.querySelectorAll('.dae-table').length !== 2) fail('M-DOM-shape');
  const targets = fixture.targets.map(spec => {
    const card = one(root, `.dae-creative-card[data-node-id="${spec.nodeId}"]`), table = one(card, '.dae-table');
    if (table.querySelectorAll('tr[data-record-id]').length !== 500 || table.querySelectorAll('td[data-record][data-field]').length !== 5000) fail('M-DOM-shape');
    const tableIndex = Number(spec.nodeId) - 1;
    for (const [rowIndex, row] of [...table.querySelectorAll('tr[data-record-id]')].entries()) {
      const record = `M-table-0${tableIndex}-row-${String(rowIndex).padStart(4, '0')}`, cells = [...row.querySelectorAll('td[data-record][data-field]')];
      if (row.getAttribute('data-record-id') !== record || cells.length !== 10 || cells.some((cell, i) => cell.getAttribute('data-record') !== record || cell.getAttribute('data-field') !== `field-${String(i).padStart(2, '0')}`)) fail('M-DOM-shape');
    }
    const cell = one(table, `td[data-record="${spec.recordId}"][data-field="${spec.fieldId}"]`), editor = one(cell, '.content-display');
    if (editor.parentElement !== cell || editor.textContent !== spec.initial || editor.getAttribute('contenteditable') === 'true') fail('M-initial-value');
    return {card, table, cell, editor};
  });
  return {canvas, graph, workflow, view, root, native, pause, gap, rendering, frame: frame.value, frameDescriptor: frame, targets, dirtyMethod: canvas.setDirty};
}

const leases = new WeakSet();
const MODES = new Set(['baseline', 'paused', 'restored']);
const REASONS = new Set(['operator-restore', 'canvas-hide', 'set-graph', 'subgraph-opening', 'pagehide', 'page-hidden', 'before-load', 'duration-limit', 'identity-lost', 'native-loop-changed', 'direct-draw', 'setup-failed', 'disposed']);
const descriptorSame = (before, after) => !!after && 'value' in after && ['writable', 'enumerable', 'configurable'].every(key => before[key] === after[key]);

/** No host read/listener/polling at construction. Only start's trusted UI action
 * performs admission HTTP. Same safety resources run in all three arms.
 */
export function createNativeCanvasPauseDiagnostic({document, window, app, registration, onChange = () => {}, maxDurationMs = 180000} = {}) {
  if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > 180000) fail('invalid-duration');
  let active = null, pending = null, disposed = false, finishing = false, cleanupIncomplete = false, epoch = 0, lastFinish = Promise.resolve(false);
  let recoveryOwner = null, recoveryCheck = null;
  const runs = [], listeners = [], tokens = new WeakMap(); let nextToken = 0;
  const token = object => {if (!tokens.has(object)) tokens.set(object, ++nextToken); return tokens.get(object);};
  const now = () => window.performance.now();
  const notify = () => {try {onChange({active: !!active, pending: !!pending, runs: runs.length, stopReason: runs.at(-1)?.stopReason ?? null});} catch { /* Recovery never depends on own UI. */ }};
  const isCurrent = owner => app.canvas === owner.canvas && app.rootGraph === owner.graph && app.graph === owner.graph && app.isGraphReady === true &&
    app.extensionManager?.workflow?.activeWorkflow === owner.workflow && (owner.workflow.activeMode ?? owner.workflow.initialMode ?? 'graph') === 'graph' &&
    app.daelabCreativeCanvas === owner.view && owner.view.root === owner.root && owner.view.active === true && owner.canvas.graph === owner.graph && owner.canvas.canvas === owner.native && !owner.canvas.subgraph &&
    owner.root.isConnected && !owner.root.hidden && owner.native.isConnected && document.visibilityState === 'visible' && document.body.dataset.daelabCreative === 'true';
  const listen = (target, type, fn) => {listeners.push([target, type, fn]); target.addEventListener(type, fn, {capture: true, passive: true});};
  function cleanup(state) {
    const failed = [];
    for (const [name, release] of [['raf', () => window.cancelAnimationFrame(state.raf)], ['timer', () => window.clearTimeout(state.timer)], ['observer', () => state.observer?.disconnect()]]) {
      try {release();} catch {failed.push(name);}
    }
    for (const item of listeners.splice(0)) {
      try {item[0].removeEventListener(item[1], item[2], true);} catch {listeners.push(item); failed.push('listener');}
    }
    state.record.cleanup = {complete: failed.length === 0, failedResources: [...new Set(failed)]};
    if (failed.length) {cleanupIncomplete = true; state.record.controlled = false;}
  }
  function cancelPending() {
    if (!pending) return;
    const state = pending; pending = null; state.abort.abort(); state.cancelFrame?.(); cleanup(state);
  }
  function stoppedQueue(state, reason) {
    if (reason === 'pagehide' || document.visibilityState !== 'visible') {state.record.postQueue = {empty: null, status: 'unavailable-after-release'}; state.record.controlled = false; return Promise.resolve(false);}
    const abort = new AbortController(), timer = window.setTimeout(() => abort.abort(), 5000);
    return emptyQueue(window, state.registration, abort.signal).then(() => {state.record.postQueue = {empty: true, status: 'read-after-restore'}; return true;}, () => {
      state.record.postQueue = {empty: false, status: 'not-proven-empty'}; state.record.controlled = false; return false;
    }).finally(() => {window.clearTimeout(timer); notify();});
  }
  const canCheckRecovery = () => !disposed && !active && !pending && !finishing && !cleanupIncomplete && !recoveryCheck && !!recoveryOwner &&
    recoveryOwner.record.controlled === true && recoveryOwner.record.cleanup?.complete === true && recoveryOwner.record.postQueue?.empty === true;
  function finishRecovery(reason = null, expected = recoveryCheck) {
    const state = recoveryCheck;
    if (!state || state !== expected || state.done) return;
    state.done = true; state.record.endedAt = now();
    if (reason === null && state.record.endedAt - state.record.startedAt >= 1000) reason = 'deadline';
    cleanup(state);
    for (const [key, name] of [['raf', 'raf'], ['timer', 'timer'], ['observer', 'observer']]) if (!state.record.cleanup.failedResources.includes(name)) state[key] = null;
    const passed = reason === null && state.record.cleanup.complete;
    state.record.status = passed ? 'observed' : 'not-proven';
    state.record.reason = reason ?? (passed ? null : 'cleanup-incomplete');
    state.run.recoveryFrameObserved = passed;
    state.owner = null; // Never keep a completed checkpoint's captured object alive.
    if (state.record.cleanup.complete) recoveryCheck = null;
    state.resolve(passed); notify();
  }
  function invalidateRecovery() {
    recoveryOwner = null;
    finishRecovery('cancelled');
  }
  function recoveryFrame(owner) {
    if (!isCurrent(owner)) fail('identity-lost');
    const pause = data(owner.canvas, 'pause_rendering'), gap = data(owner.canvas, '_maximumFrameGap'), rendering = data(owner.canvas, 'is_rendering'), current = data(owner.canvas, 'frame');
    if (!descriptorSame(owner.pause, pause) || pause.value !== false || !descriptorSame(owner.gap, gap) || gap.value !== 0 ||
        !descriptorSame(owner.rendering, rendering) || rendering.value !== true || !descriptorSame(owner.frameDescriptor, current) || !finite(current.value) || current.value < 0) fail('native-loop-changed');
    return current.value;
  }
  function checkRecovery(event) {
    if (event?.isTrusted !== true || !canCheckRecovery()) return Promise.resolve(false);
    const captured = recoveryOwner, run = captured.record; recoveryOwner = null;
    const record = {status: 'pending', reason: null, scope: 'captured-counter-window-only', canvasIdentity: run.identities.canvas,
      startedAt: now(), endedAt: null, frameBefore: null, frameAfter: null, cleanup: null};
    run.recoveryCheckpoint = record;
    return new Promise(resolve => {
      let owner;
      const state = {run, record, resolve, done: false, raf: null, timer: null, observer: null}; recoveryCheck = state;
      const finish = reason => finishRecovery(reason, state);
      const sample = () => {
        if (state.done || recoveryCheck !== state) return;
        try {
          if (now() - record.startedAt >= 1000) {finish('deadline'); return;}
          const value = recoveryFrame(owner);
          if (state.done || recoveryCheck !== state) return;
          const finalSample = ++state.frames >= 2;
          if (finalSample) record.frameAfter = value;
          if (now() - record.startedAt >= 1000) {finish('deadline'); return;}
          if (!finalSample) state.raf = window.requestAnimationFrame(sample);
          else finish(value > record.frameBefore ? null : 'frame-not-advanced');
        } catch (error) {finish(admissionFailures.get(error) ?? 'unexpected-error');}
      };
      try {
        owner = {...captured.descriptors, ...Object.fromEntries(Object.entries(captured.refs).map(([key, ref]) => [key, ref.deref()]))};
        if (Object.keys(captured.refs).some(key => !owner[key])) {finish('captured-owner-unavailable'); return;}
        state.owner = owner;
        // Resources exist only inside this explicitly requested, bounded window.
        for (const [target, type] of [[owner.root, 'dae-canvas-hide'], [owner.native, 'litegraph:set-graph'], [owner.native, 'subgraph-opening'], [window, 'pagehide'], [document, 'visibilitychange']]) {
          listen(target, type, () => finish('lifecycle-change'));
          if (state.done || recoveryCheck !== state) return;
        }
        state.observer = new window.MutationObserver(records => {
          if (state.done || recoveryCheck !== state) return;
          try {
            const removed = records.some(item => [...(item.removedNodes || [])].some(node => node === owner.root || node === owner.native || node.contains?.(owner.root) || node.contains?.(owner.native)));
            if (removed || !isCurrent(owner)) finish('identity-lost');
          } catch (error) {finish(admissionFailures.get(error) ?? 'unexpected-error');}
        });
        state.observer.observe(owner.root.parentNode || document.body, {childList: true});
        if (state.done || recoveryCheck !== state) return;
        state.observer.observe(owner.native.parentNode || document.body, {childList: true});
        if (state.done || recoveryCheck !== state) return;
        record.frameBefore = recoveryFrame(owner); state.frames = 0;
        if (state.done || recoveryCheck !== state) return;
        state.timer = window.setTimeout(() => finish('deadline'), 1000);
        state.raf = window.requestAnimationFrame(sample); notify();
      } catch (error) {finish(admissionFailures.get(error) ?? 'unexpected-error');}
    });
  }
  function stop(reason = 'operator-restore') {
    epoch++; invalidateRecovery(); cancelPending();
    if (!active) {notify(); return lastFinish;}
    const state = active; active = null;
    const {owner, record} = state;
    record.stopReason = REASONS.has(reason) ? reason : 'operator-restore'; record.stoppedAt = now();
    record.controlled = record.controlled && record.stopReason === 'operator-restore';
    record.restore = {flag: state.wrotePause ? 'conflict' : 'not-written', dirtyRequested: false};
    // Restore the captured object before cleanup, reporting or any HTTP await.
    try {
      if (state.wrotePause) {
        const current = Object.getOwnPropertyDescriptor(owner.canvas, 'pause_rendering');
        if (descriptorSame(owner.pause, current) && current.value === true) {
          owner.canvas.pause_rendering = false;
          const after = Object.getOwnPropertyDescriptor(owner.canvas, 'pause_rendering');
          if (descriptorSame(owner.pause, after) && after.value === false) {
            record.restore.flag = 'restored';
            if (owner.canvas.setDirty === owner.dirtyMethod) {owner.dirtyMethod.call(owner.canvas, true, true); record.restore.dirtyRequested = true;}
          }
        } else if (descriptorSame(owner.pause, current) && current.value === false) record.restore.flag = 'already-false';
        if (record.restore.flag !== 'restored' || !record.restore.dirtyRequested) record.controlled = false;
      }
    } catch {record.controlled = false; record.restore.error = 'restore-operation-failed';}
    finally {
      cleanup(state); leases.delete(owner.canvas);
    }
    record.recoveryFrameObserved = false;
    if (record.controlled && record.cleanup.complete && record.restore.flag === (state.wrotePause ? 'restored' : 'not-written')) {
      try {
        // Waiting for a click has no listener/timer and retains no graph/DOM strongly.
        recoveryOwner = {record, refs: Object.fromEntries(['canvas', 'graph', 'workflow', 'view', 'root', 'native'].map(key => [key, new WeakRef(owner[key])])),
          descriptors: {pause: owner.pause, gap: owner.gap, rendering: owner.rendering, frameDescriptor: owner.frameDescriptor}};
      } catch {record.recoveryCheckpoint = {status: 'not-proven', reason: 'captured-owner-unavailable'};}
    }
    finishing = true; lastFinish = stoppedQueue(state, record.stopReason).finally(() => {finishing = false;}); notify(); return lastFinish;
  }
  function guard() {
    if (!active) return;
    const state = active, owner = state.owner;
    try {
      if (!isCurrent(owner)) {void stop('identity-lost'); return;}
      const pause = data(owner.canvas, 'pause_rendering'), gap = data(owner.canvas, '_maximumFrameGap'), rendering = data(owner.canvas, 'is_rendering');
      if (!descriptorSame(owner.pause, pause) || pause.value !== (state.mode === 'paused') || !descriptorSame(owner.gap, gap) || gap.value !== 0 || !descriptorSame(owner.rendering, rendering) || rendering.value !== true) {void stop('native-loop-changed'); return;}
      if (state.mode === 'paused' && data(owner.canvas, 'frame').value !== state.frameAtArm) {void stop('direct-draw'); return;}
      state.raf = window.requestAnimationFrame(guard);
    } catch {void stop('native-loop-changed');}
  }
  function frame(state) {
    return new Promise((resolve, reject) => {
      let id;
      const abort = () => {window.cancelAnimationFrame(id); state.abort.signal.removeEventListener('abort', abort); reject(failure('admission-cancelled'));};
      state.cancelFrame = abort;
      id = window.requestAnimationFrame(() => {state.abort.signal.removeEventListener('abort', abort); state.cancelFrame = null; resolve();});
      state.abort.signal.addEventListener('abort', abort, {once: true});
      if (state.abort.signal.aborted) abort();
    });
  }
  async function start(event, {fixture, mode, explicit = false} = {}) {
    if (disposed || active || pending || finishing || cleanupIncomplete || runs.length >= 12 || event?.isTrusted !== true || explicit !== true || !proofs.has(fixture) || !MODES.has(mode)) return false;
    invalidateRecovery(); if (cleanupIncomplete) return false;
    const ownEpoch = ++epoch, abort = new AbortController();
    const record = {mode, startedAt: now(), armedAt: null, stoppedAt: null, stopReason: null, productAcceptance: false, controlled: false,
      fixtureSHA256: fixture.sha256, originalMProjectionOnly: true, restore: null, postQueue: null};
    runs.push(record);
    const state = {abort, timer: window.setTimeout(() => abort.abort(), 15000), cancelFrame: null, record}; pending = state;
    let stage = 'registration';
    try {
      const fixed = registrationOf(registration, window.location);
      stage = 'capture-initial'; const owner = capture(document, window, app, fixture);
      if (leases.has(owner.canvas)) fail('duplicate-lease');
      stage = 'lifetime-setup';
      Object.assign(state, {owner, registration: fixed, mode, wrotePause: false, raf: null, observer: null});
      // Watch lifetime while asynchronous admission is pending too. A hide/load
      // and return to the same graph cannot silently resurrect the old request.
      listen(owner.root, 'dae-canvas-hide', () => {void stop('canvas-hide');});
      listen(owner.native, 'litegraph:set-graph', () => {void stop('set-graph');});
      listen(owner.native, 'subgraph-opening', () => {void stop('subgraph-opening');});
      listen(window, 'pagehide', () => {void stop('pagehide');});
      listen(document, 'visibilitychange', () => {if (document.visibilityState !== 'visible') void stop('page-hidden');});
      state.observer = new window.MutationObserver(records => {
        if (active !== state && pending !== state) return;
        const removed = records.some(item => [...(item.removedNodes || [])].some(node => node === owner.root || node === owner.native || node.contains?.(owner.root) || node.contains?.(owner.native)));
        if (removed || !isCurrent(owner)) void stop('identity-lost');
      });
      state.observer.observe(owner.root.parentNode || document.body, {childList: true});
      state.observer.observe(owner.native.parentNode || document.body, {childList: true});
      stage = 'runtime'; record.runtime = await runtimeProof(window, fixed, abort.signal);
      if (abort.signal.aborted || epoch !== ownEpoch || !isCurrent(owner)) fail('admission-cancelled');
      stage = 'live-loop'; await frame(state); await frame(state);
      if (abort.signal.aborted || epoch !== ownEpoch || !isCurrent(owner) || data(owner.canvas, 'frame').value <= owner.frame) fail('admission-cancelled');
      stage = 'capture-repeat'; const refreshed = capture(document, window, app, fixture);
      if (refreshed.canvas !== owner.canvas || refreshed.graph !== owner.graph || refreshed.workflow !== owner.workflow || leases.has(owner.canvas) ||
          !descriptorSame(owner.pause, refreshed.pause) || !descriptorSame(owner.gap, refreshed.gap) || !descriptorSame(owner.rendering, refreshed.rendering) || refreshed.dirtyMethod !== owner.dirtyMethod) fail('admission-cancelled');
      window.clearTimeout(state.timer); pending = null;
      Object.assign(state, {frameAtArm: refreshed.frame, timer: null});
      active = state; leases.add(owner.canvas); stage = 'setup';
      state.timer = window.setTimeout(() => {void stop('duration-limit');}, maxDurationMs);
      state.raf = window.requestAnimationFrame(guard);
      if (!isCurrent(owner) || data(owner.canvas, 'pause_rendering').value !== false || data(owner.canvas, '_maximumFrameGap').value !== 0) fail('admission-cancelled');
      if (mode === 'paused') {state.wrotePause = true; owner.canvas.pause_rendering = true; if (data(owner.canvas, 'pause_rendering').value !== true) fail('pause-write-failed');}
      record.armedAt = now(); record.controlled = true; record.identities = Object.fromEntries(['canvas', 'graph', 'workflow', 'view', 'root', 'native'].map(key => [key, token(owner[key])]));
      record.frameAtArm = state.frameAtArm; record.branch = 'pinned-own-data-gap-exactly-zero'; notify(); return true;
    } catch (error) {
      // Only our own errors carry codes. Never inspect arbitrary message/stack
      // properties, including a thrown getter or a spoofed known reason string.
      record.failureStage = stage; record.failureReason = admissionFailures.get(error) ?? 'unexpected-error'; record.controlled = false;
      if (active === state) await stop('setup-failed');
      else {record.stopReason = 'admission-failed'; record.stoppedAt = now(); if (pending === state) cancelPending();}
      notify(); return false;
    }
  }
  return {start, stop, checkRecovery, get canCheckRecovery() {return canCheckRecovery();}, beforeLoadGraph() {return stop('before-load');}, destroy() {disposed = true; return stop('disposed');}, get active() {return !!active;},
    resources: () => ({listeners: listeners.length, observers: active?.observer || pending?.observer || recoveryCheck?.observer ? 1 : 0, raf: active?.raf != null || recoveryCheck?.raf != null ? 1 : 0, timer: active?.timer != null || recoveryCheck?.timer != null ? 1 : 0, ...(cleanupIncomplete ? {cleanupIncomplete: true} : {})}),
    report: () => copy({schemaVersion: 1, kind: 'active-native-loop-pause-diagnostic', productAcceptance: false, formalBudgetEvaluated: false,
      maxDurationMs, runs, limitations: ['External fixed receipt/manifest review owns PID, birth, disk and root isolation; the browser cannot authenticate an arbitrary receipt hash.',
        'HTTP proves current server responses, not already-cached module bytes. Queue evidence is before/after, not continuous.',
        'Private _maximumFrameGap is a pinned read-only implementation detail. Its public FPS getter alone does not prove the zero-gap branch.',
        'The boolean has no ownership token. Arbitrary external false/true ABA or concurrent FPS writers cannot be made safe without forbidden hooks; only the fixed isolated composition is supported.',
        'Pause suppresses native loop draw including layout/widgets/previews; direct draw bypasses it. Native history/input and the existing render scheduling chain continue.',
        'Identity rAF is a later guard, not an atomic barrier to unapproved concurrent changes. Same guard runs in baseline/paused/restored.',
        'The duration limit is a JavaScript timer; main-thread blockage, page suspension or process failure can delay/prevent callbacks. It is not a wall-clock restoration guarantee.',
        'A recovery checkpoint observes only the captured counter advancing in its explicit window, not continuous identity since Stop, immediate restoration, automatic-loop origin or visible pixels. Only weak captured identities remain between Stop and click; no listener/timer monitors that interval.',
        'The checkpoint deadline uses JavaScript scheduling, not a hard wall-clock guarantee during suspension. Mode/visible recovery and saved/reopened data remain external acceptance. An arm is not100ms or product acceptance.']})};
}

/** A reviewed fresh-host loader must call this explicitly with fixed pins.
 * No auto-mount, remote import, runtime guessing or editable receipt fields.
 */
export function mountNativeCanvasPauseDiagnostic(document, window, {registration, loadApp = () => import('/scripts/app.js')} = {}) {
  if (document.getElementById('studio-native-canvas-pause-diagnostic')) return null;
  const make = (tag, text, parent) => {const element = document.createElement(tag); element.textContent = text || ''; parent?.append(element); return element;};
  const panel = make('details', '', document.body); panel.id = 'studio-native-canvas-pause-diagnostic';
  panel.style.cssText = 'position:fixed;right:8px;bottom:56px;z-index:2147483003;width:360px;max-height:65vh;overflow:auto;background:#322513;color:white;border:2px solid #ffb347;padding:10px;font:12px/1.5 sans-serif';
  make('summary', '原生循环暂停诊断 · 会改变渲染状态', panel);
  make('p', '仅供已独审的固定隔离宿主。外部 receipt 负责 PID、birth、目录与包；页面不能自证这些事实。页面会在启用前读取同源 CPU、argv、队列、构建及资源哈希。不是产品验收。', panel);
  make('p', '只选择原 M，执行既定 P/z/O/y。180秒定时恢复可能受主线程阻塞影响；先停止834d，再恢复并下载。切图、隐藏、异常会触发恢复；冲突可能使恢复无法证明，应停止实验。不要生成、调FPS或切换宿主。', panel);
  const picker = make('input', '', panel); picker.type = 'file'; picker.accept = '.json'; picker.setAttribute('aria-label', '原 M 工作流');
  const label = make('label', '', panel), enabled = make('input', '', label); enabled.type = 'checkbox'; make('span', '已核对外部固定准入，明确同意临时改变原生渲染', label);
  const controls = make('div', '', panel), buttons = new Map();
  for (const [mode, text] of [['baseline', '启用基线守卫'], ['paused', '启用原生暂停'], ['restored', '启用恢复后对照']]) {const button = make('button', text, controls); button.type = 'button'; buttons.set(mode, button);}
  const restore = make('button', '立即恢复', controls), recovery = make('button', '检查恢复计数器', controls), download = make('button', '下载干预记录', controls), status = make('output', '未启用；无宿主监听或暂停', panel);
  restore.type = recovery.type = download.type = 'button'; restore.disabled = recovery.disabled = true;
  make('p', '恢复并完成队列核验后，可显式检查捕获旧实例的计数器在两帧窗口内是否前进。这不证明即时恢复、自动循环来源或可见画面；检查默认关闭。', panel);
  let controller = null, selected = null, disposed = false, loading = false, revision = 0;
  const update = () => {for (const button of buttons.values()) button.disabled = loading || !!controller?.active; restore.disabled = !loading && !controller?.active; recovery.disabled = loading || !controller?.canCheckRecovery; picker.disabled = enabled.disabled = loading || !!controller?.active;};
  picker.onchange = async event => {
    if (disposed || event?.isTrusted !== true || loading || controller?.active) return;
    const own = ++revision; selected = null;
    try {const file = picker.files?.[0]; if (!file || file.size !== 1277808) fail('original-M-required'); const proof = await readNativePauseFixture(await file.arrayBuffer(), window.crypto); if (!disposed && revision === own) {selected = proof; status.textContent = '原 M SHA 已核；尚未启用';}}
    catch {if (!disposed && revision === own) status.textContent = '拒绝：必须选择固定原 M 文件';}
  };
  for (const [mode, button] of buttons) button.onclick = async event => {
    if (disposed || loading || controller?.active || event?.isTrusted !== true || enabled.checked !== true || !selected) return;
    const own = ++revision; loading = true; update();
    try {
      registrationOf(registration, window.location);
      if (!controller) {const {app} = await loadApp(); if (disposed || revision !== own) return; controller = createNativeCanvasPauseDiagnostic({document, window, app, registration, onChange: update});}
      const result = await controller.start(event, {fixture: selected, mode, explicit: true});
      if (!disposed && revision === own) status.textContent = result ? `已启用 ${mode}；已设180秒恢复定时器，也可立即恢复` : '拒绝启用；保留本次准入失败记录';
    } catch {if (!disposed) status.textContent = '拒绝：固定准入不可用';}
    finally {loading = false; update();}
  };
  restore.onclick = async event => {if (disposed || event?.isTrusted !== true) return; revision++; loading = false; await controller?.stop(); if (!disposed) status.textContent = '已请求恢复；检查队列结案后，可显式检查恢复计数器'; update();};
  recovery.onclick = async event => {
    if (disposed || loading || event?.isTrusted !== true || !controller?.canCheckRecovery) return;
    const own = ++revision; loading = true; update();
    try {const observed = await controller.checkRecovery(event); if (!disposed && revision === own) status.textContent = observed ? '捕获旧实例的计数器在本检查窗口内前进；不是可见恢复或产品验收' : '恢复计数器未获证明；下载并保留原因，不自动重试';}
    finally {if (!disposed && revision === own) {loading = false; update();}}
  };
  download.onclick = event => {
    if (disposed || loading || controller?.active || event?.isTrusted !== true || !controller) return;
    const url = window.URL.createObjectURL(new Blob([JSON.stringify(controller.report())], {type: 'application/json'}));
    try {const anchor = make('a', '', panel); anchor.href = url; anchor.download = `native-canvas-pause-${Date.now()}.json`; anchor.click(); anchor.remove();}
    finally {window.URL.revokeObjectURL(url);}
  };
  return {report: () => controller?.report() ?? null, resources: () => controller?.resources() ?? {listeners: 0, observers: 0, raf: 0, timer: 0},
    destroy() {if (disposed) return; disposed = true; revision++; void controller?.destroy(); picker.onchange = restore.onclick = recovery.onclick = download.onclick = null; for (const button of buttons.values()) button.onclick = null; panel.remove();}};
}
