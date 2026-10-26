import { bindBusinessService, BusinessCapabilityUnavailable } from '../../../contracts/business.js';
/** Six implemented backend routes. Arbitrary provider/generation paths cannot pass this adapter. */
const STORYBOARD_ROUTES = new Map([
    ['import_document', 'POST'], ['import_document?preview=1', 'POST'], ['parse-prompts', 'POST'],
]);
const SCRIPT_ROUTES = new Map([
    ['document', 'POST'], ['normalize', 'POST'], ['classify', 'POST'], ['ai-status', 'GET'],
]);
function service(fetchApi, prefix, routes, capabilities = false) {
    return {
        async request(action, options) {
            const url = new URL(action, 'http://local.invalid/');
            let validQuery = true;
            url.searchParams.forEach((_value, key) => { if (key !== 'model' && key !== 'kind')
                validQuery = false; });
            const capability = capabilities && /^capabilities(?:\?|$)/.test(action) && url.pathname === '/capabilities' && !url.hash && validQuery;
            const method = capability ? 'GET' : routes.get(action);
            if (!method || (options.method ?? 'GET').toUpperCase() !== method) {
                throw new BusinessCapabilityUnavailable('unsupported-route');
            }
            // FormData, abort signals and old JSON DTOs stay byte/object identical.
            // Classify returns backend 503 when no explicit classifier is installed.
            return fetchApi(prefix + action, options);
        },
    };
}
const GENERATION_ROUTES = new Map(['submit', 'status', 'recover', 'cancel', 'pause', 'retry-local', 'reconcile-resource', 'fence-unsubmitted'].map(action => [action, 'POST']));
const OPTIMIZATION_ROUTES = new Map(['polish', 'capabilities', 'estimate', 'lease', 'submit', 'query', 'recover', 'permit', 'advance', 'stop', 'continue', 'skip', 'fence'].map(action => [action, 'POST']));
/** Explicit assembly only. A test namespace never becomes an automatic fallback. */
export function bindGenerationHttp(fetchApi, { prefix = '' } = {}) {
    if (prefix && (!/^\/[a-zA-Z0-9/_-]+$/.test(prefix) || prefix.endsWith('/') || prefix.includes('//')))
        throw new Error('Invalid service prefix');
    const removeGeneration = bindBusinessService('generation', service(fetchApi, prefix + '/daelab/studio/generation/', GENERATION_ROUTES, true));
    const removeOptimization = bindBusinessService('optimization', service(fetchApi, prefix + '/daelab/prompt-optimization/', OPTIMIZATION_ROUTES));
    return () => { removeGeneration(); removeOptimization(); };
}
export function bindBusinessHttp(fetchApi) {
    const removeStoryboard = bindBusinessService('storyboard', service(fetchApi, '/daelab/storyboard/', STORYBOARD_ROUTES));
    const removeScript = bindBusinessService('script', service(fetchApi, '/daelab/script-parser/', SCRIPT_ROUTES));
    const removeGeneration = bindGenerationHttp(fetchApi);
    return () => { removeStoryboard(); removeScript(); removeGeneration(); };
}
