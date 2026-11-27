import { expect, it } from 'vitest';
import { createMotionPathSampler, type MotionPath } from '../packages/animation/src/motion-path';

// Independent fixed-panel Simpson integration of the analytic speed; no
// subdivision, chord-length table or production position evaluator is reused.
const curves = [
  { name: 'asymmetric loop', a: [160, -240], b: [-90, 130], end: [0, 0] },
  { name: 'near reversing line', a: [120, 0], b: [-100, 0.02], end: [15, 0] },
  { name: 'stationary start', a: [0, 0], b: [15, 190], end: [210, 30] },
  { name: 'stationary end', a: [-180, 90], b: [120, 40], end: [120, 40] },
  { name: 'tight S bend', a: [280, 10], b: [-260, 90], end: [20, 100] },
];
it.each(curves)(
  'matches speed quadrature for $name across scales, reflections and translations',
  (curve) => {
    const panels = 32768;
    const velocity = (t: number) =>
      curve.end.map(
        (end, axis) =>
          3 *
          ((1 - t) ** 2 * curve.a[axis] +
            2 * (1 - t) * t * (curve.b[axis] - curve.a[axis]) +
            t * t * (end - curve.b[axis])),
      );
    const speed = (t: number) => Math.hypot(...velocity(t));
    const lengths = [0];
    for (let i = 0; i < panels; i++)
      lengths.push(
        lengths[i] +
          (speed(i / panels) + 4 * speed((i + 0.5) / panels) + speed((i + 1) / panels)) /
            (6 * panels),
      );
    const reference = (fraction: number) => {
      const wanted = fraction * lengths[panels];
      let lo = 0,
        hi = panels;
      while (hi - lo > 1) {
        const mid = (lo + hi) >>> 1;
        if (lengths[mid] < wanted) lo = mid;
        else hi = mid;
      }
      const t = (lo + (wanted - lengths[lo]) / (lengths[hi] - lengths[lo])) / panels;
      return curve.end.map(
        (end, axis) =>
          3 * (1 - t) ** 2 * t * curve.a[axis] + 3 * (1 - t) * t * t * curve.b[axis] + t ** 3 * end,
      );
    };
    for (const scale of [0.01, 1, 100])
      for (const origin of [0, -99900, 99900]) {
        const reflect = origin < 0 ? -1 : 1;
        const from = { x: origin, y: 0 - origin };
        const to = {
          x: origin + reflect * scale * curve.end[0],
          y: 0 - origin + scale * curve.end[1],
        };
        const path = {
          startX: reflect * scale * curve.a[0],
          startY: scale * curve.a[1],
          endX: reflect * scale * (curve.b[0] - curve.end[0]),
          endY: scale * (curve.b[1] - curve.end[1]),
          distance: true,
        };
        const before = structuredClone({ from, to, path });
        const sample = createMotionPathSampler(from, to, path);
        expect(sample(0)).toEqual(from);
        expect(sample(1)).toEqual(to);
        for (const fraction of [0.001, 0.01, 0.07, 0.25, 0.5, 0.73, 0.95, 0.99, 0.999]) {
          const expected = reference(fraction),
            actual = sample(fraction);
          const error = Math.hypot(
            actual.x - (origin + reflect * scale * expected[0]),
            actual.y - (0 - origin + scale * expected[1]),
          );
          expect(error).toBeLessThan(0.003 + scale * lengths[panels] * 3e-7);
        }
        expect({ from, to, path }).toEqual(before);
      }
  },
);

it('rejects interior stationary tangents between generated samples in either travel mode', () => {
  for (const distance of [false, true])
    for (const scale of [0.01, 1, 100])
      for (const origin of [0, -99900, 99900]) {
        const point = { x: origin, y: origin };
        expect(() =>
          createMotionPathSampler(point, point, {
            startX: 10 * scale,
            startY: 0,
            endX: -10 * scale,
            endY: 0,
            distance,
            tangent: true,
          }),
        ).toThrow(/tangent/);
        expect(() =>
          createMotionPathSampler(point, point, {
            startX: 10 * scale,
            startY: 0,
            endX: -10 * scale,
            endY: 0,
            distance,
          }),
        ).not.toThrow();
      }
});

