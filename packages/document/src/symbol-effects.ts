import type { Vector } from './index';
import { isBlendMode } from './blend-modes';

// Keep the document's existing placement fields so saved artwork and renderer
// adapters can use the same representation for authored and sampled effects.
export const SYMBOL_EFFECTS = [
  { id: 'opacity', field: 'opacity', label: 'Opacity', initial: 1, buttons: true },
  { id: 'tint', field: 'instanceTint', label: 'Tint', initial: { color: '#ffffff', amount: 0.25 } },
  { id: 'blur', field: 'instanceBlur', label: 'Blur', initial: 4 },
  { id: 'blend', field: 'instanceBlend', label: 'Blend mode', initial: 'multiply' },
] as const;

type SymbolEffectField = (typeof SYMBOL_EFFECTS)[number]['field'];
export type SymbolEffectPatch = { [Field in SymbolEffectField]?: Vector[Field] };

export function applySymbolEffectPatch(shape: Vector, patch: SymbolEffectPatch) {
  for (const { field } of SYMBOL_EFFECTS) {
    if (!Object.hasOwn(patch, field)) continue;
    if (patch[field] === undefined) delete shape[field];
    else Object.assign(shape, { [field]: patch[field] });
  }
}

function effectValue(object: object, field: string): unknown {
  const entry = Object.getOwnPropertyDescriptor(object, field);
  if (!entry && !(field in object)) return undefined;
  if (!entry?.enumerable || !('value' in entry))
    throw Error('Symbol motion effects require original data values.');
  return entry.value;
}

export function validateSymbolMotionEffects(shape: Vector) {
  if (shape.kind !== 'symbol') return;
  const opacity = effectValue(shape, 'opacity');
  const blur = effectValue(shape, 'instanceBlur');
  const blend = effectValue(shape, 'instanceBlend');
  const tint = effectValue(shape, 'instanceTint');
  const percent = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  if (opacity !== undefined && !percent(opacity)) throw Error('Invalid symbol motion opacity.');
  if (blur !== undefined && (typeof blur !== 'number' || !Number.isInteger(blur) || blur < 1 || blur > 32))
    throw Error('Invalid symbol motion blur.');
  if (blend !== undefined && !isBlendMode(blend))
    throw Error('Invalid symbol motion blend mode.');
  if (tint !== undefined) {
    if (!tint || typeof tint !== 'object' || Array.isArray(tint)) throw Error('Invalid symbol motion tint.');
    const color = effectValue(tint, 'color');
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color) || !percent(effectValue(tint, 'amount')))
      throw Error('Invalid symbol motion tint.');
  }
}
