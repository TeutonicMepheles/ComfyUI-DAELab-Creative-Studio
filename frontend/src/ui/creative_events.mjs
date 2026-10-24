// Shared panel ownership: saving remains a native workflow command.
export function stopCanvasPropagation(event) {
    // Let the host save command reach its handler; IME and all other editor keys retain ownership.
    if(event.type==='keydown'&&(event.ctrlKey||event.metaKey)&&String(event.key).toLowerCase()==='s'&&!event.isComposing&&event.keyCode!==229)return;
    event.stopPropagation();
}
