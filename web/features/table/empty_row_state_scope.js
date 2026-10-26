export function matchesEmptyRowStateScope(scope, table, empty) {
    return empty(table) === true && table.view === scope.view &&
        table.records.length === scope.recordIds.length &&
        table.records.every((row, index) => row.id === scope.recordIds[index]) &&
        JSON.stringify(table.fields) === scope.fields && JSON.stringify(table.meta) === scope.meta;
}
export function captureEmptyRowStateScope(before, next, recordId, empty) {
    if (!empty || empty(before) !== true)
        return null;
    const recordIds = before.records.map(row => row.id), index = recordIds.indexOf(recordId);
    if (index < 0 || new Set(recordIds).size !== recordIds.length)
        return null;
    // Only field/configuration metadata and row identities are compared. Values,
    // whole documents and native graph/history are never serialized here.
    const scope = { recordId, index, recordIds, fields: JSON.stringify(before.fields), meta: JSON.stringify(before.meta), view: before.view };
    return matchesEmptyRowStateScope(scope, next, empty) ? scope : null;
}
