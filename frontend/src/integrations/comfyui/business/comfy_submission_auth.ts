interface AuthStore {
  currentUser: unknown;
  getWorkspaceAuthToken(): Promise<string | undefined>;
}

interface ApiKeyStore {
  getApiKey(): string | null;
}

interface WorkspaceStore {
  activeWorkspaceId: string | null;
  workspaceTransitionGeneration: number;
}

interface HostStore {
  _p?: { _s: Map<string, unknown> };
}

export async function comfySubmissionOptions(host: HostStore, options: RequestInit): Promise<RequestInit> {
  const body = typeof options.body === 'string' ? JSON.parse(options.body) : null;
  if (!body?.jobs?.some((job: { input?: { config?: { provider?: string } } }) => job.input?.config?.provider === 'comfy')) return options;

  // extensionManager is the host's workspace Pinia store; auth lives in the same registry.
  const stores = host._p?._s;
  const auth = stores?.get('auth') as AuthStore | undefined;
  const keys = stores?.get('apiKeyAuth') as ApiKeyStore | undefined;
  const workspace = stores?.get('teamWorkspace') as WorkspaceStore | undefined;
  if (!auth?.getWorkspaceAuthToken || !keys?.getApiKey || !workspace) throw new Error('无法读取 ComfyUI 登录状态，请刷新页面后重试');

  const user = auth.currentUser, key = keys.getApiKey();
  const workspaceId = workspace.activeWorkspaceId, generation = workspace.workspaceTransitionGeneration;
  const token = await auth.getWorkspaceAuthToken();
  if (user !== auth.currentUser || key !== keys.getApiKey() || (workspaceId !== null &&
      (workspaceId !== workspace.activeWorkspaceId || generation !== workspace.workspaceTransitionGeneration))) {
    throw new Error('账户或工作区已切换，请重新提交');
  }
  const headers = new Headers(options.headers);
  headers.delete('X-DAELAB-Comfy-Token');
  headers.delete('X-DAELAB-Comfy-Key');
  if (token) headers.set('X-DAELAB-Comfy-Token', token);
  if (key) headers.set('X-DAELAB-Comfy-Key', key);
  return { ...options, headers };
}
