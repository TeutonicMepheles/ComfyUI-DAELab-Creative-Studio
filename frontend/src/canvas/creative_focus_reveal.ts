/** Transient Canvas focus coordination. No editor data, focus or scroll writes. */
export interface RevealRect {left: number; top: number; right: number; bottom: number}
export interface RevealDelta {dx: number; dy: number}
export interface CaretLease {isCurrent(): boolean}
interface RevealOptions {
    root: HTMLElement;
    owner(editor: HTMLElement): CaretLease | null;
    pan(delta: RevealDelta): void;
}
const finiteRect = (r: RevealRect) => [r.left, r.top, r.right, r.bottom].every(Number.isFinite)
    && r.right >= r.left && r.bottom > r.top;

/** Screen coordinates, independent of Canvas zoom; positive deltas pan left/up. */
export function revealDelta(target: RevealRect, viewport: RevealRect, margin = 16): RevealDelta | null {
    if (!finiteRect(target) || !finiteRect(viewport) || !Number.isFinite(margin) || margin < 0) return null;
    const left = viewport.left + margin, right = viewport.right - margin;
    const top = viewport.top + margin, bottom = viewport.bottom - margin;
    if (right <= left || bottom <= top || target.right - target.left > right - left || target.bottom - target.top > bottom - top) return null;
    return {
        dx: target.left < left ? target.left - left : target.right > right ? target.right - right : 0,
        dy: target.top < top ? target.top - top : target.bottom > bottom ? target.bottom - bottom : 0,
    };
}

function textControl(element: HTMLElement): boolean {
    return element.tagName === 'TEXTAREA' || (element.tagName === 'INPUT'
        && /^(text|search|url|tel|email|password)$/.test((element as HTMLInputElement).type));
}

function activeEditor(root: HTMLElement): HTMLElement | null {
    const element = root.ownerDocument.activeElement as HTMLElement | null;
    if (!element || !root.contains(element) || !element.isConnected
        || element.closest('[hidden],[inert],dialog,.dae-creative-workspace')) return null;
    return element.isContentEditable || textControl(element) ? element : null;
}

/** A detached Range reads the live collapsed focus boundary without moving Selection. */
function caretRect(editor: HTMLElement): RevealRect | null {
    if (textControl(editor)) return editor.getBoundingClientRect();
    const selection = editor.ownerDocument.getSelection();
    if (!selection?.isCollapsed || !selection.rangeCount || !selection.focusNode
        || !editor.contains(selection.focusNode) || !editor.contains(selection.anchorNode)) return null;
    try {
        const range = editor.ownerDocument.createRange();
        range.setStart(selection.focusNode, selection.focusOffset);
        range.collapse(true);
        // A zero-width caret is valid; an empty/non-rendered range is not.
        const rects = range.getClientRects();
        return rects.length === 1 && finiteRect(rects[0]!) ? rects[0]! : null;
    } catch { return null; } // Selection may have become detached during native editing.
}

function viewportRect(root: HTMLElement, win: Window): RevealRect {
    const r = root.getBoundingClientRect(), doc = root.ownerDocument.documentElement, visual = win.visualViewport;
    return {
        left: Math.max(r.left, visual?.offsetLeft ?? 0), top: Math.max(r.top, visual?.offsetTop ?? 0),
        right: Math.min(r.right, visual ? visual.offsetLeft + visual.width : doc.clientWidth),
        bottom: Math.min(r.bottom, visual ? visual.offsetTop + visual.height : doc.clientHeight),
    };
}

function internallyClipped(editor: HTMLElement, target: RevealRect, root: HTMLElement, win: Window): boolean {
    // Moving the whole world cannot repair clipping relative to an inner scrollport.
    // For native controls the measured border box already includes native scrolling.
    for (let node: HTMLElement | null = textControl(editor) ? editor.parentElement : editor; node && node !== root; node = node.parentElement) {
        const style = win.getComputedStyle(node);
        const clipX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
        const clipY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
        if (!clipX && !clipY) continue;
        const r = node.getBoundingClientRect();
        if (!finiteRect(r) || !node.offsetWidth || !node.offsetHeight) return true;
        const sx = (r.right - r.left) / node.offsetWidth, sy = (r.bottom - r.top) / node.offsetHeight;
        const left = r.left + node.clientLeft * sx, top = r.top + node.clientTop * sy;
        if ((clipX && (target.left < left || target.right > left + node.clientWidth * sx))
            || (clipY && (target.top < top || target.bottom > top + node.clientHeight * sy))) return true;
    }
    return false;
}

