interface ResultAsset {
  id?: string;
  reference_id?: string;
  url: string;
  kind: string;
  name?: string;
  provenance?: {requestId?: string};
}
interface ResultReceipt {
  requestId?: string;
  phase?: string;
  result?: ResultAsset;
  source?: {createdAt?: number};
  history?: ResultReceipt[];
}

/** Viewing completed history does not grant permission to write it into current inputs. */
export function videoTaskResultPreviews(saved: readonly ResultAsset[], receipt?: ResultReceipt | null, after = 0): ResultAsset[] {
  const results: ResultAsset[] = [], urls = new Set<string>(), requests = new Set<string>();
  const append = (asset: ResultAsset, requestId?: string) => {
    if (!asset.url || !['image', 'video'].includes(asset.kind) || urls.has(asset.url) || requestId && requests.has(requestId)) return;
    results.push(asset); urls.add(asset.url);
    if (requestId) requests.add(requestId);
  };
  for (const asset of saved) append(asset, asset.provenance?.requestId);
  for (const item of [...(receipt?.history || []), ...(receipt ? [receipt] : [])]) {
    if (item.result && ['complete', 'stale'].includes(item.phase || '') && (!after || (item.source?.createdAt || 0) > after)) {
      const asset = item.result;
      append(item.requestId ? {...asset, id: asset.id || asset.reference_id || item.requestId, provenance: {...asset.provenance, requestId: item.requestId}} : asset, item.requestId);
    }
  }
  return results;
}
