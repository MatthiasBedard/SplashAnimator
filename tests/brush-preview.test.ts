import { afterEach, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Vector } from '../packages/document/src';
import { BrushPreview } from '../packages/stage/src/brush-preview';
import { brushPreviewParts, pathCommands } from '../packages/geometry/src/drawing';
import { responseSweepSamples } from '../packages/geometry/src/brush-response-sweep';

function fixture(scheduled = false) {
  const contexts: ReturnType<typeof context>[] = [];
  function context() {
    return {
      canvas: { width: 800, height: 600 },
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      setTransform: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      transform: vi.fn(),
      fill: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
    };
  }
  vi.stubGlobal('document', {
    createElement: () => {
      const ctx = context();
      contexts.push(ctx);
      return { width: 0, height: 0, getContext: () => ctx };
    },
  });
  const curves = vi.fn();
  vi.stubGlobal(
    'Path2D',
    class {
      moveTo() {}
      lineTo() {}
      closePath() {}
      bezierCurveTo = curves;
    },
  );
  const target = context();
  const brush: Vector = {
    id: 'stroke',
    kind: 'brush',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    fill: '#cc2200',
    stroke: '',
    strokeWidth: 12,
    points: [{ x: 0, y: 0 }],
  };
  const cache = new BrushPreview(scheduled ? () => draw() : undefined);
  const draw = () => cache.draw(target as unknown as CanvasRenderingContext2D, brush);
  return { cache, brush, contexts, target, draw, curves };
}
afterEach(() => vi.unstubAllGlobals());

test.each(['tilt', 'twist'] as const)(
  '%s nib raster expansion pauses within one sample pair and resumes exactly',
  (mode) => {
    const queue = frames(),
      f = fixture(true);
    f.brush.brush = {
      pressure: true,
      minimum: 0.1,
      aspect: 0.2,
      angle: 30,
      tilt: false,
      [mode]: true,
    };
    f.brush.points = [
      { x: 0, y: 20, pressure: 0.2, tiltX: 30, twist: 0 },
      { x: 40000, y: 20, pressure: 1, tiltY: 30, twist: 179 },
    ];
    let pressureReads = 0;
    Object.defineProperty(f.brush.points[1], 'pressure', {
      enumerable: true,
      get() {
        pressureReads++;
        return 1;
      },
    });
    const original = JSON.stringify(f.brush);
    const segments = f.brush.points.map((point, i) => ({
      ...f.brush,
      points: i ? [f.brush.points[i - 1], point] : [point],
    }));
    const expected = segments.flatMap(pathCommands).filter((c) => c[0] === 'C');
    expect(expected.length).toBeGreaterThan(16000);
    pressureReads = 0;
    f.draw();
    // Bound generation as well as Canvas calls: do not eagerly allocate all
    // 4001 dabs and merely postpone their rasterization.
    expect(pressureReads).toBeLessThan(1500);
    expect(f.curves.mock.calls.length).toBeLessThanOrEqual(4096);
    const initial = f.curves.mock.calls.length;
    for (let i = 0; i < 10; i++) f.draw();
    expect(f.curves).toHaveBeenCalledTimes(initial);
    let ticks = 0;
    while (queue.pending.size) {
      const before = f.curves.mock.calls.length;
      queue.flush();
      expect(f.curves.mock.calls.length - before).toBeLessThanOrEqual(4096);
      expect(++ticks).toBeLessThan(10);
    }
    expect(ticks).toBeGreaterThan(1);
    expect(f.curves.mock.calls).toEqual(expected.map((c) => c.slice(1)));
    expect(JSON.stringify(f.brush)).toBe(original);
  },
);

test.each([undefined, { tilt: true }, { twist: true }, { pressure: true, response: 4 }])(
  'closed preview parts retain exact original path commands: %j',
  (options) => {
    const f = fixture();
    f.brush.brush = {
      pressure: true,
      minimum: 0.1,
      aspect: 0.2,
      angle: 35,
      tilt: false,
      ...options,
    };
    f.brush.points = [
      { x: 0, y: 0, pressure: 0.1, tiltX: 30, twist: 350 },
      { x: 21, y: 7, pressure: 1, tiltY: 35, twist: 15 },
    ];
    const parts = [...brushPreviewParts(f.brush)];
    expect(parts.every((p) => p[0][0] === 'M' && p.at(-1)![0] === 'Z')).toBe(true);
    expect(parts.flat()).toEqual(pathCommands(f.brush));
  },
);