it('allows stationary endpoints and near-reversing paths whose interior velocity stays nonzero', () => {
  for (const path of [
    { startX: 0, startY: 0, endX: -10, endY: 0 },
    { startX: 10, startY: 0, endX: 0, endY: 0 },
    { startX: 120, startY: 0, endX: -115, endY: -0.02 },
  ]) {
    const sample = createMotionPathSampler(
      { x: 0, y: 0 },
      { x: 15, y: 0.02 },
      { ...path, tangent: true },
    );
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9])
      expect(Number.isFinite(sample(t).tangentAngle)).toBe(true);
  }
});
it('detects stationary velocity after rotation and reflection without rejecting ordinary curved paths', () => {
  for (const sign of [-1, 1]) {
    expect(() =>
      createMotionPathSampler(
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { startX: 10, startY: sign * 20, endX: -10, endY: -sign * 20, tangent: true },
      ),
    ).toThrow(/tangent/);
    expect(() =>
      createMotionPathSampler(
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { startX: 10, startY: sign * 20, endX: -10, endY: sign * 20, tangent: true },
      ),
    ).not.toThrow();
  }
});

it('rejects a repeated interior velocity root even without a direction reversal', () => {
  // Velocity / 3 is (t - .3)^2; the stationary point misses quarter-frame samples.
  expect(() =>
    createMotionPathSampler(
      { x: 0, y: 0 },
      { x: 0.37, y: 0 },
      { startX: 0.09, startY: 0, endX: -0.49, endY: 0, tangent: true },
    ),
  ).toThrow(/tangent/);
});
it('retains monotone stationary endpoint paths despite quadratic root rounding', () => {
  for (const distance of [false, true])
    for (const reverse of [false, true]) {
      const from = { x: reverse ? 1 : 0, y: 0 };
      const to = { x: reverse ? 0 : 1, y: 0 };
      const path = {
        startX: reverse ? 0 : 0.05,
        startY: 0,
        endX: reverse ? 0.05 : 0,
        endY: 0,
        tangent: true,
        distance,
      };
      const sample = createMotionPathSampler(from, to, path);
      for (const t of [0.01, 0.25, 0.5, 0.75, 0.99]) {
        expect(sample(t).tangentAngle).toBe(reverse ? 180 : 0);
        expect(sample(t).x).toBeGreaterThan(0);
        expect(sample(t).x).toBeLessThan(1);
      }
    }
});
it('retains interior stationary rejection after factoring stationary endpoints', () => {
  for (const start of [false, true])
    expect(() =>
      createMotionPathSampler(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { startX: start ? 0 : 2, startY: 0, endX: start ? -2 : 0, endY: 0, tangent: true },
      ),
    ).toThrow(/tangent/);
  const sample = createMotionPathSampler(
    { x: 0, y: 0 },
    { x: 1, y: 2 },
    { startX: 0, startY: 0, endX: 0, endY: 0, tangent: true },
  );
  expect(sample(0.5).tangentAngle).toBeCloseTo((Math.atan2(2, 1) * 180) / Math.PI);
});
it('unwraps a returning path heading continuously and independently of query order', () => {
  for (const distance of [false, true])
    for (const sign of [-1, 1]) {
      const sample = createMotionPathSampler(
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        {
          startX: -1,
          startY: sign,
          endX: -1,
          endY: -sign,
          tangent: true,
          distance,
        },
      );
      expect(sample(0.5).tangentAngle).toBeCloseTo(sign * 270);
      const values = Array.from({ length: 101 }, (_, i) => sample(i / 100).tangentAngle!);
      expect(values[0]).toBeCloseTo(sign * 135);
      expect(values[100]).toBeCloseTo(sign * 405);
      for (let i = 1; i < values.length; i++) {
        expect(sign * (values[i] - values[i - 1])).toBeGreaterThan(0);
        expect(Math.abs(values[i] - values[i - 1])).toBeLessThan(10);
      }
      for (const i of [99, 1, 70, 30, 50]) expect(sample(i / 100).tangentAngle).toBe(values[i]);
    }
});
it('matches independently accumulated analytic headings across scales and translations', () => {
  for (const scale of [0.01, 1, 100])
    for (const origin of [0, -99900, 99900]) {
      const from = { x: origin, y: -origin },
        to = { x: origin, y: -origin };
      const path = {
        startX: -80 * scale,
        startY: 80 * scale,
        endX: -80 * scale,
        endY: -80 * scale,
        tangent: true,
      };
      const before = structuredClone({ from, to, path });
      const sample = createMotionPathSampler(from, to, path);
      let previous = 135,
        accumulated = 135;
      for (let i = 1; i <= 1000; i++) {
        const t = i / 1000,
          u = 1 - t;
        // Independent analytic derivative of the authored returning cubic.
        const angle = (Math.atan2(u * u - 4 * u * t + t * t, -u * u + t * t) * 180) / Math.PI;
        let delta = angle - previous;
        if (delta < -180) delta += 360;
        if (delta > 180) delta -= 360;
        accumulated += delta;
        previous = angle;
        expect(sample(t).tangentAngle).toBeCloseTo(accumulated, 6);
      }
      expect({ from, to, path }).toEqual(before);
    }
});
it.each([
  {
    name: 'asymmetric winding',
    edges: [
      [1, 0.05],
      [-3, 0.3],
      [1, -0.1],
    ],
  },
  {
    name: 'repeated branch crossings',
    edges: [
      [-1, 0.1],
      [-2, -0.4],
      [-1, 0.1],
    ],
  },
])('qualifies $name against dense independent velocity headings', ({ edges }) => {
  for (const rotation of [0, Math.PI / 2, Math.PI - 0.02])
    for (const reflect of [-1, 1]) {
      const vectors = edges.map(([x, y]) => ({
        x: x * Math.cos(rotation) - reflect * y * Math.sin(rotation),
        y: x * Math.sin(rotation) + reflect * y * Math.cos(rotation),
      }));
      const [a, b, c] = vectors;
      const sample = createMotionPathSampler(
        { x: 0, y: 0 },
        { x: a.x + b.x + c.x, y: a.y + b.y + c.y },
        { startX: a.x, startY: a.y, endX: -c.x, endY: -c.y, tangent: true },
      );
      const principal = (t: number) => {
        const weights = [(1 - t) ** 2, 2 * t * (1 - t), t ** 2];
        const x = vectors.reduce((sum, v, i) => sum + weights[i] * v.x, 0);
        const y = vectors.reduce((sum, v, i) => sum + weights[i] * v.y, 0);
        return (Math.atan2(y, x) * 180) / Math.PI;
      };
      let previous = principal(0),
        expected = previous;
      const references = [expected];
      for (let i = 1; i <= 32768; i++) {
        const angle = principal(i / 32768);
        const raw = angle - previous;
        const delta = raw - 360 * Math.round(raw / 360);
        // Ensure the independent sampling itself does not skip a large turn.
        expect(Math.abs(delta)).toBeLessThan(5);
        expected += delta;
        previous = angle;
        references.push(expected);
        expect(sample(i / 32768).tangentAngle).toBeCloseTo(expected, 7);
      }
      for (const i of [32767, 3, 16384, 8191, 24577])
        expect(sample(i / 32768).tangentAngle).toBeCloseTo(references[i], 7);
    }
});

