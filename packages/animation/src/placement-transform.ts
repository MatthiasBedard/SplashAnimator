import type { Layer, Project, Vector } from '../../document/src';
import { graphicVisibilityOwner } from './placement-visibility';

export type PlacementTransform = { x: number; y: number; rotation: number };
export type PlacementBasis = [number, number, number, number];
export type TransformEntry = [string, number, number, number] | [string, number, number, number, PlacementBasis];
export const replayTransformByteLimit = 64 * 1024 * 1024;
export const replayTransformSize = (entries: readonly TransformEntry[]) =>
  new TextEncoder().encode(JSON.stringify(entries)).byteLength;

export function captureReplayTransforms(pose: object): TransformEntry[] | undefined {
  const field = Object.getOwnPropertyDescriptor(pose, 'placementTransforms');
  if (!field) return undefined;
  if (!('value' in field)) throw Error('Invalid replay placement transform field.');
  if (field.value !== undefined) return readPlacementTransforms(field.value);
}
type TransformSource = Pick<Project, 'symbols' | 'layerMasks' | 'opacityBindings'>;

export function graphicTransformOwner(project: TransformSource) {
  const owner = graphicVisibilityOwner(project);
  const masked = new Set(project.layerMasks?.flatMap(mask => [mask.maskLayerId, ...mask.layerIds]));
  return (layer: Layer, frame: number, shape: Vector) => {
    if (!layer.visible || masked.has(layer.id)) return undefined;
    return owner(layer, frame, shape);
  };
}

// This validator is also embedded in the isolated worker.
export function readPlacementTransforms(value: unknown): TransformEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10000) throw Error('Invalid script placement transform state.');
  const keys = new Set<string>();
  function ownData(object: unknown[], index: number): unknown {
    const field = Object.getOwnPropertyDescriptor(object, index);
    if (!field?.enumerable || !('value' in field)) throw Error('Invalid script placement transform entry.');
    return field.value;
  }
  function readBasis(value: unknown): PlacementBasis {
    if (!Array.isArray(value) || value.length !== 4) throw Error('Placement basis requires four coefficients.');
    const a = ownData(value, 0), b = ownData(value, 1), c = ownData(value, 2), d = ownData(value, 3);
    if (typeof a !== 'number' || typeof b !== 'number' || typeof c !== 'number' || typeof d !== 'number' ||
        ![a,b,c,d].every(n => Number.isFinite(n) && Math.abs(n) <= 100000) ||
        Math.abs(a*d - b*c) < 1e-10)
      throw Error('Placement basis must be bounded, finite and nonsingular.');
    return [a,b,c,d];
  }
  return Array.from({length:value.length}, (_, index) => {
    const entry = ownData(value, index);
    if (!Array.isArray(entry) || (entry.length !== 4 && entry.length !== 5))
      throw Error('Invalid script placement transform entry.');
    const key = ownData(entry, 0), x = ownData(entry, 1), y = ownData(entry, 2), rotation = ownData(entry, 3);
    if (typeof key !== 'string' || !key || keys.has(key) ||
        typeof x !== 'number' || typeof y !== 'number' || typeof rotation !== 'number' ||
        ![x, y, rotation].every(n => Number.isFinite(n) && Math.abs(n) <= 100000))
      throw Error('Placement transform requires bounded finite X, Y and rotation.');
    keys.add(key);
    return entry.length === 5 ? [key,x,y,rotation,readBasis(ownData(entry,4))] : [key,x,y,rotation];
  });
}
