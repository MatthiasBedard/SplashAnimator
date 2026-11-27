import { liveGraphicFixture } from './live-graphics-fixture';
import { prepareCreateLiveMotionSpans } from '../packages/animation/src/live-motion';
import type { Project, LiveMotionSpan } from '../packages/document/src';
export function liveMovieFixture(firstFrame = 1, basis = 'plain') {
  const { p, span, definition } = liveGraphicFixture('loop', basis);
  span.symbolContinuity = 'movies';
  for (const index of [1, 2])
    p.layers[0].keys[index].shapes[0].symbolPlayback = { mode: 'movie', firstFrame };
  return { p, span, definition };
}
export function createLiveMovies(p: Project, span: LiveMotionSpan) {
  return prepareCreateLiveMotionSpans(p, [{ layerId: 'track', span }]);
}
export { prepareLiveMotionFrameCapture } from '../packages/animation/src/live-motion-presentation';
export { createLiveMovieSession } from '../apps/editor/src/live-movie-session';
export { createLiveMoviePainter } from '../apps/editor/src/live-movie-paint';
export { exportPNGFrame } from '../apps/editor/src/export-png';
export { captureMoviePoseClock } from '../packages/animation/src/movie-pose-clock';
export { captureLiveMotionTimeline } from '../packages/animation/src/live-motion';
export { CanvasStage } from '../packages/stage/src';
