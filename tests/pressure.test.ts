import { stabilizeSample, appendSample } from '../packages/interaction/src';
import { brushDabs } from '../packages/geometry/src/drawing';
import { describe, it, expect } from 'vitest';
import { id, clone, newProject, validateProject, type Vector } from '../packages/document/src';
import {
  applyPressureProfile,
  editPressureSample,
  pressureHandle,
  dragPressure,
  reversePressure,
  pressureResponse,
  brushNib,
  interpolateTwist,
  smoothBrushSamples,
} from '../packages/geometry/src/pressure';
const stroke = (): Vector => ({
  id: id(),
  kind: 'brush',
  x: 10,
  y: 20,
  width: 100,
  height: 0,
  rotation: 15,
  transform: [2, 0, 0.2, 1],
  fill: '#000000',
  stroke: '#000000',
  strokeWidth: 40,
  points: [
    { x: 0, y: 0, pressure: 1, tiltX: 12 },
    { x: 10, y: 0, pressure: 1 },
    { x: 50, y: 0, pressure: 1 },
    { x: 100, y: 0, pressure: 1 },
  ],
  brush: { pressure: false, minimum: 0.2, tilt: true, aspect: 0.5, angle: 30 },
});
describe('editable pressure profiles', () => {
  it('interpolates by distance rather than sample count and retains the source/nib/transform', () => {
    const s = stroke(),
      before = clone(s),
      out = applyPressureProfile(s, 0, 1, 0);
    expect(out.points.map((p) => p.pressure)).toEqual([0, 0.2, 1, 0]);
    expect(s).toEqual(before);
    expect(out.transform).toEqual(s.transform);
    expect(out.points[0].tiltX).toBe(12);
    expect(out.brush).toEqual({ ...s.brush, pressure: true });
  });
  it('edits only the requested sample, clamps values, and rejects invalid input', () => {
    const s = stroke(),
      out = editPressureSample(s, 1, 0.4);
    expect(out.points[1].pressure).toBe(0.4);
    expect(out.points[0]).toEqual(s.points[0]);
    expect(editPressureSample(s, 1, 2).points[1].pressure).toBe(1);
    expect(() => editPressureSample(s, 100, 1)).toThrow();
    expect(() => applyPressureProfile(s, NaN, 1, 0)).toThrow();
  });
  it('handles stationary dots without division by zero', () => {
    const s = stroke();
    s.points = [{ x: 0, y: 0 }];
    expect(applyPressureProfile(s, 0.3, 1, 0).points[0].pressure).toBe(0.3);
  });
});

it('edits sample width in nib coordinates and clamps without changing geometry', () => {
  const s = stroke(),
    h = pressureHandle(s, 0),
    p = s.points[0],
    radius = (s.strokeWidth / 2) * (0.2 + 0.8 * 0.25);
  const out = dragPressure(s, 0, {
    x: p.x + Math.cos(h.angle) * radius,
    y: p.y + Math.sin(h.angle) * radius,
  });
  expect(out.points[0].pressure).toBeCloseTo(0.25);
  expect(out.brush!.pressure).toBe(true);
  expect(out.points.slice(1)).toEqual(s.points.slice(1));
  expect(out.points[0].tiltX).toBe(s.points[0].tiltX);
  expect(dragPressure(s, 0, p).points[0].pressure).toBe(0);
  expect(s.points[0].pressure).toBe(1);
});
it('reverses pressure by distance and preserves sample positions', () => {
  const s = applyPressureProfile(stroke(), 0, 0.5, 1),
    out = reversePressure(s);
  expect(out.points.map((p) => p.pressure)).toEqual([1, 0.9, 0.5, 0]);
  expect(out.points.map((p) => [p.x, p.y])).toEqual(s.points.map((p) => [p.x, p.y]));
  reversePressure(out).points.forEach((p, i) =>
    expect(p.pressure).toBeCloseTo(s.points[i].pressure!, 12),
  );
});

it('response curves preserve raw samples and invert through width handles', () => {
  const s = applyPressureProfile(stroke(), 0.5, 0.5, 0.5);
  s.brush!.response = 2;
  const before = clone(s),
    h = pressureHandle(s, 1),
    dab = brushDabs(s)[0];
  expect(dab.rx).toBeCloseTo((s.strokeWidth / 2) * (0.2 + 0.8 * 0.25));
  expect(dragPressure(s, 1, h).points[1].pressure).toBeCloseTo(0.5);
  expect(s).toEqual(before);
  expect(pressureResponse(0.5, 0.5)).toBeCloseTo(Math.sqrt(0.5));
  expect(pressureResponse(0, 4)).toBe(0);
  expect(pressureResponse(1, 0.25)).toBe(1);
  expect(() => pressureResponse(0.5, 0)).toThrow();
  const project = newProject();
  project.layers[0].keys[0].shapes = [s];
  expect(() => validateProject(project)).not.toThrow();
  s.brush!.response = 5;
  expect(() => validateProject(project)).toThrow();
});

it('twist rotates nibs and width handles, interpolating across zero by the shortest arc', () => {
  const s = stroke();
  s.brush!.twist = true;
  s.points[0].twist = 90;
  const n = brushNib(s, s.points[0]),
    h = pressureHandle(s, 0);
  expect(h.angle).toBeCloseTo(n.angle);
  expect(n.angle).toBeCloseTo(Math.PI / 6 + Math.PI / 2);
  expect(interpolateTwist(350, 10, 0.5)).toBe(0);
  expect(interpolateTwist(10, 350, 0.5)).toBe(0);
  s.points = [
    { x: 0, y: 0, twist: 350 },
    { x: 100, y: 0, twist: 10 },
  ];
  const dabs = brushDabs(s);
  expect(dabs.length).toBeGreaterThan(2);
  expect(
    dabs.every((d) => {
      const degree = ((d.angle - Math.PI / 6) * 180) / Math.PI;
      return degree < 10.001 || degree > 349.999;
    }),
  ).toBe(true);
  const project = newProject();
  project.layers[0].keys[0].shapes = [s];
  expect(() => validateProject(project)).not.toThrow();
  (s.brush as unknown as { twist: string }).twist = 'yes';
  expect(() => validateProject(project)).toThrow();
});

