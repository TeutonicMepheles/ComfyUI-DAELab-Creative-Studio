type RecordValue = Record<string, unknown>;
type NodeId = string | number;
type StagedNode = {
  saved: RecordValue;
  live: RecordValue;
  id: NodeId;
  key: string;
  type: string;
  descriptor: PropertyDescriptor | undefined;
  order: number | undefined;
};

const ownedTypes = new Set(['DAELAB.Table', 'DAELAB.LLMStylePreviewB']);
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const data = (object: object, name: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
};
const nodeKey = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value :
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
const validOrder = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const sameDescriptor = (a: PropertyDescriptor | undefined, b: PropertyDescriptor | undefined): boolean =>
  a === undefined ? b === undefined : b !== undefined && 'value' in a && 'value' in b &&
    a.value === b.value && a.writable === b.writable && a.enumerable === b.enumerable && a.configurable === b.configurable;

/**
 * Native configure recomputes execution order, while ChangeTracker retains the
 * original restore argument as activeState. Amend only owned numeric orders in
 * that argument after successful explicit restoration. No graph serialization,
 * live mutation, comparator changes or history queue ownership belongs here.
 */
export function reconcileRestoredNodeOrder(
  appValue: unknown, snapshotValue: unknown, trackerValue: unknown,
  workflowValue: unknown, graphValue: unknown, result: unknown, activeWorkflowValue: unknown,
): boolean {
  if (result !== true || !record(appValue) || !record(snapshotValue) || !record(trackerValue) ||
      !record(workflowValue) || !record(graphValue) || !record(activeWorkflowValue)) return false;
  const app = appValue, snapshot = snapshotValue, tracker = trackerValue, workflow = workflowValue, graph = graphValue;
  const activeWorkflow = activeWorkflowValue;
  const staged: StagedNode[] = [];
  try {
    const graphId = data(snapshot, 'id'), savedNodes = data(snapshot, 'nodes');
    const nativeNodes = graph._nodes, lookup = graph.getNodeById;
    if (nodeKey(graphId) === undefined || !Array.isArray(savedNodes) || !Array.isArray(nativeNodes) ||
        savedNodes === nativeNodes || savedNodes.length !== nativeNodes.length || typeof lookup !== 'function') return false;
    const leaseValid = (): boolean => {
      const extensions = app.extensionManager;
      const workflowManager = record(extensions) ? extensions.workflow : undefined;
      // The active store handle can be reactive while the markRaw tracker
      // retains its raw workflow argument. Keep both identities independently.
      return app.isGraphReady === true && app.rootGraph === graph && app.graph === graph &&
        record(workflowManager) && workflowManager.activeWorkflow === activeWorkflow &&
        activeWorkflow.changeTracker === tracker && workflow.changeTracker === tracker && tracker.workflow === workflow &&
        tracker._restoringState === true && tracker.changeCount === 0 && graph.id === graphId &&
        data(snapshot, 'id') === graphId && data(snapshot, 'nodes') === savedNodes &&
        graph._nodes === nativeNodes && graph.getNodeById === lookup;
    };
    if (!leaseValid()) return false;
    const nativeMembers = nativeNodes.slice(), savedMembers = savedNodes.slice();
    const nativeById = new Map<string, RecordValue>();
    for (const live of nativeMembers) {
      if (!record(live)) return false;
      const id = nodeKey(live.id);
      if (id === undefined || nativeById.has(id)) return false;
      nativeById.set(id, live);
    }
    const seen = new Set<string>();
    for (const saved of savedMembers) {
      if (!record(saved)) return false;
      const id = data(saved, 'id'), key = nodeKey(id), type = data(saved, 'type');
      if (key === undefined || seen.has(key) || typeof type !== 'string') return false;
      seen.add(key);
      const live = nativeById.get(key);
      if (!live || live === saved || live.type !== type || lookup.call(graph, id) !== live) return false;
      let descriptor: PropertyDescriptor | undefined, order: number | undefined;
      if (ownedTypes.has(type)) {
        descriptor = Object.getOwnPropertyDescriptor(saved, 'order');
        if (!descriptor || !('value' in descriptor) || descriptor.writable !== true || !validOrder(descriptor.value)) return false;
        // Native order may be store-backed. Read it only once during staging.
        const value: unknown = live.order;
        if (!validOrder(value)) return false;
        order = value;
      }
      staged.push({saved, live, id: id as NodeId, key, type, descriptor, order});
    }
    // Getters/lookup may synchronously change workflow or replace a same-ID
    // node. Complete every staged identity check before the final lease check.
    if (savedNodes.length !== savedMembers.length || nativeNodes.length !== nativeMembers.length ||
        savedMembers.some((node, index) => savedNodes[index] !== node) ||
        nativeMembers.some((node, index) => nativeNodes[index] !== node)) return false;
    for (const entry of staged) {
      if (data(entry.saved, 'id') !== entry.id || data(entry.saved, 'type') !== entry.type ||
          nodeKey(entry.live.id) !== entry.key || entry.live.type !== entry.type ||
          lookup.call(graph, entry.id) !== entry.live ||
          (entry.order !== undefined && !sameDescriptor(entry.descriptor, Object.getOwnPropertyDescriptor(entry.saved, 'order')))) return false;
    }
    if (savedNodes.length !== savedMembers.length || nativeNodes.length !== nativeMembers.length ||
        savedMembers.some((node, index) => savedNodes[index] !== node) ||
        nativeMembers.some((node, index) => nativeNodes[index] !== node) || !leaseValid()) return false;
  } catch {
    // Unsupported host getters must not turn a successful native load into a
    // failed undo. No snapshot writes occur during validation/staging.
    return false;
  }
  let changed = false;
  for (const {saved, descriptor, order} of staged) {
    if (order === undefined || descriptor?.value === order) continue;
    Object.defineProperty(saved, 'order', {...descriptor, value: order});
    changed = true;
  }
  return changed;
}
