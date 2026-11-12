import { generationErrorText } from '../../../features/generation/control_labels.js';
import { generationOutputConnected } from '../canvas/generation_output_binding.js';
const UPLOAD = 'DAELAB.MediaUpload', GROUP = 'DAELAB.MaterialGroup';
const KEY = 'daelabCreativeCanvasV1';
const names = { waiting: '排队中', running: '生成中', pausing: '中止中', interrupting: '中止中', interrupted: '已中止', paused: '原任务已停止', failed: '生成失败', needs_input: '待补充', needs_recovery: '执行状态待核实', stopped: '已停止', complete: '已完成', stale: '输入已变化' };
const ranks = { running: 0, pausing: 0, interrupting: 0, interrupted: 3, waiting: 1, needs_recovery: 2, failed: 2, needs_input: 2, paused: 3, stopped: 3, stale: 3, complete: 4 };
/** Once assigned, an output follows one request. Polling never creates nodes. */
export function createGenerationOutputs(node, app, history, createNode, ready) {
    const graph = node.graph;
    let disposed = false;
    const current = () => !disposed && ready() && graph === app.graph && node.graph === graph && graph.getNodeById(node.id) === node;
    const outputs = () => (graph._nodes || []).filter((item) => item.type === UPLOAD && item.properties?.generationOutput?.nodeId === String(node.id));
    const connected = (target) => generationOutputConnected(target, String(node.id));
    const widget = (item) => item.widgets?.find((w) => w.name === 'asset_data');
    const state = () => { graph.extra ||= {}; return graph.extra[KEY] ||= { version: 1, active: false, viewport: { x: 60, y: 60, zoom: .8 }, cards: {} }; };
    const refresh = () => { graph.setDirtyCanvas?.(true, true); app.daelabCreativeCanvas?.sync?.(); app.daelabMaterialGroups?.tick?.(); };
    function linkOutput(target) {
        const input = target.inputs?.findIndex((slot) => slot.name === 'source_report') ?? -1;
        const output = node.outputs?.findIndex((slot) => slot.name === 'task_report') ?? -1;
        if (input < 0 || output < 0 || !node.connect(output, target, input))
            throw new Error('无法连接生成输出');
    }
    function bindGroup(group) {
        group.title = '生成结果';
        group.properties = { ...group.properties, members: [], layout: 'grid', collapsed: false, generationOutputOwner: String(node.id) };
        linkOutput(group);
    }
    function availableGroup(group) {
        return group?.type === GROUP && group.properties?.generationOutputOwner === String(node.id) && !group.properties.locked && connected(group);
    }
    function destinationGroup(batch) {
        const id = node.properties.generationOutputGroupId;
        if (id != null) {
            const chosen = graph.getNodeById(id);
            if (availableGroup(chosen))
                return chosen;
        }
        if (!batch)
            return null;
        const links = node.outputs.find((slot) => slot.name === 'task_report')?.links || [];
        let latest = null;
        for (let i = links.length - 1; i >= 0; i--) {
            const link = graph.links?.get?.(links[i]) ?? graph.links?.[links[i]];
            const group = link && graph.getNodeById(link.target_id);
            if (!availableGroup(group))
                continue;
            // Older workflows do not store the chosen ID. An empty connected group
            // is a waiting destination, even if a later submission created another.
            if (!group.properties.members.length)
                return group;
            latest ??= group;
        }
        return latest;
    }
    function assign(target, job, options) {
        const order = options.rows.findIndex(row => row.id === job.input.recordId), label = options.rows[order]?.name || `任务 ${order + 1}`;
        target.title = label + ' · 输出';
        target.properties.generationOutput = { nodeId: String(node.id), requestId: job.requestId, source: structuredClone(job.source), order, kind: job.input.config.kind };
        target.properties.materialPlaceholder = { phase: 'waiting', label: '排队中', detail: '正在提交任务', busy: true };
    }
    function sortGroups() {
        for (const group of graph._nodes || []) {
            if (group.type !== GROUP || group.properties?.generationOutputOwner !== String(node.id) || group.properties.locked)
                continue;
            group.properties.members.sort((a, b) => {
                const left = graph.getNodeById(a), right = graph.getNodeById(b);
                const rank = (item) => ranks[item?.properties?.materialPlaceholder?.phase || 'complete'] ?? 2;
                return rank(left) - rank(right) || (left?.properties?.generationOutput?.order ?? 0) - (right?.properties?.generationOutput?.order ?? 0);
            });
        }
    }
    return {
        activeOutput() {
            if (!current())
                return null;
            return outputs().find((item) => item.properties.generationOutput.groupId == null && item.properties.materialPlaceholder?.busy && item.properties.generationOutput.requestId && connected(item)) ?? null;
        },
        bindWaiting(target) {
            if (!current() || target.graph !== graph)
                throw new Error('输出目标的工作流已变化');
            if (target.type === GROUP) {
                bindGroup(target);
                node.properties.generationOutputGroupId = target.id;
                return;
            }
            if (!widget(target))
                throw new Error('输出素材接口尚未就绪');
            target.title = '生成结果';
            target.properties.generationOutput = { nodeId: String(node.id) };
            target.properties.materialPlaceholder = { phase: 'idle', label: '等待上游生成结果', busy: false };
            linkOutput(target);
            target.__mediaUpload?.reload?.();
        },
        owns(requestId) { return !!requestId && outputs().some((item) => { if (item.properties.generationOutput.requestId !== requestId)
            return false; if (connected(item))
            return true; try {
            return !!JSON.parse(widget(item)?.value || '{}').filename;
        }
        catch {
            return false;
        } }); },
        prepare(jobs, options) {
            if (!current())
                throw new Error('输出目标的工作流已变化，未提交');
            const fresh = jobs.filter(job => !outputs().some((item) => item.properties.generationOutput.requestId === job.requestId));
            if (!fresh.length)
                return;
            const destination = destinationGroup(options.batch);
            const waiting = destination ? [] : outputs().filter((item) => !item.properties.generationOutput.requestId && connected(item) && ['', '{}'].includes(widget(item)?.value)).slice(0, fresh.length);
            const remaining = fresh.slice(waiting.length);
            const previous = waiting.map((target) => ({ target, title: target.title, binding: target.properties.generationOutput, status: target.properties.materialPlaceholder }));
            const created = [], canvas = state();
            let existingGroup = null, previousMembers = [];
            canvas.cards ||= {};
            const source = canvas.cards[node.id] || { x: node.pos[0], y: node.pos[1], width: 900 };
            // Place beside all existing output runs, leaving prior assets untouched.
            const right = Math.max(source.x + source.width, ...outputs().map((item) => { const c = canvas.cards[item.id]; return c ? c.x + c.width : source.x + source.width; }));
            const origin = { x: right + 100, y: source.y };
            history.amend(() => {
                try {
                    waiting.forEach((target, index) => {
                        assign(target, fresh[index], options);
                        target.__mediaUpload?.reload?.();
                    });
                    let group = destination;
                    if (group) {
                        existingGroup = group;
                        previousMembers = [...group.properties.members];
                    }
                    if (options.batch && remaining.length && !group) {
                        group = createNode(GROUP);
                        if (!group)
                            throw new Error('素材组节点尚未加载');
                        graph.add(group);
                        created.push(group);
                        group.pos = [origin.x, origin.y];
                        canvas.cards[group.id] = { ...origin, width: 730, expanded: true };
                        bindGroup(group);
                    }
                    for (const [index, job] of remaining.entries()) {
                        const target = createNode(UPLOAD);
                        if (!target)
                            throw new Error('输出素材节点尚未加载');
                        graph.add(target);
                        created.push(target);
                        if (!widget(target))
                            throw new Error('输出素材接口尚未就绪');
                        assign(target, job, options);
                        if (group)
                            target.properties.generationOutput.groupId = group.id;
                        target.pos = [origin.x + (index % 2) * 356, origin.y + Math.floor(index / 2) * 260];
                        canvas.cards[target.id] = { x: target.pos[0], y: target.pos[1], width: 350, expanded: true };
                        if (!group)
                            linkOutput(target);
                        group?.properties.members.push(target.id);
                        target.__mediaUpload?.reload?.();
                    }
                    sortGroups();
                    refresh();
                    if (existingGroup && previousMembers.length === 0)
                        node.properties.generationOutputGroupId = existingGroup.id;
                }
                catch (error) {
                    for (const item of created.reverse()) {
                        graph.remove(item);
                        delete canvas.cards[item.id];
                    }
                    if (existingGroup)
                        existingGroup.properties.members = previousMembers;
                    for (const { target, title, binding, status } of previous) {
                        target.title = title;
                        target.properties.generationOutput = binding;
                        target.properties.materialPlaceholder = status;
                        target.__mediaUpload?.reload?.();
                    }
                    throw error;
                }
            });
        },
        update(reports) {
            if (!current())
                return;
            const changes = [];
            for (const report of reports)
                for (const target of outputs()) {
                    const binding = target.properties.generationOutput;
                    if (binding.requestId !== report.requestId || Object.keys({ ...binding.source, ...report.source }).some(key => binding.source[key] !== report.source[key]))
                        continue;
                    // A disconnected, replaced or manually filled target is no longer owned by this run.
                    if (!connected(target))
                        continue;
                    const status = { phase: report.phase, label: (names[report.phase] || '待恢复') + (report.phase === 'running' && typeof report.progress === 'number' ? ` · ${Math.round(Math.max(0, Math.min(100, report.progress)))}%` : ''), detail: generationErrorText(report.error || report.detail), busy: ['waiting', 'running', 'pausing', 'interrupting'].includes(report.phase), ...(typeof report.progress === 'number' ? { progress: Math.max(0, Math.min(100, report.progress)) } : {}) };
                    let asset = null;
                    const result = report.result, receipt = report.receipt;
                    if (report.phase === 'complete' && report.state === 'succeeded' && result?.url?.startsWith('/view?') && ['image', 'video'].includes(result.kind) && receipt?.kind === 'assets' && receipt.items?.some((item) => item.asset_id === result.asset_id && item.reference_id === result.reference_id && item.asset_id && item.reference_id)) {
                        const url = new URL(result.url, 'http://localhost');
                        if (url.searchParams.get('type') === 'output' && url.searchParams.get('filename'))
                            asset = { version: 1, id: result.reference_id, kind: result.kind, name: result.name || url.searchParams.get('filename'), filename: url.searchParams.get('filename'), subfolder: url.searchParams.get('subfolder') || '', type: 'output', assetId: result.asset_id, referenceId: result.reference_id, provenance: { requestId: report.requestId } };
                    }
                    if (report.phase === 'complete' && !asset) {
                        status.phase = 'needs_recovery';
                        status.label = '结果待核验';
                        status.detail = '尚无可用的已核验素材';
                    }
                    const saved = widget(target)?.value;
                    if (saved && saved !== '{}') {
                        try {
                            if (JSON.parse(saved).provenance?.requestId !== report.requestId)
                                continue;
                        }
                        catch {
                            continue;
                        }
                    }
                    if (JSON.stringify(target.properties.materialPlaceholder) !== JSON.stringify(status) || asset && saved !== JSON.stringify(asset))
                        changes.push({ target, status, asset });
                }
            if (!changes.length)
                return;
            history.amend(() => {
                for (const { target, status, asset } of changes) {
                    target.properties.materialPlaceholder = status;
                    if (asset)
                        widget(target).value = JSON.stringify(asset);
                    target.__mediaUpload?.render?.();
                }
                sortGroups();
                refresh();
            });
        },
        dispose() { disposed = true; }
    };
}
