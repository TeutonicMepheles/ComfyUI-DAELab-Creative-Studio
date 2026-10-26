export class BusinessCapabilityUnavailable extends Error {
    capability;
    code = 'business-capability-unavailable';
    preflightRejected = true;
    constructor(capability) {
        super(`创作工作室尚未接入 ${capability} 服务，未提交操作。`);
        this.capability = capability;
        this.name = 'BusinessCapabilityUnavailable';
    }
}
let host;
const services = new Map();
let auth;
/** Composition owns these capabilities; no workflow data is cached here. */
export function installBusinessHost(port) {
    host = port;
    return () => { if (host === port)
        host = undefined; };
}
export function businessHost() {
    if (!host)
        throw new BusinessCapabilityUnavailable('host/history');
    return host;
}
export function bindBusinessService(domain, service) {
    const bindings = services.get(domain) ?? [];
    const binding = { service, active: true };
    bindings.push(binding);
    services.set(domain, bindings);
    return () => {
        binding.active = false;
        while (bindings.length && !bindings.at(-1).active)
            bindings.pop();
        if (!bindings.length && services.get(domain) === bindings)
            services.delete(domain);
    };
}
export function bindBusinessAuth(provider) {
    auth = provider;
    return () => { if (auth === provider)
        auth = undefined; };
}
export async function businessAuth(required = false) {
    if (auth)
        return auth(required);
    if (required)
        throw new BusinessCapabilityUnavailable('provider-auth');
    return {};
}
export async function businessRequest(domain, action, options = {}) {
    const service = services.get(domain)?.at(-1)?.service;
    if (!service)
        throw new BusinessCapabilityUnavailable(domain);
    return service.request(action, options);
}
export function assertBusinessService(domain) {
    if (!services.has(domain))
        throw new BusinessCapabilityUnavailable(domain);
}
/** Transitional DTO adapter. It cannot discover/fall back to an old package service. */
export async function businessFetch(url, options = {}) {
    const routes = [
        ['/daelab/storyboard/', 'storyboard'], ['/daelab/script-parser/', 'script'],
        ['/daelab/prompt-optimization/', 'optimization'],
        ['/daelab/studio/generation/', 'generation'],
    ];
    for (const [prefix, domain] of routes)
        if (url.startsWith(prefix))
            return businessRequest(domain, url.slice(prefix.length), options);
    if (url === '/upload/image' || url.startsWith('/view?') || /^data:image\/(png|jpeg|webp);base64,/.test(url))
        return businessHost().fetchNative(url, options);
    throw new BusinessCapabilityUnavailable('unsupported-route');
}
export class BusinessRequestError extends Error {
    status;
    code;
    originalTaskMayExist;
    preflightRejected;
    constructor(message, status, code, originalTaskMayExist) {
        super(message);
        this.status = status;
        this.code = code;
        this.originalTaskMayExist = originalTaskMayExist;
        this.name = 'BusinessRequestError';
        this.preflightRejected = !originalTaskMayExist;
    }
}
/** One response boundary: an HTTP error is never evidence that no task exists. */
export async function businessJson(domain, action, payload, signal) {
    const response = await businessRequest(domain, action, {
        method: payload === undefined ? 'GET' : 'POST',
        ...(payload === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
        ...(signal ? { signal } : {}),
    });
    let data;
    try {
        data = await response.json();
    }
    catch {
        throw new BusinessRequestError('服务响应无效；请查询原请求，不要自动重新提交', response.status, 'invalid-response', true);
    }
    if (!response.ok)
        throw new BusinessRequestError(String(data.error || '服务暂不可用；请查询原请求'), response.status, String(data.code || 'request-failed'), data.originalTaskMayExist !== false);
    return data;
}
export const generationPort = {
    submit: (jobs) => businessJson('generation', 'submit', { contractVersion: 1, jobs }),
    status: (requestIds) => businessJson('generation', 'status', { contractVersion: 1, requestIds }),
    recover: (requestIds) => businessJson('generation', 'recover', { contractVersion: 1, requestIds }),
    fenceUnsubmitted: (requestId, source, inputDigest, model) => businessJson('generation', 'fence-unsubmitted', { contractVersion: 1, requestId, source, inputDigest, model }),
    pause: (requestIds) => businessJson('generation', 'pause', { contractVersion: 1, requestIds }),
    retryLocal: (requestId, newRequestId) => businessJson('generation', 'retry-local', { contractVersion: 1, requestId, newRequestId }),
};
