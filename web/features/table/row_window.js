/** DOM lifetime only: model rows, identities and history remain with the editor. */
export function attachTableRowWindow(options) {
    const { root, table } = options;
    if (typeof IntersectionObserver === 'undefined' || typeof ResizeObserver === 'undefined' || !table.isConnected || !table.offsetWidth)
        return null;
    const rows = Array.from(table.tBodies[0]?.rows ?? []);
    if (rows.length < 100)
        return null;
    const document = table.ownerDocument;
    const scale = table.getBoundingClientRect().width / table.offsetWidth;
    if (!(scale > 0))
        return null;
    // Complete all measurements before inserting spacers or releasing any cells.
    const heights = rows.map(row => row.getBoundingClientRect().height / scale);
    const entries = rows.map((row, index) => {
        const spacer = document.createElement('tr'), cell = document.createElement('td');
        spacer.dataset.tableRowSpacer = row.dataset.recordId;
        spacer.setAttribute('aria-hidden', 'true');
        cell.colSpan = row.cells.length;
        cell.style.setProperty('padding', '0', 'important');
        cell.style.setProperty('border', '0', 'important');
        cell.style.fontSize = '0';
        cell.style.lineHeight = '0';
        spacer.append(cell);
        row.setAttribute('aria-rowindex', String(index + 2));
        return { id: row.dataset.recordId, index, row, spacer, height: heights[index], visible: true };
    });
    table.setAttribute('aria-rowcount', String(entries.length + 1));
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const targets = new WeakMap();
    const events = new AbortController();
    let disposed = false, interacting = false, resizing = false, frame = 0, width = table.offsetWidth;
    const current = (entry) => entry.row ?? entry.spacer;
    function observe(entry) { const target = current(entry); targets.set(target, entry); observer.observe(target); }
    function mount(entry, mounted) {
        if (entry.row || disposed)
            return;
        const row = options.mount(entry.id, entry.index);
        row.setAttribute('aria-rowindex', String(entry.index + 2));
        observer.unobserve(entry.spacer);
        entry.spacer.replaceWith(row);
        entry.row = row;
        mounted.push(row);
        observe(entry);
    }
    function reconcile() {
        if (disposed)
            return;
        const mounted = [];
        for (const entry of entries)
            if (entry.visible)
                mount(entry, mounted);
        if (mounted.length)
            options.mounted(mounted);
        if (interacting || resizing)
            return;
        const scale = table.getBoundingClientRect().width / table.offsetWidth;
        if (!(scale > 0))
            return;
        const hidden = entries.filter(entry => entry.row && !entry.visible && !entry.row.contains(document.activeElement)
            && !entry.row.matches('[data-height-resizing]') && !entry.row.querySelector('[data-inline-editing=true]'));
        const heights = hidden.map(entry => entry.row.getBoundingClientRect().height / scale);
        hidden.forEach((entry, index) => {
            const row = entry.row;
            entry.height = heights[index];
            entry.spacer.cells[0].style.setProperty('height', entry.height + 'px', 'important');
            observer.unobserve(row);
            row.replaceWith(entry.spacer);
            entry.row = null;
            options.unmount(row);
            observe(entry);
        });
    }
    const observer = new IntersectionObserver(records => {
        for (const record of records) {
            const entry = targets.get(record.target);
            if (entry && current(entry) === record.target)
                entry.visible = record.isIntersecting;
        }
        reconcile();
    }, { rootMargin: '240px' });
    function revealAll() {
        const mounted = [];
        for (const entry of entries)
            mount(entry, mounted);
        if (mounted.length)
            options.mounted(mounted);
    }
    function refresh() {
        if (disposed || frame)
            return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            if (disposed || !table.offsetWidth)
                return;
            revealAll();
            const scale = table.getBoundingClientRect().width / table.offsetWidth;
            if (!(scale > 0))
                return;
            const heights = entries.map(entry => entry.row.getBoundingClientRect().height / scale);
            entries.forEach((entry, index) => { entry.height = heights[index]; });
            observer.disconnect();
            for (const entry of entries)
                observe(entry);
        });
    }
    const size = new ResizeObserver(() => {
        const next = table.offsetWidth;
        if (next && next !== width) {
            width = next;
            refresh();
        }
    });
    size.observe(table);
    for (const entry of entries)
        observe(entry);
    document.fonts?.addEventListener('loadingdone', refresh, { signal: events.signal });
    root.addEventListener('pointerdown', event => {
        interacting = true;
        if (event.target.closest('.dae-column-divider')) {
            resizing = true;
            revealAll();
        }
    }, { capture: true, signal: events.signal });
    const finish = () => { if (!interacting && !resizing)
        return; interacting = false; if (resizing) {
        resizing = false;
        refresh();
    }
    else
        reconcile(); };
    for (const type of ['pointerup', 'pointercancel', 'dragend'])
        document.addEventListener(type, finish, { signal: events.signal });
    document.defaultView?.addEventListener('blur', finish, { signal: events.signal });
    root.addEventListener('keydown', event => {
        if (event.target.closest('.dae-column-divider')) {
            revealAll();
            refresh();
        }
    }, { capture: true, signal: events.signal });
    return {
        ensure(id) { const entry = byId.get(id); if (!entry)
            return; const mounted = []; mount(entry, mounted); if (mounted.length)
            options.mounted(mounted); },
        revealAll, refresh,
        dispose() { if (disposed)
            return; disposed = true; observer.disconnect(); size.disconnect(); events.abort(); if (frame)
            cancelAnimationFrame(frame); byId.clear(); entries.length = 0; },
    };
}
