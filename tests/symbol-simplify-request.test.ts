import { afterEach, expect, it, vi } from 'vitest';
import {
  snapshotSymbolSimplifyRequest as snapshot,
  prepareSymbolSimplifyRequest as prepare,
  admitSymbolSimplifyResult as admit,
} from '../packages/geometry/src/symbol-simplify-request';
import { symbolSimplifyFixture as fixture } from './symbol-simplify-fixture';
import { artworkVertices } from '../packages/geometry/src/artwork-simplify';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
for (const basis of ['plain', 'affine', 'reflected'])
  it(`prepares and admits detached ${basis} complete static groups without publication`, () => {
    const source = fixture(basis),
      before = structuredClone(source),
      input = snapshot(source),
      result = prepare(input),
      output = admit(input, result);
    expect(result.selected).toEqual(['line', 'paint']);
    expect(output).toEqual(result);
    expect(output.removed).toBeGreaterThan(100);
    const original = source.project.symbols![0].shapes,
      after = output.project.symbols![0].shapes;
    expect(output.removed).toBe(
      original.reduce((n, s) => n + artworkVertices(s), 0) -
        after.reduce((n, s) => n + artworkVertices(s), 0),
    );
    expect(after[2]).toEqual(original[2]);
    expect(output.project.symbols![1]).toEqual(source.project.symbols![1]);
    output.project.symbols![0].shapes[0].nodes![0].x += 10;
    expect(source).toEqual(before);
    expect(input).toEqual(before);
    expect(result.project.symbols![0].shapes[0]).not.toEqual(output.project.symbols![0].shapes[0]);
  });
it('admits an exact no-op without normalized metadata rewrites', () => {
  const input = fixture();
  input.selected = ['other'];
  const result = prepare(input);
  expect(result.removed).toBe(0);
  expect(admit(input, result).project).toEqual(input.project);
});
for (const field of ['symbol', 'selection', 'timeline', 'button', 'numeric', 'duplicate'] as const)
  it(`rejects invalid original ${field} request data`, () => {
    const input = fixture();
    if (field === 'symbol') input.symbolId = 'missing';
    if (field === 'selection') input.selected = ['missing'];
    if (field === 'timeline') input.project.symbols![0].timeline = { duration: 1, keys: [] };
    if (field === 'button')
      input.project.symbols![0].buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
    if (field === 'numeric') input.project.symbols![0].shapes[0].points[0].x = NaN;
    if (field === 'duplicate') input.selected = ['line', 'line'];
    expect(() => snapshot(input)).toThrow();
  });
it('does not read original getter values during raw admission', () => {
  const input = fixture(),
    getter = vi.fn(() => input.project);
  Object.defineProperty(input, 'project', { get: getter });
  expect(() => snapshot(input)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  const result = prepare(fixture());
  expect(() => admit(input, result)).toThrow();
  expect(getter).not.toHaveBeenCalled();
});
for (const mutation of [
  'count',
  'selection',
  'ids',
  'unselected',
  'root',
  'assets',
  'library',
  'paint',
  'pivot',
  'basis',
  'endpoint',
  'ring',
  'kind',
  'no-reduction',
] as const)
  it(`rejects altered complete worker result ${mutation}`, () => {
    const input = fixture(),
      result = prepare(input),
      s = result.project.symbols![0].shapes[0];
    if (mutation === 'count') result.removed++;
    if (mutation === 'selection') result.selected = ['line'];
    if (mutation === 'ids') s.id = 'replacement';
    if (mutation === 'unselected') result.project.symbols![0].shapes[2].x++;
    if (mutation === 'root') result.project.layers[0].keys[0].shapes[0].x++;
    if (mutation === 'assets') result.project.assets.push({ id: 'asset', path: 'assets/raw.bin' });
    if (mutation === 'library') result.project.symbols![1].name = 'changed';
    if (mutation === 'paint') s.stroke = '#0000ff';
    if (mutation === 'pivot') s.pivot!.x++;
    if (mutation === 'basis') s.transform = [1, 0, 0.2, 1];
    if (mutation === 'endpoint') s.nodes![0].x++;
    if (mutation === 'ring') result.project.symbols![0].shapes[1].contours!.pop();
    if (mutation === 'kind') {
      s.kind = 'path';
      s.points = s.nodes!;
      delete s.nodes;
    }
    if (mutation === 'no-reduction') {
      result.project.symbols![0].shapes[0] = structuredClone(input.project.symbols![0].shapes[0]);
      result.project.symbols![0].shapes[0].stroke = '#0000ff';
    }
    expect(() => admit(input, result)).toThrow();
  });
it('rejects aliased clones and clone-time changes to source or complete response', () => {
  const input = fixture(),
    result = prepare(input),
    native = structuredClone;
  vi.stubGlobal('structuredClone', (value: unknown) => value);
  expect(() => snapshot(input)).toThrow(/detached/);
  expect(() => admit(input, result)).toThrow(/detached/);
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const copy = native(value);
    if (value === result) result.removed++;
    return copy;
  });
  expect(() => admit(input, result)).toThrow(/changed/);
});

