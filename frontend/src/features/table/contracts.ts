import type { Json, NativeDocumentPort } from '../../contracts/ports.js';
import type { createBusinessDocument } from '../../application/business_document.js';
import type { StructuredClipboardPort } from '../../ui/structured_clipboard.js';

/** Unknown saved keys are retained; these interfaces are not serialization filters. */
export interface TableField {
  id: string; name: string; type: string; width?: number; hidden?: boolean; readonly?: boolean;
  [key: string]: unknown;
}
export interface TableRecord {
  id: string; selected?: boolean; values: Record<string, Json>;
  [key: string]: unknown;
}
export interface TableData {
  version: number; fields: TableField[]; records: TableRecord[];
  meta: Record<string, Json>; view?: string;
  [key: string]: unknown;
}
/** Reuse the native document contract, never introduce a writable parallel store. */
export type TableDocumentPort = NativeDocumentPort<TableData>;
export interface TableModelExtensions {
  isPrompt?(field: TableField): boolean;
  validatePrompt?(value: Json): Json;
  isColumnPrompt?(value: unknown): boolean;
  validateColumnPrompt?(value: Json): Json;
  toColumnPrompt?(value: Json, context?: {values: Record<string, Json>}): Json;
  bindColumnAssets?(table: TableData, recordId: string, fieldId: string): void;
  migratePromptSource?(table: TableData): TableData;
  promptSourceId?(table: TableData): string | null;
  setPromptSource?(table: TableData, fieldId: string | null): void;
}
export interface TableModel {
  readonly FIELD_TYPES: readonly string[];
  readonly COLUMN_MINIMUM_WIDTH: number;
  clone<T>(value: T): T;
  uid(): string;
  normalizeTable(value?: unknown): TableData;
  emptyValue(field: TableField): Json;
  convertValue(field: TableField, value: unknown): Json;
  addField(table: TableData, spec?: Partial<TableField>): TableField;
  removeField(table: TableData, id: string): void;
  addRecord(table: TableData, values?: Record<string, Json>, afterId?: string | null): TableRecord;
  duplicateSelected(table: TableData): void;
  reorder<T extends {id: string}>(items: T[], sourceId: string, targetId: string, after?: boolean): void;
  setValue(table: TableData, recordId: string, fieldId: string, value: unknown): void;
  transferValue(table: TableData, from: {record: string; field: string}, to: {record: string; field: string}, mode?: string): void;
  parseTSV(text: string): string[][];
  pasteMatrix(table: TableData, recordId: string, fieldId: string, matrix: Json[][]): void;
  encodeTSV(matrix: Json[][]): string;
  SnapshotHistory: new (limit?: number) => {
    undoStack: string[]; redoStack: string[]; group: string | null;
    record(before: string, after: string, group?: string | null): void;
    restore(current: string, redo?: boolean): TableData | null;
  };
}

export interface TablePanelContext {
  presentation?: string; width?: number;
  getViewport(): {left: number; top: number; right: number; bottom: number} | null;
  resizeWidth?(width: number): void;
  panBy?(x: number, y: number): void;
  beginMaterialDrag?(key: string, transfer: DataTransfer): void;
}
export interface TableChangeOptions {
  render?: boolean; group?: string | null; tickets?: readonly object[]; derived?: boolean;
}
export type TableChange = (edit: (table: TableData) => void, options?: TableChangeOptions) => void;
export interface TableContentPorts {
  getTable(): TableData; change: TableChange;
  upload(file: File): Promise<string>; notify(message: string): void;
  onCleanup(dispose: () => void): void;
  beginAsync(target?: {recordId?: string; fieldId?: string}): object;
  releaseAsync(ticket: object): void;
  bindAssetDrag(element: HTMLElement, asset: {id: string}): void;
}
export interface TableColumnPresentation {
  isPrompt(field: TableField): boolean;
  promptText(value: Json, table: TableData, row: TableRecord): string;
  bindColumnAssets(table: TableData, recordId: string, fieldId: string): void;
  preserveGenerationHistory(current: TableData, restored: TableData): TableData;
  promptSourceHeader(context: {table: TableData; field: TableField; header: HTMLElement; title: HTMLElement; root: HTMLElement; change: TableChange; notify(message: string): void}): void;
  renderContentCell(cell: HTMLElement, row: TableRecord, field: TableField, ports: TableContentPorts): void;
  addGenerationColumn(table: TableData, spec: Partial<TableField>): TableField;
}
export interface TableEditorOptions {
  getTable(): TableData; setTable(table: TableData): void;
  model: TableModel; columns: TableColumnPresentation;
  upload?(file: File, options: {signal: AbortSignal}): Promise<string>;
  notify?(message: string): void;
  getPanelContext?(root: HTMLElement): TablePanelContext | null;
  confirm?(message: string): boolean;
  prompt?(message: string, value: string): string | null;
  clipboard?: StructuredClipboardPort;
  displayContent?(): boolean; promptColumnsOnly?: boolean;
  documentFactory?(read: () => TableData, write: (table: TableData) => void): ReturnType<typeof createBusinessDocument<TableData>>;
  validateChange?(previous: TableData, next: TableData): void;
  textPanelHost?(): HTMLElement;
  onRestore?(): void;
}
export interface TableEditor {
  root: HTMLElement; change: TableChange;
  render(): void; destroy(): void; closeDialogs(): void;
  panelContext(): TablePanelContext | null;
  beginAsync(target?: {recordId?: string; fieldId?: string}, requestId?: string): object;
  canAsync(ticket: object): boolean; releaseAsync(ticket: object): void; invalidateAsync(): void;
  applyAsync(tickets: object | object[], edit: (table: TableData) => void, options?: TableChangeOptions): void;
  onTableChange(observer: () => void): () => void;
  restore(redo?: boolean): unknown;
  copySelection(): Promise<void>;
  focusCell(recordId: string, fieldId: string): void;
}
