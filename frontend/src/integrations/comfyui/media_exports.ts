import { MediaExportService } from '../../application/media_export_service.js';
import type { MediaExportPort } from '../../contracts/media_exports.js';

/** Only this boundary knows HTTP paths; UI never builds a native execution graph. */
export function createMediaExportHttp(fetcher: (path: string, init?: RequestInit) => Promise<Response>): MediaExportService {
  const prefix = '/daelab/studio/media-exports';
  async function request(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    const response = await fetcher(prefix + path, body === undefined ? {signal} : {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal});
    let value: any; try { value = await response.json(); } catch { throw new Error('导出响应无法读取，请核对原任务；不会自动重新提交'); }
    if (!response.ok) {
      const error = new Error(value?.error?.message || '导出请求失败，请核对原任务') as Error & {preflightRejected?: boolean};
      if (value?.error?.code === 'submission_rejected') error.preflightRejected = true;
      throw error;
    }
    return value;
  }
  const path = (id: string): string => '/' + encodeURIComponent(id);
  const port: MediaExportPort = {
    submit: (body, signal) => request('', signal, body),
    get: (id, signal) => request(path(id), signal),
    cancel: (id, expectedVersion, signal) => request(path(id) + '/cancel', signal, {expectedVersion}),
    recover: (id, signal) => request(path(id) + '/recover', signal, {}),
  };
  return new MediaExportService(port);
}
