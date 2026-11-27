import { id, validateProject, type LiveMotionSpan, type Project } from '../../../packages/document/src';
import { liveNumericChannels, liveColorChannels, validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import { insertRootKey, editRootExposure } from '../../../packages/animation/src/timeline';
import { selectionTrajectoryStamp } from '../../../packages/animation/src/selection-trajectory';
import { createMotionFrameSampler } from '../../../packages/animation/src/motion-frames';
import {
  prepareCreateLiveMotionSpans,
  prepareRemoveLiveMotionSpans,
} from '../../../packages/animation/src/live-motion';
import { detachBasicMotionSpan, splitBasicMotionSpan } from '../../../packages/animation/src/motion-spans';
import { motionSymbolPlayback } from '../../../packages/animation/src/motion-symbols';
import { splitLiveMotionLayerAtKey } from '../../../packages/animation/src/live-motion-split';
import { splitLiveGroupMotionLayerAtKey } from '../../../packages/animation/src/live-group-motion-split';
import { splitLiveGraphicMotionLayerAtKey } from '../../../packages/animation/src/live-graphic-motion-split';
import { splitLiveMovieMotionLayerAtKey } from '../../../packages/animation/src/live-movie-motion-split';
import { splitLiveMovieTreeMotionLayerAtKey } from '../../../packages/animation/src/live-movie-tree-motion-split';
import { timelineHeldKey, timelineTweenCell, tweenCellKind } from './timeline-tween-cell';
import { prepareTimelineTween } from './timeline-tween';

const preparing = new WeakMap<Project, { invalid: boolean }>();
function insertTimeAfter(span: LiveMotionSpan, at: number): LiveMotionSpan {
  if (span.end <= at) return span;
  if (span.start > at) return {...span, start:span.start+1, end:span.end+1};
  const shifted = {...span, end:span.end+1};
  for (const {field} of liveColorChannels) {
    const keys = span[field];
    if (keys) shifted[field] = keys.map(key => span.start+key.offset > at ? {...key,offset:key.offset+1} : key);
  }
  for (const {field} of liveNumericChannels) {
    const keys = span[field];
    if (keys) shifted[field] = keys.map(key => span.start+key.offset > at ? {...key,offset:key.offset+1} : key);
  }
  if (span.gradientColorTracks) shifted.gradientColorTracks=span.gradientColorTracks.map(row=>({...row,
    keys:row.keys.map(key=>span.start+key.offset>at ? {...key,offset:key.offset+1} : key)
  }));
  return shifted;
}
export type TimelineCellCommand =
  'key' | 'blank' | 'frame' | 'plain' | 'remove-motion' | 'remove-shape';
/** Prepare the ordinary timeline key command without writing source or history.
 * Private original recipes, never a public sampled scene, own the inserted pose. */
export function prepareTimelineKeyframe(
  source: Project,
  layerId: string,
  at: number,
  blank = false,
  validate: () => void = () => {},
): Project {
  if (typeof blank !== 'boolean') throw Error('Choose an original keyframe type.');
  return prepareTimelineFrameInsertion(source, layerId, at, blank ? 'blank' : 'key', validate);
}
/** The clicked authoring column owns the target independently of the current
 * playable frame. Duration extension is part of the same detached edit. */
export function prepareTimelineFrameInsertion(
  source: Project,
  layerId: string,
  at: number,
  action: TimelineCellCommand,
  validate: () => void = () => {},
  symbolId?: string,
): Project {
  const prior = preparing.get(source);
  if (prior) {
    prior.invalid = true;
    throw Error('Keyframe preparation cannot reenter.');
  }
  const entry = { invalid: false };
  preparing.set(source, entry);
  try {
    validateLiveGraphicData(source);
    validateProject(source);
    const stamp = selectionTrajectoryStamp(source);
    const current = () => {
      const result = validate() as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('Keyframe admission must be synchronous.');
      }
      validateLiveGraphicData(source);
      if (entry.invalid || selectionTrajectoryStamp(source) !== stamp)
        throw Error('Original keyframe source changed or reentered.');
    };
    current();
    if (
      !Number.isSafeInteger(at) ||
      at < 0 ||
      at >= 100000 ||
      !['key', 'blank', 'frame', 'plain', 'remove-motion', 'remove-shape'].includes(action)
    )
      throw Error('Choose a frame from 1 to 100000 and a valid insertion type.');
    const blank = action === 'blank';
    const duration =
      action === 'frame' && at < source.duration
        ? source.duration + 1
        : Math.max(source.duration, at + 1);
    if (duration > 100000) throw Error('Timeline duration limit exceeded.');
    let candidate = structuredClone(source);
    current();
    if (selectionTrajectoryStamp(candidate) !== stamp)
      throw Error('Keyframe source clone changed.');
    const layer = candidate.layers.find((layer) => layer.id === layerId);
    if (!layer || layer.locked) throw Error('Timeline layer is locked or missing.');
    const removing = action === 'remove-motion' || action === 'remove-shape';
    const held = timelineHeldKey(layer, at);
    const tween = timelineTweenCell(layer, at, held.frame);
    const open = held.shapes.length ? held.openMotionTween : undefined;
    const removingOpen = action === 'remove-motion' && !!open && at < source.duration;
    let completedOpen = false;
    if (removingOpen) {
      delete held.openMotionTween;
    } else if (removing) {
      if (at >= source.duration || !tween || action !== `remove-${tweenCellKind(tween.span)}`)
        throw Error('The selected cell no longer owns that tween.');
      if (tween.live)
        return prepareRemoveLiveMotionSpans(candidate, [{ layerId, spanId: tween.live.id }], {
          validate: current,
        });
      detachBasicMotionSpan(candidate, [layerId], tween.span.start, tween.span.end);
    }
    candidate.duration = Math.max(source.duration, at + 1);
    const span = layer.liveMotionSpans?.find((span) => span.start < at && at < span.end);
    const remembered = symbolId === undefined ? undefined : layer.motionSpans?.find((span) =>
      span.autoRefresh && span.start < at && at < span.end,
    );
    if (action === 'plain' && tween && at <= tween.span.end)
      throw Error('Remove the tween before inserting a plain key inside it.');
    if (blank && layer.liveMotionSpans?.some((span) => span.start <= at && at <= span.end))
      throw Error(
        'A blank key cannot be a tween endpoint. Remove the adjacent tween before clearing its artwork.',
      );
    if (action === 'frame') {
      if (at < source.duration) {
        if (layer.liveMotionSpans?.some((s) => s.end > at)) {
          const spans = layer.liveMotionSpans;
          const samplingProject = () => ({
            ...candidate,
            layers: candidate.layers.map((l) => (l === layer ? { ...l, visible: true } : l)),
          });
          for (const span of spans) {
            if (span.end <= at) continue;
            const sampler = createMotionFrameSampler(samplingProject(), layerId, span);
            sampler.dispose();
            current();
          }
          // The exposure kernel owns ordinary keys and absolute binding guards.
          // Give it a detached sparse-free layer, then admit keys AND retimed
          // recipes together. No intermediate state reaches source or history.
          const exposureLayer = { ...layer };
          delete exposureLayer.liveMotionSpans;
          const exposure = {
            ...candidate,
            layers: candidate.layers.map((l) => (l === layer ? exposureLayer : l)),
          };
          editRootExposure(exposure, layerId, at, 'insert-frame');
          candidate.duration = exposure.duration;
          layer.keys = exposureLayer.keys;
          layer.liveMotionSpans = spans.map(span => insertTimeAfter(span,at));
          validateProject(candidate);
          for (const [i, span] of layer.liveMotionSpans.entries()) {
            if (spans[i].end <= at) continue;
            const sampler = createMotionFrameSampler(samplingProject(), layerId, span);
            sampler.dispose();
            current();
          }
        } else editRootExposure(candidate, layerId, at, 'insert-frame');
      }
    } else if (remembered && !removing) {
      if (blank) throw Error('Remove the tween before inserting a blank key inside it.');
      splitBasicMotionSpan(candidate, [layerId], remembered.start, remembered.end, at, true, true);
    } else if (span) {
      const sampler = createMotionFrameSampler(candidate, layerId, span);
      let promoted: string;
      try {
        promoted = selectionTrajectoryStamp(sampler.sample(at));
      } finally {
        sampler.dispose();
      }
      const split = span.rotation?.rigidGroups
        ? splitLiveGroupMotionLayerAtKey
        : span.symbolContinuity === 'movie-trees'
          ? splitLiveMovieTreeMotionLayerAtKey
          : span.symbolContinuity === 'movies'
            ? splitLiveMovieMotionLayerAtKey
            : span.symbolContinuity === 'graphics'
              ? splitLiveGraphicMotionLayerAtKey
              : splitLiveMotionLayerAtKey;
      candidate.layers[candidate.layers.indexOf(layer)] = split(candidate, layer, span, at, id());
      if (
        selectionTrajectoryStamp(
          candidate.layers
            .find((layer) => layer.id === layerId)!
            .keys.find((key) => key.frame === at)!.shapes,
        ) !== promoted
      )
        throw Error('The inserted key must retain the original sampled pose.');
    } else if (!removing) {
      insertRootKey(candidate, layerId, at, blank);
      if (action === 'key' && open && held.frame < at) {
        const clock = motionSymbolPlayback(candidate.symbols ?? []);
        const key = layer.keys.find(key => key.frame === at)!;
        for (const shape of key.shapes) {
          const playback = clock(shape);
          if (playback) shape.symbolPlayback = playback(at - held.frame);
        }
        if (at === held.frame + 1) {
          // Adjacent keys have no in-between frame. Keep the tween type on the new hold.
          key.openMotionTween = structuredClone(open);
        } else {
          candidate = prepareTimelineTween(candidate, layerId,
            { start: held.frame, end: at, ...open, kind: 'motion', createEndpoints: false },
            current, symbolId);
          completedOpen = true;
        }
      } else if (action === 'key' && tween && at > tween.span.end && held.frame < at) {
        // Start a fresh segment from the held endpoint. Paths, turns, easing and
        // contour alignment describe the preceding segment, so they stop there.
        const previous = tween.span;
        const clock = motionSymbolPlayback(candidate.symbols ?? []);
        const key = layer.keys.find((key) => key.frame === at)!;
        for (const shape of key.shapes) {
          const playback = clock(shape);
          if (playback) shape.symbolPlayback = playback(at - held.frame);
        }
        const nodes = previous.correspondence?.nodes;
        candidate = prepareCreateLiveMotionSpans(
          candidate,
          [
            {
              layerId,
              span: {
                id: id(),
                start: held.frame,
                end: at,
                ease: 'linear',
                ...(previous.options ? { options: previous.options } : {}),
                ...(nodes ? { correspondence: { nodes } } : {}),
                ...(previous.rotation?.rigidGroups
                  ? { rotation: { direction: 'shortest', turns: 0, rigidGroups: true } }
                  : {}),
                ...(tween.live?.symbolContinuity || key.shapes.some((s) => s.kind === 'symbol')
                  ? {
                      symbolContinuity:
                        tween.live?.symbolContinuity ??
                        (key.shapes.some((s) => s.symbolPlayback?.mode === 'movie')
                          ? 'movies'
                          : 'graphics'),
                    }
                  : {}),
              },
            },
          ],
          { validate: current },
        );
      }
    }
    current();
    const originalLayer = source.layers.find((layer) => layer.id === layerId)!;
    const editedLayer = candidate.layers.find((layer) => layer.id === layerId)!;
    const outsideKeys = (keys: typeof editedLayer.keys) => keys
      .filter(key => key.frame !== at || removingOpen)
      .filter(key => !completedOpen || key.frame <= held.frame || key.frame > at)
      .map(key => {
        if ((!completedOpen && !removingOpen) || key.frame !== held.frame) return key;
        const artwork = { ...key };
        delete artwork.openMotionTween;
        return artwork;
      });
    if (
      candidate.duration !== duration ||
      selectionTrajectoryStamp({
        ...candidate,
        duration: source.duration,
        layers: source.layers,
      }) !== stamp ||
      selectionTrajectoryStamp(candidate.layers.map((layer) => layer.id)) !==
        selectionTrajectoryStamp(source.layers.map((layer) => layer.id)) ||
      candidate.layers.some(
        (layer, i) =>
          layer.id !== layerId &&
          selectionTrajectoryStamp(layer) !== selectionTrajectoryStamp(source.layers[i]),
      ) ||
      (action === 'frame'
        ? selectionTrajectoryStamp(editedLayer.liveMotionSpans) !==
            selectionTrajectoryStamp(
              originalLayer.liveMotionSpans?.map(span => insertTimeAfter(span,at)),
            ) ||
          selectionTrajectoryStamp({
            ...editedLayer,
            keys: undefined,
            liveMotionSpans: undefined,
          }) !==
            selectionTrajectoryStamp({
              ...originalLayer,
              keys: undefined,
              liveMotionSpans: undefined,
            }) ||
          selectionTrajectoryStamp(editedLayer.keys) !==
            selectionTrajectoryStamp(
              originalLayer.keys.map((key) =>
                at < source.duration && key.frame > at ? { ...key, frame: key.frame + 1 } : key,
              ),
            )
        : selectionTrajectoryStamp(outsideKeys(editedLayer.keys)) !==
          selectionTrajectoryStamp(outsideKeys(originalLayer.keys)))
    )
      throw Error('Keyframe preparation changed outside artwork or project settings.');
    validateProject(candidate);
    validateLiveGraphicData(candidate);
    const expected = selectionTrajectoryStamp(candidate);
    const output = structuredClone(candidate);
    validateProject(output);
    validateLiveGraphicData(output);
    current();
    if (
      selectionTrajectoryStamp(candidate) !== expected ||
      selectionTrajectoryStamp(output) !== expected
    )
      throw Error('Complete keyframe candidate changed.');
    return output;
  } finally {
    preparing.delete(source);
  }
}
