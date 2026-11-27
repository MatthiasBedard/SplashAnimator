export { prepareLiveMotionFrameCapture } from '../packages/animation/src/live-motion-presentation';
export { exportPNGFrame } from '../apps/editor/src/export-png';
import { newProject, newLayer, type Vector } from '../packages/document/src';
import { prepareCreateLiveMotionSpans } from '../packages/animation/src/live-motion';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import { symbolInstance } from '../packages/geometry/src/symbols';

export function livePresentationFixture(mode = 'graphic') {
  const p = newProject();
  p.width = 160;
  p.height = 80;
  p.duration = 10;
  p.background = '#ffffff';
  const rect = (id: string, fill: string): Vector => ({
    id,
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    fill,
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  });
  p.layers[0].id = 'live';
  p.layers[0].keys = [
    { frame: 0, shapes: [rect('red', '#ff0000')] },
    { frame: 4, shapes: [{ ...rect('red', '#ff0000'), x: 80 }] },
    { frame: 8, shapes: [] },
  ];
  const child = newProject();
  child.duration = 5;
  child.layers[0].keys = [
    { frame: 0, shapes: [rect('blue', '#0000ff')] },
    { frame: 4, shapes: [{ ...rect('blue', '#0000ff'), x: 80 }] },
  ];
  createBasicMotionSpan(child, [child.layers[0].id], 0, 4, 'linear');
  const track = child.layers[0];
  track.keys[4].shapes[0].x = 120;
  p.symbols = [
    {
      id: 'child',
      name: 'Child',
      width: 160,
      height: 20,
      shapes: track.keys[0].shapes,
      timeline: { duration: 5, keys: track.keys.slice(1), motionSpans: track.motionSpans },
    },
  ];
  let instance = { ...symbolInstance(p.symbols[0], 0, 40), id: 'instance' };
  if (mode === 'movie')
    instance = { ...instance, symbolPlayback: { mode: 'movie', firstFrame: 2 } };
  if (mode === 'button') {
    const button = {
      id: 'button',
      name: 'Button',
      width: 160,
      height: 20,
      shapes: [
        {
          ...symbolInstance(p.symbols[0], 0, 0),
          id: 'inside',
          symbolPlayback: { mode: 'movie' as const, firstFrame: 2 },
        },
      ],
      buttonStates: { up: 0, over: 0, down: 0, hit: 0 },
    };
    p.symbols.push(button);
    instance = { ...symbolInstance(button, 0, 40), id: 'instance' };
  }
  p.layers.push({
    ...newLayer('Held graphic'),
    id: 'graphic',
    keys: [
      { frame: 0, shapes: [] },
      { frame: 1, shapes: [instance] },
    ],
  });
  p.frameScripts = [
    { frame: 0, source: "throw new Error('Live read-only preview must remain script-free');" },
  ];
  return prepareCreateLiveMotionSpans(p, [
    { layerId: 'live', span: { id: 'span', start: 0, end: 4, ease: 'linear' } },
  ]);
}
