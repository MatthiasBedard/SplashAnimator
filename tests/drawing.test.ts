import { describe, expect, it } from 'vitest';
import {
  id,
  newProject,
  MAX_VECTOR_POINTS,
  validateProject,
  migrateProject,
  type Vector,
} from '../packages/document/src';
import {
  brushDabs,
  pathCommands,
  flattenCommands,
  normalizeVector,
  scaleVector,
  polystar,
  eraseStroke,
  hit,
  hitPart,
} from '../packages/geometry/src';
import { samplePointer, appendSample } from '../packages/interaction/src';
const shape = (kind: Vector['kind'] = 'path'): Vector => ({
  id: id(),
  kind,
  x: 10,
  y: 20,
  width: 100,
  height: 100,
  rotation: 0,
  fill: '#8844ff',
  stroke: '#000000',
  strokeWidth: 40,
  points: [],
});
describe('M2 brush geometry and pointer samples', () => {
  it('renders genuinely different widths from pressure and interpolates between sparse samples', () => {
    const s = shape('brush');
    s.brush = { pressure: true, minimum: 0.1, tilt: false, aspect: 1, angle: 0 };
    s.points = [
      { x: 0, y: 0, pressure: 0 },
      { x: 100, y: 0, pressure: 1 },
    ];
    const dabs = brushDabs(s);
    expect(dabs[0].rx).toBe(2);
    expect(dabs.at(-1)!.rx).toBe(20);
    expect(dabs.length).toBeGreaterThan(100);
    expect(dabs[Math.floor(dabs.length / 2)].rx).toBeCloseTo(11, 0);
    expect(hit(s, { x: 10, y: 30 }, 0)).toBe(false);
    expect(hit(s, { x: 110, y: 30 }, 0)).toBe(true);
    s.brush.pressure = false;
    expect(brushDabs(s).every((d) => d.rx === 20)).toBe(true);
  });
  it('tilt narrows and orients an elliptical nib without losing editable input samples', () => {
    const s = shape('brush');
    s.brush = { pressure: true, minimum: 0.1, tilt: true, aspect: 1, angle: 0 };
    s.points = [{ x: 0, y: 0, pressure: 1, tiltX: 0, tiltY: 90 }];
    const d = brushDabs(s)[0];
    expect(d.rx).toBe(20);
    expect(d.ry).toBe(5);
    expect(d.angle).toBeCloseTo(Math.PI / 2);
    const p = newProject();
    p.layers[0].keys[0].shapes.push(s);
    expect(validateProject(p).layers[0].keys[0].shapes[0].points[0].tiltY).toBe(90);
  });
  it('uses full mouse width and retains last contact pressure on pen release', () => {
    const sample = {
      pointerType: 'mouse',
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      type: 'pointermove',
    };
    expect(samplePointer(sample, { x: 1, y: 2 }).pressure).toBe(1);
    expect(
      samplePointer(
        { ...sample, pointerType: 'pen', pressure: 0, type: 'pointerup' },
        { x: 1, y: 2 },
        { x: 0, y: 0, pressure: 0.8 },
      ).pressure,
    ).toBe(0.8);
    const points = [{ x: 0, y: 0, pressure: 0.1 }];
    appendSample(points, { x: 0, y: 0, pressure: 0.8 });
    expect(points).toHaveLength(2);
  });
});
describe('editable paths, fill/stroke hit semantics, and erasure', () => {
  it('scales editable text independently on both axes and rejects invalid text transforms', () => {
    const s = shape('text');
    s.text = {
      content: 'Splash',
      font: 'Arial',
      size: 24,
      bold: false,
      italic: false,
      align: 'center',
    };
    scaleVector(s, 2, 0.5);
    expect(s.width).toBe(200);
    expect(s.height).toBe(50);
    expect(s.text.scaleX).toBe(2);
    expect(s.text.scaleY).toBe(0.5);
    const p = newProject();
    p.layers[0].keys[0].shapes.push(s);
    expect(validateProject(p).layers[0].keys[0].shapes[0].text!.content).toBe('Splash');
    s.text.scaleY = -1;
    expect(() => validateProject(p)).toThrow('text');
  });
  it('keeps gradient coordinates anchored when path bounds are normalized', () => {
    const s = shape('path');
    s.points = [
      { x: -20, y: -10 },
      { x: 100, y: 20 },
    ];
    s.gradient = {
      kind: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    };
    normalizeVector(s);
    expect(s.gradient.from).toEqual({ x: 20, y: 10 });
    scaleVector(s, 2, 3);
    expect(s.gradient.to).toEqual({ x: 240, y: 30 });
    const p = newProject();
    p.layers[0].keys[0].shapes.push(s);
    expect(validateProject(p).layers[0].keys[0].shapes[0].gradient).toEqual(s.gradient);
    s.gradient.stops[1].offset = -1;
    expect(() => validateProject(p)).toThrow('gradient');
  });
  it('preserves cubic handles and world geometry when normalizing and scaling', () => {
    const s = shape('bezier');
    s.rotation = 90;
    s.nodes = [
      { x: -10, y: -20, out: { x: 20, y: -30 } },
      { x: 80, y: 90, in: { x: 40, y: 50 } },
    ];
    normalizeVector(s);
    expect(s.x).toBeCloseTo(40);
    expect(s.y).toBeCloseTo(10);
    expect(s.nodes[0].out).toEqual({ x: 30, y: 0 });
    scaleVector(s, 2, 0.5);
    expect(s.nodes[0].out).toEqual({ x: 60, y: 0 });
    const commands = pathCommands(s);
    expect(commands.some((c) => c[0] === 'C')).toBe(true);
    expect(flattenCommands(commands)[0].length).toBeGreaterThan(3);
  });
  it('does not flatten collinear overshooting Béziers into the endpoint chord', () => {
    const paths = flattenCommands([
      ['M', 0, 0],
      ['C', 100, 0, -100, 0, 1, 0],
    ]);
    expect(Math.max(...paths[0].map((p) => p.x))).toBeGreaterThan(20);
    expect(Math.min(...paths[0].map((p) => p.x))).toBeLessThan(-20);
  });
  it('distinguishes fill from stroke and respects hollow rounded primitives', () => {
    const s = shape('rectangle');
    s.strokeWidth = 2;
    s.cornerRadius = 30;
    expect(hitPart(s, { x: 60, y: 70 }, 0)).toBe('fill');
    expect(hitPart(s, { x: 10, y: 70 }, 0)).toBe('stroke');
    expect(hit(s, { x: 10, y: 20 }, 0)).toBe(false);
    s.fillEnabled = false;
    expect(hit(s, { x: 60, y: 70 }, 0)).toBe(false);
  });
  it('splits a long sparse pressure centerline with stable first ID and interpolated cut pressures', () => {
    const s = shape('brush');
    s.brush = { pressure: true, minimum: 0.1, tilt: false, aspect: 1, angle: 0 };
    s.points = [
      { x: 0, y: 0, pressure: 0 },
      { x: 100, y: 0, pressure: 1 },
    ];
    const pieces = eraseStroke(s, { x: 60, y: 0 }, { x: 60, y: 40 }, 10);
    expect(pieces).toHaveLength(2);
    expect(pieces[0].id).toBe(s.id);
    expect(pieces[1].id).not.toBe(s.id);
    expect(pieces[0].points.at(-1)!.x).toBeCloseTo(40);
    expect(pieces[1].points[0].pressure).toBeCloseTo(0.6);
    expect(s.points).toHaveLength(2);
  });
  it('creates separate star and polygon vertex counts and rejects invalid schema-3 tool data', () => {
    expect(polystar(100, 100, 5, 0.4)).toHaveLength(10);
    expect(polystar(100, 100, 6, 1)).toHaveLength(6);
    const p = newProject();
    p.layers[0].keys[0].shapes.push(shape('brush'));
    expect(() => validateProject(p)).toThrow('brush settings');
    const legacy = newProject();
    expect(migrateProject({ ...legacy, schemaVersion: 1 }).schemaVersion).toBe(59);
  });
});

