/**
 * Client for the manual model scan: hash reverse-lookup against the known
 * manifest. The scan never applies anything; a separate confirm call writes
 * local-generation.json.
 */

/** @typedef {{family:string,category:string,name:string,path:string,sha256:string}} ModelScanHit */
/** @typedef {{family:string,category:string,name:string,path:string,expectedSha256:string,actualSha256:string,expectedBytes:number,actualBytes:number,sizeMismatch:boolean}} ModelScanConflict */
/** @typedef {{family:string,category:string,name:string}} ModelScanMissing */
/** @typedef {{hits:ModelScanHit[],conflicts:ModelScanConflict[],missing:ModelScanMissing[],suggestedWritten:boolean}} ModelScanResult */

/** @typedef {{family:string,category:string}} ModelScanAdopt */

const generationReports = new Map();

export function getGenerationFileReport(kind) {
  if (!generationReports.has(kind)) {
    const report = fetch('/daelab/studio/model-files?kind=' + encodeURIComponent(kind), {
      signal: AbortSignal.timeout(15000),
    }).then(async response => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const {profiles} = await response.json();
      return Object.entries(profiles);
    }).catch(error => {
      generationReports.delete(kind);
      throw error;
    });
    generationReports.set(kind, report);
  }
  return generationReports.get(kind);
}

/**
 * @param {typeof fetch} [request]
 * @returns {Promise<ModelScanResult>}
 */
export async function scanModels(request = fetch) {
  const response = await request('/daelab/studio/scan-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(300000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `模型扫描失败（HTTP ${response.status}）`);
  }
  return data;
}

/**
 * @param {ModelScanAdopt[]} adoptConflicts
 * @param {typeof fetch} [request]
 * @returns {Promise<{applied:boolean,restartRequired:boolean}>}
 */
export async function applyModels(adoptConflicts, request = fetch) {
  const response = await request('/daelab/studio/apply-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adoptConflicts }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `应用模型配置失败（HTTP ${response.status}）`);
  }
  return data;
}
