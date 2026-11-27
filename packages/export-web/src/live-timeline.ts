import { validateProject, type Keyframe, type Project } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { createLiveMotionSpanSampler } from '../../animation/src/live-motion';
import { compileMovieClockPlan } from '../../animation/src/movie-clock-plan';
import { selectionTrajectoryStamp } from '../../animation/src/selection-trajectory';

export const MAX_HTML_COMPILED_SHAPES = 1_000_000;

/** Materialize visible live poses in an export-owned document using exact frame times. */
export function prepareLiveHTMLTimeline(snapshot: Project): Project {
  const checkNestedClocks = snapshot.layers.some(layer => layer.visible &&
    layer.liveMotionSpans?.some(span => span.symbolContinuity === 'movie-trees' || span.nestedGraphicMovies !== undefined));
  const clocks = checkNestedClocks ? selectionTrajectoryStamp(compileMovieClockPlan(snapshot)) : undefined;
  let generatedShapes = 0;
  const layers = snapshot.layers.map(layer => {
    if (!layer.liveMotionSpans?.length) return layer;
    const { liveMotionSpans, ...renderLayer } = layer;
    if (!layer.visible) return renderLayer;
    const keysByFrame = new Map(layer.keys.map(key => [key.frame, key]));
    const interior: Keyframe[] = [];
    for (const span of liveMotionSpans) {
      const first = keysByFrame.get(span.start)!;
      const last = keysByFrame.get(span.end)!;
      generatedShapes += (span.end - span.start - 1) * Math.max(first.shapes.length, last.shapes.length);
      if (generatedShapes > MAX_HTML_COMPILED_SHAPES)
        throw Error('Live motion HTML export exceeds one million compiled shapes.');
      const sampler = createLiveMotionSpanSampler(snapshot, layer.id, span);
      try {
        for (let frame = span.start + 1; frame < span.end; frame++)
          interior.push({ frame, shapes: sampler.sample(frame) });
      } finally {
        sampler.dispose();
      }
    }
    return { ...renderLayer, keys: [...layer.keys, ...interior].sort((a, b) => a.frame - b.frame) };
  });
  const prepared = { ...snapshot, layers };
  validateLiveGraphicData(prepared);
  validateProject(prepared);
  if (clocks !== undefined && selectionTrajectoryStamp(compileMovieClockPlan(prepared)) !== clocks)
    throw Error('Live motion HTML export changed the original nested movie clocks.');
  return prepared;
}
