// The mature ESM implementation is checked by focused runtime contract tests.
// @ts-expect-error ESM boundary has an explicit strict public signature below.
import { createTableModelRuntime } from './model_runtime.mjs';
export function createTableModel(extensions = {}) {
    return createTableModelRuntime(extensions);
}
