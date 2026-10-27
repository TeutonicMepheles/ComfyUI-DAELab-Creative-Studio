import type { TableEditor, TableEditorOptions } from './contracts.js';
// @ts-expect-error Mature ESM view; this facade owns the strict consumer signature.
import { createTableEditor as createEditor } from './editor_runtime.mjs';
export function createTableEditor(options: TableEditorOptions): TableEditor {
  return createEditor(options) as TableEditor;
}
