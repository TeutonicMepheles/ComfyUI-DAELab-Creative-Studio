const generationTypes = new Set(['DAELAB.LLMStylePreviewB', 'DAELAB.ImageGenerate', 'DAELAB.VideoGenerate']);
export function creationSection(type) {
    return type === 'DAELAB.VideoEdit' ? '剪辑' : generationTypes.has(type) ? '生成' : '输入';
}
export function orderedCreationEntries(entries) {
    const rank = { '输入': 0, '生成': 1, '剪辑': 2 };
    return [...entries].sort((a, b) => rank[creationSection(a.type)] - rank[creationSection(b.type)]);
}
