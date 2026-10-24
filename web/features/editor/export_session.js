import { exportInputDigest, exportInputStamp, exportTerminal, validExportReference } from '../../application/media_export_service.js';
const sameOwner = (a, b) => a.documentId === b.documentId && a.nodeId === b.nodeId;
function checkedSavedBinding(value, reference) {
    exportInputStamp(value);
    const asset = value?.asset, output = value?.output;
    if (value?.schemaVersion !== 1 || !validExportReference(value.reference) || exportInputStamp(value.reference) !== exportInputStamp(reference) ||
        typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint) ||
        !asset || typeof asset.asset_id !== 'string' || !asset.asset_id || typeof asset.reference_id !== 'string' || !asset.reference_id ||
        typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 ||
        !output || output.type !== 'output' || typeof output.filename !== 'string' || !output.filename || /[\\/:]/.test(output.filename) ||
        typeof output.subfolder !== 'string' || /[\\:]/.test(output.subfolder) || output.subfolder.startsWith('/') || output.subfolder.split('/').includes('..')) {
        throw new Error('副本的成片绑定与原导出引用不完整或不一致');
    }
    return structuredClone(value);
}
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
    #owner;
    #copied = false;
    #copyReadable = false;
    #copyInvalid = false;
    #copiedOutput;
    constructor(service, host, pollMs = 650) {
        this.service = service;
        this.host = host;
        this.pollMs = pollMs;
    }
    #hostOwner() { return this.host.owner?.() ?? this.host.input().source; }
    #valid(epoch) {
        if (this.#disposed || epoch !== this.#epoch || !this.host.current())
            return false;
        try {
            return !this.#owner || sameOwner(this.#owner, this.#hostOwner());
        }
        catch {
            return false;
        }
    }
    #stop() { this.#epoch++; this.#digestSequence++; this.#abort.abort(); this.#abort = new AbortController(); clearTimeout(this.#timer); this.#timer = undefined; }
    #release() { if (this.#ticket)
        this.host.release(this.#ticket); this.#ticket = undefined; }
    #notify() { if (this.#valid(this.#epoch))
        this.host.changed(this.view()); }
    view() {
        const report = this.#report, terminal = !!report && exportTerminal(report.state), error = this.#referenceError || this.#error;
        const matches = !!this.#reference && this.#currentDigest === this.#reference.inputDigest;
        return { ...(this.#reference ? { reference: structuredClone(this.#reference) } : {}), ...(report ? { report: structuredClone(report) } : {}),
            busy: this.#busy || !this.#copied && !!report && !terminal && !['unknown', 'needs_recovery'].includes(report.state),
            unresolved: !!this.#referenceError || !!this.#reference && (!report && !this.#rejected || !!report && ['unknown', 'needs_recovery'].includes(report.state)), rejected: this.#rejected,
            canCancel: !this.#copied && !this.#referenceError && !!report && !terminal && !report.cancelRequested,
            canRecover: !this.#copied && !this.#referenceError && !!this.#reference && !this.#busy && (!this.#published || !!this.#error), canReview: !this.#copied && !this.#referenceError && matches && report?.state === 'succeeded' && !this.#published,
            copied: this.#copied, canExportCopy: this.#copied && !this.#referenceError && !this.#copyInvalid && !this.#busy && this.#valid(this.#epoch),
            ...(this.#published ? { currentOutput: structuredClone(this.#published) } : {}), ...(this.#copiedOutput ? { copiedOutput: structuredClone(this.#copiedOutput) } : {}), ...(error ? { error } : {}) };
    }
    async inputChanged() {
        if (!this.#valid(this.#epoch))
            return;
        if (this.#referenceError) {
            this.#notify();
            return;
        }
        const sequence = ++this.#digestSequence, epoch = this.#epoch;
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
                this.#copiedOutput = undefined;
                this.#notify();
            }
            // A copy can display only the exact original edit/connections. Replacing
            // source here is a comparison against the old digest, never a new claim.
            const digest = await exportInputDigest(this.#copied && this.#reference ? { ...input, source: { ...this.#reference.source } } : input);
            if (!this.#valid(epoch) || sequence !== this.#digestSequence || stamp !== exportInputStamp(this.host.input()))
                return;
            this.#currentDigest = digest;
            this.#restoreBinding();
            this.#notify();
        }
        catch (error) {
            if (!this.#valid(epoch) || sequence !== this.#digestSequence)
                return;
            this.#published = undefined;
            this.#copiedOutput = undefined;
            this.#currentDigest = undefined;
            this.#error = error.message;
            this.#notify();
        }
    }
    #restoreBinding() {
        this.#published = undefined;
        this.#copiedOutput = undefined;
        const saved = this.host.binding(), report = this.#report, ref = this.#reference;
        if (this.#copied && this.#copyReadable && ref) {
            try {
                checkedSavedBinding(saved, ref);
                if (report && exportInputStamp(saved) !== exportInputStamp(this.#binding(report)))
                    throw new Error('副本成片绑定已改变，原数据保留但暂不能使用');
            }
            catch (error) {
                this.#copyInvalid = true;
                this.#error = error.message;
                return;
            }
        }
        if (!saved || !report || !ref || report.state !== 'succeeded' || this.#currentDigest !== ref.inputDigest)
            return;
        const expected = this.#binding(report);
        if (exportInputStamp(saved) === exportInputStamp(expected)) {
            if (this.#copied && !this.#copyInvalid)
                this.#copiedOutput = structuredClone(saved);
            else if (!this.#copied)
                this.#published = structuredClone(saved);
        }
    }
    #binding(report) {
        if (!this.#reference || report.state !== 'succeeded' || !report.output || !report.result?.items[0])
            throw new Error('成片没有可验证回执');
        return { schemaVersion: 1, reference: structuredClone(this.#reference), fingerprint: report.fingerprint,
            asset: structuredClone(report.result.items[0]), output: structuredClone(report.output) };
    }
    #ingest(report) {
        if (this.#copied && (report.state !== 'succeeded' || exportInputStamp(this.host.binding()) !== exportInputStamp(this.#binding(report)))) {
            throw new Error('副本绑定未通过原任务的成功回执核验；原数据已保留');
        }
        const previous = this.#report;
        if (previous && (report.fingerprint !== previous.fingerprint || report.version < previous.version ||
            report.version === previous.version && exportInputStamp(report) !== exportInputStamp(previous) ||
            exportTerminal(previous.state) && (report.state !== previous.state || exportInputStamp(report.result) !== exportInputStamp(previous.result))))
            throw new Error('导出回执版本倒退，已保留已知事实');
        this.#report = structuredClone(report);
        this.#rejected = false;
        this.#error = undefined;
        this.#restoreBinding();
        if (!this.#copied && report.state === 'succeeded' && this.#ticket && this.#currentDigest === this.#reference?.inputDigest && this.host.canApply(this.#ticket)) {
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
        if (this.#copied || this.#disposed || !this.#reference || !this.#report || exportTerminal(this.#report.state) || ['unknown', 'needs_recovery'].includes(this.#report.state))
            return;
        const epoch = this.#epoch;
        this.#timer = setTimeout(() => { if (this.#valid(epoch))
            void this.refresh(); }, this.pollMs);
    }
    async start() {
        if (this.#copied)
            return;
        await this.#start(false);
    }
    /** Only the explicit copy action may establish a new owner's submission intent. */
    async startCopy() {
        await this.inputChanged();
        if (!this.view().canExportCopy)
            return;
        await this.#start(true);
    }
    async #start(copy) {
        if (!this.#valid(this.#epoch) || this.view().busy || (!copy && this.view().unresolved))
            return;
        this.#stop();
        this.#release();
        this.#busy = true;
        this.#rejected = false;
        this.#error = undefined;
        this.#notify();
        const epoch = this.#epoch, requestId = crypto.randomUUID();
        try {
            this.#owner = { ...this.#hostOwner() };
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
            this.#copiedOutput = undefined;
            this.#currentDigest = inputDigest;
            this.#copied = false;
            this.#copyReadable = false;
            this.#copyInvalid = false;
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
        this.#copiedOutput = undefined;
        this.#copied = false;
        this.#copyReadable = false;
        this.#copyInvalid = true;
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
        this.#copiedOutput = undefined;
        this.#currentDigest = undefined;
        this.#lastInputStamp = undefined;
        this.#copied = false;
        this.#copyReadable = false;
        this.#copyInvalid = false;
        try {
            this.#owner = { ...this.#hostOwner() };
            if (value !== undefined) {
                if (!validExportReference(value))
                    throw new Error('保存的请求身份格式无效');
                exportInputStamp(value); // Only detached JSON DTOs may enter this session.
                this.#reference = structuredClone(value);
                this.#copied = !sameOwner(this.#owner, this.#reference.source);
                if (this.#copied) {
                    const binding = this.host.binding();
                    if (binding !== undefined) {
                        checkedSavedBinding(binding, this.#reference);
                        this.#copyReadable = true;
                    }
                    else
                        this.#error = '副本仅保留原任务引用，没有可核验的成片绑定；不会查询或接管原任务。';
                }
            }
        }
        catch (error) {
            this.rejectReference(error.message);
            return false;
        }
        void this.inputChanged();
        this.#notify();
        if (this.#reference && (!this.#copied || this.#copyReadable))
            void this.refresh();
        return true;
    }
    async refresh() { await this.#read('get'); }
    async recover() { await this.#read('recover'); }
    async #read(action) {
        if (!this.#reference || this.#referenceError || !this.#valid(this.#epoch) || this.#copied && (action !== 'get' || !this.#copyReadable || this.#copyInvalid))
            return;
        const epoch = this.#epoch, reference = this.#reference;
        if (this.#copied) {
            this.#busy = true;
            this.#notify();
        }
        try {
            const report = await this.service[action](reference, this.#abort.signal);
            if (!this.#valid(epoch) || reference !== this.#reference)
                return;
            await this.inputChanged();
            if (!this.#valid(epoch) || reference !== this.#reference)
                return;
            this.#ingest(report);
        }
        catch (error) {
            if (this.#valid(epoch)) {
                this.#error = error.message;
                if (this.#copied) {
                    this.#copyInvalid = true;
                    this.#copiedOutput = undefined;
                }
            }
        }
        finally {
            if (this.#valid(epoch)) {
                if (this.#copied)
                    this.#busy = false;
                this.#notify();
                this.#schedule();
            }
        }
    }
    async cancel() {
        if (!this.#reference || !this.#report || !this.view().canCancel || !this.#valid(this.#epoch))
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
    invalidate() { this.#stop(); this.#release(); this.#published = undefined; this.#copiedOutput = undefined; this.#currentDigest = undefined; this.#busy = false; this.#notify(); }
    dispose() { this.#stop(); this.#release(); this.#disposed = true; this.#published = undefined; this.#copiedOutput = undefined; }
}