it('samples waypoint segments with equal time or independent polyline distance', () => {
  const path = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    waypoints: [
      { x: 30, y: 0 },
      { x: 30, y: 40 },
    ],
  };
  const from = { x: 100, y: -50 },
    to = { x: 160, y: -10 };
  const timed = createMotionPathSampler(from, to, path),
    distance = createMotionPathSampler(from, to, { ...path, distance: true });
  expect(timed(1 / 3)).toEqual({ x: 130, y: -50 });
  expect(timed(2 / 3)).toEqual({ x: 130, y: -10 });
  // The three lengths are 30,40,30: quarter distances are 25,50,75.
  expect(distance(0.25)).toEqual({ x: 125, y: -50 });
  expect(distance(0.5)).toEqual({ x: 130, y: -30 });
  expect(distance(0.75)).toEqual({ x: 135, y: -10 });
  path.waypoints[0].x = 999;
  from.x = 999;
  to.x = 999;
  expect(distance(0.25)).toEqual({ x: 125, y: -50 });
  expect(distance(0)).toEqual({ x: 100, y: -50 });
  expect(distance(1)).toEqual({ x: 160, y: -10 });
});
it('handles repeated waypoint holds and rejects invalid or tangent waypoint paths', () => {
  const base = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    waypoints: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
  };
  const from = { x: 0, y: 0 },
    to = { x: 10, y: 0 };
  expect(createMotionPathSampler(from, to, base)(0.25)).toEqual(from);
  expect(createMotionPathSampler(from, to, { ...base, distance: true })(0.25)).toEqual({
    x: 2.5,
    y: 0,
  });
  expect(
    createMotionPathSampler(from, from, { ...base, waypoints: [{ x: 0, y: 0 }], distance: true })(
      0.5,
    ),
  ).toEqual(from);
  for (const waypoints of [[], [{ x: NaN, y: 0 }], [{ x: 0, y: Infinity }]])
    expect(() => createMotionPathSampler(from, to, { ...base, waypoints })).toThrow(/Waypoint/);
  expect(() => createMotionPathSampler(from, to, { ...base, tangent: true })).toThrow(
    /tangent/,
  );
  expect(() =>
    createMotionPathSampler({ x: Number.MAX_VALUE, y: 0 }, to, {
      ...base,
      waypoints: [{ x: Number.MAX_VALUE, y: 0 }],
    }),
  ).toThrow(/numeric/);
});

