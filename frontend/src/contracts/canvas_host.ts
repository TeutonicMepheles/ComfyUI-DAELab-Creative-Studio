/** Native objects remain authoritative. These are borrowed references, never copied graphs. */
export type CanvasNodeId = string | number;
export interface CanvasNode {
  id: CanvasNodeId;
  graph?: CanvasGraph | null;
  connect(output: number, target: CanvasNode, input: number): unknown;
  configure(data: unknown): void;
}
export interface CanvasGraph {
  extra?: Record<string, unknown>;
  getNodeById(id: CanvasNodeId): CanvasNode | null | undefined;
}
export interface CanvasWidget {
  value: unknown;
  callback?: (value: unknown, canvas: unknown, node: CanvasNode, position: null, event: Event) => void;
}
export interface CanvasNodeDefinition { nodeData?: unknown }
export interface CanvasHistoryPort {
  /** Fail before a mutation when serialization/history cannot safely record it. */
  assertEditable(): void;
  begin(): void;
  end(): void;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** Flush pending edits; the native capture listener dispatches this key once. */
  prepareNativeShortcut(event: KeyboardEvent): boolean;
  amend<T>(change: () => T): T;
  updateViewport(viewport: { x: number; y: number; zoom: number }): void;
}
export interface CanvasHostDiagnostic {
  code: 'canvas-host-capability' | 'canvas-host-stale';
  capability: string;
  message: string;
}
/** Injected at assembly. Core may read native node/slot data, but host commands live here. */
export interface CanvasHostPort {
  readonly history: CanvasHistoryPort;
  graph(): CanvasGraph;
  nodes(graph: CanvasGraph): readonly CanvasNode[];
  nodeDefinition(type: string): CanvasNodeDefinition | undefined;
  createNode(type: string): CanvasNode | null | undefined;
  addNode(graph: CanvasGraph, node: CanvasNode): void;
  removeNode(graph: CanvasGraph, node: CanvasNode): void;
  removeLink(graph: CanvasGraph, id: CanvasNodeId): void;
  connect(graph: CanvasGraph, source: CanvasNode, output: number, target: CanvasNode, input: number): unknown;
  configureNode(node: CanvasNode, data: unknown): void;
  serialize(graph: CanvasGraph): unknown;
  changed(graph: CanvasGraph): void;
  redraw(graph: CanvasGraph): void;
  redrawNative(): void;
  setWidgetValue(graph: CanvasGraph, node: CanvasNode, widget: CanvasWidget, value: unknown, event: Event): void;
  /** Retains the v1 public adapter action signature inside the integration boundary. */
  runAction(action: unknown, node: CanvasNode): Promise<unknown>;
  fetchAsset(url: string, options: RequestInit): Promise<Response>;
  tickGroups(): void;
}
