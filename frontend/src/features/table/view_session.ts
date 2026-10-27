/** View lifetime only. NativeDocumentPort remains the editing-data authority. */
export interface TableViewTicket { readonly requestId: string }
export function createTableViewSession() {
  let disposed = false;
  const abort = new AbortController();
  const tickets = new Set<TableViewTicket>();
  const assertCurrent = () => { if (disposed) throw new Error('编辑器已释放'); };
  return {
    signal: abort.signal,
    assertCurrent,
    begin(requestId: string): TableViewTicket {
      assertCurrent(); const ticket = Object.freeze({ requestId }); tickets.add(ticket); return ticket;
    },
    canApply(ticket: TableViewTicket): boolean { return !disposed && tickets.has(ticket); },
    release(ticket: TableViewTicket): void { tickets.delete(ticket); },
    invalidate(): void { tickets.clear(); },
    dispose(): void { if (disposed) return; disposed = true; tickets.clear(); abort.abort(); },
  };
}
