const owners = new WeakMap();
/** Node creation can precede native workflow activation and its ChangeTracker.
 * Queue installations, never edits, across that boundary; re-read the live node
 * after the native load and its caller's undo/redo continuation have settled.
 */
export function installWorkflowNodeLifecycle(app, nextFrame = callback => requestAnimationFrame(callback)) {
    const existing = owners.get(app);
    if (existing)
        return existing;
    const pending = new Map();
    let revision = 0, loads = 0, available = true, queued = false;
    const ready = (node) => available && !loads && app.isGraphReady !== false
        && !!node.graph && node.graph === app.graph && node.graph.getNodeById(node.id) === node;
    function flush() {
        queued = false;
        if (loads || !available)
            return;
        const entries = [...pending];
        pending.clear();
        for (const [node, entry] of entries) {
            if (entry.revision === revision && node.graph === entry.graph && ready(node))
                entry.install(node);
        }
    }
    const load = app.loadGraphData;
    app.loadGraphData = async function (...args) {
        const current = ++revision;
        loads++;
        available = false;
        pending.clear();
        try {
            const result = await load.apply(this, args);
            if (current === revision)
                available = result !== false;
            return result;
        }
        finally {
            loads--;
            if (!loads) {
                if (available)
                    nextFrame(flush);
                else
                    pending.clear();
            }
        }
    };
    const lifecycle = {
        ready,
        schedule(node, install) {
            if (!node.graph)
                return;
            pending.set(node, { graph: node.graph, revision, install });
            if (!loads && available && !queued) {
                queued = true;
                queueMicrotask(flush);
            }
        },
        cancel(node) { pending.delete(node); },
    };
    owners.set(app, lifecycle);
    return lifecycle;
}
