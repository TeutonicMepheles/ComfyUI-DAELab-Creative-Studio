import { DocumentController } from './document_controller.js';
import { snapshotJson, snapshotJsonForPreparation } from '../contracts/json_snapshot.js';
/** Only native read/write closures own data. Stored state is session/revision bookkeeping. */
export function createBusinessDocument(options) {
    let disposed = false, epoch = 0, group = null, lastHistoryStamp;
    const versions = new Map();
    const assertCurrent = () => { if (disposed || !options.current())
        throw new Error('编辑会话已失效，请在当前工作流重新打开'); };
    const observe = () => {
        const value = options.read();
        for (const entry of versions.values()) {
            const stamp = JSON.stringify(options.stamp ? options.stamp(value, entry.target) : value);
            if (stamp !== entry.stamp) {
                entry.stamp = stamp;
                entry.version++;
            }
        }
    };
    const commit = (before, next, settings) => {
        if (!settings.afterWrite && JSON.stringify(before) === JSON.stringify(next))
            return;
        const continuing = !!settings.group && settings.group === group && options.historyStamp?.() === lastHistoryStamp;
        const write = () => {
            try {
                options.write(next);
                settings.afterWrite?.();
            }
            catch (error) {
                options.write(before);
                throw error;
            }
            finally {
                observe();
            }
        };
        if (settings.derived || continuing)
            options.history.amend(write);
        else {
            options.history.begin();
            try {
                write();
            }
            finally {
                options.history.end();
            }
        }
        group = settings.group ?? null;
        lastHistoryStamp = options.committedHistoryStamp ? options.committedHistoryStamp() : options.historyStamp?.();
    };
    const port = {
        read: options.read,
        identity(target = {}) {
            assertCurrent();
            const identity = options.identity();
            return { ...identity, epoch: identity.epoch + epoch,
                ...(target.recordId === undefined ? {} : { recordId: target.recordId }),
                ...(target.fieldId === undefined ? {} : { fieldId: target.fieldId }) };
        },
        revision(target = {}) {
            assertCurrent();
            observe();
            const key = JSON.stringify([target.recordId, target.fieldId]);
            if (!versions.has(key))
                versions.set(key, { stamp: JSON.stringify(options.stamp ? options.stamp(options.read(), target) : options.read()), version: 0, target });
            return versions.get(key).version;
        },
        transact(_label, edit, settings = {}) {
            assertCurrent();
            observe();
            const before = snapshotJson(options.read()), draft = snapshotJson(before);
            edit(draft); // Validation/mutation happens before opening host history.
            const next = snapshotJson(draft);
            commit(before, next, settings);
        },
        transactPrepared(_label, prepare, settings = {}) {
            assertCurrent();
            observe();
            const { rollback, previous, draft } = snapshotJsonForPreparation(options.read());
            prepare(previous, draft);
            const next = snapshotJson(draft);
            assertCurrent();
            commit(rollback, next, settings);
        },
        replace(_label, value, settings = {}) {
            assertCurrent();
            observe();
            const before = snapshotJson(options.read()), next = snapshotJson(value);
            if (before !== null && next !== null && typeof before === 'object' && typeof next === 'object' && Array.isArray(before) === Array.isArray(next)) {
                commit(before, next, settings);
            }
            else {
                // Retain legacy key/descriptor replacement for unlike root containers.
                const draft = snapshotJson(before);
                for (const key of Object.keys(draft))
                    delete draft[key];
                Object.defineProperties(draft, Object.getOwnPropertyDescriptors(next));
                commit(before, snapshotJson(draft), settings);
            }
        },
    };
    const controller = new DocumentController(port);
    const invalidate = () => { epoch++; group = null; controller.invalidate(); };
    const replacement = (value) => (draft) => {
        for (const key of Object.keys(draft))
            delete draft[key];
        // Own data descriptors preserve JSON keys such as __proto__ without invoking setters.
        Object.defineProperties(draft, Object.getOwnPropertyDescriptors(snapshotJson(value)));
    };
    return {
        controller, read: options.read, observe,
        isCurrent: () => !disposed && options.current(),
        edit: (label, edit, settings) => controller.edit(label, edit, settings),
        editPrepared: (label, prepare, settings) => controller.editPrepared(label, prepare, settings),
        replace(value, settings) {
            controller.replace('编辑内容', value, settings);
        },
        replaceResults: (tickets, value, settings) => controller.applyResults(tickets, '应用审阅结果', replacement(value), settings),
        beginRequest: (requestId, target) => controller.beginRequest(requestId, target),
        canApply: controller.canApply.bind(controller),
        releaseRequest: controller.releaseRequest.bind(controller),
        invalidate,
        undo() { assertCurrent(); invalidate(); options.invalidateHost?.(); return options.history.undo(); },
        redo() { assertCurrent(); invalidate(); options.invalidateHost?.(); return options.history.redo(); },
        canUndo: () => !disposed && options.current() && (options.canUndo?.() ?? true),
        canRedo: () => !disposed && options.current() && (options.canRedo?.() ?? true),
        dispose() { disposed = true; controller.dispose(); versions.clear(); },
    };
}