test('clearing a partially rasterized nib cancels its iterator and late frames', () => {
  const queue = frames(),
    f = fixture(true);
  f.brush.brush = {
    pressure: false,
    minimum: 0.1,
    aspect: 0.1,
    angle: 0,
    tilt: false,
    twist: true,
  };
  f.brush.points = [
    { x: 0, y: 0 },
    { x: 40000, y: 0, twist: 179 },
  ];
  f.draw();
  const late = [...queue.pending.values()][0];
  f.cache.clear();
  f.brush.id = 'replacement';
  f.brush.points = [{ x: 10, y: 10 }];
  f.draw();
  const before = f.curves.mock.calls.length;
  late(0);
  while (queue.pending.size) queue.flush();
  expect(f.curves).toHaveBeenCalledTimes(before);
});

test('unchanged and opacity-only previews reuse colored coverage without replay or recoloring', () => {
  const f = fixture();
  f.draw();
  const curves = f.curves.mock.calls.length;
  for (let i = 0; i < 100; i++) f.draw();
  f.brush.opacity = 0.4;
  f.draw();
  expect(f.contexts).toHaveLength(2);
  expect(f.curves).toHaveBeenCalledTimes(curves);
  expect(f.contexts[0].fill).toHaveBeenCalledTimes(1);
  expect(f.contexts[1].fillRect).toHaveBeenCalledTimes(1);
  expect(f.target.drawImage).toHaveBeenCalledTimes(102);
});

test('new paint recolors cached coverage without retessellating it', () => {
  const f = fixture();
  f.draw();
  const curves = f.curves.mock.calls.length;
  f.brush.fill = '#0022cc';
  f.draw();
  f.draw();
  expect(f.curves).toHaveBeenCalledTimes(curves);
  expect(f.contexts[0].fill).toHaveBeenCalledTimes(1);
  expect(f.contexts[1].fillRect).toHaveBeenCalledTimes(2);
});

test('a long stroke reads only new sample pairs and no samples during unchanged repaints', () => {
  const f = fixture();
  let reads = 0;
  f.brush.points = new Proxy(f.brush.points, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) reads++;
      return Reflect.get(target, property, receiver);
    },
  });
  f.draw();
  for (let burst = 0; burst < 120; burst++) {
    for (let j = 0; j < 100; j++) f.brush.points.push({ x: (burst * 100 + j + 1) % 700, y: j % 2 });
    reads = 0;
    const before = f.curves.mock.calls.length;
    f.draw();
    expect(reads).toBe(200);
    expect(f.curves.mock.calls.length - before).toBeLessThanOrEqual(820);
    reads = 0;
    f.draw();
    expect(reads).toBe(0);
  }
  expect(f.brush.points).toHaveLength(12001);
  expect(f.contexts[1].fillRect).toHaveBeenCalledTimes(121);
});

test.each(['clear', 'shorten', 'resize', 'view', 'nib'] as const)(
  '%s invalidates both bitmap caches',
  (change) => {
    const f = fixture();
    f.brush.points.push({ x: 10, y: 0 });
    f.draw();
    if (change === 'clear') f.cache.clear();
    if (change === 'shorten') f.brush.points.pop();
    if (change === 'resize') f.target.canvas.width++;
    if (change === 'view') f.brush.x++;
    if (change === 'nib') f.brush.strokeWidth++;
    f.draw();
    expect(f.contexts).toHaveLength(4);
    expect(f.contexts[3].fillRect).toHaveBeenCalledTimes(1);
    expect(f.contexts[2].fill).toHaveBeenCalledTimes(1);
  },
);

function frames() {
  let next = 0;
  const pending = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.set(++next, callback);
    return next;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
  return {
    pending,
    flush() {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(0));
    },
  };
}

