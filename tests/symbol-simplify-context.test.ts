import { afterEach, expect, it, vi } from 'vitest';
import {
  captureStaticSymbolSimplifyContext as capture,
  type StaticSymbolSimplifySource,
} from '../apps/editor/src/symbol-simplify-context';
import { symbolSimplifyFixture } from './symbol-simplify-fixture';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture() {
  const input = symbolSimplifyFixture(),
    source: StaticSymbolSimplifySource = {
      project: input.project,
      history: {},
      session: {},
      revision: 1,
      symbolId: 'art',
      context: 'original',
      eligible: true,
    };
  const artwork = structuredClone(input.project.symbols![0].shapes);
  return { source, artwork };
}
it('overlays the current local draft in a detached complete enclosing project without publication', () => {
  const { source, artwork } = fixture();
  artwork[0].stroke = '#0000ff';
  const before = structuredClone(source.project),
    context = capture(() => source, artwork);
  expect(context.project.symbols![0].shapes).toEqual(artwork);
  expect(context.project.layers).toEqual(source.project.layers);
  context.validate();
  expect(source.project).toEqual(before);
  context.project.symbols![0].name = 'tampered';
  expect(() => context.validate()).toThrow(/input/);
});
for (const field of [
  'project',
  'history',
  'session',
  'revision',
  'symbolId',
  'context',
  'eligible',
  'library',
  'artwork',
] as const)
  it(`rejects original enclosing ${field} changes`, () => {
    const { source, artwork } = fixture(),
      context = capture(() => source, artwork);
    if (field === 'project') source.project = structuredClone(source.project);
    if (field === 'history') source.history = {};
    if (field === 'session') source.session = {};
    if (field === 'revision') source.revision++;
    if (field === 'symbolId') source.symbolId = 'unrelated';
    if (field === 'context') source.context = 'changed';
    if (field === 'eligible') source.eligible = false;
    if (field === 'library') source.project.symbols![1].name = 'changed';
    if (field === 'artwork') artwork[0].x++;
    expect(() => context.validate()).toThrow();
  });
it('rejects changed static scope and original accessors without getter reads', () => {
  const { source, artwork } = fixture();
  source.project.symbols![0].timeline = { duration: 1, keys: [] };
  expect(() => capture(() => source, artwork)).toThrow(/static/);
  const fresh = fixture(),
    getter = vi.fn(() => fresh.source.project);
  Object.defineProperty(fresh.source, 'project', { get: getter });
  expect(() => capture(() => fresh.source, fresh.artwork)).toThrow(/data/);
  expect(getter).not.toHaveBeenCalled();
});
it('poisons caught read reentry and retains original artwork', () => {
  const { source, artwork } = fixture();
  let nested = false;
  const context: ReturnType<typeof capture> = capture(() => {
    if (nested)
      try {
        context.validate();
      } catch {}
    return source;
  }, artwork);
  nested = true;
  expect(() => context.validate()).toThrow();
  nested = false;
  expect(() => context.validate()).toThrow();
});
it('rejects aliased snapshots and actual source mutation during cloning', () => {
  const { source, artwork } = fixture(),
    native = structuredClone;
  vi.stubGlobal('structuredClone', (value: unknown) => value);
  expect(() => capture(() => source, artwork)).toThrow(/detached/);
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const copy = native(value);
    source.project.name = 'late source';
    return copy;
  });
  expect(() => capture(() => source, artwork)).toThrow(/changed/);
});
