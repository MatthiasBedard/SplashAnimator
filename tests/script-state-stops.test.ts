import { afterEach, expect, it, vi } from 'vitest';
import { createScriptSession, type ScriptStateStop } from '../packages/scripting/src/session';
import { createScriptTimeline } from '../packages/scripting/src/timeline';
import { executeIsolatedFrameWithState } from '../packages/scripting/src/isolated-frame';
vi.mock('../packages/scripting/src/isolated-frame', async (original) => ({
  ...(await original<typeof import('../packages/scripting/src/isolated-frame')>()),
  executeIsolatedFrameWithState: vi.fn(),
}));
const execute = vi.mocked(executeIsolatedFrameWithState),
  config = { duration: 4, fps: 24, seed: 1 };
afterEach(() => vi.resetAllMocks());
it('stops after the matching committed state and returns only consumed inputs', async () => {
  execute.mockImplementation(async (_, timeline, state) => {
    const host = createScriptTimeline(timeline);
    host.restore(timeline);
    host.advance();
    return { timeline: host.checkpoint(), state: { n: Number(state.n) + 1 }, entryPending: true };
  });
  const session = createScriptSession(
      config,
      [0, 1, 2].map((frame) => ({ frame, source: 'increment' })),
      { n: 0 },
      'entry',
    ),
    initial = session.checkpoint();
  const options = {
    stopWhenState: [{ path: ['n'], equals: 2 }],
    events: [
      { tick: 0, data: { key: 'used' } },
      { tick: 2, data: { key: 'pending' } },
    ],
  };
  const result = await session.runWithPresentation(4, options);
  expect(result.stoppedOnState).toEqual([0]);
  expect(result.checkpoint.state).toEqual({ n: 2 });
  expect(result.checkpoint.timeline.tick).toBe(2);
  expect(result.presentation.map((p) => p.frame)).toEqual([0, 1, 2]);
  expect(result.events).toEqual([options.events[0]]);
  const held = await session.runWithPresentation(3, { stopWhenState: options.stopWhenState });
  expect(held.presentation).toHaveLength(1);
  expect(execute).toHaveBeenCalledTimes(2);
  session.restore(initial);
  expect(await session.runWithPresentation(4, options)).toEqual(result);
  const resumed = await session.runWithPresentation(1);
  expect(resumed.checkpoint.state).toEqual({ n: 3 });
  expect(resumed.stoppedOnState).toEqual([]);
});
it('distinguishes missing, null, types and own array elements without prototype traversal', async () => {
  const session = createScriptSession(config, [], { nested: { value: null }, list: ['x'], n: 0 });
  const stops: ScriptStateStop[] = [
    { path: ['nested', 'value'], equals: null },
    { path: ['missing'], equals: null },
    { path: ['list', '0'], equals: 'x' },
    { path: ['list', 'length'], equals: 1 },
    { path: ['list', '00'], equals: 'x' },
    { path: ['n'], equals: '0' },
    { path: ['n'], equals: -0 },
  ];
  const result = await session.runWithPresentation(3, { stopWhenState: stops });
  expect(result.stoppedOnState).toEqual([0, 2, 6]);
  expect(result.checkpoint.timeline.tick).toBe(0);
});
it('validates original complete predicates and input batches before matching', async () => {
  const session = createScriptSession(config, [], { n: 1 }),
    before = session.checkpoint();
  const invalid = [
    null,
    {},
    Array(1),
    Array(33).fill({ path: ['n'], equals: 1 }),
    [{ path: [], equals: 1 }],
    [{ path: Array(1), equals: 1 }],
    [{ path: ['constructor'], equals: 1 }],
    [{ path: ['n'], equals: NaN }],
    [{ path: ['n'], equals: {} }],
    [{ path: ['n'], equals: 'x'.repeat(1025) }],
    [{ path: ['n'], equals: 1, extra: true }],
  ];
  for (const stops of invalid) {
    await expect(session.run(2, { stopWhenState: stops as ScriptStateStop[] })).rejects.toThrow(
      /state stop/,
    );
    expect(session.checkpoint()).toEqual(before);
  }
  await expect(
    session.run(2, {
      stopWhenState: [{ path: ['n'], equals: 1 }],
      events: [{ tick: 2, data: {} }],
    }),
  ).rejects.toThrow();
  expect(session.checkpoint()).toEqual(before);
});
it('captures predicate paths and values before yielding and retains failure atomicity', async () => {
  let release: () => void = () => {};
  execute.mockImplementation(async (_, timeline) => {
    await new Promise<void>((r) => {
      release = r;
    });
    const host = createScriptTimeline(timeline);
    host.restore(timeline);
    host.advance();
    return { timeline: host.checkpoint(), state: { n: 1 } };
  });
  const session = createScriptSession(config, [{ frame: 0, source: 'increment' }], { n: 0 }),
    stops = [{ path: ['n'], equals: 1 }];
  const pending = session.runWithPresentation(3, { stopWhenState: stops });
  stops[0].path[0] = 'other';
  stops[0].equals = 2;
  release();
  expect((await pending).checkpoint.timeline.tick).toBe(1);
  const failing = createScriptSession(config, [{ frame: 0, source: 'fail' }], { n: 0 }),
    before = failing.checkpoint();
  execute.mockRejectedValue(Error('body failed'));
  await expect(failing.run(3, { stopWhenState: [{ path: ['n'], equals: 2 }] })).rejects.toThrow(
    'body failed',
  );
  expect(failing.checkpoint()).toEqual(before);
});

