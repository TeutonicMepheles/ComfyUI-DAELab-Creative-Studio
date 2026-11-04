const generationTypes = new Set(['DAELAB.LLMStylePreviewB','DAELAB.ImageGenerate','DAELAB.VideoGenerate']);
export type CreationSection = '输入' | '生成' | '剪辑';
export function creationSection(type: string): CreationSection {
    return type === 'DAELAB.VideoEdit' ? '剪辑' : generationTypes.has(type) ? '生成' : '输入';
}
export function orderedCreationEntries<T extends {type: string}>(entries: readonly T[]): T[] {
    const rank: Record<CreationSection, number> = {'输入':0,'生成':1,'剪辑':2};
    return [...entries].sort((a,b)=>rank[creationSection(a.type)]-rank[creationSection(b.type)]);
}
