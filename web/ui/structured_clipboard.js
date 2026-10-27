/** Explicit host-owned clipboard cache; selection, history and documents never live here. */
export function createStructuredClipboard(writeText) {
    let saved = null;
    return {
        writeText,
        remember(text, matrix) { saved = { text, matrix: structuredClone(matrix) }; },
        recall(text) { return saved?.text === text ? structuredClone(saved.matrix) : null; },
        clear() { saved = null; },
    };
}
