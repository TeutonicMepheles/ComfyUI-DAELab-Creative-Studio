import type { TableModel, TableModelExtensions } from './contracts.js';
// The mature ESM implementation is checked by focused runtime contract tests.
// @ts-expect-error ESM boundary has an explicit strict public signature below.
import { createTableModel as createModel } from './core_model.mjs';
export type { TableData, TableField, TableRecord, TableModel, TableModelExtensions, TableDocumentPort } from './contracts.js';
export type { TableEditor, TableEditorOptions, TableColumnPresentation, TablePanelContext } from './contracts.js';
export { createTableEditor } from './view.js';

export function createTableModel(extensions: TableModelExtensions = {}): TableModel {
  return createModel(extensions) as TableModel;
}
