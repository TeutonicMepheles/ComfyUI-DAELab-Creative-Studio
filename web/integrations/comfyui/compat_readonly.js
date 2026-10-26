import { captureReadonlyNode, mergeReadonlySerialized, projectReadonly, previewGPTConversion,
    applyGPTConversion, assertReadonlyWorkflowExecutionAllowed, isReadonlyType,
    captureWorkflowEnvelope, mergeWorkflowEnvelope,
    PROTOTYPE_TYPES, PROTOTYPE_SLOTS, GPT_TYPE, READONLY_MESSAGE } from '../../compat/readonly_nodes.js';
import { DocumentController } from '../../application/document_controller.js';
import { readStoryboard } from '../../features/storyboard/storyboard_table_adapter.mjs';
import { createCreativeButton, bindCreativeButton } from '../../ui/creative_button.mjs';
import { bindCreativeField } from '../../ui/creative_field.mjs';
import { bindPanelAvailability } from '../../ui/creative_panel_state.mjs';
import { canvasHistory } from './canvas/creative_history.mjs';
import { stopCanvasPropagation } from '../../ui/creative_events.mjs';

const API = Symbol.for('DAELAB.CreativeCanvas.API.v1');
const installed = new WeakMap(), archives = new WeakMap(), configured = new WeakMap(), panels = new WeakMap();
const wrapped = new WeakSet();
const graphBridges = new WeakMap();
const graphContexts = new WeakMap();
const clone = value => JSON.parse(JSON.stringify(value));

/** Capture before native configure changes defaults; restore through the native serializer. */
export function installReadonlySerialization(NodeType, {configureNative} = {}) {
    if (wrapped.has(NodeType)) return;
    const configure = NodeType.prototype.configure, serialize = NodeType.prototype.serialize;
    if (typeof configure !== 'function' || typeof serialize !== 'function') throw new Error('宿主缺少原生节点配置/序列化能力，不能安全读取旧节点');
    wrapped.add(NodeType);
    NodeType.prototype.configure = function(data) {
        if (!isReadonlyType(data?.type || this.type)) return configure.call(this, data);
        const raw = captureReadonlyNode({ ...data, type: data.type || this.type });
        archives.set(this, raw);
        // Host 1.53.10 ComfyNode.configure rebuilds inputs in current schema
        // order. Retired nodes use LGraphNode's historical-slot hydration; its
        // widget restoration and extension hooks still run normally.
        const result = (configureNative || configure).call(this, clone(data));
        configured.set(this, clone(serialize.call(this)));
        for (const widget of this.widgets || []) if (widget.name !== 'studio_compat_readonly') {
            widget.disabled = true;
            if (widget.inputEl) widget.inputEl.readOnly = true;
        }
        panels.get(this)?.sync();
        return result;
    };
    NodeType.prototype.serialize = function(...args) {
        const current = serialize.apply(this, args), original = archives.get(this);
        return original ? mergeReadonlySerialized(original, current, configured.get(this)) : current;
    };
    NodeType.prototype.onConnectInput = () => false;
    NodeType.prototype.onConnectOutput = () => false;
    NodeType.prototype.onExecute = function() { throw new Error('历史节点只读，禁止执行'); };
}

