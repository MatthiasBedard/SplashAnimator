import { validateProject, type Layer, type Project } from '@splash/document';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { checkMotionReconstruction, requireOwnedMotionInterior } from './motion-ownership';
import { selectionTrajectoryStamp } from './selection-trajectory';
import { checkFrameBlockLiveRecipes, replaceFrameBlockArtwork, routeFrameBlockArtwork, setFrameBlockLiveSpans } from './timeline';

export type AnimatedFrameClipboard = Readonly<{
  kind: 'animated'; projectId: string; duration: number; tracks: readonly string[];
}>;
const capturedTracks = new WeakMap<AnimatedFrameClipboard, { start: number; layers: Layer[] }>();

export function captureAnimatedFrameClipboard(source: Project, ids: string[], start: number, end: number, cut: boolean) {
  validateLiveGraphicData(source);
  validateLiveGraphicData({ ids, start, end, cut });
  const stamp = selectionTrajectoryStamp(source), next = validateProject(source);
  if (!ids.length || new Set(ids).size !== ids.length || ![start, end].every(Number.isSafeInteger) ||
      start < 0 || end < start || end >= next.duration) throw Error('Select an existing frame range.');
  const layers: Layer[] = [];
  for (const id of ids) {
    const layer = next.layers.find(item => item.id === id);
    if (!layer || layer.locked) throw Error('Select existing, unlocked timeline layers.');
    const keys = layer.keys.filter(key => key.frame >= start && key.frame <= end);
    const live = layer.liveMotionSpans?.filter(span => span.start <= end && span.end >= start) ?? [];
    const remembered = layer.motionSpans?.filter(span => span.start <= end && span.end >= start) ?? [];
    if ([...live, ...remembered].some(span => span.start < start || span.end > end))
      throw Error('Select the complete tween, including both endpoints, before copying or cutting frames.');
    checkFrameBlockLiveRecipes(next, { ...layer, liveMotionSpans: live });
    for (const span of remembered) checkMotionReconstruction(next, { ...layer, visible: true }, span,
      requireOwnedMotionInterior(layer, span), 'Refresh remembered motion before copying or cutting its keys.');
    layers.push(structuredClone({ ...layer, keys, liveMotionSpans: live, motionSpans: remembered }));
    if (!cut || !keys.length) continue;
    layer.keys = layer.keys.filter(key => key.frame < start || key.frame > end);
    if (layer.keys[0]?.frame !== 0) layer.keys.unshift({ frame: 0, shapes: [] });
    if (live.length) setFrameBlockLiveSpans(layer, layer.liveMotionSpans!.filter(span => span.end < start || span.start > end));
    if (remembered.length) {
      const retained = layer.motionSpans!.filter(span => span.end < start || span.start > end);
      if (retained.length) layer.motionSpans = retained;
      else delete layer.motionSpans;
    }
  }
  if (!layers.some(layer => layer.keys.length)) throw Error('Select authored keys to copy or cut.');
  if (cut) validateProject(next);
  validateLiveGraphicData(source);
  if (selectionTrajectoryStamp(source) !== stamp) throw Error('The original timeline changed during clipboard capture.');
  const clipboard: AnimatedFrameClipboard = Object.freeze({ kind: 'animated', projectId: next.id,
    duration: end - start + 1, tracks: Object.freeze([...ids]) });
  capturedTracks.set(clipboard, { start, layers });
  return { clipboard, project: next };
}

export function prepareAnimatedFramePaste(source: Project, at: number, targets: string[], clipboard: AnimatedFrameClipboard) {
  validateLiveGraphicData(source);
  validateLiveGraphicData({ at, targets });
  const originals = capturedTracks.get(clipboard);
  if (!originals) throw Error('Copy or cut an animated frame block first.');
  const tail = at + clipboard.duration;
  if (clipboard.projectId !== source.id || targets.length !== originals.layers.length ||
      new Set(targets).size !== targets.length || !Number.isSafeInteger(at) || at < 0 || tail > 100000)
    throw Error('Choose enough valid destination layers for this animated frame block.');
  const stamp = selectionTrajectoryStamp(source), next = validateProject(source);
  next.duration = Math.max(next.duration, tail);
  const plans = targets.map((id, index) => {
    const target = next.layers.find(layer => layer.id === id);
    if (!target || target.locked) throw Error('Choose existing, unlocked destination layers.');
    const artwork = routeFrameBlockArtwork(originals.layers[index], target, at - originals.start, true);
    return { target, artwork };
  });
  for (const { target, artwork } of plans) {
    if (!artwork.keys.length) continue;
    for (const span of target.motionSpans ?? []) {
      if (span.end < at || span.start >= tail) continue;
      if (span.start < at || span.end >= tail) throw Error('The paste would replace part of a remembered motion span.');
      checkMotionReconstruction(next, { ...target, visible: true }, span, requireOwnedMotionInterior(target, span),
        'Refresh destination motion before replacing its keyframes.');
    }
    replaceFrameBlockArtwork(target, at, tail, artwork);
    if (target.keys[0]?.frame !== 0) target.keys.unshift({ frame: 0, shapes: [] });
    if (target.motionSpans && !target.motionSpans.length) delete target.motionSpans;
  }
  validateProject(next);
  for (const { target, artwork } of plans) {
    if (!artwork.keys.length) continue;
    checkFrameBlockLiveRecipes(next, target);
    for (const span of artwork.spans) checkMotionReconstruction(next, { ...target, visible: true }, span,
      requireOwnedMotionInterior(target, span), 'Pasted motion cannot reconstruct its original keyframes.');
  }
  validateLiveGraphicData(next);
  validateLiveGraphicData(source);
  if (selectionTrajectoryStamp(source) !== stamp) throw Error('The original timeline changed during frame paste.');
  return next;
}
