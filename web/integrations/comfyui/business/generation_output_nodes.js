const UPLOAD = 'DAELAB.MediaUpload', GROUP = 'DAELAB.MaterialGroup';
const KEY = 'daelabCreativeCanvasV1';
const names = { waiting: '排队中', running: '生成中', pausing: '暂停中', paused: '已暂停', failed: '生成失败', needs_input: '待补充', needs_recovery: '待恢复', stopped: '已停止', complete: '已完成', stale: '输入已变化' };
const ranks = { running: 0, pausing: 0, waiting: 1, needs_recovery: 2, failed: 2, needs_input: 2, paused: 3, stopped: 3, stale: 3, complete: 4 };
/** Immutable request-bound output targets. Only prepare creates nodes; polling never does. */
export function createGenerationOutputs(node, app, history, createNode, ready) {
    const graph = node.graph;
    let disposed = false;
    const current = () => !disposed && ready() && graph === app.graph && node.graph === graph && graph.getNodeById(node.id) === node;
    const outputs = () => (graph._nodes || []).filter((item) => item.type === UPLOAD && item.properties?.generationOutput?.nodeId === String(node.id));
    const connected = (target) => { const input = target.inputs?.find((slot) => slot.name === 'source_report'), link = graph.links?.get?.(input?.link) ?? graph.links?.[input?.link]; return !!link && String(link.origin_id) === String(node.id) && link.origin_slot === node.outputs?.findIndex((slot) => slot.name === 'task_report'); };
    const widget = (item) => item.widgets?.find((w) => w.name === 'asset_data');
    const state = () => { graph.extra ||= {}; return graph.extra[KEY] ||= { version: 1, active: false, viewport: { x: 60, y: 60, zoom: .8 }, cards: {} }; };
    const refresh = () => { graph.setDirtyCanvas?.(true, true); app.daelabCreativeCanvas?.sync?.(); app.daelabMaterialGroups?.tick?.(); };
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
            const created = [], canvas = state();
            let existingGroup = null, previousMembers = [];
            canvas.cards ||= {};
            const source = canvas.cards[node.id] || { x: node.pos[0], y: node.pos[1], width: 900 };
            // Place beside all existing output runs, leaving prior assets untouched.
            const right = Math.max(source.x + source.width, ...outputs().map((item) => { const c = canvas.cards[item.id]; return c ? c.x + c.width : source.x + source.width; }));
            const origin = { x: right + 100, y: source.y };
            history.amend(() => {
                try {
                    let group = options.batch ? (graph._nodes || []).find((item) => item.type === GROUP && item.properties?.generationOutputOwner === String(node.id) && !item.properties.locked) : null;
                    if (group) {
                        existingGroup = group;
                        previousMembers = [...group.properties.members];
                    }
                    if (options.batch && !group) {
                        group = createNode(GROUP);
                        if (!group)
                            throw new Error('素材组节点尚未加载');
                        graph.add(group);
                        created.push(group);
                        group.title = '生成输出';
                        group.pos = [origin.x, origin.y];
                        group.properties = { ...group.properties, members: [], layout: 'grid', collapsed: false, generationOutputOwner: String(node.id) };
                        canvas.cards[group.id] = { ...origin, width: 730, expanded: true };
                    }
                    for (const [index, job] of fresh.entries()) {
                        const target = createNode(UPLOAD);
                        if (!target)
                            throw new Error('输出素材节点尚未加载');
                        graph.add(target);
                        created.push(target);
                        const input = target.inputs?.findIndex((slot) => slot.name === 'source_report');
                        const output = node.outputs?.findIndex((slot) => slot.name === 'task_report');
                        if (input < 0 || output < 0 || !widget(target))
                            throw new Error('输出素材接口尚未就绪');
                        const order = options.rows.findIndex(row => row.id === job.input.recordId), label = options.rows[order]?.name || `任务 ${order + 1}`;
                        target.title = label + ' · 输出';
                        target.properties.generationOutput = { nodeId: String(node.id), requestId: job.requestId, source: structuredClone(job.source), order, kind: job.input.config.kind };
                        target.properties.materialPlaceholder = { phase: 'waiting', label: '排队中', detail: '正在提交任务', busy: true };
                        target.pos = [origin.x + (index % 2) * 356, origin.y + Math.floor(index / 2) * 260];
                        canvas.cards[target.id] = { x: target.pos[0], y: target.pos[1], width: 350, expanded: true };
                        if (!node.connect(output, target, input))
                            throw new Error('无法连接生成输出');
                        group?.properties.members.push(target.id);
                        target.__mediaUpload?.reload?.();
                    }
                    sortGroups();
                    refresh();
                }
                catch (error) {
                    for (const item of created.reverse()) {
                        graph.remove(item);
                        delete canvas.cards[item.id];
                    }
                    if (existingGroup)
                        existingGroup.properties.members = previousMembers;
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
                    const status = { phase: report.phase, label: (names[report.phase] || '待恢复') + (report.phase === 'running' && typeof report.progress === 'number' ? ` · ${Math.round(Math.max(0, Math.min(100, report.progress)))}%` : ''), detail: String(report.error || report.detail || ''), busy: ['waiting', 'running', 'pausing'].includes(report.phase), ...(typeof report.progress === 'number' ? { progress: Math.max(0, Math.min(100, report.progress)) } : {}) };
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