/** Preserve unknown top-level workflow fields across the host's extension lift. */
export function installReadonlyWorkflowSerialization(graph, {subgraph = false, source = null, ownerReleases = null} = {}) {
    if (graphBridges.has(graph)) return graphBridges.get(graph);
    const configure = graph?.configure, serialize = graph?.serialize, clear = graph?.clear, asSerialisable = graph?.asSerialisable, createSubgraph = graph?.createNormalizedSubgraph, remove = graph?.remove;
    if (![configure, serialize, clear].every(value => typeof value === 'function')) throw new Error('宿主缺少原生工作流配置/序列化能力，不能安全保留旧字段');
    let envelope = source ? captureWorkflowEnvelope(source, subgraph) : null, loading = null, disposed = false, identity = {};
    const childReleases = ownerReleases || new Map();
    const pruneChildren = () => {
        const registry = (graph.rootGraph || graph).subgraphs;
        if (!(registry instanceof Map)) return;
        for (const [child, release] of childReleases) if (registry.get(child.id) !== child) { release(); childReleases.delete(child); }
    };
    const findNode = id => typeof graph.getNodeById === 'function' ? graph.getNodeById(id) || graph.getNodeById(Number(id)) : undefined;
    const findLink = id => graph.links instanceof Map ? graph.links.get(id) || graph.links.get(Number(id)) : undefined;
    const captureIdentity = current => {
        const nodeRefs = new Map(Object.keys(current.nodes).map(id => [id, findNode(id)]));
        const linkRefs = new Map(Object.keys(current.links).map(id => [id, findLink(id)]));
        return {
            ...(typeof graph.getNodeById === 'function' ? {nodeCurrent:id => !!nodeRefs.get(id) && findNode(id) === nodeRefs.get(id)} : {}),
            ...(graph.links instanceof Map ? {linkCurrent:id => !!linkRefs.get(id) && findLink(id) === linkRefs.get(id)} : {}),
            childCurrent:id => {
                const child = graph.rootGraph?.subgraphs?.get(id) || graph.subgraphs?.get(id);
                if (!child) return false;
                const context = graphContexts.get(child);
                return context?.() || false;
            },
        };
    };
    graphContexts.set(graph, () => envelope ? {source:envelope, ...identity} : false);
    const validate = (data, depth = 0) => {
        if (depth > 64) throw new Error('历史子图层级超出安全读取范围');
        for (const raw of data?.nodes || []) if (isReadonlyType(raw?.type)) captureReadonlyNode(raw);
        for (const subgraph of data?.definitions?.subgraphs || []) validate(subgraph, depth + 1);
    };
    const configuredGraph = function(data, ...args) {
        if (disposed) return configure.call(this, data, ...args);
        validate(data);
        const next = captureWorkflowEnvelope(data, subgraph);
        loading = next;
        try { const result = configure.call(this, data, ...args); envelope = next; identity = captureIdentity(next); return result; }
        catch (error) { envelope = null; throw error; }
        finally { loading = null; }
    };
    const serializedGraph = function(...args) {
        pruneChildren();
        const result = serialize.apply(this, args), source = loading || envelope;
        return !disposed && source ? mergeWorkflowEnvelope(result, source, loading ? {} : identity) : result;
    };
    const serialisableGraph = function(...args) {
        pruneChildren();
        const result = asSerialisable.apply(this, args), source = loading || envelope;
        return !disposed && source ? mergeWorkflowEnvelope(result, source, loading ? {} : identity) : result;
    };
    const clearedGraph = function(...args) { envelope = null; identity = {}; if (!ownerReleases) { for (const release of childReleases.values()) release(); childReleases.clear(); } const result = clear.apply(this, args); pruneChildren(); return result; };
    const removedEntity = function(...args) { try { return remove.apply(this, args); } finally { pruneChildren(); } };
    const createdSubgraph = function(data, ...args) {
        // Pinned createNormalizedSubgraphs creates every native graph before
        // configuring it in topological order. Bind at that exact boundary so
        // normalized node/link IDs, later duplicates, and new graphs get their
        // own archives rather than inheriting a deleted graph's old payload.
        const child = createSubgraph.call(this, data, ...args);
        pruneChildren();
        childReleases.set(child, installReadonlyWorkflowSerialization(child, {subgraph:true, source:data, ownerReleases:childReleases}));
        return child;
    };
    graph.configure = configuredGraph; graph.serialize = serializedGraph; graph.clear = clearedGraph;
    if (typeof asSerialisable === 'function') graph.asSerialisable = serialisableGraph;
    if (typeof createSubgraph === 'function') graph.createNormalizedSubgraph = createdSubgraph;
    if (typeof remove === 'function') graph.remove = removedEntity;
    const dispose = () => {
        if (disposed) return; disposed = true; envelope = null; loading = null; identity = {};
        if (!ownerReleases) { for (const release of childReleases.values()) release(); childReleases.clear(); }
        else ownerReleases.delete(graph);
        graphContexts.delete(graph);
        if (graph.configure === configuredGraph) graph.configure = configure;
        if (graph.serialize === serializedGraph) graph.serialize = serialize;
        if (graph.clear === clearedGraph) graph.clear = clear;
        if (graph.asSerialisable === serialisableGraph) graph.asSerialisable = asSerialisable;
        if (graph.createNormalizedSubgraph === createdSubgraph) graph.createNormalizedSubgraph = createSubgraph;
        if (graph.remove === removedEntity) graph.remove = remove;
        graphBridges.delete(graph);
    };
    graphBridges.set(graph, dispose); return dispose;
}

