import type { AssetLibraryPort, AssetIdentity, AssetRegistration, FavoriteInput, FavoriteQuery, LegacyFavoriteDocument } from '../contracts/assets.js';

let port: AssetLibraryPort | undefined;
const listeners = new Set<() => void>();

/** Composition injects the server port. This module stores no writable catalog. */
export function bindAssetLibraryService(value: AssetLibraryPort): () => void {
  if (port && port !== value) throw new Error('资产目录服务已由另一实例绑定');
  port = value;
  changed();
  return () => { if (port === value) { port = undefined; changed(); } };
}
function service(): AssetLibraryPort {
  if (!port) throw new Error('资产目录服务尚未接入，未保存收藏');
  return port;
}
function changed(): void {
  for (const listener of listeners) {
    try { listener(); }
    catch { console.error('[Creative Studio] asset-library view refresh failed'); }
  }
}
export function subscribeAssetLibrary(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export const searchFavorites = (query?: FavoriteQuery) => service().search(query);
function checked(receipt: AssetRegistration): AssetRegistration {
  if (!receipt || typeof receipt.assetId !== 'string' || !receipt.assetId || !/^[a-f0-9]{64}$/.test(receipt.contentSha256) || !Number.isSafeInteger(receipt.byteSize) || receipt.byteSize < 1 || receipt.status !== 'available') throw new Error('资产登记响应无效，原数据已保留');
  if (receipt.kind !== 'text' && (!['image', 'video'].includes(receipt.kind) || !receipt.referenceId || receipt.asset?.assetId !== receipt.assetId || receipt.asset?.referenceId !== receipt.referenceId || receipt.asset?.contentSha256 !== receipt.contentSha256 || receipt.asset?.byteSize !== receipt.byteSize)) throw new Error('资产文件身份响应不完整，原数据已保留');
  return receipt;
}
export async function registerAsset(input: FavoriteInput, signal?: AbortSignal) {
  const receipt = checked(await service().register(input, signal));
  if (receipt.kind !== input.kind || input.kind !== 'text' && ['filename', 'subfolder', 'type'].some(key => receipt.asset?.[key as 'filename' | 'subfolder' | 'type'] !== input.asset[key as 'filename' | 'subfolder' | 'type'])) throw new Error('资产登记返回了另一来源，原数据已保留');
  return receipt;
}
export async function resolveAsset(identity: Pick<AssetIdentity, 'assetId' | 'referenceId'>, signal?: AbortSignal) {
  const receipt = checked(await service().resolve(identity, signal));
  if (receipt.assetId !== identity.assetId || receipt.referenceId !== identity.referenceId) throw new Error('资产读取返回了另一身份');
  return receipt;
}
export const lookupFavorite = (input: FavoriteInput, signal?: AbortSignal) => service().lookup(input, signal);
export async function saveFavorite(input: FavoriteInput) { const entry = await service().save(input); changed(); return entry; }
export async function removeFavorite(id: string) { await service().remove(id); changed(); }
export async function importLegacyFavorites(origin: string, document: LegacyFavoriteDocument) {
  const report = await service().importLegacy(origin, document); changed(); return report;
}

/** Per-view async lifetime guard. Cancelling one view never cancels another. */
export function createAssetRequestScope() {
  let sequence = 0, disposed = false, controller: AbortController | undefined;
  return {
    cancel() { ++sequence; controller?.abort(); },
    dispose() { disposed = true; ++sequence; controller?.abort(); },
    async run<T>(operation: (signal: AbortSignal) => Promise<T>, apply: (result: T) => void, error: (error: unknown) => void) {
      if (disposed) return;
      const token = ++sequence;
      controller?.abort(); controller = new AbortController();
      try {
        const result = await operation(controller.signal);
        if (!disposed && token === sequence) apply(result);
      } catch (cause) { if (!disposed && token === sequence && !(cause instanceof DOMException && cause.name === 'AbortError')) error(cause); }
    },
  };
}
