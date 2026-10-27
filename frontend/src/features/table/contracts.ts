import type { Json, NativeDocumentPort } from '../../contracts/ports.js';

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
