import { planColumnBinding, clearBoundColumn, columnStamp, groupStamp } from '../../../features/table/index.js';
// @ts-expect-error Existing prompt expansion remains the sole text reference rule.
import { expandedCellText } from '../../../features/prompt/table_prompt_template.mjs';
// @ts-expect-error Existing ESM bridge owns the native tracker transaction.
import { canvasHistory } from '../canvas/creative_history.mjs';
// @ts-expect-error Public read-only material exchange has no TypeScript declaration.
import { inputSnapshot } from '../../../canvas/creative_input_exchange.mjs';
const installed = new WeakSet(), running = new WeakSet();
const tableFor = (node) => node.__scriptTable || node.__dataTable;
const panelFor = (node) => node.__scriptPanel || node.__dataTablePanel;
const states = (node) => (node.properties.daelabColumnBindings || {});
const memberIds = (group) => Array.isArray(group.properties.members) ? group.properties.members : [];
const assetUrl = (asset) => '/view?' + new URLSearchParams({ filename: String(asset.filename), subfolder: String(asset.subfolder || ''), type: String(asset.type || 'input') });
function groupItems(group) {
    return memberIds(group).map(id => {
        const member = group.graph?.getNodeById(id);
        if (!member || member.mode)
            throw new Error('绑定组中有缺失或停用素材');
        const identity = String(member.properties.daelabColumnReferenceId || 'member:' + String(member.id));
        if (member.type === 'DAELAB.TextInput') {
            const snapshot = member.inputs.some(i => i.link != null) ? inputSnapshot(member) : null;
            if (snapshot?.ready === false)
                throw new Error('组内文本尚未就绪');
            return { identity, memberId: String(id), value: snapshot?.texts?.join('\n\n') ?? member.widgets?.find(w => w.name === 'text')?.value ?? '' };
        }
        const raw = member.widgets?.find(w => w.name === 'asset_data')?.value, asset = JSON.parse(raw || 'null');
        if (member.type !== 'DAELAB.MediaUpload' || !asset?.filename || !['image', 'video'].includes(String(asset.kind)))
            throw new Error('绑定组有不可用素材');
        return { identity, memberId: String(id), value: { ...asset, url: assetUrl(asset), name: asset.name || asset.filename } };
    });
}
function saveTable(node, table) {
    const panel = panelFor(node);
    if (!panel)
        throw new Error('绑定表格尚未就绪');
    if (JSON.stringify(table) !== JSON.stringify(tableFor(node)))
        panel.editor.change(draft => Object.assign(draft, table), { derived: true });
}
function materialize(group, items, app) {
    const graph = group.graph;
    const members = items.map((item, index) => {
        let member = graph.getNodeById(item.memberId), created = false;
        if (typeof item.value === 'string' && member?.inputs.some(i => i.link != null) && groupItems(group).find(i => i.memberId === item.memberId)?.value !== item.value)
            member = undefined;
        if (!member) {
            member = LiteGraph.createNode(typeof item.value === 'string' ? 'DAELAB.TextInput' : 'DAELAB.MediaUpload') || undefined;
            if (!member)
                throw new Error('素材节点未加载');
            graph.add(member);
            created = true;
            member.properties.daelabColumnReferenceId = item.identity;
            member.pos = [(group.pos?.[0] || 0) + 40 + index * 24, (group.pos?.[1] || 0) + 100];
        }
        const text = typeof item.value === 'string', widget = member.widgets?.find(w => w.name === (text ? 'text' : 'asset_data'));
        if (!widget)
            throw new Error('素材节点缺少保存字段');
        if (text) {
            widget.value = item.value;
            delete member.properties.studioTextAsset;
            member.__daeTextPanel?.invalidateSnapshot();
            member.__daeTextPanel?.sync();
        }
        else {
            const cell = item.value, url = new URL(String(cell.url), 'http://localhost');
            if (url.origin !== 'http://localhost' || url.pathname !== '/view' || !url.searchParams.get('filename'))
                throw new Error('绑定只接收已有本地素材引用');
            const asset = { ...cell, filename: url.searchParams.get('filename'), subfolder: url.searchParams.get('subfolder') || '', type: url.searchParams.get('type') || 'input', id: cell.assetId || cell.id || item.identity };
            delete asset.bindingIdentity;
            delete asset.sourceNodeId;
            widget.value = JSON.stringify(asset);
            member.title = String(cell.name || url.searchParams.get('filename'));
            member.__mediaUpload?.render();
        }
        if (created) {
            const canvas = app.rootGraph;
            const state = canvas.extra?.daelabCreativeCanvasV1;
            if (state?.cards)
                state.cards[String(member.id)] = { x: member.pos?.[0] || 0, y: member.pos?.[1] || 0, width: 280, expanded: false };
        }
        item.memberId = String(member.id);
        return member.id;
    });
    group.properties.members = members;
}
function flushBindings(app, graph) {
    if (running.has(graph) || app.configuringGraph || app.graph !== graph)
        return;
    running.add(graph);
    try {
        // A reverse edit may update another bound column visited earlier in this pass.
        for (let pass = 0; pass < 3; pass++) {
            let changed = false;
            for (const node of graph._nodes) {
                const table = tableFor(node);
                if (!table || !panelFor(node) || node.mode)
                    continue;
                const saved = states(node), fields = new Set([...Object.keys(saved), ...node.inputs.filter(i => i.daeColumnField).map(i => i.daeColumnField)]);
                for (const fieldId of fields) {
                    const input = node.inputs.find(i => i.daeColumnField === fieldId), link = input?.link == null ? null : graph.links instanceof Map ? graph.links.get(input.link) : graph.links[String(input.link)], group = link && graph.getNodeById(link.origin_id);
                    if (!group || group.type !== 'DAELAB.MaterialGroup') {
                        if (saved[fieldId]) {
                            saveTable(node, clearBoundColumn(tableFor(node), fieldId));
                            delete saved[fieldId];
                            changed = true;
                        }
                        continue;
                    }
                    if (!tableFor(node).fields.some(field => field.id === fieldId)) {
                        if (input) {
                            node.disconnectInput?.(node.inputs.indexOf(input));
                            delete input.daeColumnField;
                        }
                        delete saved[fieldId];
                        changed = true;
                        continue;
                    }
                    const items = groupItems(group), plan = planColumnBinding(tableFor(node), fieldId, String(group.id), items, saved[fieldId], { uid: () => crypto.randomUUID(), text: expandedCellText });
                    if (!plan)
                        continue;
                    if (plan.reverse)
                        materialize(group, plan.items, app);
                    for (const mapping of plan.mapping) {
                        mapping.memberId = plan.items.find(item => item.identity === mapping.identity)?.memberId || mapping.memberId;
                        const row = plan.table.records.find(row => row.id === mapping.recordId);
                        if (mapping.assetId && row) {
                            const values = row.values[fieldId];
                            if (Array.isArray(values))
                                for (const value of values)
                                    if (value && typeof value === 'object' && !Array.isArray(value) && value.id === mapping.assetId)
                                        value.sourceNodeId = mapping.memberId;
                        }
                    }
                    saveTable(node, plan.table);
                    saved[fieldId] = { groupId: String(group.id), mapping: plan.mapping, groupStamp: groupStamp(groupItems(group)), columnStamp: columnStamp(tableFor(node), fieldId) };
                    node.properties.daelabColumnBindings = saved;
                    changed = true;
                }
            }
            if (!changed)
                break;
        }
    }
    finally {
        running.delete(graph);
    }
}
export function installColumnBindings(app) {
    if (installed.has(app))
        return;
    installed.add(app);
    let lastProblem = '', polling = false;
    const flush = (graph) => { try {
        flushBindings(app, graph);
        lastProblem = '';
    }
    catch (error) {
        const detail = String(error);
        if (detail !== lastProblem)
            app.extensionManager?.toast?.add({ severity: 'error', summary: '素材组列绑定', detail });
        lastProblem = detail;
        throw error;
    } };
    // Native canvas actions do not use our transaction wrapper; amend their state.
    const start = () => {
        if (polling)
            return;
        polling = true;
        const timer = setInterval(() => {
            const tracker = app.extensionManager?.workflow?.activeWorkflow?.changeTracker;
            if (app.isGraphReady === false || app.configuringGraph || tracker?._restoringState || tracker?.changeCount || !app.graph?._nodes.some(n => Object.keys(n.properties?.daelabColumnBindings || {}).length || n.inputs?.some(i => i.daeColumnField && i.link != null)))
                return;
            // Read-only comparison keeps ordinary ticks outside the host history machinery.
            const dirty = app.graph._nodes.some(node => node.inputs?.some(input => input.daeColumnField && input.link != null && !states(node)[input.daeColumnField]) || Object.entries((node.properties.daelabColumnBindings || {})).some(([field, binding]) => {
                const table = tableFor(node), input = node.inputs.find(i => i.daeColumnField === field), link = input?.link == null ? null : app.graph.links instanceof Map ? app.graph.links.get(input.link) : app.graph.links[String(input.link)], group = link && app.graph.getNodeById(link.origin_id);
                try {
                    return !!table && (!group || String(group.id) !== binding.groupId || columnStamp(table, field) !== binding.columnStamp || groupStamp(groupItems(group)) !== binding.groupStamp);
                }
                catch {
                    return false;
                }
            }));
            if (dirty)
                try {
                    canvasHistory(app).amend(() => flush(app.graph));
                }
                catch { /* flush reports the owned error once. */ }
        }, 250);
        timer.unref?.();
    };
    app.daelabColumnBindings = { flush, start };
    app.registerExtension?.({ name: 'DAELab.ColumnBindings', setup: start, afterConfigureGraph: start });
}
export { boundColumnTargets } from './table_column_targets.js';
export function bindColumnGroup(app, node, fieldId, group) {
    if (group.type !== 'DAELAB.MaterialGroup')
        return false;
    installColumnBindings(app);
    app.daelabColumnBindings?.start?.();
    const table = tableFor(node);
    if (!table?.fields.some(f => f.id === fieldId && !f.readonly))
        throw new Error('绑定列不可编辑');
    const items = groupItems(group);
    planColumnBinding(table, fieldId, String(group.id), items, undefined, { uid: () => crypto.randomUUID(), text: expandedCellText });
    let index = node.inputs.findIndex(input => input.daeColumnField === fieldId);
    if (index < 0) {
        index = node.inputs.findIndex(input => input.name.startsWith('columns.') && input.link == null && !input.daeColumnField);
        if (index < 0) {
            const suffix = node.inputs.filter(input => input.name.startsWith('columns.')).length;
            node.addInput('columns.column' + suffix, 'DAELAB_ASSETS');
            index = node.inputs.length - 1;
        }
        node.inputs[index].daeColumnField = fieldId;
    }
    const output = group.outputs?.findIndex(output => output.type === 'DAELAB_ASSETS') ?? -1;
    if (output < 0)
        throw new Error('素材组输出不可用');
    if (node.inputs[index].link != null && !window.confirm('此列已有素材组，替换绑定？'))
        return true;
    if (!group.connect(output, node, index))
        throw new Error('列绑定连线未建立');
    flushBindings(app, node.graph);
    return true;
}
