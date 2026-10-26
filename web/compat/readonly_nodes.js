export const GPT_TYPE = 'DAELAB.ComfyTV.GPTImageStoryboardStage';
export const BATCH_TYPE = 'DAELAB.LibTV.StoryboardBatch';
export const PROTOTYPE_TYPES = ['DAELAB.LLMStylePreviewA', 'DAELAB.LLMStylePreviewC', 'DAELAB.LLMStylePreviewD', 'DAELAB.LLMStylePreviewE'];
export const READONLY_TYPES = [GPT_TYPE, BATCH_TYPE, ...PROTOTYPE_TYPES];
export const GPT_WIDGETS = ['force_run_token', 'project_id', 'parent_output_id', 'workflow', 'size', 'custom_width', 'custom_height', 'background', 'quality', 'seed', 'control_after_generate', 'main_prompt', 'storyboard_data', 'selected_index', 'custom_params'];
export const BATCH_WIDGETS = ['project_uuid', 'request_id', 'model', 'mode', 'duration', 'resolution', 'ratio', 'sound'];
export const PROTOTYPE_SLOTS = Object.freeze({ inputs: [{ name: '原文', type: 'STRING' }, { name: '参考图片', type: 'IMAGE' }], outputs: [{ name: '结果', type: 'STRING' }] });
export const READONLY_MESSAGE = '历史节点只读：原参数、结果和连线保留，不会执行或恢复旧任务。';
const clone = (value) => JSON.parse(JSON.stringify(value));
const GPT_INPUTS = ['force_run_token:INT', 'project_id:STRING', 'parent_output_id:INT', 'workflow:COMBO', 'size:COMBO', 'custom_width:INT', 'custom_height:INT', 'background:COMBO', 'quality:COMBO', 'seed:INT', 'main_prompt:STRING', 'storyboard_data:STRING', 'selected_index:INT', 'custom_params:STRING', 'imported_storyboard:STRING'];
const BATCH_INPUTS = ['storyboard_json:STRING', 'project_uuid:STRING', 'request_id:STRING', 'model:COMBO', 'mode:COMBO', 'duration:INT', 'resolution:COMBO', 'ratio:COMBO', 'sound:BOOLEAN'];
const safeSlotType = (value) => typeof value === 'string' && /^[A-Z0-9_*,]{1,64}$/.test(value) ? value : '<unknown>';
function slotMismatch(type, side, index, expected, actual) {
    // Known node type, index and bounded datatype tokens only; never widget values.
    throw new Error(`历史槽位顺序发生变化，已阻止可能丢失连线的保存 (${type} ${side}[${index}]: ${safeSlotType(expected)} → ${safeSlotType(actual)})`);
}
/** The two pinned GPT layouts differ only by the appended optional socket. */
function assertHistoricalSlots(raw) {
    const inputs = raw.type === GPT_TYPE ? GPT_INPUTS : raw.type === BATCH_TYPE ? BATCH_INPUTS : PROTOTYPE_SLOTS.inputs.map(slot => `${slot.name}:${slot.type}`);
    const outputs = raw.type === GPT_TYPE ? ['images:COMFYTV_IMAGES', 'image:COMFYTV_IMAGE'] : raw.type === BATCH_TYPE ? ['batch_report:STRING', 'video_paths:STRING'] : ['结果:STRING'];
    for (const [side, expected] of [['inputs', inputs], ['outputs', outputs]]) {
        const actual = raw[side];
        if (actual === undefined)
            continue;
        const oldGPT = raw.type === GPT_TYPE && side === 'inputs' && actual.length === 14;
        if (actual.length !== expected.length && !oldGPT)
            slotMismatch(raw.type, side, actual.length, 'COUNT', 'COUNT');
        actual.forEach((slot, index) => {
            const [name, type] = expected[index].split(':');
            if (slot?.name !== name || slot?.type !== type)
                slotMismatch(raw.type, side, index, type, slot?.type);
        });
    }
}
export function isReadonlyType(type) { return typeof type === 'string' && READONLY_TYPES.includes(type); }
export function captureReadonlyNode(raw) {
    if (!raw || !isReadonlyType(raw.type) || raw.id == null)
        throw new Error('无法识别历史节点，原件保持不变');
    if (raw.inputs !== undefined && !Array.isArray(raw.inputs) || raw.outputs !== undefined && !Array.isArray(raw.outputs))
        throw new Error('历史槽位格式未知，原件保持不变');
    assertHistoricalSlots(raw);
    return clone(raw);
}
// Pinned LGraph schema fields are owned by the host. Extension payloads never
// replace these fields, including on old 0.4 -> current schema projection.
const WORKFLOW_FIELDS = new Set(['id', 'revision', 'config', 'subgraphs', 'definitions', 'version', 'state', 'last_node_id', 'last_link_id', 'groups', 'nodes', 'links', 'floatingLinks', 'reroutes', 'extra', 'name', 'category', 'description', 'inputNode', 'outputNode', 'inputs', 'outputs', 'widgets', 'extensions']);
const NODE_FIELDS = new Set(['title', 'id', 'type', 'pos', 'size', 'flags', 'order', 'mode', 'outputs', 'inputs', 'properties', 'shape', 'boxcolor', 'color', 'bgcolor', 'showAdvanced', 'widgets_values', 'widgets_values_named', 'extensions']);
const SLOT_FIELDS = new Set(['color_off', 'color_on', 'dir', 'label', 'localized_name', 'locked', 'name', 'nameLocked', 'removable', 'shape', 'type', 'widget', 'pos', 'link', 'links', 'slot_index', 'extensions']);
const LINK_FIELDS = new Set(['id', 'origin_id', 'origin_slot', 'target_id', 'target_slot', 'type', 'parentId', 'extensions']);
function capturePayload(raw, owned) {
    if (Object.hasOwn(raw || {}, 'extensions') && (!raw.extensions || typeof raw.extensions !== 'object' || Array.isArray(raw.extensions)))
        throw new Error('历史扩展字段格式未知，原件保持不变');
    const legacy = Object.fromEntries(Object.entries(raw || {}).filter(([key]) => !owned.has(key)));
    const extensions = raw?.extensions && typeof raw.extensions === 'object' && !Array.isArray(raw.extensions) ? raw.extensions : {};
    const collisions = Object.fromEntries(Object.keys(legacy).filter(key => Object.hasOwn(extensions, key)).map(key => [key, extensions[key]]));
    return clone({ legacy, collisions, extensions, hadExtensions: Object.hasOwn(raw || {}, 'extensions') });
}
function mergePayload(native, envelope, restoreMissing = false) {
    // Only overlay owned envelope positions; do not clone the entire native graph
    // again on every history snapshot (large tables remain host-owned payloads).
    const result = { ...native };
    const extensions = { ...(restoreMissing ? envelope.extensions : {}), ...result.extensions };
    for (const [key, value] of Object.entries(envelope.legacy)) {
        Object.defineProperty(result, key, { value: clone(value), enumerable: true, configurable: true, writable: true });
        // The host lifts old top-level fields into extensions and overwrites a
        // same-name namespaced field. Restore both original locations exactly.
        if (Object.hasOwn(envelope.collisions, key))
            Object.defineProperty(extensions, key, { value: clone(envelope.collisions[key]), enumerable: true, configurable: true, writable: true });
        else
            delete extensions[key];
    }
    if (Object.keys(extensions).length || envelope.hadExtensions)
        result.extensions = extensions;
    else
        delete result.extensions;
    return result;
}
function linkTopology(link) {
    return Array.isArray(link) ? link.slice(0, 6) : [link.id, link.origin_id, link.origin_slot, link.target_id, link.target_slot, link.type];
}
function entityId(value) {
    if (!(typeof value === 'string' && value.length || typeof value === 'number' && Number.isFinite(value)))
        throw new Error('历史图实体缺少稳定身份，原件保持不变');
    return String(value);
}
function captureSlot(slot) {
    return { name: slot.name, type: slot.type, payload: capturePayload(slot, SLOT_FIELDS), ...(slot.widget ? { widget: capturePayload(slot.widget, new Set(['name', 'extensions'])) } : {}) };
}
export function captureWorkflowEnvelope(raw, subgraph = false, graphIds = new Set(), depth = 0) {
    if (depth > 64)
        throw new Error('历史子图层级超出安全读取范围');
    const nodes = Object.create(null), links = Object.create(null), children = Object.create(null);
    for (const node of raw?.nodes || []) {
        const id = entityId(node.id);
        if (Object.hasOwn(nodes, id))
            throw new Error('历史图节点身份重复，原件保持不变');
        nodes[id] = { type: node.type, payload: capturePayload(node, NODE_FIELDS), inputs: (node.inputs || []).map(captureSlot), outputs: (node.outputs || []).map(captureSlot) };
    }
    for (const link of raw?.links || []) {
        const topology = linkTopology(link), id = entityId(topology[0]);
        if (Object.hasOwn(links, id))
            throw new Error('历史图连线身份重复，原件保持不变');
        links[id] = { topology: clone(topology), ...(Array.isArray(link) ? { tail: clone(link.slice(6)) } : { payload: capturePayload(link, LINK_FIELDS) }) };
    }
    for (const child of raw?.definitions?.subgraphs || []) {
        const id = entityId(child.id);
        if (graphIds.has(id))
            throw new Error('历史子图身份重复，原件保持不变');
        // The fixed host remints non-UUID graph IDs. Refuse before mutation rather
        // than silently attaching archived payloads to an unrelated new identity.
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
            throw new Error('历史子图身份需要显式迁移，原件保持不变');
        graphIds.add(id);
        const captured = captureWorkflowEnvelope(child, true, graphIds, depth + 1);
        children[id] = captured;
        for (const [nestedId, nested] of Object.entries(captured.children))
            children[nestedId] = nested;
    }
    return { ...capturePayload(raw, WORKFLOW_FIELDS), subgraph, nodes, links, children,
        ...(raw.definitions ? { definitions: capturePayload(raw.definitions, new Set(['subgraphs', 'extensions'])) } : {}) };
}
function mergeSlots(native, original) {
    return native.map((slot, index) => {
        const source = original[index];
        if (!source || slot.name !== source.name || slot.type !== source.type)
            return slot;
        const merged = mergePayload(slot, source.payload, true);
        if (slot.widget && source.widget)
            merged.widget = mergePayload(slot.widget, source.widget, true);
        return merged;
    });
}
export function mergeWorkflowEnvelope(native, envelope, identity = {}) {
    const result = mergePayload(native, envelope, envelope.subgraph);
    if (Array.isArray(native.nodes))
        result.nodes = native.nodes.map((node) => {
            const id = String(node.id), original = envelope.nodes[id];
            if (!original || original.type !== node.type || identity.nodeCurrent?.(id) === false)
                return node;
            const merged = mergePayload(node, original.payload, true);
            if (Array.isArray(node.inputs))
                merged.inputs = mergeSlots(node.inputs, original.inputs);
            if (Array.isArray(node.outputs))
                merged.outputs = mergeSlots(node.outputs, original.outputs);
            return merged;
        });
    if (Array.isArray(native.links))
        result.links = native.links.map((link) => {
            const topology = linkTopology(link), id = String(topology[0]), original = envelope.links[id];
            if (!original || identity.linkCurrent?.(id) === false || JSON.stringify(topology) !== JSON.stringify(original.topology))
                return link;
            if (Array.isArray(link)) {
                if (original.payload && (Object.keys(original.payload.legacy).length || original.payload.hadExtensions))
                    throw new Error('旧版连线序列无法保全扩展字段，请使用原生版本 1 导出');
                return original.tail?.length ? [...link.slice(0, 6), ...clone(original.tail)] : link;
            }
            if (original.tail?.length)
                throw new Error('连线版本转换无法保全未知序列字段，原件保持不变');
            return original.payload ? mergePayload(link, original.payload, true) : link;
        });
    if (native.definitions || envelope.definitions) {
        const definitions = envelope.definitions ? mergePayload(native.definitions || {}, envelope.definitions, true) : { ...native.definitions };
        if (Array.isArray(native.definitions?.subgraphs))
            definitions.subgraphs = native.definitions.subgraphs.map((child) => {
                const id = String(child.id), original = envelope.children[id], current = identity.childCurrent?.(id);
                return current !== false && (current?.source || original) ? mergeWorkflowEnvelope(child, current?.source || original, current || {}) : child;
            });
        if (Object.keys(definitions).length)
            result.definitions = definitions;
    }
    return result;
}
/** Preserve every unowned byte-value; native identity/layout/mode and link edits remain native. */
export function mergeReadonlySerialized(original, native, configured) {
    if (original.type !== native.type)
        throw new Error('历史节点类型变化，已拒绝覆盖原数据');
    const result = clone(original);
    for (const key of ['id', 'pos', 'size', 'order', 'mode', 'title', 'flags'])
        if (native[key] !== undefined) {
            // Native constructors synthesize defaults absent from old files. Keep them
            // absent until the user actually edits them (for example, renames the node).
            if (!Object.hasOwn(original, key) && configured && JSON.stringify(native[key]) === JSON.stringify(configured[key]))
                continue;
            result[key] = clone(native[key]);
        }
    for (const [side, link] of [['inputs', 'link'], ['outputs', 'links']]) {
        if (!Array.isArray(original[side]))
            continue;
        result[side] = original[side].map((slot, index) => {
            const current = native[side]?.[index];
            if (!current || slot.name !== current.name || slot.type !== current.type)
                slotMismatch(original.type, side, index, slot.type, current?.type);
            const restored = clone(slot);
            if (Object.hasOwn(current, link))
                restored[link] = clone(current[link]);
            else
                delete restored[link];
            return restored;
        });
    }
    // Properties, all widget positions (including legacy null DOM positions), named
    // widget values and unknown top-level payloads are immutable historical data.
    return result;
}
export function projectReadonly(raw) {
    captureReadonlyNode(raw);
    const warnings = [], parameters = {};
    const values = Array.isArray(raw.widgets_values) ? raw.widgets_values : [];
    const names = raw.type === GPT_TYPE ? GPT_WIDGETS : raw.type === BATCH_TYPE ? BATCH_WIDGETS : [];
    let positions = names;
    if (raw.type === GPT_TYPE && values.length === 14 && typeof values[11] === 'string') {
        try {
            if (Array.isArray(JSON.parse(values[11]).shots)) {
                positions = GPT_WIDGETS.filter(name => name !== 'control_after_generate');
                warnings.push('原文件缺少 seed 控制项；只读投影按已确认旧格式解释，原序列不修改。');
            }
        }
        catch { /* Unknown data remains in the raw archive and conversion will refuse it. */ }
    }
    positions.forEach((name, index) => {
        const named = raw.widgets_values_named;
        const value = named && Object.hasOwn(named, name) ? named[name] : values[index];
        if (value !== undefined)
            parameters[name] = clone(value);
    });
    const results = [];
    let storyboard;
    if (raw.type === GPT_TYPE) {
        const value = parameters.storyboard_data;
        try {
            storyboard = typeof value === 'string' ? JSON.parse(value) : value;
        }
        catch {
            warnings.push('分镜 JSON 无法解析；原始数据已保留。');
        }
        if (raw.inputs?.some((input) => input.name === 'imported_storyboard' && input.link != null))
            warnings.push('分镜来自原生连线；转换仅能使用本节点已保存的数据，不运行上游取值。');
        if (storyboard && typeof storyboard === 'object' && !Array.isArray(storyboard)) {
            const shots = storyboard.shots;
            if (Array.isArray(shots))
                for (const shot of shots)
                    if (shot && (shot.image_url || shot.reference_assets?.length))
                        results.push(clone(shot));
        }
        for (const key of ['daelabTableReports']) {
            if (raw.properties?.[key] !== undefined)
                results.push(clone(raw.properties[key]));
        }
    }
    else if (PROTOTYPE_TYPES.includes(raw.type)) {
        const saved = raw.properties?.llmStylePreview;
        if (saved && typeof saved === 'object') {
            Object.assign(parameters, clone(saved));
            if (saved.ioResult !== undefined)
                results.push(clone(saved.ioResult));
            if (saved.result !== undefined)
                results.push(clone(saved.result));
        }
        warnings.push('旧样式预览中的示例文字不是模型结果；仅显示文件中实际保存的数据。');
    }
    return { parameters, results, warnings, ...(storyboard === undefined ? {} : { storyboard }) };
}
/** Mature table conversion is injected by the integration; no duplicate writable graph. */
export function previewGPTConversion(raw, convert) {
    if (raw.type !== GPT_TYPE)
        throw new Error('此转换只适用于历史 GPT 分镜节点');
    const original = captureReadonlyNode(raw), projection = projectReadonly(original);
    if (original.inputs?.some((input) => input.name === 'imported_storyboard' && input.link != null))
        throw new Error('分镜来自连线上游；请先显式导出上游已保存内容，不能自动执行或猜测转换输入');
    if (!projection.storyboard || typeof projection.storyboard !== 'object')
        throw new Error('没有可解析的已保存分镜内容，未转换');
    const data = projection.storyboard;
    if (data.table && (!Array.isArray(data.table.fields) || !Array.isArray(data.table.records)) || !data.table && !Array.isArray(data.shots))
        throw new Error('历史分镜结构未知，不能静默转换');
    if (data.table ? data.table.fields.length > 64 || data.table.records.length > 500 : data.shots.length > 500)
        throw new Error('原始内容超过 500 行、64 列限制，未截断或转换');
    const table = clone(convert(clone(projection.storyboard)));
    if (!table || !Array.isArray(table.fields) || !Array.isArray(table.records) || table.fields.length > 64 || table.records.length > 500)
        throw new Error('转换内容不符合 500 行、64 列限制');
    const expectedRows = data.table ? data.table.records.length : data.shots.length;
    if (table.records.length !== expectedRows)
        throw new Error('转换器改变了记录数量，未应用');
    // A converted table is an editing copy. Historical runtime facts remain only
    // in the original read-only node; never let mounted generation UI resume them.
    for (const row of table.records) {
        row.meta = { ...(row.meta || {}) };
        delete row.meta.generation;
        delete row.meta.generationColumns;
    }
    table.meta = { ...(table.meta || {}) };
    delete table.meta.generation;
    delete table.meta.generationColumns;
    delete table.meta.liveSource;
    delete table.meta.generationInput;
    for (const field of table.fields)
        if (field.presentation === 'generation') {
            delete field.presentation;
            delete field.generation;
            field.readonly = false;
        }
    return { version: 1, sourceId: original.id, sourceType: original.type, sourceStamp: JSON.stringify(original),
        table, title: `${original.title || '历史 GPT 分镜'} · 转换副本`, summary: { rows: table.records.length, columns: table.fields.length },
        warnings: [...projection.warnings, '新增独立表格，保留原节点及所有旧连线。', '旧运行参数、任务回执及未知字段保留在原节点；不会选择新模型或发起任务。'] };
}
const appliedPreviews = new WeakSet();
export function applyGPTConversion(preview, port) {
    if (appliedPreviews.has(preview) || !port.current() || preview.version !== 1 || JSON.stringify(port.readSource()) !== preview.sourceStamp)
        throw new Error('预览已应用、来源或工作流已变化，请重新预览');
    port.transact('转换历史 GPT 分镜为表格副本', () => {
        if (!port.current() || JSON.stringify(port.readSource()) !== preview.sourceStamp)
            throw new Error('转换会话已失效');
        port.appendTable({ table: clone(preview.table), title: preview.title, source: port.readSource() });
    });
    appliedPreviews.add(preview);
}
export function assertReadonlyExecutionAllowed(nodes) {
    if (nodes.some(node => isReadonlyType(node.type) && node.mode !== 2 && node.mode !== 4))
        throw new Error('历史只读节点不可执行。请先显式转换，或停用这些节点后运行其他流程。');
}
export function assertReadonlyWorkflowExecutionAllowed(workflow, depth = 0) {
    if (depth > 64 || !workflow || !Array.isArray(workflow.nodes))
        throw new Error('原生图检查能力不可用，未提交');
    assertReadonlyExecutionAllowed(workflow.nodes);
    const definitions = workflow.definitions?.subgraphs;
    if (definitions !== undefined && !Array.isArray(definitions))
        throw new Error('子图格式未知，未提交');
    // The pinned host serializer emits used subgraph definitions, including nested
    // definitions. Inspect them even when the current canvas is a different graph.
    for (const graph of definitions || [])
        assertReadonlyWorkflowExecutionAllowed(graph, depth + 1);
}
