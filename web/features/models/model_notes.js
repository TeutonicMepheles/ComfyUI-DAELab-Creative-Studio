const modes = { text2video: '文生视频', singleImage2video: '首帧', frames2video: '首尾帧', image2video: '图片参考', mixed2video: '混合参考', text2image: '文生图', image2image: '图片参考', reverse: '图片反推', polish: '文本润色' };
function precision(name) { return [...new Set(name.toUpperCase().match(/Q\d+_K(?:_[MSL])?|NVFP4|INT8|BF16|FP16|FP32|W\d+A\d+|AWQ/g) || [])].join(' / '); }
/** Only verified capability fields contribute; labels and tier names are not evidence. */
export function modelNoteText(entry) {
    const c = entry?.capability;
    if (!c)
        return '';
    const lines = [], weights = c.weightBinding;
    if (weights) {
        const roles = { diffusion_models: '主模型', video_vae: '视频VAE', text_encoders: '文本编码器' };
        for (const [key, label] of Object.entries(roles)) {
            const weight = weights[key];
            const name = weight && typeof weight === 'object' && 'name' in weight ? String(weight.name) : '';
            const p = precision(name);
            if (p)
                lines.push(`${label} ${p}`);
        }
        if (typeof weights.model === 'string') {
            const p = precision(weights.model);
            if (p)
                lines.push(`量化 ${p}`);
        }
    }
    const sample = c.sampling;
    if (sample?.sampler || Number.isFinite(sample?.steps))
        lines.push([sample?.sampler, Number.isFinite(sample?.steps) ? `${sample?.steps} 步` : ''].filter(Boolean).join(' · '));
    if (Number.isFinite(sample?.turboSteps))
        lines.push(`加速 ${sample?.turboSteps} 步（已绑定适配器）`);
    const items = c.schema?.properties?.modeType?.items;
    if (items)
        for (const [mode, range] of Object.entries(items)) {
            if (!modes[mode])
                continue;
            const r = Array.isArray(range) && range.length === 2 && range.every(n => typeof n === 'number') ? range : null;
            lines.push(modes[mode] + (r && (r[1] ?? 0) > 0 ? ` ${r[0] === r[1] ? r[0] : r.join('–')} 图` : ''));
        }
    for (const mode of c.modes || [])
        if (modes[mode])
            lines.push(modes[mode]);
    if (Number.isFinite(c.maxOutputTokens))
        lines.push(`最大输出 ${c.maxOutputTokens} tokens`);
    return lines.join('；');
}
let serial = 0;
const bound = new WeakSet();
let current = null, popup = null, frame = 0;
function hideNote() { cancelAnimationFrame(frame); popup?.remove(); popup = null; current = null; }
function placeNote() {
    if (!current?.isConnected || !popup) {
        hideNote();
        return;
    }
    const owner = current.closest('.generation-settings-popover') || current, r = owner.getBoundingClientRect();
    const below = Math.max(0, innerHeight - r.bottom - 16), above = Math.max(0, r.top - 16), available = Math.max(below, above);
    popup.style.width = Math.min(360, innerWidth - 16) + 'px';
    popup.style.maxHeight = available + 'px';
    popup.style.left = Math.max(8, Math.min(r.left, innerWidth - popup.offsetWidth - 8)) + 'px';
    popup.style.top = (below >= popup.offsetHeight ? r.bottom + 8 : Math.max(8, r.top - popup.offsetHeight - 8)) + 'px';
    frame = requestAnimationFrame(placeNote);
}
function showNote(control) {
    const text = control.querySelector('.dae-model-note')?.textContent;
    if (!text)
        return;
    hideNote();
    current = control;
    popup = document.createElement('small');
    popup.className = 'dae-model-note-popup';
    popup.textContent = text;
    popup.setAttribute('aria-hidden', 'true');
    document.body.append(popup);
    placeNote();
}
/** Notes do not resize controls or their observed popovers, including focus-to-pointer transitions. */
export function updateModelNote(control, entry) {
    if (!document.getElementById('dae-model-notes-style')) {
        const style = document.createElement('style');
        style.id = 'dae-model-notes-style';
        style.textContent = '.dae-model-note{position:absolute!important;width:1px!important;height:1px!important;clip-path:inset(50%);overflow:hidden;pointer-events:none}.dae-model-note-popup{position:fixed;z-index:2147483000;box-sizing:border-box;padding:8px 10px;border-radius:6px;background:var(--dae-surface,#262626);color:var(--dae-text-muted,#ccc);box-shadow:0 2px 8px #0006;white-space:normal;text-align:left;font:400 11px/1.45 sans-serif;overflow-wrap:anywhere;overflow:hidden;pointer-events:none}';
        document.head.append(style);
    }
    const text = modelNoteText(entry);
    let note = control.querySelector(':scope > .dae-model-note');
    if (!text) {
        if (current === control)
            hideNote();
        if (note && control.getAttribute('aria-describedby') === note.id)
            control.removeAttribute('aria-describedby');
        note?.remove();
        control.classList.remove('dae-model-note-owner');
        return;
    }
    if (!note) {
        note = document.createElement('small');
        note.className = 'dae-model-note';
        note.id = 'dae-model-note-' + (++serial);
        control.append(note);
    }
    note.textContent = text;
    control.classList.add('dae-model-note-owner');
    control.setAttribute('aria-describedby', note.id);
    if (!bound.has(control)) {
        bound.add(control);
        control.addEventListener('pointerenter', () => showNote(control));
        control.addEventListener('focus', () => showNote(control));
        control.addEventListener('pointerleave', () => { if (current === control && !control.matches(':focus-visible'))
            hideNote(); });
        control.addEventListener('blur', () => { if (current === control && !control.matches(':hover'))
            hideNote(); });
        control.addEventListener('keydown', event => { if (event.key === 'Escape' && current === control)
            hideNote(); });
    }
    if (current === control && popup)
        popup.textContent = text;
}
