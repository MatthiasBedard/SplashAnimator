export { splitLiveMovieMotionLayer } from '../packages/animation/src/live-movie-motion-split';
export {
  createLiveMovieSession,
  createLiveMoviePainter,
  exportPNGFrame,
} from './live-movies-fixture';
import { liveMovieFixture, createLiveMovies } from './live-movies-fixture';
export function movieSplitFixture(basis = 'plain') {
  const { p, span } = liveMovieFixture(1, basis);
  p.width = 400;
  p.height = 240;
  p.fps = 10;
  p.frameScripts = [
    { frame: 3, source: "throw new Error('movie split previews stay script-free')" },
  ];
  for (const key of p.layers[0].keys)
    for (const shape of key.shapes) {
      shape.x = key.frame === 2 ? 160 : 180;
      shape.y += 70;
    }
  return createLiveMovies(p, span);
}