for (const [comparison, value, target, match] of [
  ['lt', -2, -1, true],
  ['lt', 0, 0, false],
  ['lt', 1, -1, false],
  ['lte', 0, -0, true],
  ['lte', 2, 1, false],
  ['gt', 2, 1, true],
  ['gt', 1, 1, false],
  ['gte', -2, -2, true],
  ['gte', -3, -2, false],
  ['lt', -Number.MAX_VALUE, Number.MAX_VALUE, true],
  ['gt', Number.MAX_VALUE, -Number.MAX_VALUE, true],
  ['lt', 1e100, 1e100 + 1e85, true],
  ['gte', Number.MIN_VALUE, 0, true],
  ['lte', -Number.MIN_VALUE, 0, true],
] as const)
  it(`ordered stop ${comparison} ${value} ${target}`, async () => {
    const session = createScriptSession(config, [], { n: value }),
      before = session.checkpoint();
    const result = await session.runWithPresentation(1, {
      stopWhenState: [{ path: ['n'], comparison, value: target }],
    });
    expect(result.stoppedOnState).toEqual(match ? [0] : []);
    expect(result.checkpoint.timeline.tick).toBe(match ? 0 : 1);
    if (match) expect(result.checkpoint).toEqual(before);
  });
it('numeric predicates never coerce missing/null/string/boolean/aggregate values and preserve any-match indexing', async () => {
  const session = createScriptSession(config, [], {
    nil: null,
    text: '2',
    flag: true,
    list: [3],
    nested: { n: 4 },
    empty: [],
  });
  const stops: ScriptStateStop[] = [
    'missing',
    'nil',
    'text',
    'flag',
    'list',
    'nested',
    'empty',
  ].map((key) => ({ path: [key], comparison: 'gt', value: 0 }));
  stops.push(
    { path: ['list', '00'], comparison: 'gt', value: 0 },
    { path: ['list', 'length'], comparison: 'gte', value: 0 },
    { path: ['nested', 'n'], comparison: 'gte', value: 4 },
    { path: ['list', '0'], comparison: 'lt', value: 4 },
    { path: ['nil'], equals: null },
  );
  expect((await session.runWithPresentation(2, { stopWhenState: stops })).stoppedOnState).toEqual([
    9, 10, 11,
  ]);
});
it('numeric stops capture targets/paths/operators once without invoking custom iterators', async () => {
  let release: () => void = () => {},
    paths = 0,
    values = 0,
    ops = 0;
  execute.mockImplementation(async (_, timeline) => {
    await new Promise<void>((r) => {
      release = r;
    });
    const host = createScriptTimeline(timeline);
    host.restore(timeline);
    host.advance();
    return { timeline: host.checkpoint(), state: { n: 5 } };
  });
  const path = ['n'];
  path[Symbol.iterator] = () => {
    throw Error('path iterator');
  };
  let threshold = 4,
    op: 'gt' | 'lt' = 'gt';
  const condition = {
    get path() {
      paths++;
      return path;
    },
    get comparison() {
      ops++;
      return op;
    },
    get value() {
      values++;
      return threshold;
    },
  };
  const list = [condition];
  list[Symbol.iterator] = () => {
    throw Error('condition iterator');
  };
  const session = createScriptSession(config, [{ frame: 0, source: 'wait' }], { n: 0 });
  const pending = session.runWithPresentation(2, { stopWhenState: list });
  threshold = 99;
  op = 'lt';
  path[0] = 'else';
  release();
  const result = await pending;
  expect(result.stoppedOnState).toEqual([0]);
  expect(result.checkpoint.timeline.tick).toBe(1);
  expect([paths, values, ops]).toEqual([1, 1, 1]);
});
it('numeric stops consume only completed-tick inputs and replay/resume the same checkpoint', async () => {
  execute.mockImplementation(async (_, timeline, state) => {
    const host = createScriptTimeline(timeline);
    host.restore(timeline);
    host.advance();
    return { timeline: host.checkpoint(), state: { n: Number(state.n) + 2 }, entryPending: true };
  });
  const session = createScriptSession(
      config,
      [0, 1, 2].map((frame) => ({ frame, source: 'add' })),
      { n: 0 },
      'entry',
    ),
    initial = session.checkpoint(),
    options = {
      stopWhenState: [
        { path: ['n'], comparison: 'gte' as const, value: 3 },
        { path: ['n'], equals: 4 },
      ],
      events: [
        { tick: 0, data: { key: 'used' } },
        { tick: 2, data: { key: 'unused' } },
      ],
    };
  const result = await session.runWithPresentation(4, options);
  expect(result.checkpoint.state).toEqual({ n: 4 });
  expect(result.stoppedOnState).toEqual([0, 1]);
  expect(result.events).toEqual([options.events[0]]);
  expect(result.presentation.map((p) => p.tick)).toEqual([0, 1, 2]);
  session.restore(initial);
  expect(await session.runWithPresentation(4, options)).toEqual(result);
  expect((await session.run(1)).state).toEqual({ n: 6 });
});
it('validates all numeric conditions and all inputs before an initial matching stop', async () => {
  const session = createScriptSession(config, [], { n: 1 }),
    before = session.checkpoint();
  const invalid = [
    { path: ['n'], comparison: 'bad', value: 1 },
    { path: ['n'], comparison: undefined, value: 1 },
    { path: ['n'], comparison: 'lt', value: NaN },
    { path: ['n'], comparison: 'gte', value: Infinity },
    { path: ['n'], comparison: 'gt', value: '1' },
    { path: ['n'], comparison: 'gt', value: null },
    { path: ['n'], comparison: 'gt' },
    { path: ['n'], comparison: 'gte', value: 0, equals: 1 },
    { path: ['n'], value: 0 },
    { path: ['n'], comparison: 'gte', value: 0, [Symbol('unknown')]: 1 },
  ];
  for (const bad of invalid) {
    await expect(
      session.run(1, { stopWhenState: [{ path: ['n'], equals: 1 }, bad as ScriptStateStop] }),
    ).rejects.toThrow();
    expect(session.checkpoint()).toEqual(before);
  }
  await expect(
    session.run(1, {
      stopWhenState: [{ path: ['n'], comparison: 'gte', value: 0 }],
      events: [{ tick: 1, data: {} }],
    }),
  ).rejects.toThrow();
  expect(session.checkpoint()).toEqual(before);
});
it('admits exactly32 predicates and sixteen path steps while rejecting original over-budget requests', async () => {
  let state: Record<string, unknown> = { n: 1 };
  for (let i = 0; i < 15; i++) state = { next: state };
  const session = createScriptSession(config, [], state as never),
    path = [...Array(15).fill('next'), 'n'],
    condition: ScriptStateStop = { path, comparison: 'gte', value: 1 };
  expect(
    (await session.runWithPresentation(1, { stopWhenState: Array(32).fill(condition) }))
      .stoppedOnState,
  ).toEqual(Array.from({ length: 32 }, (_, i) => i));
  const before = session.checkpoint();
  for (const list of [
    Array(33).fill(condition),
    [{ ...condition, path: [...path, 'extra'] }],
    Array(1),
  ]) {
    await expect(session.run(1, { stopWhenState: list })).rejects.toThrow();
    expect(session.checkpoint()).toEqual(before);
  }
});
it('rejects restore/reentry during original getter reads and remains reusable after preparation failure', async () => {
  const session = createScriptSession(config, [], { n: 1 }),
    before = session.checkpoint();
  const condition = {
    path: ['n'],
    comparison: 'gt' as const,
    get value() {
      session.restore({ ...before, state: { n: 99 } });
      return 0;
    },
  };
  await expect(session.run(2, { stopWhenState: [condition] })).rejects.toThrow(/busy/);
  expect(session.checkpoint()).toEqual(before);
  expect(
    (
      await session.runWithPresentation(1, {
        stopWhenState: [{ path: ['n'], comparison: 'gte', value: 1 }],
      })
    ).checkpoint,
  ).toEqual(before);
});
it('rolls back numeric stop batches on body failure and cancellation', async () => {
  const c = new AbortController(),
    session = createScriptSession(config, [{ frame: 0, source: 'fail' }], { n: 0 }),
    before = session.checkpoint();
  execute.mockRejectedValue(Error('body fail'));
  await expect(
    session.run(2, { stopWhenState: [{ path: ['n'], comparison: 'gte', value: 2 }] }),
  ).rejects.toThrow(/body fail/);
  expect(session.checkpoint()).toEqual(before);
  execute.mockImplementation(async (_, timeline) => {
    c.abort(Error('cancel'));
    return { timeline: { ...timeline, tick: 1 }, state: { n: 3 } };
  });
  await expect(
    session.run(2, {
      signal: c.signal,
      stopWhenState: [{ path: ['n'], comparison: 'gte', value: 2 }],
    }),
  ).rejects.toThrow(/cancel/);
  expect(session.checkpoint()).toEqual(before);
});
