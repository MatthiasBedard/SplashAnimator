import { expect, it } from 'vitest';
import {
  clone,
  newProject,
  type Vector,
} from '../packages/document/src';
import {
  captureIsolatedSymbolFrameSources,
  type IsolatedSymbolFrameSourceState,
} from '../packages/document/src/symbol-frame-sources';

function fixture() {
  const project = newProject();
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 2,
    y: 3,
    width: 20,
    height: 10,
    rotation: 15,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 1,
    points: [],
  };
  project.frameScripts = [{ frame: 40, source: 'root' }];
  project.symbols = [
    {
      id: 's',
      name: 'Source',
      width: 40,
      height: 30,
      shapes: [art],
      buttonStates: { up: 0, over: 1, down: 2, hit: 0 },
      timeline: { duration: 3, keys: [{ frame: 2, shapes: [{ ...art, x: 10 }] }] },
    },
    {
      id: 'other',
      name: 'Other',
      width: 20,
      height: 10,
      shapes: [{ ...art, id: 'other-art' }],
      timeline: { duration: 2, keys: [], frameScripts: [{ frame: 1, source: 'other' }] },
    },
  ];
  const definition = clone(project.symbols[0]);
  definition.shapes[0].y = 8;
  return {
    project,
    definition,
    revision: 0,
    frame: 1,
    validateEnclosing: () => {},
  } satisfies IsolatedSymbolFrameSourceState;
}
it('prepares one original local frame on a detached draft with complete enclosing source/artwork admission', () => {
  const source = fixture(),
    before = clone(source.project),
    draft = clone(source.definition),
    owner = captureIsolatedSymbolFrameSources(() => source);
  const result = owner.prepare('\uFEFFlet unfinished =\r\n');
  const expected = clone(draft);
  expected.timeline!.frameScripts = [{ frame: 1, source: '\uFEFFlet unfinished =\r\n' }];
  expect(result).toEqual(expected);
  expect(source.definition).toEqual(draft);
  expect(source.project).toEqual(before);
  result.shapes[0].x = 999;
  result.timeline!.frameScripts![0].source = 'forged';
  expect(owner.prepare('').timeline!.frameScripts).toEqual([{ frame: 1, source: '' }]);
  owner.assertCurrent();
});
it('keeps absent/empty/remove semantics and permits a later reopened edit', () => {
  const source = fixture();
  let owner = captureIsolatedSymbolFrameSources(() => source);
  expect(owner.prepare(null)).toEqual(source.definition);
  source.definition = owner.prepare('first');
  owner.dispose();
  owner = captureIsolatedSymbolFrameSources(() => source);
  expect(owner.prepare(null).timeline!.frameScripts).toBeUndefined();
  expect(owner.prepare('replacement').timeline!.frameScripts).toEqual([
    { frame: 1, source: 'replacement' },
  ]);
});
it.each([-1, 3, 0.5, NaN, Infinity])('rejects invalid original frame %s', (frame) => {
  const source = fixture();
  source.frame = frame;
  expect(() => captureIsolatedSymbolFrameSources(() => source)).toThrow();
});
it.each([-1, 0.5, NaN, Infinity])('rejects invalid original revision %s', (revision) => {
  const source = fixture();
  source.revision = revision;
  expect(() => captureIsolatedSymbolFrameSources(() => source)).toThrow();
});
it.each(['timeline', 'identity', 'number', 'getter', 'library'])(
  'rejects invalid original %s before normalization',
  (kind) => {
    const source = fixture();
    if (kind === 'timeline') delete source.definition.timeline;
    if (kind === 'identity') source.definition.id = 'missing';
    if (kind === 'number') source.definition.shapes[0].x = NaN;
    if (kind === 'getter')
      Object.defineProperty(source.definition, 'timeline', {
        get() {
          throw Error('raw getter');
        },
      });
    if (kind === 'library') source.project.symbols![1].shapes[0].width = Infinity;
    expect(() => captureIsolatedSymbolFrameSources(() => source)).toThrow();
  },
);
it.each([
  'definition',
  'frame',
  'revision',
  'project',
  'root source',
  'library source',
  'draft source',
])('rejects late %s edits without source or draft writes', (kind) => {
  const source = fixture(),
    owner = captureIsolatedSymbolFrameSources(() => source);
  if (kind === 'definition') source.definition = clone(source.definition);
  if (kind === 'frame') source.frame = 2;
  if (kind === 'revision') source.revision++;
  if (kind === 'project') source.project = clone(source.project);
  if (kind === 'root source') source.project.frameScripts![0].source += 'changed';
  if (kind === 'library source')
    source.project.symbols![1].timeline!.frameScripts![0].source += 'changed';
  if (kind === 'draft source') source.definition.shapes[0].x++;
  expect(() => owner.prepare('stale')).toThrow();
  expect(source.definition.timeline!.frameScripts).toBeUndefined();
});
it.each(['draft', 'project', 'revision', 'dispose', 'reentry'])(
  'rejects final enclosing %s callback changes after detached preparation',
  (kind) => {
    const source = fixture();
    let admissions = 0;
    source.validateEnclosing = () => {
      if (++admissions === 4) {
        if (kind === 'draft') source.definition.shapes[0].x++;
        if (kind === 'project') source.project.name = 'external';
        if (kind === 'revision') source.revision++;
        if (kind === 'dispose') owner.dispose();
        if (kind === 'reentry') owner.assertCurrent();
      }
    };
    const owner = captureIsolatedSymbolFrameSources(() => source);
    expect(() => owner.prepare('unpublished')).toThrow();
    expect(admissions).toBe(4);
    expect(source.definition.timeline!.frameScripts).toBeUndefined();
  },
);
it('shares exact source capacity with the real root and other library definitions', () => {
  const source = fixture();
  source.project.frameScripts![0].source = 'x'.repeat(256 * 1024 - 5);
  source.project.symbols![1].timeline!.frameScripts![0].source = 'éé';
  const owner = captureIsolatedSymbolFrameSources(() => source);
  expect(owner.prepare('x').timeline!.frameScripts![0].source).toBe('x');
  expect(() => owner.prepare('é')).toThrow(/budget/);
  expect(source.definition.timeline!.frameScripts).toBeUndefined();
  expect(owner.prepare('').timeline!.frameScripts![0].source).toBe('');
});
it('captures the original enclosing validator rather than accepting a replacement', () => {
  const source = fixture();
  let active = true;
  source.validateEnclosing = () => {
    if (!active) throw Error('original enclosing owner');
  };
  const owner = captureIsolatedSymbolFrameSources(() => source);
  source.validateEnclosing = () => {};
  active = false;
  expect(() => owner.prepare('no')).toThrow(/original enclosing/);
});
it('rejects actual aggregate overflow in the enclosing replacement draft', () => {
  const source = fixture();
  source.definition.shapes = Array.from({ length: 100001 }, (_, i) => ({
    ...source.definition.shapes[0],
    id: String(i),
  }));
  expect(() => captureIsolatedSymbolFrameSources(() => source)).toThrow(/budget/);
  expect(source.definition.shapes).toHaveLength(100001);
});
it.each([undefined, 42, {}, true])(
  'rejects raw source %s and permits a fresh valid retry',
  (value) => {
    const source = fixture(),
      owner = captureIsolatedSymbolFrameSources(() => source);
    expect(() => owner.prepare(value as string)).toThrow();
    expect(owner.prepare('valid').timeline!.frameScripts![0].source).toBe('valid');
  },
);
it('snapshots an enclosing callback getter once and rejects asynchronous admission', () => {
  const source = fixture();
  let reads = 0;
  Object.defineProperty(source, 'validateEnclosing', {
    configurable: true,
    get() {
      reads++;
      return () => {};
    },
  });
  const owner = captureIsolatedSymbolFrameSources(() => source);
  Object.defineProperty(source, 'validateEnclosing', {
    get() {
      throw Error('must not reread');
    },
  });
  expect(owner.prepare('body').timeline!.frameScripts![0].source).toBe('body');
  expect(reads).toBe(1);
  const asynchronous = fixture();
  asynchronous.validateEnclosing = () => Promise.reject(Error('not synchronous'));
  expect(() => captureIsolatedSymbolFrameSources(() => asynchronous)).toThrow(/synchronous/);
});
it('exposes only detached privately admitted source snapshots to program preparation',()=>{
  const source=fixture(),owner=captureIsolatedSymbolFrameSources(()=>source),snapshot=owner.snapshot();expect(snapshot.definition).toEqual(source.definition);expect(snapshot.project.symbols![0]).toEqual(source.definition);expect(snapshot.frame).toBe(source.frame);expect(snapshot.revision).toBe(source.revision);snapshot.definition.shapes[0].x=999;snapshot.project.frameScripts![0].source='forged';expect(owner.snapshot().definition.shapes[0].x).toBe(source.definition.shapes[0].x);expect(owner.snapshot().project.frameScripts![0].source).toBe('root');owner.dispose();expect(()=>owner.snapshot()).toThrow();
});
