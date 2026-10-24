import type { AsyncEditTicket } from '../../contracts/ports.js';
import type { GenerationReport, GenerationScope } from '../../contracts/business.js';

export interface GenerationReference { requestId: string; inputDigest: string; source: GenerationScope; model: string }
export interface GenerationEdits {
  begin(requestId: string, target: {recordId: string; fieldId: string}): AsyncEditTicket;
  current(ticket: AsyncEditTicket): boolean;
  release(ticket: AsyncEditTicket): void;
  apply(ticket: AsyncEditTicket, report: GenerationReport): boolean;
}
type Entry = { reference: GenerationReference; ticket?: AsyncEditTicket; report?: GenerationReport };
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonical(item)])) : value;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export async function generationInputDigest(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Read-only ledger projections and issued edit capabilities; never an alternate task ledger. */
export class GenerationSession {
  #entries = new Map<string, Entry>();
  #disposed = false;
  constructor(private readonly edits: GenerationEdits) {}
  watch(reference: GenerationReference, ticket?: AsyncEditTicket): void {
    if (this.#disposed) return;
    const previous = this.#entries.get(reference.requestId);
    if (previous && !same(previous.reference, reference)) throw new Error('任务引用身份发生冲突');
    if (previous && !ticket) return;
    if (previous?.ticket && previous.ticket !== ticket) this.edits.release(previous.ticket);
    this.#entries.set(reference.requestId, {reference: structuredClone(reference), ...(previous?.report ? {report: previous.report} : {}), ...(ticket ? {ticket} : {})});
  }
  ingest(report: GenerationReport): boolean {
    const entry = this.#entries.get(report.requestId);
    if (this.#disposed || !entry || !same(entry.reference.source, report.source) ||
      !Number.isSafeInteger(report.version) || report.version < 0 || !/^[a-f0-9]{64}$/.test(report.inputFingerprint)) return false;
    if (entry.report && (report.inputFingerprint !== entry.report.inputFingerprint || report.version < entry.report.version ||
      report.version === entry.report.version && report.phase === 'complete' && entry.report.phase === 'complete' && !same(report.receipt, entry.report.receipt))) return false;
    entry.report = structuredClone(report);
    return true;
  }
  report(id: string): GenerationReport | undefined { const report = this.#entries.get(id)?.report; return report && structuredClone(report); }
  canReplace(id: string): boolean {
    const entry = this.#entries.get(id), report = entry?.report;
    return !!entry && report?.replacementAllowed === true && report.state === 'cancelled' &&
      /^[a-f0-9]{64}$/.test(entry.reference.inputDigest) && report.source.inputDigest === entry.reference.inputDigest;
  }
  canApply(id: string): boolean {
    const entry = this.#entries.get(id), report = entry?.report;
    const result = report?.result as {url?: string; kind?: string; asset_id?: string; reference_id?: string} | undefined;
    const receipt = report?.receipt as {kind?: string; items?: {asset_id?: string; reference_id?: string}[]} | undefined;
    return !this.#disposed && !!entry?.ticket && this.edits.current(entry.ticket) && report?.state === 'succeeded' && report.phase === 'complete' &&
      !!result?.url?.startsWith('/view?') && receipt?.kind === 'assets' && ['image','video'].includes(result.kind ?? '') &&
      !!receipt?.items?.some(item => item.asset_id === result.asset_id && item.reference_id === result.reference_id && !!item.asset_id && !!item.reference_id);
  }
  apply(id: string): boolean {
    if (!this.canApply(id)) return false;
    const entry = this.#entries.get(id)!;
    if (!this.edits.apply(entry.ticket!, structuredClone(entry.report!))) return false;
    delete entry.ticket;
    return true;
  }
  /** A visible review action may issue a new ticket; polling and recovery never do. */
  review(id: string, inputDigest: string, identity: {documentId: string; tableId: string; nodeId: string}): boolean {
    const entry = this.#entries.get(id);
    if (this.#disposed || !entry || !/^[a-f0-9]{64}$/.test(inputDigest) || entry.reference.inputDigest !== inputDigest ||
      entry.report?.source.inputDigest !== inputDigest ||
      !Object.entries(identity).every(([key,value]) => entry.reference.source[key as keyof GenerationScope] === value)) return false;
    if (entry.ticket) this.edits.release(entry.ticket);
    entry.ticket = this.edits.begin(id, entry.reference.source);
    return this.apply(id);
  }
  invalidate(): void { for (const entry of this.#entries.values()) if (entry.ticket) {this.edits.release(entry.ticket); delete entry.ticket;} }
  dispose(): void { this.invalidate(); this.#disposed = true; this.#entries.clear(); }
}
