export function modelSourceKind(model: {provider?: string} | null): 'local'|'api'|'unknown' {
    if(model?.provider==='local'||model?.provider==='qwen')return 'local';
    if(model?.provider==='comfy'||model?.provider==='deepseek')return 'api';
    return 'unknown';
}
export function modelSourceBadge(model: {provider?: string} | null): string {
    return {local:'本地',api:'API',unknown:'来源未知'}[modelSourceKind(model)];
}
