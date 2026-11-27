export { splitLiveMovieTreeMotionLayer } from '../packages/animation/src/live-movie-tree-motion-split';
export {
  createLiveMovieSession,
  createLiveMoviePainter,
  exportPNGFrame,
} from './live-movies-fixture';
import { liveTreeFixture, createLiveMovieTrees } from './live-tree-edit-fixture';
import { symbolInstance } from '../packages/geometry/src/symbols';
export function treeSplitFixture(basis = 'plain', bridgeMode?: 'loop' | 'once' | 'single') {
  const { p, span, definition } = liveTreeFixture(1, basis);
  p.width = 400;
  p.height = 240;
  p.fps = 10;
  p.frameScripts = [
    { frame: 3, source: "throw new Error('Nested split previews stay script-free')" },
  ];
  for (const key of p.layers[0].keys)
    for (const shape of key.shapes) {
      shape.x = key.frame === 2 ? 160 : 180;
      shape.y += 70;
    }
  if (bridgeMode) {
    const bridge = {
      id: 'bridge',
      name: 'Bridge',
      width: 60,
      height: 10,
      shapes: definition.shapes,
      timeline: {
        duration: 4,
        keys: [
          { frame: 2, shapes: [] },
          { frame: 3, shapes: definition.shapes },
        ],
      },
    };
    definition.shapes = [
      {
        ...symbolInstance(bridge, 0, 0),
        id: 'bridge-instance',
        symbolPlayback: { mode: bridgeMode, firstFrame: 0 },
      },
    ];
    p.symbols!.push(bridge);
  }
  return createLiveMovieTrees(p, span);
}
