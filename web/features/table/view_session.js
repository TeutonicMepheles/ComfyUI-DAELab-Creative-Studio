export function createTableViewSession() {
    let disposed = false;
    const abort = new AbortController();
    const tickets = new Set();
    const assertCurrent = () => { if (disposed)
        throw new Error('编辑器已释放'); };
    return {
        signal: abort.signal,
        assertCurrent,
        begin(requestId) {
            assertCurrent();
            const ticket = Object.freeze({ requestId });
            tickets.add(ticket);
            return ticket;
        },
        canApply(ticket) { return !disposed && tickets.has(ticket); },
        release(ticket) { tickets.delete(ticket); },
        invalidate() { tickets.clear(); },
        dispose() { if (disposed)
            return; disposed = true; tickets.clear(); abort.abort(); },
    };
}
