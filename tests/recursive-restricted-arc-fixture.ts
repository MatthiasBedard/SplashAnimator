import { restrictedArcProject } from './restricted-arc-project-fixture';
import {
  captureLiveGroupMotionAuthoringFrame as capture,
  prepareRestrictedArcLiveGroupMotionSpans as initial,
  prepareRecursiveRestrictedArcLiveGroupMotionSpans as recursive,
} from '../packages/animation/src/live-group-motion-owner';
/** Independently authored monotone distance curve. Preserve the earlier turning
 * and translated uncertain fixtures as rejection tests, never repair their data. */
export function recursiveRestrictedArcProject(basis = 'plain', { fade = false, accelerate = false, varyStroke = false, varyColor = false } = {}) {
  const { p } = restrictedArcProject(basis);
  for (const bank of p.layers[0].liveMotionSpans![0].groupPaths!)
    bank.path = { startX: 16, startY: 8, endX: -16, endY: -8, distance: true };
  if (accelerate) p.layers[0].liveMotionSpans![0].ease = 'in';
  if (varyStroke) {
    const layer = p.layers[0], span = layer.liveMotionSpans![0];
    span.options = {...span.options, strokeWidth:true};
    layer.keys[0].shapes[0].strokeWidth = 2;
    layer.keys[1].shapes[0].strokeWidth = 18;
  }
  if (varyColor) {
    const layer = p.layers[0];
    const span=layer.liveMotionSpans![0];
    const loose = [span.start,span.end].map(frame=>layer.keys.find(k=>k.frame===frame)!.shapes.find(s=>s.id==='loose')!);
    loose[0].fill = '#102030';
    loose[1].fill = '#d08070';
    loose[0].stroke = '#b08020';
    loose[1].stroke = '#3070e0';
  }
  if (fade) {
    const layer = p.layers[0];
    delete layer.keys[0].shapes[0].opacity;
    layer.keys[1].shapes[0].opacity = 0.25;
    layer.liveMotionSpans![0].opacityEase = 'out';
  }
  function split(source: typeof p, frame: number, id: string, persisted: boolean) {
    const scope = capture(() => ({ project: source, revision: 0, frame }));
    try {
      return (persisted ? recursive : initial)([
        { owner: scope.resolve('track', 'outer'), rightSpanId: id },
      ]);
    } finally {
      scope.dispose();
    }
  }
  const q = split(p, 4, 'right', false),
    left = split(q, 2, 'left-middle', true),
    r = split(left, 6, 'right-middle', true);
  return { p, q, r };
}
