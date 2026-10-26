function valueBinding(data) {
    const descriptor = Object.getOwnPropertyDescriptor(data, 'value');
    if (!descriptor)
        return null;
    if ('value' in descriptor)
        return { kind: 'data', descriptor };
    const options = data.options, element = data.element;
    // The owned multiline STRING uses ComfyUI's public DOM-widget getValue
    // contract. Unknown accessors do not opt in merely by returning a string.
    if (data.type !== 'customtext' || typeof descriptor.get !== 'function' || !options || typeof options !== 'object' ||
        !('getValue' in options) || typeof options.getValue !== 'function' || !element || typeof element !== 'object')
        return null;
    return { kind: 'customtext', descriptor, options, getValue: options.getValue, element };
}
function sameBinding(a, b) {
    return !!b && a.kind === b.kind && a.options === b.options && a.getValue === b.getValue && a.element === b.element &&
        a.descriptor.get === b.descriptor.get && a.descriptor.set === b.descriptor.set &&
        a.descriptor.enumerable === b.descriptor.enumerable && a.descriptor.configurable === b.descriptor.configurable && a.descriptor.writable === b.descriptor.writable;
}
// Slot descriptors are tiny; do not serialize arbitrary unknown slot metadata or
// invoke accessors just to decide whether a table-string optimization is safe.
function properties(object) {
    const result = [];
    for (const key of Reflect.ownKeys(object)) {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        if (!descriptor || !('value' in descriptor))
            return null;
        result.push([key, descriptor]);
    }
    return result;
}
function sameProperties(a, b) {
    return a === b || !!a && !!b && a.length === b.length && a.every(([key, x], i) => {
        const item = b[i];
        return !!item && key === item[0] && Object.is(x.value, item[1].value) &&
            x.enumerable === item[1].enumerable && x.configurable === item[1].configurable && x.writable === item[1].writable;
    });
}
function sameScope(a, b) {
    return a.raw === b.raw && a.widgets === b.widgets && a.inputs === b.inputs && a.slots.length === b.slots.length &&
        a.slots.every((slot, i) => {
            const next = b.slots[i];
            return !!next && slot.object === next.object && slot.name === next.name && slot.type === next.type && slot.link === next.link &&
                sameProperties(slot.properties, next.properties) && sameProperties(slot.widget, next.widget);
        });
}
function withoutLiveSource(table) {
    try {
        if (!table || typeof table !== 'object' || !('meta' in table))
            return false;
        const meta = table.meta;
        return !!meta && typeof meta === 'object' && !Array.isArray(meta) && !('liveSource' in meta);
    }
    catch {
        return false;
    }
}
/** Cache one proved immutable string, never a mutable table or public snapshot. */
export function createTableWidgetSerializer(node, data, readTableView) {
    let owner = null;
    // install assigns this serializer before hideNative replaces widget.options.
    // Bind public getter hooks on its first eligible call, then never retarget them.
    let binding;
    try {
        const graph = node.graph, nodeId = node.id, nativeNode = graph?.getNodeById?.(nodeId);
        // The native lookup may return the raw node behind a Vue proxy. Capture its
        // identity now and compare future lookups, rather than equating raw/proxy.
        if (graph && nativeNode)
            owner = { graph, graphId: graph.id, nodeId, nativeNode };
    }
    catch { /* An unavailable cache guard must not change the old serializer. */ }
    let cached = null;
    const scope = (provedRaw) => {
        try {
            if (!owner || node.type !== 'DAELAB.Table' || node.mode !== 0 || node.graph !== owner.graph ||
                node.id !== owner.nodeId || owner.graph.id !== owner.graphId || owner.graph.getNodeById?.(owner.nodeId) !== owner.nativeNode ||
                data.serializeValue !== serialize)
                return null;
            const widgets = node.widgets, inputs = node.inputs;
            if (!widgets || !inputs || widgets.find(widget => widget.name === 'table_data') !== data)
                return null;
            const currentBinding = valueBinding(data);
            if (binding === undefined)
                binding = currentBinding;
            if (!binding || !sameBinding(binding, currentBinding))
                return null;
            const slots = [];
            for (const object of inputs) {
                const fields = properties(object);
                if (!fields)
                    return null;
                // Native NodeInputSlot.link is a prototype getter backed by current
                // connectivity; own descriptors alone would miss a newly connected wire.
                const link = object.link;
                if (link != null)
                    return null;
                const widget = object.widget;
                const widgetProperties = widget && typeof widget === 'object' ? properties(widget) : null;
                if (widget && typeof widget === 'object' && !widgetProperties)
                    return null;
                slots.push({ object, name: object.name, type: object.type, link, properties: fields, widget: widgetProperties });
            }
            const input = slots.find(slot => slot.name === 'source_table');
            if (!input || input.type !== 'STRING')
                return null;
            // Hits always read the public getter anew. A miss reads it here and in
            // the original delegate; the pinned host getter is a synchronous query.
            // Post-delegate checks revalidate hooks/ownership without a third getter.
            // If the store changed meanwhile, the next call's fresh key cannot hit.
            const raw = currentBinding.kind === 'data' ? currentBinding.descriptor.value : provedRaw ?? data.value;
            if (typeof raw !== 'string')
                return null;
            return { raw, widgets, inputs, slots };
        }
        catch {
            return null;
        }
    };
    const serialize = () => {
        const before = scope();
        if (before && cached && sameScope(before, cached))
            return cached.raw;
        cached = null;
        // The miss/error path remains the original complete public read and JSON
        // encoding. Noncanonical inputs, live projections and errors never arm.
        try {
            const table = readTableView(node), result = JSON.stringify(table);
            if (before && result === before.raw && withoutLiveSource(table)) {
                const after = scope(before.raw);
                if (after && sameScope(before, after))
                    cached = after;
            }
            return result;
        }
        catch {
            return data.value;
        }
    };
    return serialize;
}
