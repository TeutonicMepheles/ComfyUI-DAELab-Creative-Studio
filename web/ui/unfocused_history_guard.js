/** Cancel browser text history only for this blurred, controlled field.
 * The host still owns graph undo; this binding never dispatches it or writes data.
 */
export function bindUnfocusedHistoryGuard(field, options) {
    let disposed = false, composing = false;
    const compositionStart = (event) => { if (event.target === field)
        composing = true; };
    const compositionEnd = (event) => { if (event.target === field)
        composing = false; };
    const beforeInput = (event) => {
        const input = event;
        if (disposed || event.target !== field || !event.cancelable ||
            (input.inputType !== 'historyUndo' && input.inputType !== 'historyRedo') ||
            !field.isConnected || field.disabled || field.readOnly || composing || input.isComposing)
            return;
        if (field.ownerDocument.activeElement === field)
            return;
        const tree = field.getRootNode();
        if ('activeElement' in tree && tree.activeElement === field)
            return;
        try {
            if (!options.isCurrent())
                return;
        }
        catch {
            return;
        }
        event.preventDefault();
    };
    field.addEventListener('compositionstart', compositionStart);
    field.addEventListener('compositionend', compositionEnd);
    field.addEventListener('beforeinput', beforeInput);
    return () => {
        if (disposed)
            return;
        disposed = true;
        field.removeEventListener('compositionstart', compositionStart);
        field.removeEventListener('compositionend', compositionEnd);
        field.removeEventListener('beforeinput', beforeInput);
    };
}
