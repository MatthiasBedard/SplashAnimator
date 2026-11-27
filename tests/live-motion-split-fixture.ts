export {
  captureLiveMotionAuthoringFrame,
  prepareSplitLiveMotionSpans,
} from '../packages/animation/src/live-motion-owner';
export { captureLiveMotionTimeline } from '../packages/animation/src/live-motion';
export { prepareLiveMotionFrameCapture } from '../packages/animation/src/live-motion-presentation';
export { exportPNGFrame } from '../apps/editor/src/export-png';
import {
  newProject,
  type Project,
  type Vector,
  type LiveMotionSpan,
} from '../packages/document/src';
import { prepareCreateLiveMotionSpans } from '../packages/animation/src/live-motion';

export function liveSplitFixture(change?: (p: Project, span: LiveMotionSpan) => void): Project {
  const p = newProject();
  p.width = 160;
  p.height = 100;
  p.duration = 12;
  p.background = '#ffffff';
  const a: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 8,
    y: 12,
    width: 20,
    height: 20,
    rotation: 0,
    opacity: 1,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.layers[0].id = 'track';
  p.layers[0].keys = [
    { frame: 0, shapes: [a] },
    { frame: 8, shapes: [{ ...structuredClone(a), x: 88 }] },
    { frame: 10, shapes: [] },
  ];
  const span: LiveMotionSpan = { id: 'live', start: 0, end: 8, ease: 'linear' };
  change?.(p, span);
  return prepareCreateLiveMotionSpans(p, [{ layerId: 'track', span }]);
}
