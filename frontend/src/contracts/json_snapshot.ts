/** Detach workflow JSON, including nested reactive proxies, without schema filtering.
 * Undefined follows native JSON save semantics (omitted object fields/null array
 * entries). Invalid numbers and unsupported values fail before a native edit.
 * This is a temporary value snapshot, never another writable document owner.
 */
function encodeJsonSnapshot(value: unknown): string {
  return JSON.stringify(value, (_key: string, item: unknown): unknown => {
    if (typeof item === 'number' && !Number.isFinite(item) ||
        typeof item === 'bigint' || typeof item === 'function' || typeof item === 'symbol') {
      throw new TypeError('编辑数据包含不可保存的 JSON 值');
    }
    return item;
  });
}

export function snapshotJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(encodeJsonSnapshot(value)) as T;
}

/** One native read boundary, with separately owned rollback and preparation data.
 * The encoded value lives only for this call. None of the parsed copies alias;
 * callers must retain rollback privately and validate the prepared draft again.
 */
export function snapshotJsonForPreparation<T>(value: T): { rollback: T; previous: T; draft: T } {
  if (value === undefined) return { rollback: value, previous: value, draft: value };
  const encoded = encodeJsonSnapshot(value);
  return {
    rollback: JSON.parse(encoded) as T,
    previous: JSON.parse(encoded) as T,
    draft: JSON.parse(encoded) as T,
  };
}