it('rejects unresolved positive waypoint distance intervals instead of silently skipping them', () => {
  const from = { x: 0, y: 0 },
    to = { x: 2, y: 1e-20 };
  const path = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    waypoints: [
      { x: 1, y: 0 },
      { x: 1, y: 1e-20 },
    ],
    distance: true,
  };
  expect(() => createMotionPathSampler(from, to, path)).toThrow(/unresolved/);
  expect(createMotionPathSampler(from, to, { ...path, distance: false })(0.5)).toEqual({
    x: 1,
    y: 5e-21,
  });
});
it('keeps compiled waypoint timing independent of later settings changes', () => {
  const path = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    waypoints: [
      { x: 30, y: 0 },
      { x: 30, y: 40 },
    ],
    distance: true,
  };
  const sampler = createMotionPathSampler({ x: 0, y: 0 }, { x: 60, y: 40 }, path);
  expect(sampler(0.25)).toEqual({ x: 25, y: 0 });
  path.distance = false;
  expect(sampler(0.25)).toEqual({ x: 25, y: 0 });
});

it('detaches compiled cubic geometry and tangent settings from later caller mutations', () => {
  for (const distance of [false, true])
    for (const tangent of [false, true])
      for (const mutation of ['from', 'to', 'controls', 'tangent', 'waypoints'] as const) {
        const from = { x: 10, y: 20 },
          to = { x: 110, y: 20 };
        const path: MotionPath = { startX: 0, startY: 60, endX: 0, endY: 60, distance, tangent };
        const sample = createMotionPathSampler(from, to, path);
        const progress = [0, 0.25, 0.5, 0.75, 1];
        const expected = progress.map(sample);
        // Symmetric cubic has its arc-length and parameter midpoint at (60,65).
        expect(expected[2].x).toBeCloseTo(60, 8);
        expect(expected[2].y).toBeCloseTo(65, 8);
        if (tangent) expect(expected[2].tangentAngle).toBeCloseTo(0, 8);
        if (mutation === 'from') from.x = -500;
        if (mutation === 'to') to.y = 900;
        if (mutation === 'controls') {
          path.startX = 400;
          path.endY = -300;
        }
        if (mutation === 'tangent') path.tangent = !tangent;
        if (mutation === 'waypoints') path.waypoints = [{ x: 30, y: 40 }];
        expect(progress.map(sample), `${distance}/${tangent}/${mutation}`).toEqual(expected);
        // Returned samples are detached too.
        expected[0].x = 999;
        expect(sample(0).x).toBe(10);
      }
});

