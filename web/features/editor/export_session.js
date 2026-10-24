import { exportInputDigest, exportInputStamp, exportTerminal, validExportReference } from '../../application/media_export_service.js';
/** Per-view ledger projection. Disposal stops observation, never the owned backend task. */
export class ExportSession {
    service;
    host;
    pollMs;
    #disposed = false;
    #epoch = 0;
    #abort = new AbortController();
    #timer;
    #reference;
    #report;
    #ticket;
    #busy = false;
    #rejected = false;
    #error;
    #currentDigest;
    #published;
    #digestSequence = 0;
    #lastInputStamp;
    #referenceError;
    constructor(service, host, pollMs = 650) {
        this.service = service;
        this.host = host;
        this.pollMs = pollMs;
    }
    #valid(epoch) { return !this.#disposed && epoch === this.#epoch && this.host.current(); }
    #stop() { this.#epoch++; this.#digestSequence++; this.#abort.abort(); this.#abort = new AbortController(); clearTimeout(this.#timer); this.#timer = undefined; }
    #release() { if (this.#ticket)
        this.host.release(this.#ticket); this.#ticket = undefined; }
    #notify() { if (!this.#disposed && this.host.current())
        this.host.changed(this.view()); }
    view() {
        const report = this.#report, terminal = !!report && exportTerminal(report.state), error = this.#referenceError || this.#error;
        const matches = !!this.#reference && this.#currentDigest === this.#reference.inputDigest;
        return { ...(this.#reference ? { reference: structuredClone(this.#reference) } : {}), ...(report ? { report: structuredClone(report) } : {}),
            busy: this.#busy || !!report && !terminal && !['unknown', 'needs_recovery'].includes(report.state),
            unresolved: !!this.#referenceError || !!this.#reference && (!report && !this.#rejected || !!report && ['unknown', 'needs_recovery'].includes(report.state)), rejected: this.#rejected,
            canCancel: !this.#referenceError && !!report && !terminal && !report.cancelRequested,
            canRecover: !this.#referenceError && !!this.#reference && !this.#busy && (!this.#published || !!this.#error), canReview: !this.#referenceError && matches && report?.state === 'succeeded' && !this.#published,
            ...(this.#published ? { currentOutput: structuredClone(this.#published) } : {}), ...(error ? { error } : {}) };
    }
    async inputChanged() {
        if (this.#disposed || !this.host.current())
            return;
        if (this.#referenceError) {
            this.#notify();
            return;
        }
        const sequence = ++this.#digestSequence;
        try {
            const input = structuredClone(this.host.input()), stamp = exportInputStamp(input);
            if (stamp === this.#lastInputStamp && this.#currentDigest) {
                this.#restoreBinding();
                this.#notify();
                return;
            }
            if (stamp !== this.#lastInputStamp) {
                this.#lastInputStamp = stamp;
                this.#currentDigest = undefined;
                this.#published = undefined;
                this.#notify();
            }
            const digest = await exportInputDigest(input);
            if (this.#disposed || sequence !== this.#digestSequence || !this.host.current() || stamp !== exportInputStamp(this.host.input()))
                return;
            this.#currentDigest = digest;
            this.#restoreBinding();
            this.#notify();
        }
        catch (error) {
            this.#published = undefined;
            this.#currentDigest = undefined;
            this.#error = error.message;
            this.#notify();
        }
    }
    #restoreBinding() {
        this.#published = undefined;
        const saved = this.host.binding(), report = this.#report, ref = this.#reference;
        if (!saved || !report || !ref || report.state !== 'succeeded' || this.#currentDigest !== ref.inputDigest)
            return;
        const expected = this.#binding(report);
        if (exportInputStamp(saved) === exportInputStamp(expected))
            this.#published = structuredClone(saved);
    }
    #binding(report) {
        if (!this.#reference || report.state !== 'succeeded' || !report.output || !report.result?.items[0])
            throw new Error('成片没有可验证回执');
        return { schemaVersion: 1, reference: structuredClone(this.#reference), fingerprint: report.fingerprint,
            asset: structuredClone(report.result.items[0]), output: structuredClone(report.output) };
    }
    #ingest(report) {
        const previous = this.#report;
        if (previous && (report.fingerprint !== previous.fingerprint || report.version < previous.version ||
            report.version === previous.version && exportInputStamp(report) !== exportInputStamp(previous) ||
            exportTerminal(previous.state) && (report.state !== previous.state || exportInputStamp(report.result) !== exportInputStamp(previous.result))))
            throw new Error('导出回执版本倒退，已保留已知事实');
        this.#report = structuredClone(report);
        this.#rejected = false;
        this.#error = undefined;
        this.#restoreBinding();
        if (report.state === 'succeeded' && this.#ticket && this.#currentDigest === this.#reference?.inputDigest && this.host.canApply(this.#ticket)) {
            const binding = this.#binding(report);
            if (this.host.apply(this.#ticket, binding)) {
                this.#published = binding;
                this.#ticket = undefined;
            }
        }
        if (exportTerminal(report.state))
            this.#release();
    }
    #schedule() {
        clearTimeout(this.#timer);
        if (this.#disposed || !this.#reference || !this.#report || exportTerminal(this.#report.state) || ['unknown', 'needs_recovery'].includes(this.#report.state))
            return;
        const epoch = this.#epoch;
        this.#timer = setTimeout(() => { if (this.#valid(epoch))
            void this.refresh(); }, this.pollMs);
    }
    async start() {
        if (this.#disposed || !this.host.current() || this.view().busy || this.view().unresolved)
            return;
        this.#stop();
        this.#release();
        this.#busy = true;
        this.#rejected = false;
        this.#error = undefined;
        this.#notify();
        const epoch = this.#epoch, requestId = crypto.randomUUID();
        try {
            const ticket = this.host.begin(requestId);
            this.#ticket = ticket;
            const input = structuredClone(this.host.input()), inputDigest = await exportInputDigest(input);
            if (!this.#valid(epoch) || !this.host.canApply(ticket)) {
                if (this.#ticket === ticket)
                    this.#release();
                return;
            }
            const reference = { schemaVersion: 1, requestId, inputDigest, source: { ...input.source } };
            this.#reference = reference;
            this.#report = undefined;
            this.#published = undefined;
            this.#currentDigest = inputDigest;
            this.host.saveReference(reference); // Durable request reference exists before a possibly ambiguous POST.
            const report = await this.service.submit(reference, input, this.#abort.signal);
            if (!this.#valid(epoch))
                return;
            this.#ingest(report);
        }
        catch (error) {
            if (this.#valid(epoch)) {
                this.#error = error.message;
                this.#rejected = error.preflightRejected === true;
                if (this.#reference?.requestId !== requestId || this.#rejected)
                    this.#release();
            }
        }
        finally {
            if (this.#valid(epoch)) {
                this.#busy = false;
                this.#notify();
                this.#schedule();
            }
        }
    }
    /** A host snapshot failure must never masquerade as an absent saved request. */
    rejectReference(reason) {
        this.#stop();
        this.#release();
        this.#reference = undefined;
        this.#report = undefined;
        this.#published = undefined;
        this.#currentDigest = undefined;
        this.#lastInputStamp = undefined;
        this.#busy = false;
        this.#rejected = false;
        this.#error = undefined;
        this.#referenceError = `原导出引用无法核对：${reason}。原数据已保留；请修复引用并重新加载，暂不能提交新导出。`;
        this.#notify();
    }
    load(value) {
        this.#stop();
        this.#release();
        this.#reference = undefined;
        this.#referenceError = undefined;
        this.#report = undefined;
        this.#published = undefined;
        this.#busy = false;
        this.#rejected = false;
        this.#error = undefined;
        try {
            if (value !== undefined) {
                if (!validExportReference(value))
                    throw new Error('保存的请求身份格式无效');
                exportInputStamp(value); // Only detached JSON DTOs may enter this session.
                this.#reference = structuredClone(value);
                const owner = this.host.input().source;
                if (owner.documentId !== this.#reference.source.documentId || owner.nodeId !== this.#reference.source.nodeId) {
                    throw new Error('此导出属于另一剪辑实例，未接管原任务');
                }
            }
        }
        catch (error) {
            this.rejectReference(error.message);
            return false;
        }
        void this.inputChanged();
        this.#notify();
        if (this.#reference)
            void this.refresh();
        return true;
    }
    async refresh() { await this.#read('get'); }
    async recover() { await this.#read('recover'); }
    async #read(action) {
        if (!this.#reference || this.#referenceError || this.#disposed || !this.host.current())
            return;
        const epoch = this.#epoch, reference = this.#reference;
        try {
            const report = await this.service[action](reference, this.#abort.signal);
            if (!this.#valid(epoch) || reference !== this.#reference)
                return;
            this.#ingest(report);
        }
        catch (error) {
            if (this.#valid(epoch))
                this.#error = error.message;
        }
        finally {
            if (this.#valid(epoch)) {
                this.#notify();
                this.#schedule();
            }
        }
    }
    async cancel() {
        if (!this.#reference || !this.#report || !this.view().canCancel || this.#disposed || !this.host.current())
            return;
        const epoch = this.#epoch, reference = this.#reference;
        try {
            const report = await this.service.cancel(reference, this.#report.version, this.#abort.signal);
            if (this.#valid(epoch) && reference === this.#reference)
                this.#ingest(report);
        }
        catch (error) {
            if (this.#valid(epoch))
                this.#error = error.message;
        }
        finally {
            if (this.#valid(epoch)) {
                this.#notify();
                this.#schedule();
            }
        }
    }
    async review() {
        const epoch = this.#epoch, reference = this.#reference;
        await this.inputChanged();
        if (!this.#valid(epoch) || reference !== this.#reference || !this.view().canReview || !this.#reference || !this.#report)
            return false;
        this.#release();
        this.#ticket = this.host.begin(this.#reference.requestId);
        this.#ingest(this.#report);
        this.#notify();
        return !!this.#published;
    }
    invalidate() { this.#stop(); this.#release(); this.#published = undefined; this.#currentDigest = undefined; this.#busy = false; this.#notify(); }
    dispose() { this.#stop(); this.#release(); this.#disposed = true; this.#published = undefined; }
}
