const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export async function generationInputDigest(input) {
    const bytes = new TextEncoder().encode(JSON.stringify(input));
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
/** Read-only ledger projections and issued edit capabilities; never an alternate task ledger. */
export class GenerationSession {
    edits;
    #entries = new Map();
    #disposed = false;
    constructor(edits) {
        this.edits = edits;
    }
    watch(reference, ticket) {
        if (this.#disposed)
            return;
        const previous = this.#entries.get(reference.requestId);
        if (previous && !same(previous.reference, reference))
            throw new Error('任务引用身份发生冲突');
        if (previous && !ticket)
            return;
        if (previous?.ticket && previous.ticket !== ticket)
            this.edits.release(previous.ticket);
        this.#entries.set(reference.requestId, { reference: structuredClone(reference), ...(previous?.report ? { report: previous.report } : {}), ...(ticket ? { ticket } : {}) });
    }
    ingest(report) {
        const entry = this.#entries.get(report.requestId);
        if (this.#disposed || !entry || !same(entry.reference.source, report.source) ||
            !Number.isSafeInteger(report.version) || report.version < 0 || !/^[a-f0-9]{64}$/.test(report.inputFingerprint))
            return false;
        if (entry.report && (report.inputFingerprint !== entry.report.inputFingerprint || report.version < entry.report.version ||
            report.version === entry.report.version && report.phase === 'complete' && entry.report.phase === 'complete' && !same(report.receipt, entry.report.receipt)))
            return false;
        entry.report = structuredClone(report);
        return true;
    }
    report(id) { const report = this.#entries.get(id)?.report; return report && structuredClone(report); }
    canReplace(id) {
        const entry = this.#entries.get(id), report = entry?.report;
        return !!entry && report?.replacementAllowed === true && report.state === 'cancelled' &&
            /^[a-f0-9]{64}$/.test(entry.reference.inputDigest) && report.source.inputDigest === entry.reference.inputDigest;
    }
    canApply(id) {
        const entry = this.#entries.get(id), report = entry?.report;
        const result = report?.result;
        const receipt = report?.receipt;
        return !this.#disposed && !!entry?.ticket && this.edits.current(entry.ticket) && report?.state === 'succeeded' && report.phase === 'complete' &&
            !!result?.url?.startsWith('/view?') && receipt?.kind === 'assets' && ['image', 'video'].includes(result.kind ?? '') &&
            !!receipt?.items?.some(item => item.asset_id === result.asset_id && item.reference_id === result.reference_id && !!item.asset_id && !!item.reference_id);
    }
    apply(id) {
        if (!this.canApply(id))
            return false;
        const entry = this.#entries.get(id);
        if (!this.edits.apply(entry.ticket, structuredClone(entry.report)))
            return false;
        delete entry.ticket;
        return true;
    }
    /** A visible review action may issue a new ticket; polling and recovery never do. */
    review(id, inputDigest, identity) {
        const entry = this.#entries.get(id);
        if (this.#disposed || !entry || !/^[a-f0-9]{64}$/.test(inputDigest) || entry.reference.inputDigest !== inputDigest ||
            entry.report?.source.inputDigest !== inputDigest ||
            !Object.entries(identity).every(([key, value]) => entry.reference.source[key] === value))
            return false;
        if (entry.ticket)
            this.edits.release(entry.ticket);
        entry.ticket = this.edits.begin(id, entry.reference.source);
        return this.apply(id);
    }
    invalidate() { for (const entry of this.#entries.values())
        if (entry.ticket) {
            this.edits.release(entry.ticket);
            delete entry.ticket;
        } }
    dispose() { this.invalidate(); this.#disposed = true; this.#entries.clear(); }
}
