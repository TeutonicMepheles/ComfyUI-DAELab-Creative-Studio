// @ts-expect-error Mature ESM view; this facade owns the strict consumer signature.
import { createTableEditor as createEditor } from './editor_runtime.mjs';
export function createTableEditor(options) {
    return createEditor(options);
}