test('caught-up input replenishes its budget without an extra whole-stage repaint', () => {
  const queue = frames(),
    f = fixture(true);
  for (let burst = 0; burst < 120; burst++) {
    for (let i = 0; i < 100; i++) f.brush.points.push({ x: i, y: burst % 2 });
    f.draw();
    const paints = f.target.drawImage.mock.calls.length;
    expect(queue.pending.size).toBe(1);
    queue.flush();
    expect(f.target.drawImage).toHaveBeenCalledTimes(paints);
    expect(queue.pending.size).toBe(0);
  }
  expect(f.brush.points).toHaveLength(12001);
});

test('new backlog upgrades a budget-only callback and still drains every sample', () => {
  const queue = frames(),
    f = fixture(true);
  f.draw();
  expect(queue.pending.size).toBe(1);
  for (let i = 1; i <= 6000; i++) f.brush.points.push({ x: i, y: 0 });
  f.draw();
  const before = f.curves.mock.calls.length;
  expect(queue.pending.size).toBe(1);
  queue.flush();
  expect(f.curves.mock.calls.length).toBeGreaterThan(before);
  while (queue.pending.size) queue.flush();
  const paints = f.target.drawImage.mock.calls.length;
  f.cache.requestDraw();
  queue.flush();
  expect(f.target.drawImage).toHaveBeenCalledTimes(paints + 1);
  expect(queue.pending.size).toBe(0);
  expect(f.brush.points).toHaveLength(6001);
});

test('large queued strokes drain every sample with a shared per-frame raster budget', () => {
  const queue = frames(),
    f = fixture(true);
  let reads = 0;
  f.brush.points = new Proxy(f.brush.points, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) reads++;
      return Reflect.get(target, property, receiver);
    },
  });
  for (let i = 1; i <= 12000; i++) f.brush.points.push({ x: i, y: i % 2 });
  const original = JSON.stringify(f.brush.points);
  reads = 0;
  f.draw();
  expect(reads).toBe(511); // First dab plus 255 pairs.
  const colored = f.contexts[1].fillRect.mock.calls.length;
  reads = 0;
  for (let i = 0; i < 100; i++) f.draw();
  expect(reads).toBe(0);
  expect(f.contexts[1].fillRect).toHaveBeenCalledTimes(colored);
  expect(queue.pending.size).toBe(1);
  let drained = 256,
    ticks = 0;
  while (queue.pending.size) {
    reads = 0;
    queue.flush();
    expect(reads).toBeLessThanOrEqual(512);
    drained += reads / 2;
    expect(++ticks).toBeLessThan(50);
  }
  expect(drained).toBe(12001);
  expect(JSON.stringify(f.brush.points)).toBe(original);
});

test('new input shares the current frame budget and catches up after idle without dropping it', () => {
  const queue = frames(),
    f = fixture(true);
  f.draw();
  for (let i = 1; i <= 1000; i++) {
    f.brush.points.push({ x: i, y: 0 });
    f.draw();
  }
  expect(f.curves.mock.calls.length).toBeLessThanOrEqual(2100);
  expect(queue.pending.size).toBe(1);
  while (queue.pending.size) queue.flush();
  const curves = f.curves.mock.calls.length;
  f.draw();
  expect(f.curves).toHaveBeenCalledTimes(curves);
  f.brush.points.push({ x: 1001, y: 0 });
  f.draw();
  expect(f.curves.mock.calls.length).toBeGreaterThan(curves);
});

test('clear cancels queued raster work and an obsolete callback cannot repaint a new stroke', () => {
  const queue = frames(),
    f = fixture(true);
  for (let i = 1; i <= 1000; i++) f.brush.points.push({ x: i, y: 0 });
  f.draw();
  const late = [...queue.pending.values()][0];
  f.cache.clear();
  expect(queue.pending.size).toBe(0);
  f.brush.id = 'new';
  f.brush.points = [{ x: 1, y: 1 }];
  f.draw();
  const draws = f.target.drawImage.mock.calls.length;
  late(0);
  expect(f.target.drawImage).toHaveBeenCalledTimes(draws);
  expect(queue.pending.size).toBe(1);
  queue.flush();
  expect(queue.pending.size).toBe(0);
});

