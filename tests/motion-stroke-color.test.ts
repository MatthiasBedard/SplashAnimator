import { expect, it } from 'vitest';
import { liveSplitFixture } from './live-motion-split-fixture';
import { validateProject } from '../packages/document/src';
import {
  createBasicMotionSpan,
  refreshBasicMotionSpan,
  splitBasicMotionSpan,
} from '../packages/animation/src/motion-spans';

function artwork() {
  const project = liveSplitFixture();
  const layer = project.layers[0];
  delete layer.liveMotionSpans;
  for (const [index, key] of layer.keys.slice(0, 2).entries()) {
    const shape = key.shapes[0];
    shape.fill = '#ABCDEF';
    shape.stroke = index ? '#808080' : '#000000';
    shape.strokeWidth = 4;
    shape.gradient = {
      kind: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 20, y: 0 },
      stops: [
        { offset: 0, color: '#ABCDEF', opacity: 0.25 },
        { offset: 1, color: '#FFAABB' },
      ],
    };
  }
  return project;
}

it('reopens and refreshes remembered stroke colors without rewriting retained gradient paint', () => {
  const p = artwork(),
    before = structuredClone(p.layers[0].keys);
  createBasicMotionSpan(p, ['track'], 0, 8, 'linear', { strokeColor: true });
  const reopened = validateProject(JSON.parse(JSON.stringify(p)));
  refreshBasicMotionSpan(reopened, ['track'], 0, 8);
  const keys = reopened.layers[0].keys;
  expect(keys.filter((k) => [0, 8, 10].includes(k.frame))).toEqual(before);
  expect(keys[2].shapes[0]).toMatchObject({
    stroke: '#202020',
    fill: '#ABCDEF',
    gradient: before[0].shapes[0].gradient,
  });
  const original = structuredClone(keys);
  splitBasicMotionSpan(reopened, ['track'], 0, 8, 4, true);
  expect(reopened.layers[0].keys).toEqual(original);
  expect(reopened.layers[0].motionSpans?.map((s) => s.options)).toEqual([
    { strokeColor: true },
    { strokeColor: true },
  ]);
});

it('rejects a later track with changing fill paint before writing either track', () => {
  const p = artwork();
  const other = structuredClone(p.layers[0]);
  other.id = 'other';
  other.keys[1].shapes[0].gradient!.stops[0].color = '#112233';
  p.layers.push(other);
  const original = structuredClone(p);
  expect(() =>
    createBasicMotionSpan(p, ['track', 'other'], 0, 8, 'linear', { strokeColor: true }),
  ).toThrow();
  expect(p).toEqual(original);
});
