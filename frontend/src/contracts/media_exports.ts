import type { JobStatus, Json } from './ports.js';

export interface ExportOwner { documentId: string; nodeId: string }
export interface ExportSource extends ExportOwner { inputDigest: string }
export interface ExportInput { edit_data: string; connections: Record<string, Json>; source: ExportOwner }
export interface ExportReference { schemaVersion: 1; requestId: string; inputDigest: string; source: ExportOwner }
export interface ExportOutput { filename: string; subfolder: string; type: 'output' }
export interface ExportAsset { asset_id: string; reference_id: string; sha256: string; bytes: number }
export interface ExportReport {
  schemaVersion: 1; requestId: string; state: JobStatus; version: number;
  fingerprint: string; editFingerprint: string; native: {promptId: string; nodeId: string; listIndex: number | null};
  providerTaskId: string | null; cancelRequested: boolean; result: {kind: 'assets'; items: ExportAsset[]} | null;
  errorCode: string | null; source: ExportSource & {operation: 'video_export'}; attempt: number;
  output: ExportOutput | null; recoveryAction: string;
}
export interface ExportBinding { schemaVersion: 1; reference: ExportReference; fingerprint: string; asset: ExportAsset; output: ExportOutput }
export interface MediaExportPort {
  submit(value: {requestId: string; edit_data: string; connections: Record<string, Json>; source: ExportSource}, signal: AbortSignal): Promise<unknown>;
  get(requestId: string, signal: AbortSignal): Promise<unknown>;
  cancel(requestId: string, expectedVersion: number, signal: AbortSignal): Promise<unknown>;
  recover(requestId: string, signal: AbortSignal): Promise<unknown>;
}
