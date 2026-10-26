import type { AsyncEditTicket, EditIdentity, EditTarget, EditTransactionOptions, NativeDocumentPort } from '../contracts/ports.js';
import { snapshotJson } from '../contracts/json_snapshot.js';

const sameIdentity = (a: EditIdentity, b: EditIdentity): boolean =>
  a.workflowSession === b.workflowSession && a.epoch === b.epoch &&
  a.documentId === b.documentId && a.recordId === b.recordId && a.fieldId === b.fieldId;

/** One edit entry point over native workflow state. No shadow document or job state. */
export class DocumentController<T> {
  #disposed = false;
  #requests = new Map<string, AsyncEditTicket>();
  constructor(private readonly port: NativeDocumentPort<T>) {}

  edit(label: string, mutation: (document: T) => void, options?: EditTransactionOptions): void {
    if (this.#disposed) throw new Error('Document controller has been released');
    this.port.transact(label, mutation, options);
  }

  editPrepared(label: string, prepare: (previous: T, draft: T) => void, options?: EditTransactionOptions): void {
    if (this.#disposed) throw new Error('Document controller has been released');
    if (this.port.transactPrepared) this.port.transactPrepared(label, prepare, options);
    else this.port.transact(label, draft => prepare(snapshotJson(draft), draft), options);
  }

  replace(label: string, value: T, options?: EditTransactionOptions): void {
    if (this.#disposed) throw new Error('Document controller has been released');
    if (this.port.replace) this.port.replace(label, value, options);
    else this.port.transact(label, draft => {
      for (const key of Object.keys(draft as object)) delete (draft as Record<string, unknown>)[key];
      Object.defineProperties(draft as object, Object.getOwnPropertyDescriptors(snapshotJson(value)));
    }, options);
  }

  beginRequest(requestId: string, target?: EditTarget): AsyncEditTicket {
    if (this.#disposed) throw new Error('Document controller has been released');
    for (const ticket of this.#requests.values()) if (!this.canApply(ticket)) this.releaseRequest(ticket);
    if (!requestId || this.#requests.has(requestId)) throw new Error('Request identity must be new');
    const ticket = Object.freeze({ ...this.port.identity(target), requestId, inputVersion: this.port.revision(target) });
    this.#requests.set(requestId, ticket);
    return ticket;
  }

  canApply(ticket: AsyncEditTicket): boolean {
    if (!ticket || this.#disposed || this.#requests.get(ticket.requestId) !== ticket) return false;
    try { return sameIdentity(ticket, this.port.identity(ticket)) && ticket.inputVersion === this.port.revision(ticket); }
    catch { return false; }
  }

  releaseRequest(ticket: AsyncEditTicket): void {
    if (this.#requests.get(ticket.requestId) === ticket) this.#requests.delete(ticket.requestId);
  }

  invalidate(): void { this.#requests.clear(); }

  /** Reject stale edits; their results remain in the backend ledger for review. */
  applyResult(ticket: AsyncEditTicket, label: string, mutation: (document: T) => void): boolean {
    return this.applyResults([ticket], label, mutation);
  }

  /** Validate the whole review batch before one native edit; failed mutations can be retried. */
  applyResults(tickets: readonly AsyncEditTicket[], label: string, mutation: (document: T) => void, options?: EditTransactionOptions): boolean {
    if (!tickets.length || new Set(tickets).size !== tickets.length || !tickets.every(ticket => this.canApply(ticket))) return false;
    this.port.transact(label, mutation, options);
    for (const ticket of tickets) this.releaseRequest(ticket);
    return true;
  }

  dispose(): void {
    this.#disposed = true;
    this.#requests.clear();
  }
}
