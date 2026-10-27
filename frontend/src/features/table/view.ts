import type { TableEditor, TableEditorOptions } from './contracts.js';
// @ts-expect-error Mature ESM view; this facade owns the strict consumer signature.
import { createTableEditor as createEditor, tableDialog as dialog, tableButton as button, FIELD_LABELS as labels } from './editor_runtime.mjs';
export const tableDialog: (title: string) => HTMLDialogElement = dialog;
export const tableButton: (label: string, action: (event: Event) => unknown, primary?: boolean) => HTMLButtonElement = button;
export const FIELD_LABELS: Readonly<Record<string,string>> = labels;
export function createTableEditor(options: TableEditorOptions): TableEditor {
  return createEditor(options) as TableEditor;
}
