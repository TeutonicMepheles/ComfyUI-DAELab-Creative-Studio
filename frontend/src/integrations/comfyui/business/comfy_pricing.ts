import jsonata from '../vendor/jsonata/jsonata.mjs';
import type { GenerationPriceInput, GenerationCredits } from '../../../contracts/business.js';

type InputSpec = [unknown, { default?: unknown; options?: unknown[] }];
interface NodeDefinition {
  price_badge?: { engine: string; expr: string; depends_on: {
    widgets?: { name: string; type: string }[]; inputs?: string[]; input_groups?: string[];
  } };
  input?: { required?: Record<string, InputSpec>; optional?: Record<string, InputSpec> };
}
const seedanceNodes: Record<string, string> = {text2video: 'ByteDance2TextToVideoNode', singleImage2video: 'ByteDance2FirstLastFrameNode', frames2video: 'ByteDance2FirstLastFrameNode', mixed2video: 'ByteDance2ReferenceNodeV2', image2video: 'ByteDance2ReferenceNodeV2'};
const minimaxNodes: Record<string, string> = {text2video: 'MinimaxHailuo03TextToVideoNode', singleImage2video: 'MinimaxHailuo03FirstLastFrameNode', frames2video: 'MinimaxHailuo03FirstLastFrameNode', mixed2video: 'MinimaxHailuo03ReferenceNode', image2video: 'MinimaxHailuo03ReferenceNode'};

export function createComfyPriceEstimator(definition: (type: string) => NodeDefinition | undefined) {
  return async (input: GenerationPriceInput): Promise<GenerationCredits | null> => {
    const model = input.model === 'Minimax H3' ? 'MiniMax H3' : input.model;
    const type = input.kind === 'video' ? (model.startsWith('Seedance ') ? seedanceNodes : model === 'MiniMax H3' ? minimaxNodes : {})[input.mode] : undefined;
    if (!type) return null;
    const node = definition(type), badge = node?.price_badge;
    if (!node || !badge || badge.engine !== 'jsonata') return null;
    const specs = {...node.input?.required, ...node.input?.optional};
    const choices = specs.model?.[1]?.options as { key: string; inputs: { required?: Record<string, InputSpec>; optional?: Record<string, InputSpec> } }[] | undefined;
    const selected = choices?.find(option => option.key === model);
    if (!selected) return null;
    for (const [name, spec] of Object.entries({...selected.inputs.required, ...selected.inputs.optional})) specs['model.' + name] = spec;
    const widgets: Record<string, unknown> = {};
    for (const {name, type: widgetType} of badge.depends_on.widgets || []) {
      const setting = name.replace(/^model\./, ''), spec = specs[name];
      let value = name === 'model' ? model : input.settings[setting === 'generate_audio' ? 'enableSound' : setting];
      value ??= spec?.[1]?.default ?? spec?.[1]?.options?.[0] ?? (Array.isArray(spec?.[0]) ? spec[0][0] : null);
      if (widgetType === 'BOOLEAN') value = value === true || value === 'on' || value === 1;
      else if (widgetType === 'INT' || widgetType === 'FLOAT') value = value === null ? null : Number(value);
      else if (typeof value === 'string') value = value.trim().toLowerCase();
      widgets[name] = value;
    }
    const frames = input.mode === 'singleImage2video' || input.mode === 'frames2video';
    const inputs = Object.fromEntries((badge.depends_on.inputs || []).map(name => [name, {connected: frames && (name === 'first_frame' || name === 'last_frame' && input.mode === 'frames2video')} ]));
    const inputGroups = Object.fromEntries((badge.depends_on.input_groups || []).map(name => [name, frames ? 0 : input.media.filter(media => name === 'model.reference_' + media.kind + 's').length]));
    const result = await jsonata(badge.expr).evaluate({widgets, inputs, inputGroups}) as Record<string, unknown> | undefined;
    if (!result) return null;
    const values = result.type === 'usd' ? [result.usd] : result.type === 'range_usd' ? [result.min_usd, result.max_usd] : result.type === 'list_usd' && Array.isArray(result.usd) ? result.usd : [];
    if (!values.length || values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) return null;
    // Comfy's documented conversion: https://support.comfy.org/articles/5846341390-how-credits-work-in-comfy
    return {min: Math.min(...values as number[]) * 211, max: Math.max(...values as number[]) * 211};
  };
}
