import {
  newProject,
  type Project,
  type SymbolDefinition,
  type Vector,
  type LiveMotionSpan,
} from '../packages/document/src';
import { symbolInstance } from '../packages/geometry/src/symbols';
import { prepareCreateLiveMotionSpans } from '../packages/animation/src/live-motion';
export function liveGraphicFixture(mode = 'loop', basis = 'plain') {
  const p = newProject();
  p.width = 240;
  p.height = 160;
  p.duration = 14;
  const rect = (x: number): Vector => ({
    id: 'art',
    kind: 'rectangle',
    x,
    y: 0,
    width: 4,
    height: 4,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  });
  const definition: SymbolDefinition = {
    id: 'graphic',
    name: 'Graphic',
    width: 60,
    height: 10,
    shapes: [rect(0)],
    timeline: {
      duration: 5,
      keys: [1, 2, 3, 4].map((frame) => ({ frame, shapes: [rect(frame * 10)] })),
    },
  };
  p.symbols = [definition];
  const start = {
    ...symbolInstance(definition, 20, 30),
    id: 'instance',
    ...(mode === 'default'
      ? {}
      : { symbolPlayback: { mode: mode as 'loop' | 'once' | 'single', firstFrame: 1 } }),
  };
  if (basis !== 'plain') start.transform = [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3];
  const end = {
    ...structuredClone(start),
    x: 100,
    y: 70,
    rotation: 90,
    symbolPlayback: {
      mode: (mode === 'default' ? 'loop' : mode) as 'loop' | 'once' | 'single',
      firstFrame: mode === 'single' ? 1 : mode === 'once' ? 4 : mode === 'default' ? 3 : 4,
    },
  };
  p.layers[0].id = 'track';
  p.layers[0].keys = [
    { frame: 0, shapes: [] },
    { frame: 2, shapes: [start] },
    { frame: 10, shapes: [end] },
    { frame: 12, shapes: [] },
  ];
  const span: LiveMotionSpan = {
    id: 'live',
    start: 2,
    end: 10,
    ease: 'linear',
    symbolContinuity: 'graphics',
  };
  return { p, span, definition };
}
export function createLiveGraphics(p: Project, span: LiveMotionSpan) {
  return prepareCreateLiveMotionSpans(p, [{ layerId: 'track', span }]);
}