it('admits pressure Brush sample reduction but rejects fabricated pen metadata or lost endpoints', () => {
  const input = fixture(),
    brush = input.project.symbols![0].shapes[0];
  brush.kind = 'brush';
  brush.fillEnabled = true;
  brush.brush = { pressure: true, minimum: 0.1, tilt: false, aspect: 1, angle: 0 };
  brush.points = Array.from({ length: 121 }, (_, i) => ({
    x: i,
    y: 0,
    pressure: 0.2 + i / 200,
    tiltX: 10,
    twist: 30,
  }));
  const result = prepare(input);
  expect(result.project.symbols![0].shapes[0].points.length).toBeLessThan(121);
  expect(admit(input, result)).toEqual(result);
  const forged = structuredClone(result);
  forged.project.symbols![0].shapes[0].points[0].pressure = 0.9;
  expect(() => admit(input, forged)).toThrow(/samples|endpoints/);
  const missing = structuredClone(result);
  missing.project.symbols![0].shapes[0].points.pop();
  expect(() => admit(input, missing)).toThrow();
});

it('raw response getters reject without executing and clone mutation of the input rejects', () => {
  const input = fixture(),
    result = prepare(input),
    getter = vi.fn(() => result.removed);
  Object.defineProperty(result, 'removed', { get: getter });
  expect(() => admit(input, result)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  const fresh = prepare(input),
    native = structuredClone;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = native(value);
    if (value === fresh) input.project.name = 'late changed source';
    return out;
  });
  expect(() => admit(input, fresh)).toThrow(/changed/);
});

it('rejects additional inactive geometry arrays in an otherwise valid reduction', () => {
  const input = fixture(),
    result = prepare(input);
  result.project.symbols![0].shapes[0].points = [{ x: 4, y: 5 }];
  expect(() => admit(input, result)).toThrow(/storage/);
  const brush = input.project.symbols![0].shapes[0];
  brush.kind = 'brush';
  brush.fillEnabled = true;
  brush.brush = { pressure: false, minimum: 1, tilt: false, aspect: 1, angle: 0 };
  brush.points = Array.from({ length: 121 }, (_, x) => ({ x, y: 0 }));
  const forged = prepare(input);
  forged.project.symbols![0].shapes[0].nodes = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ];
  expect(() => admit(input, forged)).toThrow(/Inactive/);
});

it('an aliased comparison clone rejects before changing caller response or original artwork', () => {
  const input = fixture(),
    result = prepare(input),
    before = structuredClone({ input, result }),
    native = structuredClone;
  vi.stubGlobal('structuredClone', (value: unknown) =>
    value === result.project ? value : native(value),
  );
  expect(() => admit(input, result)).toThrow(/detached/);
  expect({ input, result }).toEqual(before);
});
