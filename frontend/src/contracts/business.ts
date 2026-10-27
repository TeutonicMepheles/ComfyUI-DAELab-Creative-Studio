import type { CanvasGraph, CanvasHistoryPort, CanvasNode } from './canvas_host.js';

export type BusinessDomain = 'storyboard' | 'script' | 'optimization' | 'generation';
export interface BusinessAuth { headers?: Record<string, string>; assertCurrent?: () => void }
export interface BusinessHostPort {
  readonly history: CanvasHistoryPort;
  nodes(graph: CanvasGraph): readonly CanvasNode[];
  createNode(type: string): CanvasNode | null | undefined;
  addNode(graph: CanvasGraph, node: CanvasNode): void;
  focusNode(node: CanvasNode): void;
  placeNode?(node: CanvasNode, position: {x: number; y: number; width: number}): void;
  isSelected(node: CanvasNode): boolean;
  fetchNative(url: string, options?: RequestInit): Promise<Response>;
}
export interface BusinessServicePort {
  /** Existing domain DTOs are preserved. The bound service owns execution and its durable ledger. */
  request(action: string, options: RequestInit): Promise<Response>;
}
export class BusinessCapabilityUnavailable extends Error {
  readonly code = 'business-capability-unavailable';
  readonly preflightRejected = true;
  constructor(readonly capability: string) {
    super(`创作工作室尚未接入 ${capability} 服务，未提交操作。`);
    this.name = 'BusinessCapabilityUnavailable';
  }
}
let host: BusinessHostPort | undefined;
const services = new Map<BusinessDomain, { service: BusinessServicePort; active: boolean }[]>();
let auth: ((required: boolean) => Promise<BusinessAuth>) | undefined;

/** Composition owns these capabilities; no workflow data is cached here. */
export function installBusinessHost(port: BusinessHostPort): () => void {
  host = port;
  return () => { if (host === port) host = undefined; };
}
export function businessHost(): BusinessHostPort {
  if (!host) throw new BusinessCapabilityUnavailable('host/history');
  return host;
}
export function bindBusinessService(domain: BusinessDomain, service: BusinessServicePort): () => void {
  const bindings = services.get(domain) ?? [];
  const binding = { service, active: true };
  bindings.push(binding); services.set(domain, bindings);
  return () => {
    binding.active = false;
    while (bindings.length && !bindings.at(-1)!.active) bindings.pop();
    if (!bindings.length && services.get(domain) === bindings) services.delete(domain);
  };
}
export function bindBusinessAuth(provider: (required: boolean) => Promise<BusinessAuth>): () => void {
  auth = provider;
  return () => { if (auth === provider) auth = undefined; };
}
export async function businessAuth(required = false): Promise<BusinessAuth> {
  if (auth) return auth(required);
  if (required) throw new BusinessCapabilityUnavailable('provider-auth');
  return {};
}
export async function businessRequest(domain: BusinessDomain, action: string, options: RequestInit = {}): Promise<Response> {
  const service = services.get(domain)?.at(-1)?.service;
  if (!service) throw new BusinessCapabilityUnavailable(domain);
  return service.request(action, options);
}
export function assertBusinessService(domain: BusinessDomain): void {
  if (!services.has(domain)) throw new BusinessCapabilityUnavailable(domain);
}
/** Transitional DTO adapter. It cannot discover/fall back to an old package service. */
export async function businessFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const routes: readonly [string, BusinessDomain][] = [
    ['/daelab/storyboard/', 'storyboard'], ['/daelab/script-parser/', 'script'],
    ['/daelab/prompt-optimization/', 'optimization'],
    ['/daelab/studio/generation/', 'generation'],
  ];
  for (const [prefix, domain] of routes) if (url.startsWith(prefix)) return businessRequest(domain, url.slice(prefix.length), options);
  if (url === '/upload/image' || url.startsWith('/view?') || /^data:image\/(png|jpeg|webp);base64,/.test(url)) return businessHost().fetchNative(url, options);
  throw new BusinessCapabilityUnavailable('unsupported-route');
}

export interface GenerationScope {
  documentId: string; tableId: string; nodeId: string;
  recordId: string; fieldId: string;
  workflowSession: string; epoch: number; inputVersion: number; inputDigest?: string; model?: string;
}
export interface GenerationSubmission { requestId: string; input: Record<string, unknown>; source: GenerationScope }
export interface GenerationReport {
  requestId: string; state: string; phase: string; version: number;
  inputFingerprint: string; source: GenerationScope;
  taskId?: string | null; error?: string; result?: unknown; receipt?: unknown;
  replacementAllowed?: boolean; preparation?: 'ready' | 'rejected' | 'fenced';
  [key: string]: unknown;
}
export class BusinessRequestError extends Error {
  readonly preflightRejected: boolean;
  constructor(message: string, readonly status: number, readonly code: string,
    readonly originalTaskMayExist: boolean) {
    super(message); this.name = 'BusinessRequestError';
    this.preflightRejected = !originalTaskMayExist;
  }
}
/** One response boundary: an HTTP error is never evidence that no task exists. */
export async function businessJson<T>(domain: BusinessDomain, action: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await businessRequest(domain, action, {
    method: payload === undefined ? 'GET' : 'POST',
    ...(payload === undefined ? {} : { headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) }),
    ...(signal ? {signal} : {}),
  });
  let data: any;
  try { data = await response.json(); }
  catch { throw new BusinessRequestError('服务响应无效；请查询原请求，不要自动重新提交', response.status, 'invalid-response', true); }
  if (!response.ok) throw new BusinessRequestError(String(data.error || '服务暂不可用；请查询原请求'), response.status,
    String(data.code || 'request-failed'), data.originalTaskMayExist !== false);
  return data as T;
}
export const generationPort = {
  submit: (jobs: readonly GenerationSubmission[]) => businessJson<{jobs: GenerationReport[]}>('generation', 'submit', {contractVersion: 1, jobs}),
  status: (requestIds: readonly string[]) => businessJson<{jobs: GenerationReport[]}>('generation', 'status', {contractVersion: 1, requestIds}),
  recover: (requestIds: readonly string[]) => businessJson<{jobs: GenerationReport[]}>('generation', 'recover', {contractVersion: 1, requestIds}),
  fenceUnsubmitted: (requestId: string, source: GenerationScope, inputDigest: string, model: string) => businessJson<{jobs: GenerationReport[]}>('generation', 'fence-unsubmitted', {contractVersion: 1, requestId, source, inputDigest, model}),
  pause: (requestIds: readonly string[]) => businessJson<{jobs: GenerationReport[]}>('generation', 'pause', {contractVersion: 1, requestIds}),
  retryLocal: (requestId: string, newRequestId: string) => businessJson<{jobs: GenerationReport[]}>('generation', 'retry-local', {contractVersion: 1, requestId, newRequestId}),
};
