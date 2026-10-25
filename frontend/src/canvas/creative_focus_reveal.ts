/** Transient Canvas focus coordination. No editor data, focus or scroll writes. */
export interface RevealRect {left: number; top: number; right: number; bottom: number}
export interface RevealDelta {dx: number; dy: number}
export interface CaretLease {isCurrent(): boolean}
interface RevealOptions {
    root: HTMLElement;
    owner(editor: HTMLElement): CaretLease | null;
    pan(delta: RevealDelta): void;
    /** One owned bottom status overlay; measured only for trusted Tab controls. */
    tabOcclusion?(): RevealRect | null;
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

/** Trusted Tab controls may expose only their leading region when oversized. */
function tabControlDelta(target: RevealRect, viewport: RevealRect): RevealDelta | null {
    const fitted = revealDelta(target, viewport);
    if (fitted) return fitted;
    if (!finiteRect(target) || !finiteRect(viewport)) return null;
    const left = viewport.left + 16, right = viewport.right - 16;
    const top = viewport.top + 16, bottom = viewport.bottom - 16;
    if (right <= left || bottom <= top) return null;
    // This is the delta of a measurement truncated to the available size on
    // each oversized axis. Compute that axis directly: reconstructing a right
    // edge then subtracting left can round its width above the exact budget.
    // Full original bounds still decide ancestor clipping; no DOM is clipped.
    return {
        dx: target.right - target.left > right - left ? target.left - left
            : target.left < left ? target.left - left : target.right > right ? target.right - right : 0,
        dy: target.bottom - target.top > bottom - top ? target.top - top
            : target.top < top ? target.top - top : target.bottom > bottom ? target.bottom - bottom : 0,
    };
}

function avoidTabStatus(target: RevealRect, viewport: RevealRect, delta: RevealDelta,
    status: RevealRect | null): RevealDelta | null {
    if (!status || !finiteRect(status) || status.right <= status.left) return delta;
    const left = Math.max(status.left, viewport.left), right = Math.min(status.right, viewport.right);
    const top = Math.max(status.top, viewport.top), bottom = Math.min(status.bottom, viewport.bottom);
    if (right <= left || bottom <= top) return delta;
    // Check the region the baseline pan would reveal, not the pre-pan location.
    // Oversized controls retain the existing leading-region guarantee only.
    const projectedLeft = target.left - delta.dx, projectedTop = target.top - delta.dy;
    const projectedRight = Math.min(target.right - delta.dx, viewport.right - 16);
    const projectedBottom = Math.min(target.bottom - delta.dy, viewport.bottom - 16);
    if (projectedRight + 16 <= left || projectedLeft - 16 >= right
        || projectedBottom + 16 <= top || projectedTop - 16 >= bottom) return delta;
    // Preserve the same 16px outline clearance above the actual status box.
    // No fixed overlay height or hidden status/error message is introduced.
    return tabControlDelta(target, {...viewport, bottom: top});
}

function textControl(element: HTMLElement): boolean {
    return element.tagName === 'TEXTAREA' || (element.tagName === 'INPUT'
        && /^(text|search|url|tel|email|password)$/.test((element as HTMLInputElement).type));
}

function activeTarget(root: HTMLElement): HTMLElement | null {
    const element = root.ownerDocument.activeElement as HTMLElement | null;
    if (!element || !root.contains(element) || !element.isConnected
        || element.closest('[hidden],[inert],dialog,.dae-creative-workspace')) return null;
    return element;
}

function activeEditor(root: HTMLElement): HTMLElement | null {
    const element = activeTarget(root);
    return element && (element.isContentEditable || textControl(element)) ? element : null;
}

function activeControl(root: HTMLElement): HTMLElement | null {
    const element = activeTarget(root);
    return element && !element.isContentEditable && !textControl(element)
        && element.tabIndex >= 0 && !element.matches(':disabled') ? element : null;
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

interface MeasuredPx {value: number; error: number; significant: number}
function measuredPx(text: string): MeasuredPx | null {
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)px$/.test(text)) return null;
    const value = Number(text.slice(0, -2));
    if (!Number.isFinite(value) || value < 0) return null;
    const significant = text.slice(0, -2).replace('.', '').replace(/^0+/, '').length;
    // Blink CSSNumericLiteralValue uses %.6g for nonintegers. Short strings do
    // NOT mean coarse precision ("1.5px" must not grant a .05px tolerance).
    // https://chromium.googlesource.com/chromium/src/+/494419358caf690316f160a1f27d9e771a14c033/third_party/blink/renderer/core/css/css_numeric_literal_value.cc
    const error = value === 0 ? 0 : .5 * 10 ** (Math.floor(Math.log10(value)) - Math.max(6, significant) + 1);
    return {value, error, significant};
}
function axisAligned(style: CSSStyleDeclaration): boolean {
    if (style.rotate !== 'none' || style.scale !== 'none' || style.perspective !== 'none'
        || !/^(1|normal)$/.test(style.zoom)) return false;
    if (style.transform === 'none') return true;
    const match = /^matrix\(([^)]+)\)$/.exec(style.transform);
    const values = match?.[1]?.split(',').map(Number);
    return !!values && values.length === 6 && values.every(Number.isFinite)
        && values[0]! > 0 && values[3]! > 0 && values[1] === 0 && values[2] === 0;
}
function alignedPath(node: HTMLElement | null, root: HTMLElement, win: Window): boolean {
    for (; node && node !== root; node = node.parentElement) if (!axisAligned(win.getComputedStyle(node))) return false;
    return node === root;
}
function floatRectHalfUlp(value: number): number {
    // Blink Element::getBoundingClientRect returns DOMRect::FromRectF. Account
    // for the coordinates' float32 rounding, not an arbitrary screen-pixel gap.
    // https://chromium.googlesource.com/chromium/src/+/6c499eeecfb7a65b0ffd42782cbdf9c813bfd968/third_party/blink/renderer/core/dom/element.cc
    return value === 0 ? 2 ** -150 : 2 ** (Math.max(-126, Math.floor(Math.log2(Math.abs(value)))) - 24);
}
function fractionalLeadingEdge(style: CSSStyleDeclaration, axis: 'x' | 'y', start: number, end: number,
    target: number, clientLeading: number): number | null {
    if (style.direction !== 'ltr' || style.writingMode !== 'horizontal-tb' || style.scrollbarGutter !== 'auto'
        || !axisAligned(style)) return null;
    const horizontal = axis === 'x';
    const leading = measuredPx(horizontal ? style.borderLeftWidth : style.borderTopWidth);
    // Deliberately narrow: short/integer borders and unknown serialization keep
    // the existing conservative path. No claim of sub-serialization accuracy.
    if (!leading || Number.isInteger(leading.value) || leading.significant < 6
        || Math.round(leading.value) !== clientLeading) return null;
    const size = measuredPx(horizontal ? style.width : style.height);
    if (!size || size.value <= 0) return null;
    let extent = size.value, extentError = size.error;
    if (style.boxSizing === 'content-box') {
        for (const text of horizontal ? [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
            : [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth]) {
            const part = measuredPx(text); if (!part) return null;
            extent += part.value; extentError += part.error;
        }
    } else if (style.boxSizing !== 'border-box') return null;
    const span = end - start, coordinateError = floatRectHalfUlp(start), spanError = coordinateError + floatRectHalfUlp(end);
    if (span <= spanError || extent <= extentError) return null;
    // Lower endpoint of the propagated measurement interval: only leading
    // border equality is corrected. Genuine clipping beyond this interval is
    // still rejected; right/bottom retain their original client/offset limits.
    const edge = start - coordinateError + Math.max(0, leading.value - leading.error)
        * (span - spanError) / (extent + extentError) - floatRectHalfUlp(target);
    return edge - Number.EPSILON * 8 * (Math.abs(start) + Math.abs(edge - start) + Math.abs(target));
}

function internallyClipped(editor: HTMLElement, target: RevealRect, root: HTMLElement, win: Window, wholeControl = false): boolean {
    // Moving the whole world cannot repair clipping relative to an inner scrollport.
    // For native controls the measured border box already includes native scrolling.
    for (let node: HTMLElement | null = wholeControl || textControl(editor) ? editor.parentElement : editor; node && node !== root; node = node.parentElement) {
        const style = win.getComputedStyle(node);
        const clipX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
        const clipY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
        if (!clipX && !clipY) continue;
        const r = node.getBoundingClientRect();
        if (!finiteRect(r) || !node.offsetWidth || !node.offsetHeight) return true;
        const sx = (r.right - r.left) / node.offsetWidth, sy = (r.bottom - r.top) / node.offsetHeight;
        const left = r.left + node.clientLeft * sx, top = r.top + node.clientTop * sy;
        let leadingLeft = left, leadingTop = top;
        if ((clipX && target.left < left) || (clipY && target.top < top)) {
            const x = clipX && target.left < left ? fractionalLeadingEdge(style, 'x', r.left, r.right, target.left, node.clientLeft) : null;
            const y = clipY && target.top < top ? fractionalLeadingEdge(style, 'y', r.top, r.bottom, target.top, node.clientTop) : null;
            if ((x !== null || y !== null) && alignedPath(node.parentElement, root, win)) {
                if (x !== null) leadingLeft = Math.min(left, x);
                if (y !== null) leadingTop = Math.min(top, y);
            }
        }
        if ((clipX && (target.left < leadingLeft || target.right > left + node.clientWidth * sx))
            || (clipY && (target.top < leadingTop || target.bottom > top + node.clientHeight * sy))) return true;
    }
    return false;
}

export function createCaretReveal({root, owner, pan, tabOcclusion}: RevealOptions) {
    const doc = root.ownerDocument, win = doc.defaultView;
    if (!win) throw new TypeError('Caret reveal requires the owning document window');
    let frame = 0, destroyed = false, suppressed = false, pointing = false;
    let composing: HTMLElement | null = null, imeKey: HTMLElement | null = null;
    let pending: {editor: HTMLElement; lease: CaretLease; wholeControl: boolean} | null = null;
    let tabIntent: {origin: HTMLElement; lease: CaretLease} | null = null, tabFrame = 0;
    const releases: Array<() => void> = [];
    function cancel() {
        if (frame) win!.cancelAnimationFrame(frame);
        frame = 0; pending = null;
    }
    function cancelTab() {
        if (tabFrame) win!.cancelAnimationFrame(tabFrame);
        tabFrame = 0; tabIntent = null;
    }
    function suspend() { suppressed = true; cancel(); cancelTab(); }
    function reset() { suspend(); composing = null; imeKey = null; pointing = false; }
    function valid(editor: HTMLElement, lease: CaretLease, wholeControl: boolean) {
        return !destroyed && !suppressed && !pointing && !composing && !imeKey
            && !doc.hidden && (wholeControl ? activeControl(root) : activeEditor(root)) === editor && lease.isCurrent();
    }
    function schedule(intent = false, control: HTMLElement | null = null) {
        if (destroyed) return;
        if (intent) suppressed = false;
        const editor = control ?? activeEditor(root);
        if (!editor || suppressed || pointing || composing || imeKey || doc.hidden) { cancel(); return; }
        const lease = owner(editor);
        if (!lease || !lease.isCurrent()) { cancel(); return; }
        pending = {editor, lease, wholeControl: control !== null};
        if (frame) return;
        frame = win!.requestAnimationFrame(() => {
            frame = 0;
            const request = pending; pending = null;
            if (!request || !valid(request.editor, request.lease, request.wholeControl)) return;
            const target = request.wholeControl ? request.editor.getBoundingClientRect() : caretRect(request.editor);
            if (!target) return;
            const viewport = viewportRect(root, win!);
            let delta = request.wholeControl ? tabControlDelta(target, viewport) : revealDelta(target, viewport);
            if (delta && request.wholeControl && tabOcclusion) delta = avoidTabStatus(target, viewport, delta, tabOcclusion());
            // Most editing is already visible: avoid inspecting every ancestor
            // unless translation is needed. Range/root reads remain a real cost.
            if (!delta || (!delta.dx && !delta.dy)) return;
            if (!internallyClipped(request.editor, target, root, win!, request.wholeControl)
                && valid(request.editor, request.lease, request.wholeControl)) pan(delta);
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
    listen(root, 'focusin', event => {
        const navigation = tabIntent; cancelTab();
        const control = activeControl(root);
        if (control && navigation && event.isTrusted && event.target === control
            && (event as FocusEvent).relatedTarget === navigation.origin && navigation.lease.isCurrent()) schedule(true, control);
        else schedule(true);
    });
    listen(root, 'focusout', () => { cancel(); composing = null; imeKey = null; });
    listen(root, 'compositionstart', event => {
        cancelTab();
        composing = belongs(event); if (composing) { imeKey = null; cancel(); }
    });
    listen(root, 'compositionend', event => {
        const editor = belongs(event);
        if (!editor || (editor !== composing && editor !== imeKey)) return;
        composing = null; imeKey = null; schedule(true);
    });
    listen(root, 'keydown', event => {
        cancelTab();
        const key = event as KeyboardEvent, editor = belongs(event);
        if (editor && (key.isComposing || key.keyCode === 229)) { imeKey = editor; cancel(); }
        // Observe native Tab intent without consuming it or choosing the next control.
        // Focusout may end inline editing; the card lease survives that transition.
        if (key.key !== 'Tab' || !key.isTrusted || key.ctrlKey || key.metaKey || key.altKey
            || key.isComposing || key.keyCode === 229 || composing || imeKey || pointing || doc.hidden || destroyed) return;
        const origin = activeTarget(root);
        if (!origin || event.target !== origin) return;
        const lease = owner(origin);
        if (!lease?.isCurrent()) return;
        tabIntent = {origin, lease};
        tabFrame = win!.requestAnimationFrame(() => { tabFrame = 0; tabIntent = null; });
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
    listen(doc, 'selectionchange', () => { if (!pending?.wholeControl) schedule(); });
    listen(root, 'pointerdown', event => {
        cancelTab();
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
            destroyed = true; cancel(); cancelTab(); composing = null; imeKey = null; pointing = false;
            for (const release of releases) release();
        },
    };
}
