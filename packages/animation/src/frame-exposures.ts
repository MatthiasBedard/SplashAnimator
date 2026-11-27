import { clone, keyAt, type BasicMotionSpan, type Layer, type Project } from '@splash/document';

export type FrameClip = { duration: number; keys: Layer['keys']; motionSpans?: BasicMotionSpan[] };
export function copyFrames(layer: Layer, start: number, end: number): FrameClip {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start)
    throw new Error('Invalid frame range.');
  return {
    duration: end - start + 1,
    keys: [
      { frame: 0, shapes: clone(keyAt(layer, start).shapes) },
      ...layer.keys
        .filter((k) => k.frame > start && k.frame <= end)
        .map((k) => ({ ...clone(k), frame: k.frame - start })),
    ],
  };
}

export function clearFrames(layer: Layer, start: number, end: number, duration: number, restored?: Layer['keys'][number]['shapes']) {
  if (layer.locked) throw new Error('Timeline layer is locked.');
  const after = restored ?? clone(keyAt(layer, end + 1).shapes);
  layer.keys = layer.keys.filter((k) => k.frame < start || k.frame > end);
  layer.keys.push({ frame: start, shapes: [] });
  if (end + 1 < duration && !layer.keys.some((k) => k.frame === end + 1))
    layer.keys.push({ frame: end + 1, shapes: after });
  layer.keys.sort((a, b) => a.frame - b.frame);
}

/** Relocate exposures only onto empty frames (or the original range). Never overwrite other artwork. */
export function moveFrames(
  project: Pick<Project, 'layers' | 'duration'>,
  layerId: string,
  start: number,
  end: number,
  at: number,
) {
  const layer = project.layers.find((l) => l.id === layerId);
  if (!layer || layer.locked) throw new Error('Timeline layer is locked or missing.');
  const count = end - start + 1;
  if (
    !Number.isInteger(at) ||
    at < 0 ||
    at + count > 100000 ||
    start < 0 ||
    end >= project.duration
  )
    throw new Error('Invalid move destination.');
  if (at === start) return;
  // Check exposure spans instead of iterating every frame.
  const boundaries = [
    at,
    ...layer.keys.filter((k) => k.frame > at && k.frame < at + count).map((k) => k.frame),
    start,
    end + 1,
  ].filter((f) => f >= at && f < at + count);
  if (
    boundaries.some(
      (f) => (f < start || f > end) && f < project.duration && keyAt(layer, f).shapes.length,
    )
  )
    throw new Error(
      'Destination contains artwork. Choose blank frames or use Insert copied frames.',
    );
  const clip = copyFrames(layer, start, end),
    oldDuration = project.duration;
  const next = clone(layer);
  clearFrames(next, start, end, oldDuration);
  const tail = at + count,
    after = tail < oldDuration ? clone(keyAt(next, tail).shapes) : [];
  next.keys = next.keys.filter((k) => k.frame < at || k.frame >= tail);
  if (at > oldDuration && !next.keys.some((k) => k.frame === oldDuration))
    next.keys.push({ frame: oldDuration, shapes: [] });
  next.keys.push(...clip.keys.map((k) => ({ ...clone(k), frame: at + k.frame })));
  if (tail < oldDuration && !next.keys.some((k) => k.frame === tail))
    next.keys.push({ frame: tail, shapes: after });
  next.keys.sort((a, b) => a.frame - b.frame);
  layer.keys = next.keys;
  project.duration = Math.max(oldDuration, tail);
}

export function placeFrameClip(track: Layer, duration: number, at: number, clip: FrameClip, occupiedMessage = 'Destination contains artwork.') {
  const count = clip.duration;
  if (
    at < duration &&
    (keyAt(track, at).shapes.length ||
      track.keys.some((k) => k.frame > at && k.frame < at + count && k.shapes.length))
  )
    throw new Error(occupiedMessage);
  const keys = clone(track.keys.filter((k) => k.frame < at || k.frame >= at + count));
  if (at > duration && !keys.some((k) => k.frame === duration))
    keys.push({ frame: duration, shapes: [] });
  if (at + count < duration && !keys.some((k) => k.frame === at + count))
    keys.push({ frame: at + count, shapes: clone(keyAt(track, at + count).shapes) });
  keys.push(...clip.keys.map((k) => ({ ...k, frame: at + k.frame })));
  keys.sort((a, b) => a.frame - b.frame);
  return keys;
}
