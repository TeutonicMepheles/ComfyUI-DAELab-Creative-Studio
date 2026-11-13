export const TEXT_TEMPLATES = [
    { id: 'scene', label: '画面描述', text: '保留原文主体、动作和场景，明确景别、构图、光线与风格。仅输出可用于生成的画面描述，不增加原文没有的人物、事件或产品细节。' },
    { id: 'camera', label: '镜头运动', text: '保留原文主体与场景，只整理镜头起止、景别、运动方向及时间变化；未指定时不编造镜头运动。仅输出镜头提示词，不添加新情节。' },
    { id: 'references', label: '参考图引用', text: '保留输入中的参考图引用、序号及其对应关系，明确各参考图约束的主体、外观或风格；不虚构未提供的参考图，不修改引用标记。仅输出生成提示词。' },
];
export const DEFAULT_TEXT_INSTRUCTION = '保留原意，把已有主体、动作和变化写得更具体。保留原话、数量、顺序和素材引用。未说明的时间、地点、人物、运镜和声音留白。';
const previousSeedanceOpening = '先写原文中的主体与场景，再按发生顺序描述动作和画面变化。区分主体动作与运镜，沿用已有参考素材的编号与用途。只有原文明确分镜时才分镜。';
const previousFrameClause = '已指定首尾帧时写清两帧之间的连续变化；';
const previousFrameLine = '首帧是动作起点，尾帧是落点；两帧都给出时描述中间可见的变化。';
const VIDEO_INSTRUCTIONS = {
    seedance: '原文有动作或对白时，首句直接写谁做了第一个动作或说了什么，其他人物在各自行动时引入。原文只有静态画面时直接描述所见。区分主体动作与运镜，沿用已有参考素材的编号与用途。只有原文明确分镜时才分镜。',
    minimax: '写中文镜头描述，台词、歌词和画面文字保留原语言。普通生成从 integrated_multimodal_description 的 [Shot 1] 开始。已指定完整参考时写明素材与主体的对应关系。声音与配乐分别写入 overall_soundscape 和 non_diegetic_music，不虚构声音。',
};
const reverseScene = '观察参考图片，用中文描述画面中可见的主体、位置、姿态和环境。保留可辨认的文字；看不清的细节留白。';
const previousReverseInstructions = {
    seedance: reverseScene + '把这一帧写成视频的起始画面。只有另有明确要求时，才接写后续动作、运镜或声音；台词用 {原话}，字幕用 〖原文〗。',
    minimax: reverseScene + '用中文写出当前镜头的景别、构图和人物与环境的关系。只有明确指定首帧、尾帧或角色参考时才写出对应用途，不从静态姿势推断后续剧情或对白。',
    image: reverseScene + '按主体及其空间关系、构图、光线、色彩、材质和画风组织成一段可用于重现这张图片的提示词。',
};
const priorReverseInstructions = {
    seedance: reverseScene + '按用户指定的用途引用图片：用作首帧时写起始画面，用作人物或风格参考时写清需要沿用的特征。未指定用途只描述画面。只对明确要求的声音或字幕使用标记：{台词}、<音效>、（音乐）、〖字幕〗。',
    minimax: reverseScene + '只有明确指定首帧、尾帧或全能参考时才选择格式。首尾帧先写图片对应的起点或落点，再写 integrated_multimodal_description、overall_soundscape、non_diegetic_music；全能参考依次写 subject_definitions、summary、retention_analysis、detailed_description 和两个声音字段，说明图片中哪些特征要保留。未指定用途时只描述画面。字段名保留英文，描述用中文，不编造对白或时长。',
    image: previousReverseInstructions.image + '有编辑要求时说明修改对象和改后效果，保留其余可见内容；需要呈现的字样用双引号逐字注明。',
};
const REVERSE_INSTRUCTIONS = {
    seedance: reverseScene + '若指定了人物、构图或风格参考，描述相应的可见特征。只对明确要求的声音或字幕使用标记：{台词}、<音效>、（音乐）、〖字幕〗。',
    minimax: reverseScene + '普通镜头按 integrated_multimodal_description、overall_soundscape、non_diegetic_music 组织内容。明确为全能参考时用 subject_definitions、summary、retention_analysis、detailed_description 和两个声音字段组织已有信息。保留可见特征和已给出的素材引用，正文用中文，不编造对白或时长。',
    image: priorReverseInstructions.image,
};
function instructionTarget(state) {
    return state.purpose === 'image' ? 'image' : state.videoTarget === 'minimax' ? 'minimax' : 'seedance';
}
function defaultInstruction(target) {
    if (target === 'image')
        return DEFAULT_TEXT_INSTRUCTION;
    const lines = [VIDEO_INSTRUCTIONS[target]];
    if (target === 'seedance')
        lines.push('把已有事件写成连贯的画面：写清谁先做什么、谁随后做什么。直接从动作写起，避免先列人物再重复叙述。', '说话人后用 {原话} 逐字标出台词，保留原语言。音效用 <音效>，配乐用（音乐），字幕用 〖字幕原文〗。只标原文明确要求的内容，不把对白自动写成字幕。');
    if (target === 'minimax')
        lines.push('按播放顺序写出已有的起始状态、动作过程和结束状态。分清主体在移动还是镜头在移动；只有原文给出方向、幅度、速度或切镜点时，才具体描述。', '参考素材只承担原文指定的身份、场景、风格或运镜作用。', '原文中说出的每句台词都要逐字保留，按原顺序写进对应镜头；不能改成口型、发声或问候的描述。说话人明确时沿用同一编号，如 (S1)。中文原话写在 <d>[Chinese]…</d> 内。屏幕文字保留原文。只有一句问候且没有画面信息时，直接保留原句，不补说话人、朝向、镜头或声音。');
    return [...lines, DEFAULT_TEXT_INSTRUCTION].join('\n');
}
export function processingInstruction(state, rowInstruction) {
    if (state.rewriteStrength)
        return rowInstruction ?? state.instruction ?? '';
    const target = instructionTarget(state);
    if (state.slotInstruction !== undefined || rowInstruction !== undefined) {
        const linked = rowInstruction ?? '';
        if (state.mode === 'reverse')
            return [REVERSE_INSTRUCTIONS[target], linked].filter(Boolean).join('\n\n');
        return target === 'image' ? linked : [defaultInstruction(target), linked].filter(Boolean).join('\n\n');
    }
    const text = polishInstruction(state, target);
    if (state.mode === 'reverse') {
        const polish = defaultInstruction(target);
        for (const old of [previousReverseInstructions[target], priorReverseInstructions[target]]) {
            if (text === old || text.startsWith(old + '\n'))
                return REVERSE_INSTRUCTIONS[target] + text.slice(old.length);
        }
        if (text === polish || TEXT_TEMPLATES.some(t => t.text === text))
            return REVERSE_INSTRUCTIONS[target];
        if (text.startsWith(polish + '\n'))
            return REVERSE_INSTRUCTIONS[target] + text.slice(polish.length);
    }
    return text;
}
function polishInstruction(state, target) {
    if (state.instruction === undefined || state.instruction === DEFAULT_TEXT_INSTRUCTION)
        return defaultInstruction(target);
    if (target !== 'image') {
        if (TEXT_TEMPLATES.some(template => template.text === state.instruction) ||
            state.instruction === TEXT_TEMPLATES.map(template => template.text).join('\n'))
            return defaultInstruction(target);
        const oldPrefix = target === 'seedance' ? '为 Seedance 整理提示词。' : '为 MiniMax H3 ';
        let text = state.instruction;
        if (target === 'seedance') {
            for (const opening of [previousSeedanceOpening, oldPrefix + previousSeedanceOpening]) {
                if (text === opening || text.startsWith(opening + '\n')) {
                    text = VIDEO_INSTRUCTIONS.seedance + text.slice(opening.length);
                    break;
                }
            }
        }
        if (target === 'minimax') {
            const current = VIDEO_INSTRUCTIONS.minimax;
            const previous = current.replace('已指定完整参考时', previousFrameClause + '已指定完整参考时');
            const withoutTitle = text.startsWith(oldPrefix) ? text.slice(oldPrefix.length) : text;
            const chinese = withoutTitle.replace(/^写英文镜头描述/, '写中文镜头描述');
            for (const opening of [previous, current]) {
                if (chinese === opening || chinese.startsWith(opening + '\n')) {
                    text = current + chinese.slice(opening.length).replace('\n' + previousFrameLine + '参考素材', '\n参考素材');
                    break;
                }
            }
        }
        if (text.startsWith(oldPrefix + VIDEO_INSTRUCTIONS[target]))
            text = text.slice(oldPrefix.length);
        if (text === VIDEO_INSTRUCTIONS[target] + '\n' + DEFAULT_TEXT_INSTRUCTION)
            return defaultInstruction(target);
        return text;
    }
    return state.instruction;
}
export function changeInstructionTarget(state, key, value) {
    if (state[key] === value)
        return;
    if (state.rewriteStrength) {
        state[key] = value;
        return;
    }
    const field = state.slotInstruction === undefined ? 'instruction' : 'manualInstruction';
    const drafts = state.instructionDrafts ??= {};
    const previous = instructionTarget(state);
    drafts[state.mode === 'reverse' ? 'reverse-' + previous : previous] = state[field] ?? (state.mode === 'reverse' ? REVERSE_INSTRUCTIONS[previous] : defaultInstruction(previous));
    state[key] = value;
    const next = instructionTarget(state);
    state[field] = state.mode === 'reverse' ? drafts['reverse-' + next] ?? REVERSE_INSTRUCTIONS[next] : drafts[next] ?? defaultInstruction(next);
}
