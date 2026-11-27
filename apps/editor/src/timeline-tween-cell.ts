import {
  type BasicMotionSpan,
  type Layer,
  type LiveMotionSpan,
} from '../../../packages/document/src';

export function tweenCellKind(span: BasicMotionSpan | LiveMotionSpan) {
  return span.options?.nodes || span.options?.primitives ? 'shape' : 'motion';
}

export function openMotionAt(layer: Layer, frame: number) {
  const held = timelineHeldKey(layer, frame);
  return held.shapes.length ? held.openMotionTween : undefined;
}

/** On a shared endpoint the outgoing span owns the cell. After an endpoint the
 * tween holds until the next authored key, including a blank key. */
export function timelineTweenCell(
  layer: Layer,
  frame: number,
  heldFrame = timelineHeldKey(layer, frame).frame,
) {
  const live = layer.liveMotionSpans ?? [];
  const baked = layer.motionSpans ?? [];
  const interior = (span: BasicMotionSpan | LiveMotionSpan) =>
    span.start <= frame && frame < span.end;
  const endpoint = (span: BasicMotionSpan | LiveMotionSpan) => span.end === heldFrame;
  const activeLive = live.find(interior);
  if (activeLive) return { live: activeLive, span: activeLive };
  const activeBaked = baked.find(interior);
  if (activeBaked) return { span: activeBaked };
  const endedLive = live.find(endpoint);
  if (endedLive) return { live: endedLive, span: endedLive };
  const endedBaked = baked.find(endpoint);
  if (endedBaked) return { span: endedBaked };
}

export function timelineHeldKey(layer: Layer, frame: number) {
  let low = 1;
  let high = layer.keys.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (layer.keys[mid].frame <= frame) low = mid + 1;
    else high = mid;
  }
  return layer.keys[low - 1];
}