it('passes through curved waypoints with independently calculated Catmull-Rom interiors and matching derivatives', () => {
  const from = { x: 100, y: 100 },
    to = { x: 200, y: 100 };
  const path: MotionPath = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    curvedWaypoints: true,
    waypoints: [
      { x: 30, y: 0 },
      { x: 30, y: 40 },
    ],
  };
  const sample = createMotionPathSampler(from, to, path);
  const points = [from, { x: 130, y: 100 }, { x: 130, y: 140 }, to];
  const reference = (t: number) => {
    const index = Math.min(2, Math.floor(t * 3)),
      u = t === 1 ? 1 : t * 3 - index;
    const a = points[Math.max(0, index - 1)],
      b = points[index],
      c = points[index + 1],
      d = points[Math.min(3, index + 2)];
    const axis = (k: 'x' | 'y') =>
      0.5 *
      (2 * b[k] +
        (-a[k] + c[k]) * u +
        (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * u * u +
        (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * u * u * u);
    return { x: axis('x'), y: axis('y') };
  };
  for (let i = 0; i <= 120; i++) {
    const actual = sample(i / 120),
      expected = reference(i / 120);
    expect(actual.x).toBeCloseTo(expected.x, 10);
    expect(actual.y).toBeCloseTo(expected.y, 10);
  }
  expect(sample(1 / 3)).toEqual(points[1]);
  expect(sample(2 / 3)).toEqual(points[2]);
  for (const t of [1 / 3, 2 / 3]) {
    const h = 1e-6,
      a = sample(t - h),
      b = sample(t),
      c = sample(t + h);
    expect((b.x - a.x) / h).toBeCloseTo((c.x - b.x) / h, 2);
    expect((b.y - a.y) / h).toBeCloseTo((c.y - b.y) / h, 2);
  }
  const expected = sample(0.5);
  from.x = 999;
  to.y = 999;
  path.waypoints = [{ x: 999, y: 999 }];
  path.curvedWaypoints = false;
  expect(sample(0.5)).toEqual(expected);
});

it('rejects unsupported curved waypoint modes and invalid generated controls', () => {
  const path: MotionPath = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    curvedWaypoints: true,
    waypoints: [{ x: 10, y: 20 }],
  };
  const from = { x: 0, y: 0 },
    to = { x: 30, y: 40 };
  expect(createMotionPathSampler(from, to, { ...path, distance: true })(0.5).x).toBeTypeOf(
    'number',
  );
  expect(
    createMotionPathSampler(from, to, { ...path, tangent: true })(0.5).tangentAngle,
  ).toBeTypeOf('number');
  expect(() => createMotionPathSampler(from, to, { ...path, waypoints: undefined })).toThrow(
    /requires waypoints/,
  );
  expect(() =>
    createMotionPathSampler(
      { x: -1e308, y: 0 },
      { x: 1e308, y: 0 },
      { ...path, waypoints: [{ x: 1e308, y: 0 }] },
    ),
  ).toThrow(/numeric/);
  const sample = createMotionPathSampler(from, to, path);
  for (const t of [-0.01, 1.01, NaN, Infinity]) expect(() => sample(t)).toThrow(/progress/);
});

