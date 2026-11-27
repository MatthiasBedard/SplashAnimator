import { expect, it } from 'vitest';
import { clone, newProject, type Vector } from '../packages/document/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import {
  createBoundOpacitySampler,
  type RootOpacityBinding,
} from '../packages/animation/src/opacity-binding';
function fixture() {
  const p = newProject();
  p.duration = 14;
  const a: Vector = {
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
    opacity: 0.8,
  };
  const l = p.layers[0];
  l.keys = [
    { frame: 0, shapes: [a, { ...a, id: 'b' }] },
    { frame: 5, shapes: [{ ...a, x: 50 }] },
    { frame: 8, shapes: [] },
    { frame: 10, shapes: [{ ...a, x: 100 }] },
  ];
  const other = clone(l);
  other.id = 'other';
  p.layers.push(other);
  const binding: RootOpacityBinding = {
    layerId: l.id,
    shapeId: 'a',
    start: 2,
    end: 7,
    keys: [
      { frame: 3, opacity: 0, ease: 'in' },
      { frame: 7, opacity: 1 },
    ],
  };
  return { p, l, binding };
}
it('holds keys only inside the selected interval; preserves exposure origins, siblings and later reused IDs', () => {
  const { p, l, binding } = fixture(),
    before = clone(p);
  l.locked = true;
  before.layers[0].locked = true;
  const plan = createBoundOpacitySampler(() => ({ project: p, revision: 0 }), [binding]);
  binding.keys[0].opacity = 1;
  binding.end = 12;
  binding.shapeId = 'b';
  for (const [frame, value] of [
    [1, 0.8],
    [2, 0],
    [5, 0.25],
    [7, 1],
    [11, 0.8],
    [4, 0.0625],
  ]) {
    const [a, b] = plan.sample(frame);
    expect(a.key.shapes[0].opacity).toBe(value);
    expect(b.key.shapes[0].opacity).toBe(0.8);
    expect(a.key.frame).toBe(frame < 5 ? 0 : frame < 8 ? 5 : 10);
    if (frame < 5) expect(a.key.shapes[1].opacity).toBe(0.8);
    a.key.shapes[0].x = 999;
  }
  expect(plan.sample(9)[0].key.shapes).toEqual([]);
  expect(p).toEqual(before);
  plan.dispose();
  expect(() => plan.sample(4)).toThrow(/disposed/);
});
it('accepts independent disjoint channels for two lifetimes and rejects overlap including a shared frame', () => {
  const { p, binding } = fixture(),
    read = () => ({ project: p, revision: 0 });
  const later = { ...binding, start: 10, end: 13, keys: [{ frame: 11, opacity: 0.1 }] };
  const plan = createBoundOpacitySampler(read, [later, binding]);
  expect(plan.sample(3)[0].key.shapes[0].opacity).toBe(0);
  expect(plan.sample(10)[0].key.shapes[0].opacity).toBe(0.1);
  expect(() =>
    createBoundOpacitySampler(read, [
      binding,
      { ...binding, start: 7, end: 7, keys: [{ frame: 7, opacity: 0.2 }] },
    ]),
  ).toThrow(/overlap/);
});
it('rejects gaps, missing/ambiguous targets, replacement kinds/symbols and out-of-interval keys before sampling', () => {
  for (const mode of [
    'gap',
    'missing',
    'layer',
    'duplicate',
    'kind',
    'symbol',
    'range',
    'keys',
    'order',
  ]) {
    const { p, l, binding } = fixture();
    if (mode === 'gap') binding.end = 12;
    if (mode === 'missing') binding.shapeId = 'b';
    if (mode === 'layer') p.layers.push(clone(l));
    if (mode === 'duplicate') l.keys[1].shapes.push(clone(l.keys[1].shapes[0]));
    if (mode === 'kind') l.keys[1].shapes[0].kind = 'ellipse';
    if (mode === 'symbol')
      for (const [i, k] of l.keys.entries())
        for (const s of k.shapes) {
          s.kind = 'symbol';
          s.symbolId = i ? 'new' : 'old';
        }
    if (mode === 'range') binding.start = NaN;
    if (mode === 'keys') binding.start = 4;
    if (mode === 'order') l.keys[1].frame = 0;
    expect(() =>
      createBoundOpacitySampler(() => ({ project: p, revision: 0 }), [binding]),
    ).toThrow();
  }
});
it('overrides opacity on the evaluated pose while retaining remembered geometry, locks, and baseline rejection', () => {
  const { p, l, binding } = fixture();
  l.keys[0].shapes.pop();
  createBasicMotionSpan(p, [l.id], 0, 5, 'linear');
  l.keys[5].shapes[0].x = 100;
  const read = () => ({ project: p, revision: 0 }),
    before = clone(p);
  const plan = createBoundOpacitySampler(read, [binding]);
  const pose = plan.sample(4)[0];
  expect(pose.sampled).toBe(true);
  expect(pose.key.shapes[0]).toMatchObject({ x: 80, opacity: 0.0625 });
  expect(p).toEqual(before);
  l.keys[2].shapes[0].x = 999;
  expect(() => createBoundOpacitySampler(read, [binding]).sample(4)).toThrow(
    /Generated keys changed/,
  );
  l.visible = false;
  expect(
    createBoundOpacitySampler(read, [binding])
      .sample(4)
      .map((t) => t.layerId),
  ).toEqual(['other']);
});
it('refuses changed source identity/revision and a revision change during evaluation', () => {
  const { p, binding } = fixture();
  let project = p,
    revision = 0,
    count = 0,
    flip = Infinity;
  const read = () => ({ project, revision: ++count === flip ? ++revision : revision });
  const plan = createBoundOpacitySampler(read, [binding]);
  revision++;
  expect(() => plan.sample(3)).toThrow(/changed/);
  const next = createBoundOpacitySampler(read, [binding]);
  project = clone(p);
  expect(() => next.sample(3)).toThrow(/changed/);
  const latest = createBoundOpacitySampler(read, [binding]);
  flip = count + 3;
  expect(() => latest.sample(3)).toThrow(/changed/);
});

it('rejects reentry or disposal in a source callback without publishing a scene', () => {
  for (const action of ['reenter', 'dispose']) {
    const { p, binding } = fixture();
    let trigger = false;
    const plan = createBoundOpacitySampler(() => {
      if (trigger) {
        trigger = false;
        if (action === 'dispose') plan.dispose();
        else plan.sample(3);
      }
      return { project: p, revision: 0 };
    }, [binding]);
    trigger = true;
    expect(() => plan.sample(3)).toThrow();
    if (action === 'dispose') expect(() => plan.sample(3)).toThrow(/disposed/);
    else expect(plan.sample(3)[0].key.shapes[0].opacity).toBe(0);
  }
});

it('samples persisted binding data by default but leaves unbound projects unchanged',()=>{
 const {p,binding}=fixture();const read=()=>({project:p,revision:0});expect(createBoundOpacitySampler(read).sample(3)[0].key.shapes[0].opacity).toBe(0.8);
 p.opacityBindings=[binding];expect(createBoundOpacitySampler(read).sample(3)[0].key.shapes[0].opacity).toBe(0);
 expect(createBoundOpacitySampler(read,[]).sample(3)[0].key.shapes[0].opacity).toBe(0.8);
});
