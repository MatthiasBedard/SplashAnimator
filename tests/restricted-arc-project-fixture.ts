import { liveRotationFixture } from './live-motion-rotation-fixture';
import { validateProject } from '../packages/document/src';
import {
  captureLiveGroupMotionAuthoringFrame,
  prepareLiveGroupRestrictedArcGeometry,
} from '../packages/animation/src/live-group-motion-owner';
/** Test-only saved linear pair; production split publication stays guarded. */
export function restrictedArcProject(basis = 'plain') {
  const { p } = liveRotationFixture('rigid', basis, true),
    layer = p.layers[0],
    span = layer.liveMotionSpans![0];
  p.width = 400;
  for (const group of ['outer', 'second']) {
    const shapes = layer.keys[0].shapes.filter((s) => s.groups?.[0] === group);
    shapes[1].x = shapes[0].x;
    shapes[1].y = shapes[0].y;
  }
  for (const s of layer.keys[0].shapes) {
    s.opacity = 1;
    s.fill = s.id === 'loose' ? '#0000ff' : s.groups?.[0] === 'second' ? '#00ff00' : '#ff0000';
  }
  layer.keys[1].shapes = layer.keys[0].shapes.map((s) => ({
    ...structuredClone(s),
    x: s.x + 96,
    y: s.y + 24,
  }));
  span.groupPaths = ['outer', 'second'].map((groupId) => ({
    groupId,
    composition: 'additive',
    path: { startX: 32, startY: -40, endX: -32, endY: -24, distance: true },
  }));
  const scope = captureLiveGroupMotionAuthoringFrame(() => ({ project: p, revision: 0, frame: 4 }));
  const staged = prepareLiveGroupRestrictedArcGeometry([scope.resolve('track', 'outer')])[0];
  scope.dispose();
  const q = structuredClone(p),
    l = q.layers[0];
  l.keys.push({ frame: 4, shapes: staged.middle });
  l.keys.sort((a, b) => a.frame - b.frame);
  l.liveMotionSpans = [0, 1].map((side) => ({
    ...structuredClone(span),
    id: side ? 'right' : span.id,
    start: side ? 4 : 0,
    end: side ? 8 : 4,
    groupPaths: staged.bindings.map((binding) => {
      const g = binding.halves[side];
      return {
        groupId: binding.groupId,
        composition: 'additive',
        path: {
          startX: g.cubic[1].x,
          startY: g.cubic[1].y,
          endX: g.cubic[2].x - g.cubic[3].x,
          endY: g.cubic[2].y - g.cubic[3].y,
          distance: true,
        },
        restrictedArc: { descriptor: structuredClone(g.descriptor), origin: { ...g.origin } },
      };
    }),
  }));
  validateProject(q);
  return { p, q };
}
