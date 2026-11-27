import type { Project } from '../../document/src';
import type { StagePlacement } from './stage-placements';
import { applyStageVisibility } from './stage-visibility';
import { applyStageSpawns, type SpawnPose } from './stage-spawn';
import type { ScriptState } from './timeline';
import { graphicTransformOwner, readPlacementTransforms, type PlacementTransform, type PlacementBasis, type TransformEntry } from '../../animation/src/placement-transform';
export { graphicTransformOwner, readPlacementTransforms, type PlacementTransform, type PlacementBasis } from '../../animation/src/placement-transform';

export const placementTransformsKey = '$splashPlacementTransforms';
export function createStageTransforms(
  lookup: (name: string, layerId?: string) => StagePlacement | undefined,
  state: ScriptState,
  stateKey: string,
  read: typeof readPlacementTransforms,
) {
  const identity: Readonly<PlacementBasis> = [1,0,0,1];
  function currentEntry(placement: StagePlacement) {
    return read(state[stateKey]).find(([key]) => key === placement.visibilityKey);
  }
  function writable(name: string, layerId?: string) {
    const placement = lookup(name, layerId);
    if (!placement?.visibilityKey || !placement.authoredTransform)
      throw Error('Transforms require an owned named graphic on an ordinary visible layer.');
    return { placement, key: placement.visibilityKey, authored: placement.authoredTransform };
  }
  function store(entry: TransformEntry, authored: Readonly<PlacementTransform>, authoredBasis: Readonly<PlacementBasis>) {
    const [key,x,y,rotation,basis] = entry;
    const entries = read(state[stateKey]).filter(([other]) => other !== key);
    const changedBasis = basis && !basis.every((n,i) => n === authoredBasis[i]);
    if (changedBasis) entries.push(entry);
    else if (x !== authored.x || y !== authored.y || rotation !== authored.rotation)
      entries.push([key,x,y,rotation]);
    if (entries.length) state[stateKey] = entries;
    else delete state[stateKey];
  }
  return {
    getTransform(name: string, layerId?: string) {
      const placement = lookup(name, layerId);
      if (!placement?.authoredTransform) return undefined;
      const entry = currentEntry(placement);
      return Object.freeze(entry
        ? { x: entry[1], y: entry[2], rotation: entry[3] }
        : { ...placement.authoredTransform });
    },
    setTransform(name: string, transform: PlacementTransform, layerId?: string) {
      const {placement,key,authored} = writable(name,layerId);
      if (!transform || typeof transform !== 'object') throw Error('Invalid placement transform.');
      const [x, y, rotation] = ['x', 'y', 'rotation'].map(field =>
        Object.getOwnPropertyDescriptor(transform, field)?.value,
      );
      const basis = currentEntry(placement)?.[4];
      const [entry] = read([basis ? [key,x,y,rotation,basis] : [key,x,y,rotation]]);
      store(entry,authored,placement.authoredBasis ?? identity);
    },
    getBasis(name: string, layerId?: string): Readonly<PlacementBasis> | undefined {
      const placement = lookup(name,layerId);
      if (!placement?.authoredTransform) return undefined;
      const basis = currentEntry(placement)?.[4] ?? placement.authoredBasis ?? identity;
      return Object.freeze([...basis]);
    },
    setBasis(name: string, basis: Readonly<PlacementBasis>, layerId?: string) {
      const {placement,key,authored} = writable(name,layerId);
      const current = currentEntry(placement);
      const [entry] = read([[key,current?.[1] ?? authored.x,current?.[2] ?? authored.y,
        current?.[3] ?? authored.rotation,basis]]);
      store(entry,authored,placement.authoredBasis ?? identity);
    },
  };
}

export function applyStagePresentation(project: Project, state?: ScriptState, buttons?: Set<string>, pose?: SpawnPose): Project {
  const transforms = new Map(readPlacementTransforms(state?.[placementTransformsKey])
    .map(([key, x, y, rotation, basis]) => [key, { x, y, rotation, ...(basis ? {transform:basis} : {}) }]));
  if (!transforms.size) return applyStageVisibility(applyStageSpawns(project,state,pose), state, buttons);
  const owner = graphicTransformOwner(project);
  const layers = project.layers.map(layer => ({
    ...layer,
    keys: layer.keys.map(key => ({
      ...key,
      shapes: key.shapes.map(shape => {
        const token = owner(layer, key.frame, shape);
        if (!token) return shape;
        const transform = transforms.get(token);
        if (!transform) return shape;
        transforms.delete(token);
        return { ...shape, ...transform };
      }),
    })),
  }));
  if (transforms.size) throw Error('Unknown script placement transform target.');
  return applyStageVisibility(applyStageSpawns({...project,layers},state,pose), state, buttons);
}