test('legacy synchronous callers still draw complete strokes without a scheduling callback', () => {
  const f = fixture();
  for (let i = 1; i <= 1000; i++) f.brush.points.push({ x: i, y: i % 2 });
  f.draw();
  expect(f.curves.mock.calls.length).toBeGreaterThanOrEqual(8000);
  const curves = f.curves.mock.calls.length;
  f.draw();
  expect(f.curves).toHaveBeenCalledTimes(curves);
});

test('recolor work stays local after 12000 samples instead of covering accumulated paint', () => {
  const f = fixture();
  for (let i = 1; i <= 12000; i++) f.brush.points.push({ x: 100 + (i % 500), y: 100 });
  f.draw();
  const color = f.contexts[1];
  const initial = color.fillRect.mock.lastCall!;
  expect(initial[2] * initial[3]).toBeLessThan(800 * 600);
  for (let i = 1; i <= 100; i++) {
    f.brush.points.push({ x: 100 + i, y: 100 });
    f.draw();
    const [x, y, width, height] = color.fillRect.mock.lastCall!;
    expect(width).toBeLessThan(40);
    expect(height).toBeLessThan(40);
    expect(width * height).toBeLessThan(1600);
    expect(x).toBeGreaterThan(80);
    expect(y).toBeGreaterThan(80);
    expect(color.rect).toHaveBeenLastCalledWith(x, y, width, height);
    expect(color.drawImage).toHaveBeenLastCalledWith(
      expect.anything(),
      x,
      y,
      width,
      height,
      x,
      y,
      width,
      height,
    );
  }
  expect(f.brush.points).toHaveLength(12101);
  expect(color.save).toHaveBeenCalledTimes(101);
  expect(color.clip).toHaveBeenCalledTimes(101);
  expect(color.restore).toHaveBeenCalledTimes(101);
});

test('active source-over composites use painted bounds and other operators keep the full source', () => {
  const f = fixture();
  f.brush.points = [{ x: 100, y: 200 }, { x: 300, y: 200 }];
  f.draw();
  const [source, x, y, width, height, dx, dy, dw, dh] = f.target.drawImage.mock.lastCall!;
  expect([x, y, width, height]).toEqual([92, 192, 216, 16]);
  expect(f.contexts[1].fillRect).toHaveBeenCalledWith(x, y, width, height);
  expect([dx, dy, dw, dh]).toEqual([x, y, width, height]);
  f.target.globalCompositeOperation = 'copy';
  f.draw();
  expect(f.target.drawImage).toHaveBeenLastCalledWith(source, 0, 0);
});

test('dirty control hulls use device coordinates including reflected skewed views', () => {
  const f = fixture();
  f.brush.points = [{ x: 10, y: 20 }];
  f.draw();
  const m = { a: -2, b: 0.5, c: 1, d: 3, e: 200, f: 20 };
  f.contexts[0].getTransform = () => m;
  f.brush.points.push({ x: 11, y: 21 });
  f.draw();
  const [x, y, width, height] = f.contexts[1].fillRect.mock.lastCall!;
  // Independent conservative nib bounds: the two radius-six dabs fit inside
  // local [4,17] x [14,27], then affine-map into this device hull.
  expect(x).toBeGreaterThanOrEqual(178);
  expect(y).toBeGreaterThanOrEqual(62);
  expect(x + width).toBeLessThanOrEqual(221);
  expect(y + height).toBeLessThanOrEqual(112);
  expect(x).toBeLessThanOrEqual(198);
  expect(y).toBeLessThanOrEqual(85);
  expect(x + width).toBeGreaterThanOrEqual(200);
  expect(y + height).toBeGreaterThanOrEqual(89);
});

test('offscreen increments skip recoloring, then a fill change recolors the whole retained mask', () => {
  const f = fixture();
  f.brush.points = [{ x: -100, y: -100 }];
  f.draw();
  f.brush.points.push({ x: -90, y: -90 });
  f.draw();
  expect(f.contexts[1].fillRect).not.toHaveBeenCalled();
  f.brush.fill = '#2244cc';
  f.draw();
  expect(f.contexts[1].fillRect).toHaveBeenLastCalledWith(0, 0, 800, 600);
  expect(f.contexts[1].fillRect).toHaveBeenCalledTimes(1);
  f.brush.points.push({ x: 100, y: 100 });
  f.draw();
  const [x, y, width, height] = f.contexts[1].fillRect.mock.lastCall!;
  expect(x).toBe(0);
  expect(y).toBe(0);
  expect(width).toBeLessThan(120);
  expect(height).toBeLessThan(120);
});

