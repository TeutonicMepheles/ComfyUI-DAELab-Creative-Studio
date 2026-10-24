import { createBusinessDocument } from '../../../application/business_document.js';
import type { EditTarget } from '../../../contracts/ports.js';

// This module is the only application document binding that knows the ComfyUI host.
type Host = { app: any; history: any };
let host: Host | undefined;
let epoch = 0, session = 0, workflow: unknown;
export function installBusinessDocuments(app: any, history: any): void { host = { app, history }; workflow = app.extensionManager?.workflow?.activeWorkflow; session++; epoch++; }
export function invalidateBusinessDocuments(): void { epoch++; }
export function loadedBusinessWorkflow(): void {
  const next = host?.app.extensionManager?.workflow?.activeWorkflow;
  if (next !== workflow) { workflow = next; session++; }
  epoch++;
}
export function bindBusinessDocument<T>(node: any, read: () => T, write: (value: T) => void, stamp?: (value: T, target: EditTarget) => unknown) {
  if (!host) throw new Error('Native document host is not installed');
  const { app, history } = host;
  const graph = node.graph;
  const active = () => app.extensionManager?.workflow?.activeWorkflow;
  const binding = createBusinessDocument({
    read, write, history,
    current: () => !!graph && node.graph === graph && graph.getNodeById?.(node.id) === node && graph === app.graph,
    identity() {
      if (active() !== workflow) { workflow = active(); session++; epoch++; }
      return { workflowSession: `native-workflow-${session}`, epoch, documentId: String(node.id) };
    },
    historyStamp: () => JSON.stringify((app.rootGraph || app.graph)?.serialize()),
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
export function tableInputStamp(table: any, target: EditTarget): unknown {
  if (!target.recordId) return table;
  const row = table.records.find((record: any) => record.id === target.recordId);
  const { canvasWidth: _width, density: _density, ...meta } = table.meta || {};
  const fields = table.fields.map(({ width: _width, hidden: _hidden, ...field }: any) => field);
  const { height: _height, ...rowMeta } = row?.meta || {};
  return { fields, meta, record: row ? { ...row, meta: rowMeta, selected: undefined } : null };
}
