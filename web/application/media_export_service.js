export const exportTerminal = (state) => ['succeeded', 'failed', 'cancelled'].includes(state);
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
/** The browser digest is an opaque immutable correlation field, not the server's content hash. */
export function exportInputStamp(value) {
    function canonical(item) {
        if (typeof item === 'number' && !Number.isFinite(item))
            throw new Error('剪辑参数必须是有限数字');
        if (Array.isArray(item))
            return item.map(canonical);
        if (object(item))
            return Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, canonical(item[key])]));
        if (item === null || ['string', 'number', 'boolean'].includes(typeof item))
            return item;
        throw new Error('剪辑输入不是有效 JSON');
    }
    return JSON.stringify(canonical(value));
}
export async function exportInputDigest(input) {
    // Parse to reject malformed edit JSON; retain exact serialized edit data in the digest.
    exportInputStamp(JSON.parse(input.edit_data));
    const bytes = new TextEncoder().encode(exportInputStamp(input));
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function validExportReference(value) {
    return object(value) && value.schemaVersion === 1 && typeof value.requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,255}$/.test(value.requestId) &&
        sha(value.inputDigest) && object(value.source) && typeof value.source.documentId === 'string' && !!value.source.documentId && typeof value.source.nodeId === 'string' && !!value.source.nodeId;
}
export function checkedExportReport(value, reference) {
    if (!object(value) || value.schemaVersion !== 1 || value.requestId !== reference.requestId || !Number.isSafeInteger(value.version) || value.version < 0 ||
        !['pending', 'submitting', 'submitted', 'running', 'fetching', 'succeeded', 'failed', 'needs_recovery', 'unknown', 'cancelled'].includes(value.state) ||
        !sha(value.fingerprint) || !sha(value.editFingerprint) || !object(value.source) || value.source.operation !== 'video_export' ||
        value.source.documentId !== reference.source.documentId || value.source.nodeId !== reference.source.nodeId || value.source.inputDigest !== reference.inputDigest ||
        !object(value.native) || typeof value.native.promptId !== 'string' || typeof value.native.nodeId !== 'string')
        throw new Error('导出回执与原请求身份不一致，已拒绝应用');
    if (value.state === 'succeeded') {
        const output = value.output, receipt = value.result;
        if (!object(output) || output.type !== 'output' || typeof output.filename !== 'string' || !output.filename || /[\\/:]/.test(output.filename) ||
            typeof output.subfolder !== 'string' || /[\\:]/.test(output.subfolder) || output.subfolder.startsWith('/') || output.subfolder.split('/').some((part) => part === '..') ||
            !object(receipt) || receipt.kind !== 'assets' || !Array.isArray(receipt.items) || receipt.items.length !== 1 ||
            !receipt.items.every((item) => object(item) && typeof item.asset_id === 'string' && !!item.asset_id && typeof item.reference_id === 'string' && !!item.reference_id && sha(item.sha256) && Number.isSafeInteger(item.bytes) && item.bytes > 0))
            throw new Error('导出成片缺少完整资产回执');
    }
    else if (value.output !== null)
        throw new Error('导出尚未成功，不接受成片引用');
    return structuredClone(value);
}
export class MediaExportService {
    port;
    constructor(port) {
        this.port = port;
    }
    async submit(reference, input, signal) {
        const captured = structuredClone(input), expected = structuredClone(reference);
        if (!validExportReference(expected) || captured.source.documentId !== expected.source.documentId || captured.source.nodeId !== expected.source.nodeId ||
            await exportInputDigest(captured) !== expected.inputDigest)
            throw new Error('导出提交与已确认输入快照不一致');
        return checkedExportReport(await this.port.submit({ requestId: expected.requestId, edit_data: captured.edit_data, connections: captured.connections,
            source: { ...expected.source, inputDigest: expected.inputDigest } }, signal), expected);
    }
    async get(reference, signal) { return checkedExportReport(await this.port.get(reference.requestId, signal), reference); }
    async cancel(reference, expectedVersion, signal) { return checkedExportReport(await this.port.cancel(reference.requestId, expectedVersion, signal), reference); }
    async recover(reference, signal) { return checkedExportReport(await this.port.recover(reference.requestId, signal), reference); }
}
