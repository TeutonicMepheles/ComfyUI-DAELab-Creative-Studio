import type { TableModel, TableModelExtensions } from './contracts.js';
// The mature ESM implementation is checked by focused runtime contract tests.
// @ts-expect-error ESM boundary has an explicit strict public signature below.
import { createTableModelRuntime } from './model_runtime.mjs';
export type { TableData, TableField, TableRecord, TableModel, TableModelExtensions, TableDocumentPort } from './contracts.js';

export function createTableModel(extensions: TableModelExtensions = {}): TableModel {
  return createTableModelRuntime(extensions) as TableModel;
}