export function readonlySnapshot(node) {
    const raw = archives.get(node);
    if (!raw) throw new Error('旧节点原始数据尚未加载，请重新打开原工作流');
    return mergeReadonlySerialized(raw, node.serialize(), configured.get(node));
}

export function nativeConversionPort(node, app, history) {
    const graph = node.graph, workflow = app.extensionManager?.workflow?.activeWorkflow;
    const current = () => !!graph && node.graph === graph && graph === app.graph && graph.getNodeById(node.id) === node &&
        workflow === app.extensionManager?.workflow?.activeWorkflow;
    let created = [];
    const controller = new DocumentController({
        read: () => graph,
        identity: () => ({ workflowSession: 'compat-native', epoch: 0, documentId: String(node.id) }),
        revision: () => 0,
        transact(_label, mutate) {
            if (!current()) throw new Error('转换工作流已失效');
            if (typeof history?.begin !== 'function' || typeof history?.end !== 'function') throw new Error('宿主撤销能力不可用，未转换');
            created = []; history.begin();
            try { mutate(graph); }
            catch (error) { for (const added of created) if (added.graph === graph) graph.remove(added); throw error; }
            finally { history.end(); created = []; }
        },
    });
    return {
        current,
        readSource: () => readonlySnapshot(node),
        transact: (label, mutate) => controller.edit(label, mutate),
        appendTable({table, title, source}) {
            const next = globalThis.LiteGraph?.createNode?.('DAELAB.Table');
            if (!next) throw new Error('当前宿主未安装多维表格节点，未转换');
            const field = next.widgets?.find(widget => widget.name === 'table_data');
            if (!field) { next.onRemoved?.(); throw new Error('多维表格保存合同不可用，未转换'); }
            field.value = JSON.stringify(table);
            next.title = title;
            next.pos = [(Number(source.pos?.[0]) || 0) + (Number(source.size?.[0]) || 460) + 40, Number(source.pos?.[1]) || 0];
            next.properties ||= {};
            next.properties.studioCompatibilitySource = { version: 1, nodeId: source.id, nodeType: source.type };
            created.push(next); graph.add(next);
            graph.change?.(); graph.setDirtyCanvas?.(true, true);
        },
        dispose() { controller.dispose(); },
    };
}