test('nonlinear fixed nib emits its first closed part without building all response geometry', () => {
  const f = fixture();
  f.brush.brush = {
    pressure: true,
    minimum: 0.01,
    response: 0.25,
    aspect: 0.2,
    angle: 35,
    tilt: false,
  };
  f.brush.points = [
    { x: 0, y: 0, pressure: 0 },
    { x: 1000, y: 20, pressure: 1 },
  ];
  f.brush.transform = [20, 0, 0, 20];
  let reads = 0;
  Object.defineProperty(f.brush, 'strokeWidth', {
    enumerable: true,
    get() {
      reads++;
      return 200;
    },
  });
  const samples = responseSweepSamples(f.brush)!;
  const preparationReads = reads;
  expect(samples.length).toBeGreaterThan(100);
  reads = 0;
  const cursor = brushPreviewParts(f.brush);
  const first = cursor.next();
  // Subdivision admission still completes before output. Only the first ellipse
  // should then be built, rather than every admitted ellipse and connector.
  expect(reads).toBeLessThanOrEqual(preparationReads + 1);
  if (first.done) throw new Error('Missing first preview part');
  expect(first.value.filter((c) => c[0] === 'C')).toHaveLength(4);
  const expected = pathCommands(f.brush);
  expect([...(first.value ?? []), ...[...cursor].flat()]).toEqual(expected);
});

// Reference geometry captured before the streaming refactor. Quantize the
// reference coordinates to 1e-8 because transcendental math can vary by runtime.
test.each([
  [0.25, false, '89274ae5e1c238cc060aec7c843942af5b9076de5fcbbe201225d1b6fd881647'],
  [0.25, true, 'bf9908b85c10189191ef5e0601a21fa513a03b2b703ffb6c17b3d7b107f81570'],
  [0.5, false, '0c4c8c9e1788b3da50b06b9019bfaf07efb184caa70260d9781f473f3a31aacc'],
  [0.5, true, '309f858fe9e35ae5bc2dc8cf8ee5d75a922629708f7a1c9b560ce35030ce7cec'],
  [1, false, '02b7b07f7b6920f14f552c8be95b65da8d154ad9e80cb861e3cbb4294b8f2cf8'],
  [1, true, 'e10f2ee513fe7eeb8ca0e3bff832f83921bc6bc959a7ccec661fe703b3787382'],
  [2, false, '1b25baa58cc288bf3872fa484be31802ffd79461694ae366518d54c7069103d0'],
  [2, true, '2e40d0434a97d1be5b256f5d6bc9aa809139c4f3bd7fdaa0aed385f9a9935819'],
  [4, false, '2fcf369349d040a6806c9267b83349006033e02599bbdc4e1f1519417847d8cd'],
  [4, true, '1c52b809bbc015108c00fb37370c5a631d9618246189c307091973e0450230da'],
] as const)(
  'fixed nib geometry matches the reference for response %s/reverse %s',
  (response, reverse, hash) => {
    const s: Vector = {
      id: 'oracle',
      kind: 'brush',
      x: 4,
      y: 7,
      width: 200,
      height: 30,
      rotation: 35,
      transform: [-2, 0.25, 0.5, 3],
      strokeWidth: 40,
      fill: '#cc2200',
      stroke: '#000000',
      points: [
        { x: 0, y: 0, pressure: 0 },
        { x: 80, y: 20, pressure: 1 },
        { x: 80, y: 20, pressure: 0.1 },
        { x: -10, y: 5, pressure: 0.7 },
      ],
      brush: { pressure: true, minimum: 0.1, response, aspect: 0.2, angle: 35, tilt: false },
    };
    if (reverse) s.points.reverse();
    const commands = pathCommands(s);
    const quantized = JSON.stringify(commands, (_, value: unknown) =>
      typeof value === 'number' ? Math.round(value * 1e8) : value,
    );
    expect(createHash('sha256').update(quantized).digest('hex')).toBe(hash);
    expect([...brushPreviewParts(s)].flat()).toEqual(commands);
  },
);