it('unwraps curved waypoint headings across joins against independent polynomial velocities', () => {
  // More than a full revolution with branch-cut crossings at segment joins.
  const points = Array.from({ length: 17 }, (_, i) => ({
    x: 100 * Math.cos((i * Math.PI) / 4),
    y: 100 * Math.sin((i * Math.PI) / 4),
  }));
  const from = points[0],
    to = points[16];
  const path: MotionPath = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    curvedWaypoints: true,
    tangent: true,
    waypoints: points.slice(1, -1).map((p) => ({ x: p.x - from.x, y: p.y - from.y })),
  };
  const sample = createMotionPathSampler(from, to, path);
  let previous = 0;
  const expected: number[] = [];
  for (let step = 0; step <= 1600; step++) {
    const t = step / 1600,
      i = Math.min(15, Math.floor(t * 16)),
      u = t === 1 ? 1 : t * 16 - i;
    const a = points[Math.max(0, i - 1)],
      b = points[i],
      c = points[i + 1],
      d = points[Math.min(16, i + 2)];
    const velocity = (k: 'x' | 'y') =>
      0.5 *
      (-a[k] +
        c[k] +
        2 * (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * u +
        3 * (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * u * u);
    const raw = (Math.atan2(velocity('y'), velocity('x')) * 180) / Math.PI;
    const heading = step === 0 ? raw : raw + 360 * Math.round((previous - raw) / 360);
    previous = heading;
    expected.push(heading);
    expect(sample(t).tangentAngle).toBeCloseTo(heading, 7);
  }
  expect(expected[1600] - expected[0]).toBeGreaterThan(600);
  for (const step of [1500, 200, 800, 0, 1600, 100])
    expect(sample(step / 1600).tangentAngle).toBeCloseTo(expected[step], 7);
  path.tangent = false;
  path.waypoints = [];
  expect(sample(0.5).tangentAngle).toBeCloseTo(expected[800], 7);
});

it('rejects stationary curved waypoint joins and endpoints before sampling', () => {
  const from = { x: 0, y: 0 };
  const base: MotionPath = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    curvedWaypoints: true,
    tangent: true,
  };
  for (const [waypoints, to] of [
    [[{ x: 10, y: 0 }], { x: 0, y: 0 }],
    [[{ x: 0, y: 0 }], { x: 20, y: 10 }],
    [[{ x: 20, y: 10 }], { x: 20, y: 10 }],
  ] as const) {
    expect(() => createMotionPathSampler(from, to, { ...base, waypoints })).toThrow(/tangent/);
    expect(
      createMotionPathSampler(from, to, { ...base, waypoints, tangent: false })(0.5).x,
    ).toBeTypeOf('number');
  }
});

