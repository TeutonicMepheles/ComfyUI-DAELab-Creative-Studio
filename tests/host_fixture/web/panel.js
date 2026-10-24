import {app} from '/scripts/app.js';
import {bindCreativeField} from '/extensions/ComfyUI-DAELab-Creative-Studio/ui/creative_field.mjs';
import {bindCreativeButton} from '/extensions/ComfyUI-DAELab-Creative-Studio/ui/creative_button.mjs';
import {bindPanelAvailability} from '/extensions/ComfyUI-DAELab-Creative-Studio/ui/creative_panel_state.mjs';
import {DocumentController} from '/extensions/ComfyUI-DAELab-Creative-Studio/application/document_controller.js';

const TYPE = 'StudioTest.Panel';
function install(node) {
    if (node.studioTestPanel) return;
    const widget = node.widgets.find(w => w.name === 'text');
    widget.hidden = true;
    widget.computeSize = () => [0, -4];
    if (widget.inputEl) widget.inputEl.style.display = 'none';
    const root = document.createElement('section');
    root.className = 'dae-ui dae-studio';
    root.style.cssText = 'padding:12px;box-sizing:border-box;width:100%;min-width:0';
    const label = document.createElement('label');
    label.textContent = '验收文本';
    const field = document.createElement('textarea');
    field.setAttribute('aria-label', '验收文本');
    field.value = widget.value;
    field.rows = 4;
    field.style.cssText = 'display:block;width:100%;box-sizing:border-box;resize:vertical';
    label.append(field);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '追加标记';
    const status = document.createElement('output');
    status.style.cssText = 'display:block;overflow-wrap:anywhere';
    root.append(label, button, status);
    let revision = 0;
    const controller = new DocumentController({
        read: () => node,
        identity: () => ({workflowSession: String(node.graph?.id || 'fixture'), epoch: 0, documentId: String(node.id)}),
        revision: () => revision,
        transact: (name, edit) => {
            node.graph?.beforeChange?.();
            try { edit(node); revision++; }
            finally { node.graph?.afterChange?.(); }
        },
    });
    field.addEventListener('change', () => controller.edit('text', () => {widget.value = field.value;}));
    button.onclick = async () => {
        controller.edit('append', () => {widget.value = String(widget.value) + ' ✓';});
        field.value = widget.value;
        status.textContent = '已更新本实例';
    };
    for (const event of ['pointerdown', 'keydown', 'dblclick', 'wheel']) root.addEventListener(event, e => {
        if (event === 'keydown' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !e.isComposing && e.keyCode !== 229) return;
        e.stopPropagation();
    });
    const release = [bindCreativeField(field), bindCreativeButton(button), bindPanelAvailability(node, root)];
    node.addDOMWidget('acceptance', 'custom', root, {serialize: false, getMinHeight: () => 200, hideOnZoom: false});
    node.studioTestPanel = {root, fields: [field], buttons: [button], sync() {field.value = widget.value;}, destroy() {controller.dispose(); release.forEach(fn => fn()); root.remove(); delete node.studioTestPanel;}};
    node.setSize([360, 260]);
}
function registerAdapter() {
    const api = globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')];
    if (!api || registerAdapter.done) return;
    api.registerAdapter('studio.acceptance.fixture', {
        matches: node => node.type === TYPE,
        width: 360, minWidth: 240, expanded: true, resizable: true, fullHeight: true,
        panel: node => node.studioTestPanel,
        menu: [{label: '隔离验收面板', type: TYPE, icon: 'file-text-line'}],
    });
    registerAdapter.done = true;
}
globalThis.addEventListener('daelab:creative-canvas-ready', registerAdapter);
registerAdapter();
app.registerExtension({
    name: 'Studio.AcceptanceFixture',
    beforeRegisterNodeDef(type, definition) {
        if (definition.name !== TYPE) return;
        for (const method of ['onNodeCreated', 'onConfigure']) {
            const previous = type.prototype[method];
            type.prototype[method] = function() {const result = previous?.apply(this, arguments); install(this); this.studioTestPanel?.sync(); return result;};
        }
        const removed = type.prototype.onRemoved;
        type.prototype.onRemoved = function() {this.studioTestPanel?.destroy(); return removed?.apply(this, arguments);};
    },
});