export function createCaretReveal({root, owner, pan}: RevealOptions) {
    const doc = root.ownerDocument, win = doc.defaultView;
    if (!win) throw new TypeError('Caret reveal requires the owning document window');
    let frame = 0, destroyed = false, suppressed = false, pointing = false;
    let composing: HTMLElement | null = null, imeKey: HTMLElement | null = null;
    let pending: {editor: HTMLElement; lease: CaretLease} | null = null;
    const releases: Array<() => void> = [];
    function cancel() {
        if (frame) win!.cancelAnimationFrame(frame);
        frame = 0; pending = null;
    }
    function suspend() { suppressed = true; cancel(); }
    function reset() { suspend(); composing = null; imeKey = null; pointing = false; }
    function valid(editor: HTMLElement, lease: CaretLease) {
        return !destroyed && !suppressed && !pointing && !composing && !imeKey
            && !doc.hidden && activeEditor(root) === editor && lease.isCurrent();
    }
    function schedule(intent = false) {
        if (destroyed) return;
        if (intent) suppressed = false;
        const editor = activeEditor(root);
        if (!editor || suppressed || pointing || composing || imeKey || doc.hidden) { cancel(); return; }
        const lease = owner(editor);
        if (!lease || !lease.isCurrent()) { cancel(); return; }
        pending = {editor, lease};
        if (frame) return;
        frame = win!.requestAnimationFrame(() => {
            frame = 0;
            const request = pending; pending = null;
            if (!request || !valid(request.editor, request.lease)) return;
            const target = caretRect(request.editor);
            if (!target) return;
            const delta = revealDelta(target, viewportRect(root, win!));
            // Most editing is already visible: avoid inspecting every ancestor
            // unless translation is needed. Range/root reads remain a real cost.
            if (!delta || (!delta.dx && !delta.dy)) return;
            if (!internallyClipped(request.editor, target, root, win!) && valid(request.editor, request.lease)) pan(delta);
        });
    }
    function listen(target: EventTarget, type: string, listener: EventListener) {
        target.addEventListener(type, listener, true);
        releases.push(() => target.removeEventListener(type, listener, true));
    }
    const belongs = (event: Event) => {
        const editor = activeEditor(root);
        return editor && event.target && editor.contains(event.target as Node) ? editor : null;
    };
    listen(root, 'focusin', () => schedule(true));
    listen(root, 'focusout', () => { cancel(); composing = null; imeKey = null; });
    listen(root, 'compositionstart', event => {
        composing = belongs(event); if (composing) { imeKey = null; cancel(); }
    });
    listen(root, 'compositionend', event => {
        const editor = belongs(event);
        if (!editor || (editor !== composing && editor !== imeKey)) return;
        composing = null; imeKey = null; schedule(true);
    });
    listen(root, 'keydown', event => {
        const key = event as KeyboardEvent, editor = belongs(event);
        if (editor && (key.isComposing || key.keyCode === 229)) { imeKey = editor; cancel(); }
    });
    listen(root, 'keyup', event => {
        const key = event as KeyboardEvent;
        if (belongs(event) && !key.isComposing && key.keyCode !== 229
            && /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown)$/.test(key.key)) schedule(true);
    });
    listen(root, 'input', event => {
        const editor = belongs(event);
        if (!editor) return;
        if ((event as InputEvent).isComposing) { imeKey = editor; cancel(); return; }
        if (!composing) imeKey = null;
        schedule(true);
    });
    listen(root, 'select', event => { if (belongs(event)) schedule(); });
    listen(doc, 'selectionchange', () => schedule());
    listen(root, 'pointerdown', event => {
        if ((event as PointerEvent).button === 0) { pointing = true; cancel(); }
    });
    listen(doc, 'pointerup', event => {
        if (!pointing) return;
        pointing = false;
        if (belongs(event)) schedule(true);
    });
    listen(doc, 'pointercancel', () => { pointing = false; cancel(); });
    listen(doc, 'visibilitychange', () => { if (doc.hidden) reset(); });
    listen(win, 'pagehide', reset);
    return {
        cancel: reset,
        suspend,
        destroy() {
            if (destroyed) return;
            destroyed = true; cancel(); composing = null; imeKey = null; pointing = false;
            for (const release of releases) release();
        },
    };
}
