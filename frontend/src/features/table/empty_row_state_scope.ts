/** Optional provider promise: every row has {issues: [], hint: ''} in this mode.
 * Unknown/global-dependent providers must omit it. This is not row-state caching.
 */
export interface EmptyRowStateTable {
  fields: readonly unknown[];
  records: readonly {id: string}[];
  meta?: unknown;
  view?: unknown;
}
export type EmptyRowStateCapability = (table: EmptyRowStateTable) => boolean;
export interface EmptyRowStateScope {
  readonly recordId: string;
  readonly index: number;
  readonly recordIds: readonly string[];
  readonly fields: string | undefined;
  readonly meta: string | undefined;
  readonly view: unknown;
}

export function matchesEmptyRowStateScope(scope: EmptyRowStateScope, table: EmptyRowStateTable, empty: EmptyRowStateCapability): boolean {
  return empty(table) === true && table.view === scope.view &&
    table.records.length === scope.recordIds.length &&
    table.records.every((row, index) => row.id === scope.recordIds[index]) &&
    JSON.stringify(table.fields) === scope.fields && JSON.stringify(table.meta) === scope.meta;
}

export function captureEmptyRowStateScope(before: EmptyRowStateTable, next: EmptyRowStateTable, recordId: string, empty: EmptyRowStateCapability | null): EmptyRowStateScope | null {
  if (!empty || empty(before) !== true) return null;
  const recordIds = before.records.map(row => row.id), index = recordIds.indexOf(recordId);
  if (index < 0 || new Set(recordIds).size !== recordIds.length) return null;
  // Only field/configuration metadata and row identities are compared. Values,
  // whole documents and native graph/history are never serialized here.
  const scope = {recordId, index, recordIds, fields: JSON.stringify(before.fields), meta: JSON.stringify(before.meta), view: before.view};
  return matchesEmptyRowStateScope(scope, next, empty) ? scope : null;
}
