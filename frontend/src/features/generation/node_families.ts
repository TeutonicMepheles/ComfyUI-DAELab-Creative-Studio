// Public native identities. The legacy mixed node remains loadable.
export const LEGACY_GENERATION_NODE = 'DAELAB.LibTV.VideoGenerate';
export const IMAGE_GENERATION_NODE = 'DAELAB.ImageGenerate';
export const VIDEO_GENERATION_NODE = 'DAELAB.VideoGenerate';
export const GENERATION_NODE_TYPES: readonly string[] = [LEGACY_GENERATION_NODE, IMAGE_GENERATION_NODE, VIDEO_GENERATION_NODE];
export const isGenerationNode = (type: string): boolean => GENERATION_NODE_TYPES.includes(type);
export function generationNodeKind(type: string): 'image' | 'video' | null {
    return type === IMAGE_GENERATION_NODE ? 'image' : type === VIDEO_GENERATION_NODE ? 'video' : null;
}
