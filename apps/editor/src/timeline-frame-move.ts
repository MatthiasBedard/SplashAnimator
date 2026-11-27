import { id, validateProject, type Project } from '../../../packages/document/src';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import {
  transferFrameBlock,
  type FrameTrackMapping,
} from '../../../packages/animation/src/timeline';
import { selectionTrajectoryStamp } from '../../../packages/animation/src/selection-trajectory';
import { prepareTimelineKeyframe } from './timeline-keyframe';

const preparing = new WeakMap<Project, { invalid: boolean }>();
/** Separate the selected cells from neighboring tween poses before relocating
 * keys. Sparse spans keep their exact restricted motion on either side. */
function isolateTweenRange(
  project: Project,
  layerId: string,
  start: number,
  end: number,
  current: () => void,
  alreadyMoving?: { start: number; end: number },
) {
  const partial = (span: { start: number; end: number }) =>
    span.start <= end && span.end >= start && (span.start < start || span.end > end) &&
    !(alreadyMoving && span.start >= alreadyMoving.start && span.end <= alreadyMoving.end);
  let candidate = project;
  for (const at of new Set([start - 1, start, end, end + 1])) {
    const layer = candidate.layers.find(layer => layer.id === layerId)!;
    if (layer.liveMotionSpans?.some(span => partial(span) && span.start < at && at < span.end)) {
      const visible = layer.visible;
      layer.visible = true;
      candidate = prepareTimelineKeyframe(candidate, layerId, at, false, current);
      candidate.layers.find(track => track.id === layerId)!.visible = visible;
    }
  }
  // Remembered motion already has a stored pose at each frame. Keep those
  // keys when only part of the recipe is moving or being replaced.
  const layer = candidate.layers.find(layer => layer.id === layerId)!;
  if (layer.motionSpans?.some(partial)) {
    layer.motionSpans = layer.motionSpans.filter(span => !partial(span));
    if (!layer.motionSpans.length) delete layer.motionSpans;
  }
  return candidate;
}

export function prepareTimelineFrameMove(
  source: Project,
  mappings: FrameTrackMapping[],
  start: number,
  end: number,
  at: number,
  validate: () => void = () => {},
  copy = false,
): Project {
  const prior = preparing.get(source);
  if (prior) {
    prior.invalid = true;
    throw Error('Timeline frame movement cannot reenter.');
  }
  const entry = { invalid: false };
  preparing.set(source, entry);
  try {
    validateLiveGraphicData(source);
    validateLiveGraphicData({ mappings, start, end, at });
    validateProject(source);
    const stamp = selectionTrajectoryStamp(source),
      requestStamp = selectionTrajectoryStamp(mappings);
    const current = () => {
      const result = validate() as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('Timeline movement admission must be synchronous.');
      }
      validateLiveGraphicData(source);
      validateLiveGraphicData(mappings);
      if (
        entry.invalid ||
        selectionTrajectoryStamp(source) !== stamp ||
        selectionTrajectoryStamp(mappings) !== requestStamp
      )
        throw Error('Original timeline movement source or destination changed.');
    };
    current();
    let candidate = structuredClone(source);
    const routes = structuredClone(mappings);
    current();
    if (
      selectionTrajectoryStamp(candidate) !== stamp ||
      selectionTrajectoryStamp(routes) !== requestStamp
    )
      throw Error('Timeline movement capture changed.');
    if (!copy && routes.some(route => route.sourceId !== route.targetId) &&
        [start, end, at].every(Number.isSafeInteger) && start >= 0 && end >= start &&
        end < candidate.duration && at >= 0 && at + end - start < 100000) {
      const across = routes.filter(route => route.sourceId !== route.targetId);
      for (const { sourceId, targetId } of across) {
        const from = candidate.layers.find(layer => layer.id === sourceId);
        const to = candidate.layers.find(layer => layer.id === targetId);
        if (!from || !to || from.locked || to.locked)
          throw Error('Choose existing, unlocked source and destination layers.');
      }
      for (const { sourceId } of across)
        candidate = isolateTweenRange(candidate, sourceId, start, end, current);
      for (const { sourceId, targetId } of across) {
        const from = candidate.layers.find(layer => layer.id === sourceId)!;
        const artwork = from.keys.filter(key => key.frame >= start && key.frame <= end);
        if (!artwork.length) continue;
        candidate = isolateTweenRange(candidate, targetId, at, at + end - start, current,
          routes.some(route => route.sourceId === targetId) ? { start, end } : undefined);
        const to = candidate.layers.find(layer => layer.id === targetId)!;
        if (to.drawingMode === 'merge' && artwork.some(key =>
          key.shapes.some(shape => shape.kind === 'symbol' || shape.kind === 'text' || shape.groups?.length)))
          to.drawingMode = 'object';
      }
      for (const { sourceId, targetId } of across) {
        const from = candidate.layers.find(layer => layer.id === sourceId)!;
        const to = candidate.layers.find(layer => layer.id === targetId)!;
        const occupied = new Set([...(to.liveMotionSpans ?? []), ...(to.motionSpans ?? [])]
          .filter(span => span.end < at || span.start > at + end - start).map(span => span.id));
        for (const span of [...(from.liveMotionSpans ?? []), ...(from.motionSpans ?? [])])
          if (span.start >= start && span.end <= end && occupied.has(span.id)) span.id = id();
      }
    }
    if (!copy && start === end && at !== start) {
      for (const { sourceId, targetId } of routes) {
        const layer = candidate.layers.find((l) => l.id === sourceId);
        if (
          sourceId === targetId &&
          layer?.liveMotionSpans?.some((s) => s.start < start && start < s.end)
        )
          candidate = prepareTimelineKeyframe(candidate, sourceId, start, false, current);
      }
    }
    transferFrameBlock(candidate, routes, start, end, at, copy);
    validateProject(candidate);
    validateLiveGraphicData(candidate);
    const expected = selectionTrajectoryStamp(candidate),
      output = structuredClone(candidate);
    validateProject(output);
    validateLiveGraphicData(output);
    current();
    if (
      selectionTrajectoryStamp(candidate) !== expected ||
      selectionTrajectoryStamp(output) !== expected
    )
      throw Error('Complete moved-frame candidate changed.');
    return output;
  } finally {
    preparing.delete(source);
  }
}
