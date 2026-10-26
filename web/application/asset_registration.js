/** A registration receipt is derived metadata. The supplied read() remains the
 * sole editable text source; neither responses nor reloading write text back. */
export function createTextSnapshotRegistration(options) {
    let epoch = 0, disposed = false, pending;
    const invalidate = () => { epoch++; pending?.abort(); pending = undefined; };
    return {
        invalidate,
        async commit() {
            invalidate();
            if (disposed || !options.current())
                return null;
            const text = options.read(), source = options.source(), token = epoch;
            if (!text.trim())
                return null;
            const controller = pending = new AbortController();
            try {
                const receipt = await options.register({ kind: 'text', name: '输入文本', text, source }, controller.signal);
                if (disposed || controller.signal.aborted || token !== epoch || !options.current() || options.read() !== text || JSON.stringify(options.source()) !== JSON.stringify(source))
                    return null;
                options.apply(receipt);
                return receipt;
            }
            catch (error) {
                if (!disposed && token === epoch && !controller.signal.aborted)
                    options.error(error);
                return null;
            }
            finally {
                if (pending === controller)
                    pending = undefined;
            }
        },
        dispose() { disposed = true; invalidate(); },
    };
}
