import { TEXT_TEMPLATES, DEFAULT_TEXT_INSTRUCTION, processingInstruction } from './text_templates.js';
export const REWRITE_TEMPLATES = [
    { id: 'qwen-faithful', label: 'Qwen Image · 保真整理', purpose: 'image', strength: 'faithful' },
    { id: 'qwen-expand', label: 'Qwen Image · 生成扩写', purpose: 'image', strength: 'expand' },
    { id: 'minimax-faithful', label: 'MiniMax H3 · 保真整理', purpose: 'video', strength: 'faithful' },
    { id: 'minimax-expand', label: 'MiniMax H3 · 生成扩写', purpose: 'video', strength: 'expand' },
];
export const REWRITE_TASKS = [
    { id: 'text2image', label: '文生图', purpose: 'image' },
    { id: 'image-edit', label: '图片编辑', purpose: 'image' },
    { id: 'text2video', label: '文生视频', purpose: 'video' },
    { id: 'singleImage2video', label: '首帧', purpose: 'video' },
    { id: 'frames2video', label: '首尾帧', purpose: 'video' },
    { id: 'lastImage2video', label: '尾帧', purpose: 'video' },
    { id: 'reference', label: '全能参考', purpose: 'video' },
];
export function rewriteTemplateId(state) {
    if (!state.rewriteStrength)
        return '';
    return REWRITE_TEMPLATES.find(t => t.purpose === state.purpose && t.strength === state.rewriteStrength &&
        (t.purpose === 'image' || state.videoTarget === 'minimax'))?.id || '';
}
export function chooseRewriteTemplate(state, id) {
    const template = REWRITE_TEMPLATES.find(t => t.id === id);
    if (!template)
        return;
    const previous = state.purpose;
    const field = state.slotInstruction === undefined ? 'instruction' : 'manualInstruction';
    const old = state[field];
    const defaults = { ...state };
    delete defaults.instruction;
    delete defaults.rewriteStrength;
    if (!state.rewriteStrength && (old === DEFAULT_TEXT_INSTRUCTION || TEXT_TEMPLATES.some(t => t.text === old) || old === TEXT_TEMPLATES.map(t => t.text).join('\n') || old === processingInstruction(defaults)))
        state[field] = '';
    // On the first explicit switch, keep the user's saved requirements intact.
    state.purpose = template.purpose;
    if (template.purpose === 'video')
        state.videoTarget = 'minimax';
    state.rewriteStrength = template.strength;
    if (previous !== state.purpose || !REWRITE_TASKS.some(t => t.purpose === state.purpose && t.id === state.rewriteTask))
        state.rewriteTask = state.purpose === 'image' ? 'text2image' : 'text2video';
}
export function rewriteOptions(state) {
    if (!rewriteTemplateId(state))
        return undefined;
    const task = state.rewriteTask || (state.purpose === 'image' ? 'text2image' : 'text2video');
    return { version: 1, strength: state.rewriteStrength, task,
        ...(state.rewriteDuration !== undefined && state.purpose === 'video' ? { duration: state.rewriteDuration } : {}) };
}
