export type AssetKind = 'image' | 'video' | 'text';
export interface AssetIdentity { assetId: string; referenceId?: string; contentSha256: string; byteSize: number }
export interface AssetSource { operation: string; documentId?: string; nodeId?: string; tableId?: string; recordId?: string; fieldId?: string; requestId?: string; occurrenceId?: string; sourceAssetId?: string; sourceReferenceId?: string }
export interface LocalAssetReference {
  version: 1; kind: 'image' | 'video'; name: string;
  filename: string; subfolder: string; type: 'input' | 'output';
  assetId?: string; referenceId?: string; contentSha256?: string; byteSize?: number;
}
export type FavoriteInput = ({ kind: 'text'; name: string; text: string }
  | { kind: 'image' | 'video'; name: string; asset: LocalAssetReference }) & { source?: AssetSource };
export interface AssetRegistration extends AssetIdentity { kind: AssetKind; status: 'available'; asset?: LocalAssetReference; sources?: readonly {referenceId: string | null; source: Partial<AssetSource>}[] }
export type FavoriteEntry = FavoriteInput & { id: string; assetId: string; referenceId?: string; createdAt: string; status?: string };
export interface FavoriteQuery { q?: string; kind?: AssetKind; limit?: number; offset?: number; signal?: AbortSignal }
export interface FavoritePage { schemaVersion: 1; entries: FavoriteEntry[]; total: number; offset: number; limit: number; hasMore: boolean }
export interface LegacyFavoriteDocument { version: 1; entries: unknown[] }
export interface FavoriteImportReport {
  schemaVersion: 1; origin: string; source_preserved: true; accepted: number; rejected: number;
  report: { index: number; status: string; error?: { message: string } }[];
}
export interface AssetLibraryPort {
  register(input: FavoriteInput, signal?: AbortSignal): Promise<AssetRegistration>;
  resolve(identity: Pick<AssetIdentity, 'assetId' | 'referenceId'>, signal?: AbortSignal): Promise<AssetRegistration>;
  search(query?: FavoriteQuery): Promise<FavoritePage>;
  lookup(input: FavoriteInput, signal?: AbortSignal): Promise<FavoriteEntry | null>;
  save(input: FavoriteInput): Promise<FavoriteEntry>;
  remove(id: string): Promise<void>;
  importLegacy(origin: string, document: LegacyFavoriteDocument): Promise<FavoriteImportReport>;
}
