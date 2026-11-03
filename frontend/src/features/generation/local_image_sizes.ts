export type LocalImageSizePreset = {ratio:string; width:number; height:number};
type ImageSizeSchema = {config?:{imageSize?:{min:number; max:number; step:number; maxPixels:number; presets:LocalImageSizePreset[]}}};

/** Pixel presets come from the same backend capability that builds the graph. */
export function localImageSizePresets(schema: ImageSizeSchema): LocalImageSizePreset[] {
  const size=schema.config?.imageSize;
  if(!size||![size.min,size.max,size.step,size.maxPixels].every(value=>Number.isInteger(value)&&value>0)||!Array.isArray(size.presets))return [];
  return size.presets.filter(preset=>{
    const match=String(preset.ratio).match(/^(\d+):(\d+)$/);
    return match&&Number(match[1])>0&&Number(match[2])>0&&[preset.width,preset.height].every(value=>Number.isInteger(value)&&value>=size.min&&value<=size.max&&value%size.step===0)
      &&preset.width*preset.height<=size.maxPixels&&Math.abs(preset.width/preset.height-Number(match[1])/Number(match[2]))<1e-8;
  }).map(preset=>({...preset}));
}
