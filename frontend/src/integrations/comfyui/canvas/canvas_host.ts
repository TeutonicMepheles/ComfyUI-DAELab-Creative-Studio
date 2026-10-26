import type {
  CanvasGraph, CanvasHistoryPort, CanvasHostDiagnostic, CanvasHostPort,
  CanvasNode, CanvasNodeDefinition, CanvasNodeId,
} from '../../../contracts/canvas_host.js';

interface NativeGraph extends CanvasGraph {
  _nodes?: CanvasNode[];
  serialize?: () => unknown;
  add?: (node: CanvasNode) => void;
  remove?: (node: CanvasNode) => void;
  removeLink?: (id: CanvasNodeId) => void;
  change?: () => void;
  setDirtyCanvas?: (foreground: boolean, background: boolean) => void;
}
interface CanvasApp {
  graph: NativeGraph;
  canvas?: { setDirty?: (foreground: boolean, background: boolean) => void };
  api?: { fetchApi?: (url: string, options: RequestInit) => Promise<Response> };
  daelabMaterialGroups?: { tick?: () => void };
}
interface NodeRegistry {
  createNode?: (type: string) => CanvasNode | null | undefined;
  registered_node_types?: Record<string, CanvasNodeDefinition>;
}
type DiagnosticSink = (diagnostic: CanvasHostDiagnostic) => void;
interface WorkflowModeHost {
  isGraphReady?: boolean;
  extensionManager?: {
    workflow?: { activeWorkflow?: { activeMode?: string | null; initialMode?: string | null } };
    command?: { execute?: (id: string) => unknown | Promise<unknown> };
  };
}

/** Refuse an unknown mode rather than overlaying a possibly active App Mode. */
export async function enterCanvasGraphMode(app: WorkflowModeHost, diagnose: DiagnosticSink): Promise<void> {
  const workflow = app.extensionManager?.workflow?.activeWorkflow;
  const reject = (): never => {
    const message = '宿主缺少 mode 能力，无法安全切换创作画布。';
    diagnose({ code: 'canvas-host-capability', capability: 'mode', message });
    throw new Error(message);
  };
  // ComfyUI's getWorkflowMode uses activeMode ?? initialMode ?? 'graph'.
  // initialMode may be absent/undefined until the first activation; activeMode
  // is the explicit mode capability on ComfyWorkflow (null means no override).
  // A missing workflow is a loading state, not evidence of graph mode.
  if (app.isGraphReady === false || !workflow || !('activeMode' in workflow)) return reject();
  if (workflow.activeMode !== null && workflow.activeMode !== 'graph' && workflow.activeMode !== 'app') return reject();
  const mode = workflow?.activeMode ?? workflow?.initialMode ?? 'graph';
  if (mode !== 'graph' && mode !== 'app') reject();
  if (mode === 'app') {
    const command = app.extensionManager?.command;
    if (!command?.execute) return reject();
    try { await command.execute('Comfy.ToggleLinear'); }
    catch { return reject(); }
    // The native command layer may handle its own errors. Check the actual
    // result before covering the host with our view, including tab switches.
    if (app.extensionManager?.workflow?.activeWorkflow !== workflow) return reject();
    const result = workflow.activeMode ?? workflow.initialMode ?? 'graph';
    if (result !== 'graph') return reject();
  }
}

/** ComfyUI-specific compatibility surface; no persistent graph/cache is created here. */
export function createCanvasHostPort(
  app: CanvasApp,
  registry: NodeRegistry,
  history: CanvasHistoryPort,
  diagnose: DiagnosticSink,
): CanvasHostPort {
  const reject = (capability: string): never => {
    const message = `宿主缺少 ${capability} 能力，已拒绝此操作以保护工作流保存和撤销。`;
    diagnose({ code: 'canvas-host-capability', capability, message });
    throw new Error(message);
  };
  const current = (graph: CanvasGraph): NativeGraph => {
    if (graph !== app.graph) {
      const message = '工作流已切换，已拒绝修改过期画布。';
      diagnose({ code: 'canvas-host-stale', capability: 'active-workflow', message });
      throw new Error(message);
    }
    return app.graph;
  };
  const editable = (graph: CanvasGraph): NativeGraph => {
    const native = current(graph);
    if (typeof native.serialize !== 'function') reject('serialization');
    if (typeof native.change !== 'function') reject('change-notification');
    history.assertEditable();
    return native;
  };
  return {
    history,
    graph: () => app.graph,
    nodes(graph) {
      const native = current(graph);
      if (!Array.isArray(native._nodes)) return reject('node-enumeration');
      return native._nodes;
    },
    nodeDefinition: type => registry.registered_node_types?.[type],
    createNode(type) {
      editable(app.graph);
      if (!registry.createNode) return reject('node-creation');
      return registry.createNode(type);
    },
    addNode(graph, node) {
      const native = editable(graph);
      if (!native.add) return reject('node-add');
      native.add(node);
    },
    removeNode(graph, node) {
      const native = editable(graph);
      if (!native.remove) return reject('node-remove');
      native.remove(node);
    },
    removeLink(graph, id) {
      const native = editable(graph);
      if (!native.removeLink) return reject('link-remove');
      native.removeLink(id);
    },
    connect(graph, source, output, target, input) {
      const native = editable(graph);
      if (native.getNodeById(source.id) !== source || native.getNodeById(target.id) !== target) return reject('live-connection-endpoints');
      history.begin();
      try { return source.connect(output, target, input); }
      finally { history.end(); }
    },
    configureNode(node, data) { editable(app.graph); node.configure(data); },
    serialize(graph) {
      const native = current(graph);
      if (!native.serialize) return reject('serialization');
      return native.serialize();
    },
    changed(graph) {
      // Disposing the previous view may request a repaint after a workflow switch.
      // It is safe to discard that notification; editing commands still reject it.
      if (graph !== app.graph) return;
      const native = app.graph;
      native.setDirtyCanvas?.(true, true);
      native.change?.();
    },
    redraw(graph) { if (graph === app.graph) app.graph.setDirtyCanvas?.(true, true); },
    redrawNative() { app.canvas?.setDirty?.(true, true); },
    setWidgetValue(graph, node, widget, value, event) {
      if (editable(graph).getNodeById(node.id) !== node) return reject('live-widget-owner');
      history.begin();
      try { widget.value = value; widget.callback?.(value, app.canvas, node, null, event); }
      finally { history.end(); }
    },
    async runAction(action, node) {
      if (editable(app.graph).getNodeById(node.id) !== node) return reject('live-action-owner');
      if (!action || typeof action !== 'object' || !('run' in action) || typeof action.run !== 'function') return reject('adapter-action');
      return action.run(node, app);
    },
    fetchAsset(url, options) {
      if (!app.api?.fetchApi) return reject('asset-request');
      return app.api.fetchApi(url, options);
    },
    tickGroups() { app.daelabMaterialGroups?.tick?.(); },
  };
}
