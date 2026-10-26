import {inputSnapshot, API_KEY} from './creative_contract.mjs';
export {inputSnapshot};

export function publishInputExchange(target = globalThis) {
    const api = target[API_KEY];
    if (api?.version !== 1 || typeof api.registerAdapter !== 'function') throw new Error('Creative Canvas API v1 must be published first');
    target[API_KEY] = Object.freeze({...api, inputSnapshot});
    target.dispatchEvent?.(new Event('daelab:creative-canvas-ready'));
}
