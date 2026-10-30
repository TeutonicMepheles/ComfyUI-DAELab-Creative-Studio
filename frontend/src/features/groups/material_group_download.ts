export interface GroupDownloadItem { name: string; url?: string; text?: string }
const encoder = new TextEncoder();
export function safeDownloadName(name: string): string {
    return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 160) || '素材';
}
const crcTable = Uint32Array.from({length: 256}, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!;
    return (crc ^ 0xffffffff) >>> 0;
}
// Stored ZIP entries preserve original media bytes without recompression.
export async function createGroupArchive(items: readonly GroupDownloadItem[], fetcher: typeof fetch = fetch): Promise<Blob> {
    if (!items.length) throw new Error('素材组为空');
    if (items.length > 65535) throw new Error('素材数量超出 ZIP 支持范围');
    const parts: BlobPart[] = [], directory: Uint8Array<ArrayBuffer>[] = [];
    let offset = 0;
    for (const [index, item] of items.entries()) {
        let bytes: Uint8Array<ArrayBuffer>;
        if (item.text !== undefined) bytes = encoder.encode(item.text);
        else {
            if (!item.url) throw new Error(`素材缺少文件：${item.name}`);
            const response = await fetcher(item.url);
            if (!response.ok) throw new Error(`下载失败：${item.name}（${response.status}）`);
            bytes = new Uint8Array(await response.arrayBuffer());
        }
        const name = encoder.encode(`${String(index + 1).padStart(3, '0')}_${safeDownloadName(item.name)}`);
        if (offset + bytes.length + name.length + 30 >= 0xffffffff) throw new Error('整组文件过大，暂不支持 4GB 及以上 ZIP');
        const crc = crc32(bytes), local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
        l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true);
        l.setUint16(12, 33, true); l.setUint32(14, crc, true); l.setUint32(18, bytes.length, true); l.setUint32(22, bytes.length, true); l.setUint16(26, name.length, true); local.set(name, 30);
        const central = new Uint8Array(46 + name.length), c = new DataView(central.buffer);
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(14, 33, true);
        c.setUint32(16, crc, true); c.setUint32(20, bytes.length, true); c.setUint32(24, bytes.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true); central.set(name, 46);
        parts.push(local, bytes); directory.push(central); offset += local.length + bytes.length;
    }
    const size = directory.reduce((sum, entry) => sum + entry.length, 0);
    if (offset + size >= 0xffffffff) throw new Error('整组文件过大，暂不支持 4GB 及以上 ZIP');
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, items.length, true); e.setUint16(10, items.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
    return new Blob([...parts, ...directory, end], {type: 'application/zip'});
}
