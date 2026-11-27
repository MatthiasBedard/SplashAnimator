import { liveMovieFixture } from './live-movies-fixture';
import { symbolInstance } from '../packages/geometry/src/symbols';
import { prepareCreateLiveMotionSpans } from '../packages/animation/src/live-motion';
import type { Project, LiveMotionSpan } from '../packages/document/src';
export function liveTreeFixture(first = 1, basis = 'plain') {
  const { p, span, definition } = liveMovieFixture(first, basis),
    leaf = {
      ...structuredClone(definition),
      id: 'leaf',
      name: 'Leaf',
      timeline: {
        duration: 3,
        keys: [1, 2].map((frame) => ({
          frame,
          shapes: [{ ...structuredClone(definition.shapes[0]), x: frame * 10 }],
        })),
      },
    };
  definition.shapes = [
    {
      ...symbolInstance(leaf, 0, 0),
      id: 'nested',
      symbolPlayback: { mode: 'movie', firstFrame: 1 },
    },
  ];
  definition.timeline = { duration: 5, keys: [] };
  p.symbols!.push(leaf);
  span.symbolContinuity = 'movie-trees';
  return { p, span, definition };
}
export function createLiveMovieTrees(p: Project, span: LiveMotionSpan) {
  return prepareCreateLiveMotionSpans(p, [{ layerId: 'track', span }]);
}