export function createReadonlyPanel(node, app, history) {
    const root = document.createElement('section'); root.className = 'dae-ui';
    root.setAttribute('aria-label', '历史节点只读资料');
    root.style.cssText = 'box-sizing:border-box;max-width:100%;min-width:0;padding:12px;display:flex;flex-direction:column;gap:8px;overflow:auto;max-height:440px;color:var(--dae-text);background:var(--dae-surface-low);font:var(--dae-font-body,14px var(--dae-font-family))';
    const note = document.createElement('p'); note.textContent = READONLY_MESSAGE;
    const warnings = document.createElement('p'); warnings.setAttribute('role', 'status');
    const data = document.createElement('textarea'); data.readOnly = true; data.rows = 10;
    data.setAttribute('aria-label', '原参数与已有结果'); data.style.cssText = 'width:100%;box-sizing:border-box;resize:vertical;min-width:0;white-space:pre-wrap';
    const controls = document.createElement('div'); controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
    root.append(note, warnings, data, controls);
    const releases = [bindCreativeField(data), bindPanelAvailability(node, root)];
    const buttons = []; let disposed = false, dialog = null, activePort = null, modalReleases = [];
    const button = (label, action) => { const item = createCreativeButton(label, action); buttons.push(item); releases.push(bindCreativeButton(item)); return item; };
    const fail = error => { warnings.textContent = error instanceof Error ? error.message : '无法读取历史资料'; };
    function sync() {
        if (disposed) return;
        try {
            const raw = readonlySnapshot(node), projection = projectReadonly(raw);
            const display = { parameters: projection.parameters, savedResults: projection.results,
                ...(projection.storyboard === undefined ? {} : { savedStoryboard: projection.storyboard }) };
            const text = JSON.stringify(display, null, 2);
            data.value = text.length > 100000 ? text.slice(0, 100000) + '\n… 显示已截断，导出原始节点可查看全部数据。' : text;
            warnings.textContent = projection.warnings.join('\n');
        } catch (error) { fail(error); }
    }
    controls.append(button('导出原始节点', () => {
        try {
            const url = URL.createObjectURL(new Blob([JSON.stringify(readonlySnapshot(node), null, 2)], {type:'application/json'}));
            const anchor = document.createElement('a'); anchor.href = url; anchor.download = '历史节点原始数据.json'; anchor.click(); URL.revokeObjectURL(url);
        } catch (error) { fail(error); }
    }));
    function closeDialog() { activePort?.dispose(); activePort = null; for (const release of modalReleases) release(); modalReleases = []; dialog?.remove(); dialog = null; }
    // ComfyNode's constructor calls nodeCreated before LiteGraph assigns type.
    // comfyClass is already authoritative there, as in the attach guard.
    if ((node.type || node.comfyClass) === GPT_TYPE) controls.append(button('预览转换为表格', () => {
        try {
            closeDialog(); const port = nativeConversionPort(node, app, history); activePort = port;
            const preview = previewGPTConversion(port.readSource(), readStoryboard);
            dialog = document.createElement('dialog'); dialog.className = 'dae-ui';
            dialog.style.cssText = 'width:min(680px,calc(100vw - 32px));max-height:80vh;overflow:auto;box-sizing:border-box';
            const title = document.createElement('h3'); title.textContent = '转换预览';
            const summary = document.createElement('p'); summary.textContent = `新增 ${preview.summary.rows} 行、${preview.summary.columns} 列的表格副本。原节点和所有连线保留。`;
            const instructions = document.createElement('p'); instructions.textContent = preview.warnings.join('\n');
            const details = document.createElement('pre'); details.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
            details.textContent = JSON.stringify(preview.table, null, 2);
            const errorLine = document.createElement('p'); errorLine.setAttribute('role', 'status');
            const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
            const modalButton = (label, action) => { const item = createCreativeButton(label, action); modalReleases.push(bindCreativeButton(item)); return item; };
            actions.append(modalButton('取消', closeDialog), modalButton('确认创建表格副本', () => {
                try { if (disposed) throw new Error('面板已关闭'); applyGPTConversion(preview, port); port.dispose(); closeDialog(); warnings.textContent = '已创建表格副本，可使用宿主撤销恢复。原节点保持只读。'; }
                catch (error) { errorLine.textContent = error.message; }
            }));
            dialog.addEventListener('cancel', () => { port.dispose(); closeDialog(); }, {once:true});
            dialog.append(title, summary, instructions, details, errorLine, actions); document.body.append(dialog); dialog.showModal();
        } catch (error) { closeDialog(); fail(error); }
    }));
    for (const event of ['pointerdown', 'dblclick', 'keydown', 'wheel']) root.addEventListener(event, stopCanvasPropagation);
    sync();
    return {root, buttons, fields:[data], sync, close:closeDialog, destroy() { if (disposed) return; disposed = true; closeDialog(); for (const release of releases) release(); root.remove(); }};
}