it('maps whole curved waypoint distance against independent dense polynomial chords', () => {
  for (const tangent of [false, true]) {
    const points = [
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 60 },
      { x: 110, y: 20 },
    ];
    const path: MotionPath = {
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      curvedWaypoints: true,
      distance: true,
      tangent,
      waypoints: points.slice(1, -1).map((p) => ({ x: p.x - 10, y: p.y - 20 })),
    };
    const sample = createMotionPathSampler(points[0], points[3], path);
    const polynomial = (t: number) => {
      const i = Math.min(2, Math.floor(t * 3)),
        u = t === 1 ? 1 : t * 3 - i;
      const a = points[Math.max(0, i - 1)],
        b = points[i],
        c = points[i + 1],
        d = points[Math.min(3, i + 2)];
      const axis = (k: 'x' | 'y') =>
        0.5 *
        (2 * b[k] +
          (-a[k] + c[k]) * u +
          (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * u * u +
          (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * u * u * u);
      const v = (k: 'x' | 'y') =>
        0.5 *
        (-a[k] +
          c[k] +
          2 * (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * u +
          3 * (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * u * u);
      return { x: axis('x'), y: axis('y'), angle: (Math.atan2(v('y'), v('x')) * 180) / Math.PI };
    };
    const count = 30000,
      cumulative = [0];
    let previous = polynomial(0);
    for (let i = 1; i <= count; i++) {
      const p = polynomial(i / count);
      cumulative.push(cumulative[i - 1] + Math.hypot(p.x - previous.x, p.y - previous.y));
      previous = p;
    }
    for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const target = fraction * cumulative[count];
      let i = 1;
      while (cumulative[i] < target) i++;
      const t =
        (i - 1 + (target - cumulative[i - 1]) / (cumulative[i] - cumulative[i - 1])) / count;
      const expected = polynomial(t),
        actual = sample(fraction);
      expect(Math.hypot(actual.x - expected.x, actual.y - expected.y)).toBeLessThan(0.003);
      if (tangent) expect(Math.abs(actual.tangentAngle! - expected.angle)).toBeLessThan(0.02);
    }
    const expected = sample(0.25);
    path.distance = false;
    path.waypoints = [];
    expect(sample(0.25)).toEqual(expected);
    expect(sample(0).x).toBe(10);
    expect(sample(1).x).toBe(110);
  }
});

it('handles stationary curved distance paths and rejects unresolved positive distance intervals', () => {
  const base: MotionPath = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    curvedWaypoints: true,
    distance: true,
    waypoints: [{ x: 0, y: 0 }],
  };
  expect(createMotionPathSampler({ x: 3, y: 4 }, { x: 3, y: 4 }, base)(0.5)).toEqual({
    x: 3,
    y: 4,
  });
  expect(() =>
    createMotionPathSampler(
      { x: 0, y: 0 },
      { x: 1, y: 1e-20 },
      {
        ...base,
        waypoints: [
          { x: 1, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1e-20 },
        ],
      },
    ),
  ).toThrow(/unresolved/);
});

it('samples custom linked waypoint handles with exact joins, distance timing and detached settings', () => {
  const handles = [
    { x: 10, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 0 },
  ];
  const path: MotionPath = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    waypoints: [{ x: 30, y: 0 }],
    curvedWaypoints: true,
    waypointTangents: handles,
    tangent: true,
  };
  for (const distance of [false, true]) {
    const sample = createMotionPathSampler({ x: 0, y: 0 }, { x: 60, y: 0 }, { ...path, distance });
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(sample(t).x).toBeCloseTo(60 * t, 8);
      expect(sample(t).y).toBe(0);
      expect(sample(t).tangentAngle).toBe(0);
    }
  }
  const curved = {
    ...path,
    waypointTangents: [
      { x: 10, y: 20 },
      { x: 10, y: 0 },
      { x: 10, y: -20 },
    ],
    tangent: false,
  };
  const sample = createMotionPathSampler({ x: 0, y: 0 }, { x: 60, y: 0 }, curved);
  // First cubic at u=.5: (0,0),(10,20),(20,0),(30,0).
  expect(sample(0.25)).toEqual({ x: 15, y: 7.5 });
  expect(sample(0.75)).toEqual({ x: 45, y: 7.5 });
  curved.waypointTangents[0].y = 999;
  expect(sample(0.25)).toEqual({ x: 15, y: 7.5 });
  for (const waypointTangents of [[], [{ x: NaN, y: 0 }], handles.slice(1)])
    expect(() =>
      createMotionPathSampler({ x: 0, y: 0 }, { x: 60, y: 0 }, { ...path, waypointTangents }),
    ).toThrow(/handles/);
  expect(() =>
    createMotionPathSampler({ x: 0, y: 0 }, { x: 60, y: 0 }, { ...path, curvedWaypoints: false }),
  ).toThrow(/handles/);
  expect(() =>
    createMotionPathSampler(
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { ...path, waypointTangents: [handles[0], { x: 0, y: 0 }, handles[2]] },
    ),
  ).toThrow(/tangent/);
});