it('stabilizes positions while preserving current pen metadata, including stationary twist', () => {
  const previous = { x: 0, y: 0, pressure: 0.3, twist: 10 },
    sample = { x: 30, y: 40, pressure: 0.8, tiltX: 25, twist: 90 };
  expect(stabilizeSample(previous, sample, 10)).toEqual({ ...sample, x: 24, y: 32 });
  expect(stabilizeSample(previous, { ...sample, x: 3, y: 4 }, 10)).toEqual({
    ...sample,
    x: 0,
    y: 0,
  });
  expect(stabilizeSample(previous, sample, 0)).toEqual(sample);
  expect(() => stabilizeSample(previous, sample, -1)).toThrow();
  const points = [previous];
  appendSample(points, { ...previous, twist: 90 });
  expect(points).toHaveLength(2);
});
it('smooths brush coordinates without moving endpoints or altering pen metadata', () => {
  const points = [
    { x: 0, y: 0, pressure: 0.1, twist: 350 },
    { x: 10, y: 20, pressure: 0.8, tiltX: 30, twist: 10 },
    { x: 20, y: 0, pressure: 0.2 },
  ];
  const out = smoothBrushSamples(points, 1);
  expect(out[0]).toEqual(points[0]);
  expect(out[2]).toEqual(points[2]);
  expect(out[1]).toEqual({ ...points[1], y: 10 });
  expect(points[1].y).toBe(20);
  expect(smoothBrushSamples(points, 0)).toEqual(points);
  expect(() => smoothBrushSamples(points, 11)).toThrow();
});

it('keeps stationary pressure and orientation runs in place while smoothing moving neighbors', () => {
  const points = [
    { x: 0, y: 0, pressure: 0.2, twist: 0 },
    { x: 10, y: 20, pressure: 0.3, twist: 0 },
    { x: 20, y: 0, pressure: 0.4, twist: 10 },
    { x: 20, y: 0, pressure: 0.8, tiltX: 30, twist: 90 },
    { x: 20, y: 0, pressure: 0.5, tiltY: 20, twist: 180 },
    { x: 30, y: 20, pressure: 0.3, twist: 180 },
    { x: 40, y: 0, pressure: 0.2, twist: 180 },
  ];
  const before = JSON.stringify(points);
  for (const amount of [0, 0.5, 1]) {
    const result = smoothBrushSamples(points, amount);
    expect(result.slice(2, 5)).toEqual(points.slice(2, 5));
    expect(result[1].y).toBe(20 - 10 * amount);
    expect(result[5].y).toBe(20 - 10 * amount);
    expect(result.map(({ x: _x, y: _y, ...rest }) => rest)).toEqual(
      points.map(({ x: _x, y: _y, ...rest }) => rest),
    );
    result.forEach((p, i) => expect(p).not.toBe(points[i]));
  }
  expect(JSON.stringify(points)).toBe(before);
  for (const sample of [points.slice(2, 5), [], points.slice(0, 1)])
    expect(smoothBrushSamples(sample, 1)).toEqual(sample);
});

it('smoothing preserves uneven straight sample positions and pressure landmarks', () => {
  for (const offset of [0, 1e9]) {
    const points = [0, 1, 9, 10, 80, 100].map((x, i) => ({
      x: offset + x,
      y: offset + x * 2,
      pressure: i % 2 ? 0.9 : 0.2,
      tiltX: i * 5,
      twist: i * 30,
    }));
    const before = JSON.stringify(points);
    for (const amount of [0, 0.5, 1]) {
      const result = smoothBrushSamples(points, amount);
      result.forEach((p, i) => {
        expect(p.x).toBeCloseTo(points[i].x, 7);
        expect(p.y).toBeCloseTo(points[i].y, 7);
        expect(p.pressure).toBe(points[i].pressure);
        expect(p.tiltX).toBe(points[i].tiltX);
        expect(p.twist).toBe(points[i].twist);
      });
    }
    expect(JSON.stringify(points)).toBe(before);
  }
  // An uneven corner still moves toward its chord, without crossing it.
  const corner = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 30 },
  ];
  expect(smoothBrushSamples(corner, 1)[1]).toEqual({ x: 6.25, y: 3.75 });
});


it('supports ten smoothing passes without moving endpoints or pen metadata',()=>{
 const points=Array.from({length:81},(_,i)=>({x:i*3,y:Math.sin(i/6)*20+(i%2?4:-4),pressure:i/80,tiltX:i}));
 const before=structuredClone(points),low=smoothBrushSamples(points,1),high=smoothBrushSamples(points,10);
 const rough=(p:{x:number;y:number}[])=>p.slice(1,-1).reduce((sum,q,i)=>sum+Math.abs(p[i].y-2*q.y+p[i+2].y),0);
 expect(rough(high)).toBeLessThan(rough(low));expect(high[0]).toEqual(points[0]);expect(high.at(-1)).toEqual(points.at(-1));expect(high.map(p=>[p.pressure,p.tiltX])).toEqual(points.map(p=>[p.pressure,p.tiltX]));expect(points).toEqual(before);
});
