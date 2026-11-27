import { expect, it } from 'vitest';
import { newProject, type Vector } from '../packages/document/src';
import { liveCreationIssue } from '../apps/editor/src/live-creation';
function fixture() {
  const p = newProject();
  p.duration = 12;
  const shape: Vector = {
    id: 'a',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    groups: ['outer', 'inner'],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [shape, { ...structuredClone(shape), id: 'b', x: 20 }] },
    { frame: 8, shapes: [structuredClone(shape), { ...structuredClone(shape), id: 'b', x: 40 }] },
    { frame: 10, shapes: [] },
  ];
  return p;
}
it('requires explicit group hints while retaining omitted/plain scope exactly', () => {
  const p = fixture(),
    id = p.layers[0].id,
    before = structuredClone(p);
  expect(liveCreationIssue(p, id, 0, 8)).toBe(liveCreationIssue(p, id, 0, 8, 'plain'));
  expect(liveCreationIssue(p, id, 0, 8)).toMatch(/grouped/);
  expect(liveCreationIssue(p, id, 0, 8, 'groups')).toBeUndefined();
  expect(p).toEqual(before);
});
for (const invalid of [
  'noGroup',
  'singleton',
  'laterSingleton',
  'order',
  'identity',
  'ancestry',
  'missingAncestry',
  'symbol',
  'blank',
  'interior',
  'locked',
  'hidden',
  'overlap',
  'opacity',
  'fraction',
  'missing',
  'outside',
] as const)
  it(`group availability rejects ${invalid} without changing original artwork`, () => {
    const p = fixture(),
      layer = p.layers[0];
    if (invalid === 'noGroup')
      for (const key of layer.keys) for (const s of key.shapes) delete s.groups;
    if (invalid === 'singleton') for (const key of layer.keys) key.shapes.splice(1);
    if (invalid === 'laterSingleton')
      for (const key of layer.keys.slice(0, 2))
        key.shapes.push({ ...structuredClone(key.shapes[0]), id: 'lonely', groups: ['other'] });
    if (invalid === 'order') layer.keys[1].shapes.reverse();
    if (invalid === 'identity') layer.keys[1].shapes[1].id = 'other';
    if (invalid === 'ancestry') layer.keys[1].shapes[1].groups = ['outer', 'changed'];
    if (invalid === 'missingAncestry') delete layer.keys[1].shapes[1].groups;
    if (invalid === 'symbol') Object.assign(layer.keys[0].shapes[0], { kind: 'symbol' });
    if (invalid === 'blank') layer.keys[1].shapes = [];
    if (invalid === 'interior')
      layer.keys.splice(1, 0, { frame: 4, shapes: structuredClone(layer.keys[0].shapes) });
    if (invalid === 'locked') layer.locked = true;
    if (invalid === 'hidden') layer.visible = false;
    if (invalid === 'overlap')
      layer.liveMotionSpans = [{ id: 'owned', start: 0, end: 8, ease: 'linear' }];
    if (invalid === 'opacity')
      p.opacityBindings = [
        {
          layerId: layer.id,
          shapeId: 'a',
          start: 0,
          end: 8,
          keys: [
            { frame: 0, opacity: 1 },
            { frame: 8, opacity: 0.5 },
          ],
        },
      ];
    const before = structuredClone(p);
    expect(
      liveCreationIssue(
        p,
        layer.id,
        invalid === 'fraction' ? 0.5 : invalid === 'missing' ? 1 : 0,
        invalid === 'outside' ? 20 : 8,
        'groups',
      ),
    ).toBeTruthy();
    expect(p).toEqual(before);
  });
it('complete multiple outer groups and loose roots are only hints, not geometry certification', () => {
  const p = fixture();
  for (const key of p.layers[0].keys.slice(0, 2)) {
    key.shapes.push(
      ...key.shapes.map((s) => ({
        ...structuredClone(s),
        id: s.id + '2',
        groups: ['second', 'nested'],
      })),
    );
    key.shapes.push({ ...structuredClone(key.shapes[0]), id: 'loose', groups: undefined });
  }
  p.layers[0].keys[1].shapes[1].x = 999;
  expect(liveCreationIssue(p, p.layers[0].id, 0, 8, 'groups')).toBeUndefined();
});
it('plain ungrouped endpoints never inherit group eligibility', () => {
  const p = fixture();
  for (const key of p.layers[0].keys) for (const s of key.shapes) delete s.groups;
  expect(liveCreationIssue(p, p.layers[0].id, 0, 8)).toBeUndefined();
  expect(liveCreationIssue(p, p.layers[0].id, 0, 8, 'groups')).toMatch(/outer groups/);
});
