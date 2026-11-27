import { liveMovieFixture } from './live-movies-fixture';
import { symbolInstance } from '../packages/geometry/src/symbols';
export { createReadOnlyMovieTreeFrameSampler } from '../packages/animation/src/read-only-movie-tree-sampler';
export { exportPNGFrame } from '../apps/editor/src/export-png';
export { createLiveMovieSession } from '../apps/editor/src/live-movie-session';
export { createLiveMoviePainter } from '../apps/editor/src/live-movie-paint';
export function readOnlyMovieTreeFixture(basis: string) {
  const { p, definition } = liveMovieFixture(9998, basis);
  p.width = 400;
  p.height = 240;
  for (const key of p.layers[0].keys)
    for (const s of key.shapes) {
      s.x = key.frame === 2 ? 160 : 180;
      s.y = key.frame === 2 ? 100 : 140;
    }
  const leaf = {
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
      ...symbolInstance(leaf, 7, 3),
      id: 'nested',
      symbolPlayback: { mode: 'movie', firstFrame: 1 },
    },
  ];
  definition.timeline = { duration: 5, keys: [] };
  p.symbols!.push(leaf);
  p.frameScripts = [{ frame: 2, source: 'globalThis.__treeScriptRan = true' }];
  return {
    p,
    requests: [{ layerId: 'track', recipe: { start: 2, end: 10, ease: 'linear' as const } }],
  };
}
