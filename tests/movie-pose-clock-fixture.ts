export { captureMoviePoseClock } from '../packages/animation/src/movie-pose-clock';
export { CanvasStage } from '../packages/stage/src';
export { exportPNGFrame } from '../apps/editor/src/export-png';
export { prepareLiveMotionFrameCapture } from '../packages/animation/src/live-motion-presentation';
import { livePresentationFixture } from './live-motion-presentation-fixture';

export function moviePoseFixture() {
  const p = livePresentationFixture('movie');
  p.width = 400;
  p.height = 160;
  p.duration = 12;
  p.fps = 10;
  const root = { ...p.layers[1].keys[1].shapes[0], x: 20, y: 80 };
  p.layers[1].keys = [
    { frame: 0, shapes: [] },
    { frame: 1, shapes: [root] },
    { frame: 3, shapes: [{ ...root, x: 40 }] },
    { frame: 6, shapes: [] },
    { frame: 8, shapes: [structuredClone(root)] },
  ];
  return p;
}
