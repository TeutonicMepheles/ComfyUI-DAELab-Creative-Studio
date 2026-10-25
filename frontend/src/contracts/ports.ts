/** Host-neutral ports. Runtime facts are never serialized as editable graph state. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface EditIdentity {
  workflowSession: string;
  epoch: number;
  documentId: string;
  recordId?: string;
  fieldId?: string;
}
export interface NativeDocumentPort<T> {
  /** Read the current native workflow; implementations must not maintain another writable graph. */
  read(): T;
  identity(target?: EditTarget): EditIdentity;
  revision(target?: EditTarget): number;
  /** The host owns history and rollback; nested derived edits join this transaction. */
  transact(label: string, edit: (document: T) => void, options?: EditTransactionOptions): void;
  /** Optional whole-value edit, with the same isolation, validation and history contract as transact. */
  replace?(label: string, value: T, options?: EditTransactionOptions): void;
}
export interface EditTarget { recordId?: string; fieldId?: string }
export interface EditTransactionOptions {
  group?: string | null;
  /** Derived projections join the current native history state, never a job ledger. */
  derived?: boolean;
  afterWrite?: () => void;
}
export interface AsyncEditTicket extends EditIdentity {
  requestId: string;
  inputVersion: number;
}
export interface AssetReference {
  id: string;
  kind: 'image' | 'video' | 'text';
  filename?: string;
  subfolder?: string;
  type?: 'input' | 'output';
  text?: string;
  provenance?: Json;
}
export interface AssetPort {
  get(id: string): Promise<AssetReference | null>;
  favorite(asset: AssetReference): Promise<string>;
  search(query: string, limit: number): Promise<readonly AssetReference[]>;
}
export type JobStatus = 'pending' | 'submitting' | 'submitted' | 'running' | 'fetching' |
  'succeeded' | 'failed' | 'needs_recovery' | 'unknown' | 'cancelled';
export interface JobSnapshot {
  requestId: string;
  provider: string;
  status: JobStatus;
  revision: number;
  inputFingerprint: string;
  providerTaskId?: string;
  outputs: readonly AssetReference[];
}
export interface JobsPort {
  get(requestId: string): Promise<JobSnapshot | null>;
  /** Query the same durable identity. Recovery must not silently submit another task. */
  recover(requestId: string): Promise<JobSnapshot>;
}
