import { createBusinessDocument } from '../../../application/business_document.js';
import { nativeEditHistoryStamp } from './native_edit_history_stamp.js';
let host;
let epoch = 0, session = 0, workflow;
export function installBusinessDocuments(app, history) { host = { app, history }; workflow = app.extensionManager?.workflow?.activeWorkflow; session++; epoch++; }
export function invalidateBusinessDocuments() { epoch++; }
export function loadedBusinessWorkflow() {
    const next = host?.app.extensionManager?.workflow?.activeWorkflow;
    if (next !== workflow) {
        workflow = next;
        session++;
    }
    epoch++;
}
export function bindBusinessDocument(node, read, write, stamp) {
    if (!host)
        throw new Error('Native document host is not installed');
    const { app, history } = host;
    const graph = node.graph;
    const active = () => app.extensionManager?.workflow?.activeWorkflow;
    const binding = createBusinessDocument({
        read, write, history,
        current: () => !!graph && node.graph === graph && graph.getNodeById?.(node.id) === node && graph === app.graph,
        identity() {
            if (active() !== workflow) {
                workflow = active();
                session++;
                epoch++;
            }
            return { workflowSession: `native-workflow-${session}`, epoch, documentId: String(node.id) };
        },
        historyStamp: () => nativeEditHistoryStamp((app.rootGraph || app.graph)?.serialize()),
        committedHistoryStamp: () => {
            const tracker = active()?.changeTracker;
            // The native boundary already captured this snapshot. Reading the live
            // graph again both repeats serialization and can absorb a later external
            // mutation into our grouping baseline. Nested/legacy hosts keep the old path.
            return nativeEditHistoryStamp(tracker?.changeCount === 0 && tracker.activeState
                ? tracker.activeState : (app.rootGraph || app.graph)?.serialize());
        },
        canUndo: () => {
            const tracker = active()?.changeTracker;
            return !!tracker && (!!tracker.undoQueue?.length || !!tracker.activeState && JSON.stringify(tracker.activeState) !== JSON.stringify((app.rootGraph || app.graph)?.serialize()));
        },
        canRedo: () => !!active()?.changeTracker?.redoQueue?.length,
        invalidateHost: invalidateBusinessDocuments,
        ...(stamp ? { stamp } : {}),
    });
    return binding;
}
/** Keep identity and unknown values; another record's edit does not invalidate this row. */
export function tableInputStamp(table, target) {
    if (!target.recordId)
        return table;
    const row = table.records.find((record) => record.id === target.recordId);
    const { canvasWidth: _width, density: _density, ...meta } = table.meta || {};
    const fields = table.fields.map(({ width: _width, hidden: _hidden, ...field }) => field);
    const { height: _height, ...rowMeta } = row?.meta || {};
    return { fields, meta, record: row ? { ...row, meta: rowMeta, selected: undefined } : null };
}
