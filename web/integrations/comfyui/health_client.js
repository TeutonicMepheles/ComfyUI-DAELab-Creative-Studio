import { STUDIO_VERSION, FRONTEND_BUILD_ID } from './index.js';
export async function checkStudioHealth(request = fetch) {
    try {
        const response = await request('/daelab/studio/health', { signal: AbortSignal.timeout(5000) });
        if (response.status === 404)
            return { available: false, reason: 'Creative Studio 后端未加载，请检查重复安装诊断及安装目录。' };
        const data = await response.json();
        if (!response.ok || data.schemaVersion !== 1 || !data.compatible || data.frontendVersion !== STUDIO_VERSION || !data.buildFingerprint || data.frontendBuildId !== FRONTEND_BUILD_ID) {
            return { available: false, reason: 'Creative Studio 前后端版本不一致或构建缺失，请安装同一版本并刷新浏览器缓存。' };
        }
        return { available: true, health: data };
    }
    catch {
        // Do not expose arbitrary remote exception bodies or credentials in diagnostics.
        return { available: false, reason: 'Creative Studio 核心健康检查不可达，请检查本机服务与启动日志。' };
    }
}
