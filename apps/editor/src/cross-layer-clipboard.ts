import { keyAt, validateProject, type Project, type Vector } from '../../../packages/document/src';
import { copyVectors, expandSelection } from '../../../packages/document/src/groups';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import { selectionTrajectoryStamp as stamp } from '../../../packages/animation/src/selection-trajectory';
import { multiFrameId } from '../../../packages/animation/src/multi-frame';
import {
  currentLayerKeys,
  crossLayerMaskTracks,
  prepareMaskedMergeComponent,
  previewCurrentLayerChange,
  type CrossLayerRebuilder,
} from './cross-layer-selection';

/** Internal clipboard: destinations are the original layer identities, never row
 * positions or equal artwork IDs on unrelated layers. Assets stay document-owned. */
export type CrossLayerClipboard = {
  format: 'splash-cross-layer-artwork-1';
  projectId: string;
  tracks: { layer: string; maskLayer?: string; shapes: Vector[] }[];
};

function clipboardMaskOwners(project: Project) {
  return new Map((project.layerMasks ?? []).flatMap(
    mask => mask.layerIds.map(layer => [layer, mask.maskLayerId] as const),
  ));
}

export function copyCurrentLayers(
  project: Project,
  frame: number,
  selection: string[],
): CrossLayerClipboard {
  validateLiveGraphicData([project, selection]);
  validateProject(project);
  const source = stamp(project),
    picks = stamp(selection),
    ids = [...selection],
    snapshot = structuredClone(project);
  // Reuse original mask/tween/group admission; no geometry is published.
  previewCurrentLayerChange(snapshot, frame, ids, { kind: 'move', x: 0, y: 0 }, undefined, true);
  const requested = new Set(ids), owners = clipboardMaskOwners(snapshot);
  const tracks = currentLayerKeys(snapshot, frame).flatMap(({ layer, keys: [key], mask }) => {
    const members = new Set(
      expandSelection(
        key.shapes,
        key.shapes
          .filter((s) => requested.has(multiFrameId(layer.id, key.frame, s.id)))
          .map((s) => s.id),
        [],
      ),
    );
    const shapes = key.shapes.filter((s) => members.has(s.id));
    if (!shapes.length) return [];
    if (!mask) return [{ layer: layer.id, shapes }];
    if (snapshot.opacityBindings?.some(binding => binding.layerId === layer.id))
      throw Error('Copy masked opacity-bound artwork from its active layer.');
    return [{ layer: layer.id, maskLayer: owners.get(layer.id), shapes }];
  });
  if (!tracks.length) throw Error('Select artwork to copy across layers.');
  const result: CrossLayerClipboard = structuredClone({
    format: 'splash-cross-layer-artwork-1',
    projectId: snapshot.id,
    tracks,
  });
  validateLiveGraphicData([project, selection, result]);
  if (stamp(project) !== source || stamp(snapshot) !== source || stamp(selection) !== picks)
    throw Error('Original cross-layer source changed while copying.');
  return result;
}

/** Append copies to current exposures of the explicit original layers. Complete
 * detached track reconstruction precedes a single caller-owned publication. */
