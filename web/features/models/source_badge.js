export function modelSourceBadge(model) {
    if (model?.provider === 'local' || model?.provider === 'qwen')
        return '本地';
    if (model?.provider === 'comfy' || model?.provider === 'deepseek')
        return 'API';
    return '来源未知';
}
