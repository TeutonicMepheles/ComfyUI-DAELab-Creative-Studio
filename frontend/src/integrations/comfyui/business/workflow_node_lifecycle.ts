interface WorkflowNode {
  id: string | number;
  graph?: WorkflowGraph | null;
}
interface WorkflowGraph {
  getNodeById(id: string | number): WorkflowNode | null | undefined;
}
interface WorkflowApp {
  isGraphReady?: boolean;
  graph: WorkflowGraph;
  loadGraphData(...args: unknown[]): unknown;
}
interface PendingInstall {
  graph: WorkflowGraph;
  revision: number;
  install(node: WorkflowNode): void;
}
interface WorkflowNodeLifecycle {
  ready(node: WorkflowNode): boolean;
  schedule(node: WorkflowNode, install: (node: WorkflowNode) => void): void;
  cancel(node: WorkflowNode): void;
}
const owners = new WeakMap<WorkflowApp, WorkflowNodeLifecycle>();

/** Node creation can precede native workflow activation and its ChangeTracker.
 * Queue installations, never edits, across that boundary; re-read the live node
 * after the native load and its caller's undo/redo continuation have settled.
 */
export function installWorkflowNodeLifecycle(
  app: WorkflowApp,
  nextFrame: (callback: () => void) => unknown = callback => requestAnimationFrame(callback),
): WorkflowNodeLifecycle {
  const existing = owners.get(app);
  if (existing) return existing;
  const pending = new Map<WorkflowNode, PendingInstall>();
  let revision = 0, loads = 0, available = true, queued = false;
  const ready = (node: WorkflowNode) => available && !loads && app.isGraphReady !== false
    && !!node.graph && node.graph === app.graph && node.graph.getNodeById(node.id) === node;
  function flush() {
    queued = false;
    if (loads || !available) return;
    const entries = [...pending];pending.clear();
    for (const [node, entry] of entries) {
      if (entry.revision === revision && node.graph === entry.graph && ready(node)) entry.install(node);
    }
  }
  const load = app.loadGraphData;
  app.loadGraphData = async function (...args: unknown[]) {
    const current = ++revision;
    loads++;available = false;pending.clear();
    try {
      const result = await load.apply(this, args);
      if (current === revision) available = result !== false;
      return result;
    } finally {
      loads--;
      if (!loads) {
        if (available) nextFrame(flush);
        else pending.clear();
      }
    }
  };
  const lifecycle: WorkflowNodeLifecycle = {
    ready,
    schedule(node, install) {
      if (!node.graph) return;
      pending.set(node, { graph: node.graph, revision, install });
      if (!loads && available && !queued) { queued = true;queueMicrotask(flush); }
    },
    cancel(node) { pending.delete(node); },
  };
  owners.set(app, lifecycle);
  return lifecycle;
}