it('converts legacy scaled-text paint and rejects invalid resize before mutating geometry', () => {
  const s = shape('text');
  s.text = {
    content: 'Text',
    font: 'Arial',
    size: 24,
    bold: false,
    italic: false,
    align: 'left',
    scaleX: 2,
    scaleY: 3,
  };
  s.pivot = { x: 4, y: 5 };
  s.gradient = {
    kind: 'radial',
    from: { x: 10, y: 10 },
    to: { x: 30, y: 10 },
    stops: [
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#ffffff' },
    ],
  };
  const before = JSON.parse(JSON.stringify(s));
  expect(() => scaleVector(s, 0, 1)).toThrow();
  expect(s).toEqual(before);
  scaleVector(s, 0.5, 2);
  expect(s.gradient.from).toEqual({ x: 10, y: 60 });
  expect(s.gradient.to).toEqual({ x: 30, y: 60 });
  expect(s.gradient.transform).toEqual([1, 0, 0, 6]);
  expect(s.text.scaleX).toBe(1);
  expect(s.text.scaleY).toBe(6);
});

it('retains the complete contact nib on release without losing the release position', () => {
  const contact = { x: 10, y: 20, pressure: 0.8, tiltX: 30, tiltY: -20, twist: 270 };
  const event = {
    pointerType: 'pen',
    type: 'pointerup',
    pressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
  };
  const released = samplePointer(event, { x: 12, y: 23 }, contact);
  expect(released).toEqual({ ...contact, x: 12, y: 23 });
  const stationary = [contact];
  appendSample(stationary, samplePointer(event, contact, contact));
  expect(stationary).toEqual([contact]);
  const stroke = shape('brush');
  stroke.brush = { pressure: true, minimum: 0.1, tilt: true, twist: true, aspect: 0.3, angle: 10 };
  stroke.points = [contact, released];
  const dabs = brushDabs(stroke),
    first = dabs[0],
    last = dabs.at(-1)!;
  expect(last.rx).toBe(first.rx);
  expect(last.ry).toBe(first.ry);
  expect(last.angle).toBeCloseTo(first.angle, 10);
  expect(samplePointer({ ...event, type: 'pointermove' }, { x: 12, y: 23 }, contact)).toMatchObject(
    { pressure: 0, tiltX: 0, tiltY: 0, twist: 0 },
  );
  expect(
    samplePointer({ ...event, pointerType: 'mouse' }, { x: 12, y: 23 }, contact),
  ).toMatchObject({ pressure: 1, tiltX: 0, tiltY: 0, twist: 0 });
  expect(samplePointer(event, { x: 12, y: 23 })).toMatchObject({
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
  });
});

