import { afterEach, expect, it, vi } from 'vitest';
import {
  snapshotSymbolSimplifyRequest as snapshot,
  prepareSymbolSimplifyRequest as prepare,
  admitSymbolSimplifyResult as admit,
} from '../packages/geometry/src/symbol-simplify-request';
import { isolatedSymbolSimplifyFixture as fixture } from './symbol-simplify-isolated-fixture';
import { artworkVertices } from '../packages/geometry/src/artwork-simplify';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
for (const basis of ['plain', 'affine', 'reflected'])
  for (const depth of [1, 2])
    it(`snapshots/prepares/admits depth ${depth} isolated ${basis} groups without touching siblings`, () => {
      const source = fixture(basis);
      if (depth === 2) source.ancestry!.push('inner');
      const before = structuredClone(source),
        input = snapshot(source),
        result = prepare(input),
        output = admit(input, result),
        ids = depth === 1 ? ['line', 'partner'] : ['line'];
      expect(output).toEqual(result);
      expect(output.selected).toEqual(ids);
      const old = source.project.symbols![0].shapes,
        next = output.project.symbols![0].shapes;
      old.forEach((s, i) => {
        if (ids.includes(s.id)) {
          expect(artworkVertices(next[i])).toBeLessThan(artworkVertices(s));
          expect(next[i].groups).toEqual(s.groups);
        } else expect(next[i]).toStrictEqual(s);
      });
      expect(output.project.layers).toEqual(source.project.layers);
      expect(output.project.symbols![1]).toEqual(source.project.symbols![1]);
      output.project.symbols![0].shapes[0].nodes![0].x++;
      expect(source).toStrictEqual(before);
      expect(input).toStrictEqual(before);
      expect(output).not.toEqual(result);
    });
it('retains an isolated complete no-op with exact metadata', () => {
  const input = fixture();
  input.project.symbols![0].shapes[3].groups = ['alone'];
  input.ancestry = ['alone'];
  input.selected = ['other'];
  const out = admit(input, prepare(input));
  expect(out.removed).toBe(0);
  expect(out.project).toStrictEqual(input.project);
});
for (const kind of ['empty', 'missing', 'outside', 'getter', 'nonfinite', 'reordered'] as const)
  it(`rejects ${kind} raw isolated requests before background work`, () => {
    const input = fixture();
    let getter: ReturnType<typeof vi.fn> | undefined;
    if (kind === 'empty') input.ancestry = [];
    if (kind === 'missing') input.ancestry = ['missing'];
    if (kind === 'outside') input.selected = ['other'];
    if (kind === 'nonfinite') input.ancestry = [Infinity as unknown as string];
    if (kind === 'reordered') input.ancestry = ['inner', 'outer'];
    if (kind === 'getter') {
      getter = vi.fn(() => ['outer']);
      Object.defineProperty(input, 'ancestry', { get: getter });
    }
    expect(() => snapshot(input)).toThrow();
    if (getter) expect(getter).not.toHaveBeenCalled();
  });
for (const kind of [
  'widerSelection',
  'widerGeometry',
  'narrowerSelection',
  'groups',
  'sibling',
  'library',
  'count',
  'endpoint',
] as const)
  it(`rejects forged isolated response ${kind}`, () => {
    const input = snapshot(fixture()),
      result = prepare(input);
    if (kind === 'widerSelection') result.selected.push('paint');
    if (kind === 'narrowerSelection') result.selected = ['line'];
    if (kind === 'widerGeometry') {
      const wide = { ...input };
      delete wide.ancestry;
      const out = prepare(wide);
      out.selected = result.selected;
      expect(() => admit(input, out)).toThrow();
      return;
    }
    if (kind === 'groups') result.project.symbols![0].shapes[0].groups = ['outer'];
    if (kind === 'sibling') result.project.symbols![0].shapes[2].contours![0][0].x++;
    if (kind === 'library') result.project.symbols![1].name = 'changed';
    if (kind === 'count') result.removed++;
    if (kind === 'endpoint') result.project.symbols![0].shapes[0].nodes![0].x++;
    expect(() => admit(input, result)).toThrow();
  });
it('captures ancestry before caller edits and rejects real clone-time retargeting', () => {
  const source = fixture(),
    input = snapshot(source);
  source.ancestry![0] = 'changed';
  source.selected = ['other'];
  expect(prepare(input).selected).toEqual(['line', 'partner']);
  const fresh = fixture(),
    native = structuredClone;
  let fired = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const copy = native(value);
    if (!fired && value === fresh) {
      fired = true;
      fresh.ancestry![0] = 'changed';
    }
    return copy;
  });
  expect(() => snapshot(fresh)).toThrow();
  expect(fired).toBe(true);
});
it('rejects original ancestry changes during host result cloning', () => {
  const input = snapshot(fixture()),
    result = prepare(input),
    native = structuredClone;
  let fired = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const copy = native(value);
    if (!fired && value === result.project) {
      fired = true;
      input.ancestry![0] = 'changed';
    }
    return copy;
  });
  expect(() => admit(input, result)).toThrow();
  expect(fired).toBe(true);
});
