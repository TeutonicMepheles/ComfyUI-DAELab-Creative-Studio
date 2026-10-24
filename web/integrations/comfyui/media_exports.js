import { MediaExportService } from '../../application/media_export_service.js';
/** Only this boundary knows HTTP paths; UI never builds a native execution graph. */
export function createMediaExportHttp(fetcher) {
    const prefix = '/daelab/studio/media-exports';
    async function request(path, signal, body) {
        const response = await fetcher(prefix + path, body === undefined ? { signal } : {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
        });
        let value;
        try {
            value = await response.json();
        }
        catch {
            throw new Error('导出响应无法读取，请核对原任务；不会自动重新提交');
        }
        if (!response.ok) {
            const error = new Error(value?.error?.message || '导出请求失败，请核对原任务');
            if (value?.error?.code === 'submission_rejected')
                error.preflightRejected = true;
            throw error;
        }
        return value;
    }
    const path = (id) => '/' + encodeURIComponent(id);
    const port = {
        submit: (body, signal) => request('', signal, body),
        get: (id, signal) => request(path(id), signal),
        cancel: (id, expectedVersion, signal) => request(path(id) + '/cancel', signal, { expectedVersion }),
        recover: (id, signal) => request(path(id) + '/recover', signal, {}),
    };
    return new MediaExportService(port);
}