it('reports sample exhaustion without silently accepting a truncated gesture', () => {
  const points = Array.from({ length: MAX_VECTOR_POINTS - 1 }, (_, x) => ({
    x,
    y: 0,
    pressure: 1,
  }));
  expect(appendSample(points, { x: MAX_VECTOR_POINTS - 1, y: 0, pressure: 1 })).toBe(true);
  expect(points).toHaveLength(MAX_VECTOR_POINTS);
  const before = JSON.stringify(points);
  expect(appendSample(points, { x: MAX_VECTOR_POINTS - 1, y: 0, pressure: 1 })).toBe(true);
  expect(appendSample(points, { x: MAX_VECTOR_POINTS, y: 0, pressure: 1 })).toBe(false);
  expect(appendSample(points, { x: MAX_VECTOR_POINTS - 1, y: 0, pressure: 0.5 })).toBe(false);
  expect(JSON.stringify(points)).toBe(before);
});

it('retains precise release endpoints without weakening the sample bound', () => {
  const points = [{ x: 0, y: 0, pressure: 0.7, twist: 90 }];
  const end = { ...points[0], x: 0.0625, y: 0.03125 };
  expect(appendSample(points, end)).toBe(true);
  expect(points).toHaveLength(1);
  expect(appendSample(points, end, true)).toBe(true);
  expect(points).toHaveLength(2);
  expect(points.at(-1)).toEqual(end);
  expect(appendSample(points, { ...end }, true)).toBe(true);
  expect(points).toHaveLength(2);
  const full = Array.from({ length: MAX_VECTOR_POINTS }, (_, x) => ({ x, y: 0 }));
  expect(appendSample(full, { x: MAX_VECTOR_POINTS - 1 + 0.0625, y: 0 }, true)).toBe(false);
  expect(full.at(-1)).toEqual({ x: MAX_VECTOR_POINTS - 1, y: 0 });
});

it('retains long freehand contact samples beyond the former stage cutoff', () => {
  const points: Vector['points'] = [];
  for (let i = 0; i < 21000; i++) {
    const sample = {
      x: i / 100,
      y: i % 2,
      pressure: (i % 101) / 100,
      tiltX: i % 80,
      tiltY: -(i % 80),
      twist: i % 360,
    };
    expect(appendSample(points, sample)).toBe(true);
    expect(points.at(-1)).toEqual(sample);
  }
  expect(points).toHaveLength(21000);
});

it('hit testing follows nonzero winding instead of parity in compound paint', () => {
  const square = (a: number, b: number) => [
    { x: a, y: a },
    { x: b, y: a },
    { x: b, y: b },
    { x: a, y: b },
  ];
  for (const fillRule of [undefined, 'nonzero', 'evenodd'] as const) {
    const s: Vector = {
      ...shape('polygon'),
      x: 0,
      y: 0,
      strokeWidth: 0,
      fillRule,
      contours: [square(0, 40), square(5, 35)],
    };
    const before = structuredClone(s);
    expect(hitPart(s, { x: 20, y: 20 }, 0)).toBe(fillRule === 'evenodd' ? null : 'fill');
    expect(s).toEqual(before);
    s.contours![1].reverse();
    expect(hitPart(s, { x: 20, y: 20 }, 0)).toBe(null);
    s.transform = [-1, 0, 0, 1];
    expect(hitPart(s, { x: -20, y: 20 }, 0)).toBe(null);
    expect(hitPart(s, { x: -2, y: 2 }, 0)).toBe('fill');
  }
});
it('hit testing accumulates repeated winding within a single closed path', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
    { x: 0, y: 40 },
    { x: 0, y: 0 },
  ];
  const s: Vector = {
    ...shape(),
    x: 0,
    y: 0,
    strokeWidth: 0,
    closed: true,
    points: [...points, ...points],
  };
  expect(hitPart(s, { x: 20, y: 20 }, 0)).toBe('fill');
  s.fillRule = 'evenodd';
  expect(hitPart(s, { x: 20, y: 20 }, 0)).toBe(null);
});
