export async function comfyAccountAuth(host, required = false) {
    // extensionManager is the host's workspace Pinia store; auth lives in the same registry.
    const stores = host._p?._s;
    const auth = stores?.get('auth');
    const keys = stores?.get('apiKeyAuth');
    const workspace = stores?.get('teamWorkspace');
    if (!auth?.getWorkspaceAuthToken || !keys?.getApiKey || !workspace)
        throw new Error('无法读取 ComfyUI 登录状态，请刷新页面后重试');
    const user = auth.currentUser, key = keys.getApiKey();
    const workspaceId = workspace.activeWorkspaceId, generation = workspace.workspaceTransitionGeneration;
    const token = await auth.getWorkspaceAuthToken();
    const assertCurrent = () => {
        if (user !== auth.currentUser || key !== keys.getApiKey() || (workspaceId !== null &&
            (workspaceId !== workspace.activeWorkspaceId || generation !== workspace.workspaceTransitionGeneration))) {
            throw new Error('账户或工作区已切换，请重新提交');
        }
    };
    assertCurrent();
    if (required && !token && !key)
        throw new Error('请先登录 ComfyUI 账户，GPT 优化使用 Comfy 积分');
    const headers = {};
    if (token)
        headers.Authorization = `Bearer ${token}`;
    else if (key)
        headers['X-API-Key'] = key;
    return { headers, assertCurrent, token, key };
}
export async function comfySubmissionOptions(host, options) {
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : null;
    if (!body?.jobs?.some((job) => job.input?.config?.provider === 'comfy'))
        return options;
    const { token, key } = await comfyAccountAuth(host);
    const headers = new Headers(options.headers);
    headers.delete('X-DAELAB-Comfy-Token');
    headers.delete('X-DAELAB-Comfy-Key');
    if (token)
        headers.set('X-DAELAB-Comfy-Token', token);
    if (key)
        headers.set('X-DAELAB-Comfy-Key', key);
    return { ...options, headers };
}