it('supports independent incoming waypoint controls while rejecting tangent corners', () => {
  const path: MotionPath = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    curvedWaypoints: true,
    waypoints: [{ x: 30, y: 0 }],
    waypointTangents: [
      { x: 10, y: 20 },
      { x: 10, y: 0 },
      { x: 10, y: -20 },
    ],
    waypointIncoming: [{ x: -10, y: 20 }],
  };
  const from = { x: 0, y: 0 },
    to = { x: 60, y: 0 };
  const sample = createMotionPathSampler(from, to, path);
  // The first cubic's two control y coordinates are both 20; the next stays unchanged.
  expect(sample(0.25)).toEqual({ x: 15, y: 15 });
  expect(sample(0.5)).toEqual({ x: 30, y: 0 });
  expect(sample(0.75)).toEqual({ x: 45, y: 7.5 });
  expect(() => createMotionPathSampler(from, to, { ...path, tangent: true })).toThrow(/join/);
  expect(createMotionPathSampler(from, to, { ...path, distance: true })(0.5).x).toBeGreaterThan(0);
  const aligned = createMotionPathSampler(from, to, {
    ...path,
    waypointIncoming: [{ x: -5, y: 0 }],
    tangent: true,
  });
  expect(aligned(0.5).tangentAngle).toBeCloseTo(0, 8);
  path.waypointIncoming![0].y = 999;
  expect(sample(0.25)).toEqual({ x: 15, y: 15 });
  for (const waypointIncoming of [
    [],
    [{ x: NaN, y: 0 }],
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  ])
    expect(() => createMotionPathSampler(from, to, { ...path, waypointIncoming })).toThrow(
      /incoming/,
    );
  expect(() => createMotionPathSampler(from, to, { ...path, waypointTangents: undefined })).toThrow(
    /incoming/,
  );
});

it('retains subnormal distance fractions across curved waypoint segments', () => {
  const unit = Number.MIN_VALUE;
  const sample = createMotionPathSampler(
    { x: 0, y: 0 },
    { x: 18 * unit, y: 0 },
    {
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      waypoints: [{ x: 9 * unit, y: 0 }],
      curvedWaypoints: true,
      waypointTangents: [
        { x: 3 * unit, y: 0 },
        { x: 3 * unit, y: 0 },
        { x: 3 * unit, y: 0 },
      ],
      distance: true,
    },
  );
  expect(sample(1 / 18).x).toBe(unit);
});


it.each([false, true])('lifts straight waypoint headings independently of sampling order (distance %s)', (distance) => {
  const from = { x: 10, y: 20 }, to = { x: 11, y: 20 };
  const path = { startX: 0, startY: 0, endX: 0, endY: 0, tangent: true, distance,
    waypoints: [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }] };
  const sample = createMotionPathSampler(from, to, path);
  const expected = [0, 90, 180, 270, 360];
  for (const i of [4, 0, 3, 1, 2]) {
    expect(sample((i + 0.5) / 5).tangentAngle).toBe(expected[i]);
    expect(sample(i / 5).tangentAngle).toBe(expected[i]);
  }
  expect(sample(1)).toEqual({ ...to, tangentAngle: 360 });
  path.waypoints[0].x = 999; path.tangent = false; from.x = 999; to.x = 999;
  expect(sample(0.5)).toEqual({ x: 10.5, y: 21, tangentAngle: 180 });
});
it('uses segment distance boundaries for straight headings and rejects undefined turns at compile time', () => {
  const from = { x: 0, y: 0 }, to = { x: 30, y: 40 };
  const path = { startX: 0, startY: 0, endX: 0, endY: 0, tangent: true, waypoints: [{ x: 30, y: 0 }] };
  const timed = createMotionPathSampler(from, to, path);
  const distance = createMotionPathSampler(from, to, { ...path, distance: true });
  expect(timed(0.45).tangentAngle).toBe(0);
  expect(distance(0.45).tangentAngle).toBe(90);
  expect(distance(3 / 7)).toEqual({ x: 30, y: 0, tangentAngle: 90 });
  for (const end of [{ x: 0, y: 0 }, { x: 0, y: 1e-15 }, { x: 30, y: 0 }])
    expect(() => createMotionPathSampler(from, end, path)).toThrow(/tangent/);
  for (const scale of [1e-200, 1e200]) {
    const sample = createMotionPathSampler(from, { x: scale, y: scale }, { ...path, waypoints: [{ x: scale, y: 0 }] });
    expect(sample(0.25).tangentAngle).toBe(0);
    expect(sample(0.75).tangentAngle).toBe(90);
  }
});
