/** Detach workflow JSON, including nested reactive proxies, without schema filtering.
 * Undefined follows native JSON save semantics (omitted object fields/null array
 * entries). Invalid numbers and unsupported values fail before a native edit.
 * This is a temporary value snapshot, never another writable document owner.
 */
export function snapshotJson(value) {
    if (value === undefined)
        return value;
    const encoded = JSON.stringify(value, (_key, item) => {
        if (typeof item === 'number' && !Number.isFinite(item) ||
            typeof item === 'bigint' || typeof item === 'function' || typeof item === 'symbol') {
            throw new TypeError('编辑数据包含不可保存的 JSON 值');
        }
        return item;
    });
    return JSON.parse(encoded);
}
