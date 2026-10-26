const CANVAS_STATE = 'daelabCreativeCanvasV1';
type PlainData = { prototype: object | null; descriptors: Record<string, PropertyDescriptor> };

function plainData(value: unknown): PlainData | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype: object | null = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype || 'toJSON' in value) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  // Do not pre-read accessors or move their receiver onto a shallow copy.
  if (Reflect.ownKeys(descriptors).some(key => !('value' in Reflect.get(descriptors, key)))) return null;
  return { prototype, descriptors };
}

function own(data: PlainData, key: string): PropertyDescriptor | undefined {
  return Object.hasOwn(data.descriptors, key) ? data.descriptors[key] : undefined;
}

function copyWith(data: PlainData, replacements: Record<string, unknown>): object {
  const descriptors = { ...data.descriptors };
  for (const key of Object.keys(replacements)) descriptors[key] = { ...own(data, key), value: replacements[key] };
  // Descriptor construction preserves own __proto__ and unknown keys as data.
  return Object.create(data.prototype, descriptors) as object;
}

/** Compare edits while leaving the known Canvas navigation coordinates out.
 * This is not saved data or a cache. Nonplain/accessor/toJSON paths retain the
 * original stringify contract; arbitrary Proxy behavior is not supported by
 * the plain-data projection. No graph-wide clone or parse is performed.
 */
export function nativeEditHistoryStamp(snapshot: unknown): string | undefined {
  let comparable = snapshot;
  try {
    const root = plainData(snapshot);
    const extra = root && plainData(own(root, 'extra')?.value);
    const canvas = extra && plainData(own(extra, CANVAS_STATE)?.value);
    const version = canvas && own(canvas, 'version');
    const viewport = canvas && version?.enumerable && version.value === 1 && plainData(own(canvas, 'viewport')?.value);
    if (root && extra && canvas && viewport) {
      const x = own(viewport, 'x'), y = own(viewport, 'y'), zoom = own(viewport, 'zoom');
      if (x?.enumerable && y?.enumerable && zoom?.enumerable
          && Number.isFinite(x.value) && Number.isFinite(y.value) && Number.isFinite(zoom.value)
          && zoom.value >= 0.15 && zoom.value <= 2) {
        const nextViewport = copyWith(viewport, { x: 0, y: 0, zoom: 1 });
        comparable = copyWith(root, { extra: copyWith(extra, {
          [CANVAS_STATE]: copyWith(canvas, { viewport: nextViewport }),
        }) });
      }
    }
  } catch {
    // Metadata inspection is only an eligibility check. Keep native errors and
    // custom serialization behavior on the single stringify below.
  }
  return JSON.stringify(comparable);
}
