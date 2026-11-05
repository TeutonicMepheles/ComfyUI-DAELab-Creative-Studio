/** Keep the body-mounted view aligned with the host's live canvas region. */
export function bindCanvasHostBounds(root: HTMLElement, region: () => HTMLElement | null, toolbar: () => HTMLElement | null = () => null) {
  let frame = 0;
  let target: HTMLElement | null = null;
  let controls: HTMLElement | null = null;
  let disposed = false;
  const schedule = () => {
    if (!disposed && !frame) frame = requestAnimationFrame(sync);
  };
  const resize = new ResizeObserver(schedule);
  function sync() {
    frame = 0;
    if (disposed) return;
    const next = region();
    const nextControls = toolbar();
    if (next !== target || nextControls !== controls) {
      resize.disconnect();
      target = next;
      controls = nextControls;
      for (let element = target; element; element = element.parentElement) resize.observe(element);
      if (controls) resize.observe(controls);
    }
    if (!target?.isConnected) return;
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const edges = {
      top: Math.max(0, rect.top), left: Math.max(0, rect.left),
      right: Math.max(0, innerWidth - rect.right), bottom: Math.max(0, innerHeight - rect.bottom),
    };
    for (const [edge, value] of Object.entries(edges)) {
      const property = `--dae-host-canvas-${edge}`;
      const text = `${value}px`;
      if (root.style.getPropertyValue(property) !== text) root.style.setProperty(property, text);
    }
    if (!root.hasAttribute('data-host-bounds')) root.setAttribute('data-host-bounds', '');
    const offset = controls?.isConnected ? Math.max(0, controls.getBoundingClientRect().bottom - edges.top) : 0;
    const text = `${offset}px`;
    if (root.style.getPropertyValue('--dae-host-toolbar-offset') !== text) root.style.setProperty('--dae-host-toolbar-offset', text);
  }
  const mutations = new MutationObserver(records => {
    if (records.some(record => record.target !== root && !root.contains(record.target))) schedule();
  });
  mutations.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden']});
  window.addEventListener('resize', schedule);
  sync();
  return {
    sync,
    destroy() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect(); mutations.disconnect();
      window.removeEventListener('resize', schedule);
      for (const edge of ['top', 'left', 'right', 'bottom']) root.style.removeProperty(`--dae-host-canvas-${edge}`);
      root.style.removeProperty('--dae-host-toolbar-offset');
      root.removeAttribute('data-host-bounds');
    },
  };
}
