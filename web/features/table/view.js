// @ts-expect-error Mature ESM view; this facade owns the strict consumer signature.
import { createTableEditor as createEditor, tableDialog as dialog, tableButton as button, FIELD_LABELS as labels } from './editor_runtime.mjs';
export const tableDialog = dialog;
export const tableButton = button;
export const FIELD_LABELS = labels;
export function createTableEditor(options) {
    return createEditor(options);
}
