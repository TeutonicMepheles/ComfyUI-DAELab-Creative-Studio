export function abovePopoverLayout(anchor, viewport, popup, alignment) {
    const maxHeight = Math.max(0, Math.min(viewport.height - 16, anchor.top - 16));
    const height = Math.min(popup.height, maxHeight);
    const desiredLeft = alignment ? alignment.anchorCenter - alignment.iconOffset : anchor.left;
    return { maxHeight, top: Math.max(8, anchor.top - height - 8), left: Math.max(8, Math.min(desiredLeft, viewport.width - popup.width - 8)) };
}
