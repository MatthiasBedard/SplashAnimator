import type { Project, Layer } from '../../document/src';

import { animatedButtonOwners, deepGraphicButtonSpans, graphicVisibilityOwner, nestedButtonOwners } from './stage-visibility';
import { graphicTransformOwner, type PlacementBasis, type PlacementTransform } from './stage-transform';
import { spawnableGraphics } from './stage-spawn';
import { captureGraphicChildren, type ScriptGraphicParent } from './stage-children';
import { captureScriptLibrary, type ScriptLibrarySource } from './stage-library';

export interface StagePlacement {
  readonly id: string;
  readonly name: string;
  readonly symbolId: string;
  readonly layerId: string;
  readonly visibilityKey?: string;
  readonly visible: boolean;
  readonly parentId?: string;
  readonly authoredTransform?: Readonly<PlacementTransform>;
  readonly authoredBasis?: Readonly<PlacementBasis>;
}

// Capture authored exposure boundaries once. No vector geometry or project object
// crosses the worker boundary. A blank key ends the previous placement's lifetime.
export async function captureStagePlacements(layers: readonly Layer[], project?:ScriptLibrarySource & Pick<Project, 'layerMasks' | 'opacityBindings'>, allowDirectButtons = false, duration?: number, allowNestedScripts=false) {
  const owner=project && graphicVisibilityOwner(project, allowDirectButtons);
  const transformOwner=project && graphicTransformOwner(project);
  const nested=project && nestedButtonOwners(project,layers,allowDirectButtons);
  const children=project && captureGraphicChildren(project);
  type TrackKey = {frame:number; items:StagePlacement[]; parents?:ScriptGraphicParent[]};
  const tracks: TrackKey[][] = [];
  for (const layer of layers) {
    const keys: TrackKey[] = [];
    for (const key of layer.keys) {
      const items: StagePlacement[] = [];
      for (const shape of key.shapes) {
        if (shape.kind === 'symbol' && shape.instanceName && shape.symbolId !== undefined) {
          const transform = transformOwner?.(layer,key.frame,shape)
            ? Object.freeze({x:shape.x,y:shape.y,rotation:shape.rotation}) : undefined;
          items.push({ ...(owner?{visibilityKey:owner(layer,key.frame,shape)}:{}), id:shape.id, name:shape.instanceName, symbolId:shape.symbolId, layerId:layer.id, visible:layer.visible,
            ...(transform ? {authoredTransform:transform} : {}),
            ...(transform && shape.transform ? {authoredBasis:Object.freeze([...shape.transform] as PlacementBasis)} : {}) });
        }
      }
      for (const child of nested?.(layer,key) ?? []) items.push(child.placement);
      const parents=items.length ? children?.capture(layer,key) : undefined;
      if (items.length || keys.at(-1)?.items.length)
        keys.push({frame:key.frame,items,...(parents?.length?{parents}:{})});
    }
    if (keys.length) tracks.push(keys);
  }
  const animated = project && allowDirectButtons ? animatedButtonOwners(project,layers,duration) : [];
  const deepButtons = project&&allowDirectButtons&&allowNestedScripts?deepGraphicButtonSpans(project,layers,duration):[];
  const spawnable = project && layers.length < 1000
    ? spawnableGraphics(project).map(definition => definition.id).sort() : [];
  const scriptLibrary = project ? captureScriptLibrary(project,spawnable,layers.length < 1000) : [];
  if (!tracks.length && !spawnable.length && !scriptLibrary.length && !deepButtons.length) return undefined;
  const graphicHierarchy=children?.identity();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(
    scriptLibrary.length ? [tracks,animated,spawnable,graphicHierarchy,scriptLibrary]
      : graphicHierarchy?.length ? [tracks,animated,spawnable,graphicHierarchy]
      : spawnable.length ? [tracks,animated,spawnable] : animated.length ? [tracks,animated] : tracks,
  )));
  const identity = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return {
    identity,
    animatedButtonSpans: () => [...animated,...deepButtons].map(span=>({...span,placement:{...span.placement}})),
    spawnable: Object.freeze(spawnable),
    scriptLibrary: Object.freeze(scriptLibrary.map(item=>Object.freeze(item))),
    at(frame: number): StagePlacement[] {
      const placements: StagePlacement[] = [];
      for (const keys of tracks) {
        let lo = 0, hi = keys.length;
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (keys[mid].frame <= frame) lo = mid + 1;
          else hi = mid;
        }
        if (!lo) continue;
        const key=keys[lo-1];
        for (const item of key.items) placements.push({...item});
        for (const parent of key.parents ?? []) children!.append(parent,frame,placements);
      }
      if (duration !== undefined) for (const child of animated) {
        if ((frame>=child.start && frame<child.end) || (child.end>duration && frame<child.end-duration))
          placements.push({...child.placement});
      }
      return placements;
    },
  };
}
export type StagePlacements = Awaited<ReturnType<typeof captureStagePlacements>>;

// Embedded in the worker; only frozen descriptors from the current frame are returned.
export function createInstanceLookup(items: readonly StagePlacement[]) {
  const names = new Map<string, StagePlacement[]>();
  const children = new Map<string, StagePlacement[]>();
  for (const item of items) {
    const index = item.parentId === undefined ? names : children;
    const key = item.parentId === undefined ? item.name : JSON.stringify([item.layerId,item.parentId,item.name]);
    const matches = index.get(key);
    if (matches) matches.push(Object.freeze(item));
    else index.set(key, [Object.freeze(item)]);
  }
  function root(name: string, layerId?: string) {
    if (typeof name !== 'string' || !name.trim() || name.length > 200 ||
        (layerId !== undefined && typeof layerId !== 'string')) throw Error('Invalid placement lookup.');
    const matches = names.get(name);
    if (!matches) return undefined;
    const found = layerId === undefined ? matches : matches.filter(item => item.layerId === layerId);
    if (found.length > 1) throw Error('Ambiguous placement name: ' + name);
    return found[0];
  }
  return (name: string, layerId?: string, parentName?: string) => {
    if (parentName === undefined) return root(name,layerId);
    if (typeof name !== 'string' || !name.trim() || name.length > 200) throw Error('Invalid placement lookup.');
    const parent = root(parentName,layerId);
    if (!parent) return undefined;
    const matches = children.get(JSON.stringify([parent.layerId,parent.id,name]));
    if (matches && matches.length > 1) throw Error('Ambiguous child placement name: ' + name);
    return matches?.[0];
  };
}
