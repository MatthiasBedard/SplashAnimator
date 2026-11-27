import {
  newProject,
  type Vector,
  type Project,
  type LiveMotionSpan,
} from '../packages/document/src';
export type Basis = [number, number, number, number];
export function liveRotationFixture(mode = 'rigid', basis = 'plain', many = false, plain = false) {
  const p = newProject();
  p.width = 300;
  p.height = 240;
  p.duration = 12;
  p.fps = 1;
  const b: Basis =
    basis === 'plain' ? [1, 0, 0, 1] : [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3];
  const h: Basis =
    mode === 'uniform'
      ? [1.5, 0, 0, 1.5]
      : mode === 'axes'
        ? [2, 0, 0, 0.5]
        : mode === 'shear'
          ? [2, 0, 0.25, 0.5]
          : mode === 'both'
            ? [2, 0.2, 0.25, 0.5]
            : [1, 0, 0, 1];
  const multiply = (a: Basis, b: Basis): Basis => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
  ];
  const shape = (id: string, x: number, y: number, groups?: string[]): Vector => ({
    id,
    kind: 'rectangle',
    x,
    y,
    width: 12,
    height: 10,
    rotation: 0,
    transform: [...b],
    pivot: { x: 3, y: 4 },
    opacity: 0.75,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    ...(groups ? { groups } : {}),
  });
  const first = [shape('a', 0, 20, ['outer', 'inner']), shape('b', 40, 20, ['outer', 'inner'])];
  if (many)
    first.push(
      shape('c', 160, 120, ['second']),
      shape('d', 200, 120, ['second', 'child']),
      shape('loose', 280, 40),
    );
  const last = first.map((s): Vector => {
    const grouped = !!s.groups?.length,
      leader = s.groups?.[0] === 'second' ? first[2] : first[0],
      dx = s.x - leader.x,
      dy = s.y - leader.y;
    return {
      ...structuredClone(s),
      x: grouped ? leader.x + 80 - (h[1] * dx + h[3] * dy) : s.x + 20,
      y: grouped ? leader.y + h[0] * dx + h[2] * dy : s.y + 40,
      rotation: 90,
      transform: grouped ? multiply(h, b) : [...b],
    };
  });
  if (plain) for (const s of [...first, ...last]) delete s.groups;
  const span: LiveMotionSpan = {
    id: 'live',
    start: 0,
    end: 8,
    ease: 'linear',
    opacityEase: 'out',
    paintEase: 'linear',
    options: { paint: true, ...(mode !== 'rigid' ? { affine: true } : {}) },
    rotation: {
      direction: 'shortest',
      turns: 0,
      ...(!plain ? { rigidGroups: true } : {}),
      ...(mode === 'uniform'
        ? { uniformGroupScale: true }
        : mode !== 'rigid'
          ? {
              axisGroupScale: true,
              ...(mode === 'shear' || mode === 'both' ? { axisGroupShear: true } : {}),
            }
          : {}),
    },
  };
  p.layers[0].id = 'track';
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys = [
    { frame: 0, shapes: first },
    { frame: 8, shapes: last },
    { frame: 10, shapes: [] },
  ];
  p.layers[0].liveMotionSpans = [span];
  p.symbols = [
    {
      id: 'library',
      name: 'Preserve',
      width: 1,
      height: 1,
      shapes: [{ ...shape('saved', 0, 0), width: 1, height: 1 }],
    },
  ];
  return { p, b, h };
}
export function secondRotationTrack(p: Project) {
  const later = structuredClone(p.layers[0]);
  later.id = 'later';
  p.layers.push(later);
  return later;
}
export {
  prepareUpdateLiveMotionSpans,
  captureLiveMotionTimeline,
} from '../packages/animation/src/live-motion';