export async function pasteCurrentLayers(
  project: Project,
  frame: number,
  clipboard: CrossLayerClipboard,
  inPlace: boolean,
  options: { rebuild: CrossLayerRebuilder; signal?: AbortSignal; admit?: () => void },
): Promise<{ project: Project; selected: string[] }> {
  validateLiveGraphicData([project, clipboard]);
  validateProject(project);
  if (typeof inPlace !== 'boolean') throw Error('Choose a paste placement.');
  if (!options || ![Object.prototype, null].includes(Object.getPrototypeOf(options)))
    throw Error('Use original clipboard options.');
  for (const name of ['rebuild', 'signal', 'admit']) {
    const d = Object.getOwnPropertyDescriptor(options, name);
    if (d && !('value' in d)) throw Error('Use original clipboard options.');
  }
  const { rebuild, signal, admit } = options;
  if (typeof rebuild !== 'function' || (admit !== undefined && typeof admit !== 'function'))
    throw Error('Choose a reconstruction worker.');
  const source = stamp(project),
    input = stamp(clipboard);
  const current = () => {
    signal?.throwIfAborted();
    validateLiveGraphicData([project, clipboard]);
    if (stamp(project) !== source || stamp(clipboard) !== input)
      throw Error('Original clipboard source changed.');
    admit?.();
    signal?.throwIfAborted();
    validateLiveGraphicData([project, clipboard]);
    if (stamp(project) !== source || stamp(clipboard) !== input)
      throw Error('Original clipboard source changed during admission.');
  };
  current();
  let candidate = structuredClone(project);
  const clip = structuredClone(clipboard);
  current();
  if (stamp(candidate) !== source || stamp(clip) !== input)
    throw Error('Clipboard snapshot changed while cloning.');
  if (
    clip.format !== 'splash-cross-layer-artwork-1' ||
    clip.projectId !== candidate.id ||
    !Array.isArray(clip.tracks) ||
    !clip.tracks.length ||
    new Set(clip.tracks.map((t) => t.layer)).size !== clip.tracks.length
  )
    throw Error('Paste cross-layer artwork into its original document and layers.');
  currentLayerKeys(candidate, frame);
  const protectedTracks = crossLayerMaskTracks(candidate), owners = clipboardMaskOwners(candidate);
  const plans = clip.tracks.map((track) => {
    const layer = candidate.layers.find((l) => l.id === track.layer);
    if (!layer || !layer.visible || layer.locked)
      throw Error('Every original clipboard layer must still be visible and unlocked.');
    const maskLayer = owners.get(layer.id);
    if (track.maskLayer !== maskLayer)
      throw Error('Paste into the original mask groups.');
    if (protectedTracks.has(layer.id) && (!maskLayer ||
        candidate.opacityBindings?.some(binding => binding.layerId === layer.id)))
      throw Error('Paste into mask groups from their active layer.');
    const key = keyAt(layer, frame);
    if (
      [...(layer.motionSpans ?? []), ...(layer.liveMotionSpans ?? [])].some(
        (s) => s.start <= key.frame && key.frame <= s.end,
      )
    )
      throw Error('Paste outside owned tween artwork using its keyframe controls.');
    if (
      !Array.isArray(track.shapes) ||
      !track.shapes.length ||
      track.shapes.some((s) => typeof s.id !== 'string' || !s.id) ||
      new Set(track.shapes.map((s) => s.id)).size !== track.shapes.length
    )
      throw Error('Invalid clipboard artwork identity.');
    const copies = copyVectors(track.shapes, 0, [], inPlace ? { x: 0, y: 0 } : { x: 16, y: 16 });
    if (
      layer.drawingMode === 'merge' &&
      copies.some((s) => s.kind === 'symbol' || s.groups?.length)
    )
      throw Error('Paste symbols and groups into their original object layers.');
    return {
      layer: layer.id,
      maskLayer,
      frame: key.frame,
      merge: layer.drawingMode === 'merge',
      artwork: [...key.shapes, ...copies],
      ids: copies.map((s) => s.id),
    };
  });
  const replace = (layer: string, at: number, artwork: Vector[]) => {
    candidate = {
      ...candidate,
      layers: candidate.layers.map((l) =>
        l.id !== layer
          ? l
          : { ...l, keys: l.keys.map((k) => (k.frame !== at ? k : { ...k, shapes: artwork })) },
      ),
    };
  };
  // Admit the entire inserted artwork budget before starting any layer worker.
  for (const plan of plans) replace(plan.layer, plan.frame, plan.artwork);
  validateProject(candidate);
  const maskedPlans = plans.filter(plan => plan.maskLayer !== undefined);
  const components = new Map<string, ReturnType<typeof prepareMaskedMergeComponent>>();
  if (maskedPlans.length) {
    const tracks = new Map(currentLayerKeys(candidate, frame).map(track => [track.layer.id, track]));
    for (const plan of maskedPlans) {
      const track = tracks.get(plan.layer);
      const visible = new Set(track?.keys[0].shapes.map(shape => shape.id));
      if (!track?.mask || plan.ids.some(id => !visible.has(id)))
        throw Error('Keep the pasted artwork visible beneath its original mask.');
      if (plan.merge)
        components.set(plan.layer, prepareMaskedMergeComponent(track.mask, plan.artwork, plan.ids));
    }
  }
  current();
  const selected: string[] = [];
  for (const plan of plans) {
    current();
    let ids: string[] = plan.ids;
    if (plan.merge) {
      const component = components.get(plan.layer);
      const shapes = structuredClone(component?.input ?? plan.artwork),
        chosen = [...ids],
        payload = stamp([shapes, chosen]);
      const result = await rebuild(
        shapes,
        chosen,
        shapes.some((s) => s.kind === 'bezier' && s.fillEnabled === false),
        signal,
      );
      current();
      if (stamp([shapes, chosen]) !== payload)
        throw Error('Clipboard worker input changed during preparation.');
      validateLiveGraphicData(result);
      if (!result || !Array.isArray(result.artwork) || !Array.isArray(result.selected))
        throw Error('Invalid clipboard reconstruction result.');
      const output = stamp(result),
        detached = structuredClone(result);
      current();
      if (stamp(result) !== output || stamp(detached) !== output)
        throw Error('Clipboard worker output changed during preparation.');
      const known = new Set(detached.artwork.map((s) => s.id));
      if (
        new Set(detached.selected).size !== detached.selected.length ||
        detached.selected.some((id) => !known.has(id)) ||
        (component && !detached.selected.length)
      )
        throw Error('Invalid clipboard result selection.');
      replace(plan.layer, plan.frame, component ? component.restore(detached) : detached.artwork);
      ids = detached.selected;
      validateProject(candidate);
      current();
    }
    selected.push(...ids.map((id) => multiFrameId(plan.layer, plan.frame, id)));
  }
  validateLiveGraphicData(candidate);
  validateProject(candidate);
  const output = stamp(candidate),
    detached = structuredClone(candidate);
  current();
  if (stamp(candidate) !== output || stamp(detached) !== output)
    throw Error('Clipboard candidate changed during preparation.');
  return { project: detached, selected };
}
