// The mature ESM implementation is checked by focused runtime contract tests.
// @ts-expect-error ESM boundary has an explicit strict public signature below.
import { createTableModel as createModel } from './core_model.mjs';
export function createTableModel(extensions = {}) {
    return createModel(extensions);
}
