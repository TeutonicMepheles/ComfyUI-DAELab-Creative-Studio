import { DocumentController } from './document_controller.js';
import { snapshotJson } from '../contracts/json_snapshot.js';
import type { AsyncEditTicket, EditIdentity, EditTarget, EditTransactionOptions, NativeDocumentPort } from '../contracts/ports.js';

export interface BusinessDocumentOptions<T> {
  read(): T;
  write(value: T): void;
  identity(): EditIdentity;
  current(): boolean;
  stamp?(value: T, target: EditTarget): unknown;
  historyStamp?(): unknown;
  history: { begin(): void; end(): void; amend(change: () => void): unknown; undo(): unknown; redo(): unknown };
  invalidateHost?(): void;
  canUndo?(): boolean;
  canRedo?(): boolean;
}

/** Only native read/write closures own data. Stored state is session/revision bookkeeping. */
export function createBusinessDocument<T>(options: BusinessDocumentOptions<T>) {
  let disposed = false, epoch = 0, group: string | null = null, lastHistoryStamp: unknown;
  const versions = new Map<string, { stamp: string | undefined; version: number; target: EditTarget }>();
  const assertCurrent = () => { if (disposed || !options.current()) throw new Error('编辑会话已失效，请在当前工作流重新打开'); };
  const observe = () => {
    const value = options.read();
    for (const entry of versions.values()) {
      const stamp = JSON.stringify(options.stamp ? options.stamp(value, entry.target) : value);
      if (stamp !== entry.stamp) { entry.stamp = stamp; entry.version++; }
    }
  };
  const commit = (before: T, next: T, settings: EditTransactionOptions) => {
    if (!settings.afterWrite && JSON.stringify(before) === JSON.stringify(next)) return;
    const continuing = !!settings.group && settings.group === group && options.historyStamp?.() === lastHistoryStamp;
    const write = () => {
      try { options.write(next); settings.afterWrite?.(); }
      catch (error) { options.write(before); throw error; }
      finally { observe(); }
    };
    if (settings.derived || continuing) options.history.amend(write);
    else { options.history.begin(); try { write(); } finally { options.history.end(); } }
    group = settings.group ?? null;
    lastHistoryStamp = options.historyStamp?.();
  };
  const port: NativeDocumentPort<T> = {
    read: options.read,
    identity(target = {}) {
      assertCurrent(); const identity = options.identity();
      return { ...identity, epoch: identity.epoch + epoch,
        ...(target.recordId === undefined ? {} : { recordId: target.recordId }),
        ...(target.fieldId === undefined ? {} : { fieldId: target.fieldId }) };
    },
    revision(target = {}) {
      assertCurrent(); observe();
      const key = JSON.stringify([target.recordId, target.fieldId]);
      if (!versions.has(key)) versions.set(key, { stamp: JSON.stringify(options.stamp ? options.stamp(options.read(), target) : options.read()), version: 0, target });
      return versions.get(key)!.version;
    },
    transact(_label, edit, settings = {}) {
      assertCurrent(); observe();
      const before = snapshotJson(options.read()), draft = snapshotJson(before);
      edit(draft); // Validation/mutation happens before opening host history.
      const next = snapshotJson(draft);
      commit(before, next, settings);
    },
    replace(_label, value, settings = {}) {
      assertCurrent(); observe();
      const before = snapshotJson(options.read()), next = snapshotJson(value);
      if (before !== null && next !== null && typeof before === 'object' && typeof next === 'object' && Array.isArray(before) === Array.isArray(next)) {
        commit(before, next, settings);
      } else {
        // Retain legacy key/descriptor replacement for unlike root containers.
        const draft = snapshotJson(before);
        for (const key of Object.keys(draft as object)) delete (draft as Record<string, unknown>)[key];
        Object.defineProperties(draft as object, Object.getOwnPropertyDescriptors(next));
        commit(before, snapshotJson(draft), settings);
      }
    },
  };
  const controller = new DocumentController(port);
  const invalidate = () => { epoch++; group = null; controller.invalidate(); };
  const replacement = (value: T) => (draft: T) => {
    for (const key of Object.keys(draft as object)) delete (draft as Record<string, unknown>)[key];
    // Own data descriptors preserve JSON keys such as __proto__ without invoking setters.
    Object.defineProperties(draft as object, Object.getOwnPropertyDescriptors(snapshotJson(value)));
  };
  return {
    controller, read: options.read, observe,
    isCurrent: () => !disposed && options.current(),
    edit: (label: string, edit: (document: T) => void, settings?: EditTransactionOptions) => controller.edit(label, edit, settings),
    replace(value: T, settings?: EditTransactionOptions) {
      controller.replace('编辑内容', value, settings);
    },
    replaceResults: (tickets: readonly AsyncEditTicket[], value: T, settings?: EditTransactionOptions) => controller.applyResults(tickets, '应用审阅结果', replacement(value), settings),
    beginRequest: (requestId: string, target?: EditTarget) => controller.beginRequest(requestId, target),
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
