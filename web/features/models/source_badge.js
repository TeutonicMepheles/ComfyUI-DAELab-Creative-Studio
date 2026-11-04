export function modelSourceKind(model) {
    if (model?.provider === 'local' || model?.provider === 'qwen')
        return 'local';
    if (model?.provider === 'comfy' || model?.provider === 'deepseek')
        return 'api';
    return 'unknown';
}
export function modelSourceBadge(model) {
    return { local: '本地', api: 'API', unknown: '来源未知' }[modelSourceKind(model)];
}
