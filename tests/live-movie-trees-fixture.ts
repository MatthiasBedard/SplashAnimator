import { readOnlyMovieTreeFixture } from './read-only-movie-trees-fixture';
import { symbolInstance } from '../packages/geometry/src/symbols';
import { prepareCreateLiveMotionSpans } from '../packages/animation/src/live-motion';
export { prepareLiveMotionFrameCapture } from '../packages/animation/src/live-motion-presentation';
export { exportPNGFrame } from '../apps/editor/src/export-png';
export { createLiveMovieSession } from '../apps/editor/src/live-movie-session';
export { createLiveMoviePainter } from '../apps/editor/src/live-movie-paint';
export function liveMovieTreesFixture(basis: string, mode: 'loop' | 'once' | 'single') {
  const { p } = readOnlyMovieTreeFixture(basis),
    parent = p.symbols![0],
    child = structuredClone(parent.shapes[0]);
  const middle = {
    id: 'middle',
    name: 'Middle',
    width: 60,
    height: 10,
    shapes: [child],
    timeline: {
      duration: 4,
      keys: [
        { frame: 2, shapes: [] },
        { frame: 3, shapes: [child] },
      ],
    },
  };
  p.symbols!.push(middle);
  parent.shapes = [
    { ...symbolInstance(middle, 0, 0), id: 'bridge', symbolPlayback: { mode, firstFrame: 0 } },
  ];
  return prepareCreateLiveMotionSpans(p, [
    {
      layerId: 'track',
      span: {
        id: 'tree',
        start: 2,
        end: 10,
        ease: 'linear',
        symbolContinuity: 'movie-trees',
      },
    },
  ]);
}