/** Explicit assembly entry; nothing registers merely because this module was imported. */
export function installCompatReadonly(app, {history = canvasHistory(app)} = {}) {
    if (installed.has(app)) return installed.get(app);
    const types = globalThis.LiteGraph, Base = globalThis.LGraphNode;
    if (!types?.registerNodeType || typeof Base?.prototype?.configure !== 'function' || typeof app?.registerExtension !== 'function' || typeof app.queuePrompt !== 'function') throw new Error('宿主缺少兼容节点注册或队列保护能力');
    let released = false, unregister = null, bridgedGraph = null, releaseGraph = null; const ownedPanels = new Set();
    const bindRootGraph = () => {
        if (released) return;
        const graph = app.rootGraph || app.graph;
        if (graph === bridgedGraph) return;
        releaseGraph?.(); bridgedGraph = graph;
        releaseGraph = installReadonlyWorkflowSerialization(graph);
    };
    const attach = node => {
        if (released || !isReadonlyType(node?.type || node?.comfyClass) || panels.has(node)) return;
        const panel = createReadonlyPanel(node, app, history); panels.set(node, panel); ownedPanels.add(panel);
        const widget = node.addDOMWidget?.('studio_compat_readonly', 'custom', panel.root, {serialize:false, hideOnZoom:false, getValue:() => '', setValue:() => panel.sync()});
        if (widget) { widget.serialize = false; widget.computeSize = () => [0, 340]; }
        const removed = node.onRemoved;
        node.onRemoved = function(...args) { panel.destroy(); ownedPanels.delete(panel); panels.delete(this); return removed?.apply(this, args); };
    };
    app.registerExtension({
        name:'DAELab.Studio.ReadonlyCompatibility',
        beforeConfigureGraph() { bindRootGraph(); },
        registerCustomNodes() {
            for (const type of PROTOTYPE_TYPES) {
                if (types.registered_node_types?.[type]) throw new Error('历史兼容类型已被另一实现注册，请先停用旧包');
                class LegacyPrototype extends Base {
                    constructor() {
                        super('历史 LLM 预览 · 只读'); this.type = type; this.comfyClass = type; this.isVirtualNode = true;
                        this.serialize_widgets = true; this.properties = {llmStylePreview:{version:1,mode:'polish'}};
                        for (const slot of PROTOTYPE_SLOTS.inputs) this.addInput(slot.name,slot.type);
                        for (const slot of PROTOTYPE_SLOTS.outputs) this.addOutput(slot.name,slot.type);
                        this.size = [type.endsWith('A') ? 420 : type.endsWith('E') ? 700 : 460, 690];
                    }
                    onAdded() { attach(this); }
                }
                LegacyPrototype.title = '历史 LLM 预览 · 只读'; LegacyPrototype.category = 'DAELab/Legacy';
                LegacyPrototype.skip_list = true;
                installReadonlySerialization(LegacyPrototype, {configureNative:Base.prototype.configure}); types.registerNodeType(type,LegacyPrototype);
            }
        },
        beforeRegisterNodeDef(NodeType, nodeData) { if (isReadonlyType(nodeData?.name)) { NodeType.skip_list = true; installReadonlySerialization(NodeType, {configureNative:Base.prototype.configure}); } },
        nodeCreated(node) { if (isReadonlyType(node.type || node.comfyClass)) attach(node); },
        loadedGraphNode(node) { panels.get(node)?.sync(); },
    });
    const originalQueue = app.queuePrompt;
    const guardedQueue = async function(...args) {
        if (!released) {
            if (app.isGraphReady === false) throw new Error('图尚未就绪，未提交');
            const graph = app.rootGraph || app.graph;
            if (typeof graph?.serialize !== 'function') throw new Error('宿主缺少图检查能力，未提交');
            assertReadonlyWorkflowExecutionAllowed(graph.serialize());
        }
        return originalQueue.apply(this,args);
    };
    app.queuePrompt = guardedQueue;
    const registerAdapter = () => {
        const api = globalThis[API]; if (released || unregister || api?.version !== 1) return;
        unregister = api.registerAdapter('daelab.studio.readonly-compat', {
            matches:node => isReadonlyType(node.type), menu:[], width:460, expanded:true, compactWidth:0,
            panel:node => panels.get(node), refresh:node => panels.get(node)?.sync(),
            summary:() => '历史资料 · 只读 · 执行已禁用', canConnectOutput:() => false,
        });
    };
    globalThis.addEventListener('daelab:creative-canvas-ready', registerAdapter); registerAdapter();
    const dispose = () => { if (released) return; released = true; releaseGraph?.(); releaseGraph = null; bridgedGraph = null; for (const panel of ownedPanels) panel.destroy(); ownedPanels.clear(); globalThis.removeEventListener('daelab:creative-canvas-ready',registerAdapter); unregister?.(); if (app.queuePrompt === guardedQueue) app.queuePrompt = originalQueue; installed.delete(app); };
    installed.set(app,dispose); return dispose;
}
