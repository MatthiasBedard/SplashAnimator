import { afterEach, expect, it, vi } from 'vitest';
import { createScriptSession, type ScriptStateStop } from '../packages/scripting/src/session';
import {
  createScriptTimeline,
  type ScriptState,
  type ScriptValue,
} from '../packages/scripting/src/timeline';
import { executeIsolatedFrameWithState } from '../packages/scripting/src/isolated-frame';
import { parseScriptStateStop } from '../packages/scripting/src/stop-state';
vi.mock('../packages/scripting/src/isolated-frame', async (original) => ({
  ...(await original<typeof import('../packages/scripting/src/isolated-frame')>()),
  executeIsolatedFrameWithState: vi.fn(),
}));
const execute = vi.mocked(executeIsolatedFrameWithState);
const config = { duration: 4, fps: 24, seed: 1 };
const sources = [0, 1, 2, 3].map((frame) => ({ frame, source: 'body' }));
const changed: ScriptStateStop = { path: ['n'], changed: true };
function output(timeline: Parameters<typeof execute>[1], state: ScriptState) {
  const host = createScriptTimeline(timeline);
  host.restore(timeline);
  host.advance();
  return { timeline: host.checkpoint(), state };
}
afterEach(() => vi.resetAllMocks());
it('stops at the first changed boundary, consumes only prior inputs and rebases on resume', async () => {
  execute.mockImplementation(async (_, timeline, state) => ({
    ...output(timeline, { n: Number(state.n) + 1 }),
    entryPending: true,
  }));
  const session = createScriptSession(config, sources, { n: 0 }, 'entry'),
    initial = session.checkpoint();
  const options = {
    stopWhenState: [changed],
    events: [
      { tick: 0, data: { tag: 'used' } },
      { tick: 1, data: { tag: 'pending' } },
    ],
  };
  const result = await session.runWithPresentation(4, options);
  expect(result.checkpoint.state).toEqual({ n: 1 });
  expect(result.checkpoint.timeline.tick).toBe(1);
  expect(result.stoppedOnState).toEqual([0]);
  expect(result.events).toEqual([options.events[0]]);
  expect(result.presentation.map((v) => v.tick)).toEqual([0, 1]);
  const resumed = await session.runWithPresentation(2, { stopWhenState: [changed] });
  expect(resumed.checkpoint.state).toEqual({ n: 2 });
  expect(resumed.checkpoint.timeline.tick).toBe(2);
  session.restore(initial);
  expect(await session.runWithPresentation(4, options)).toEqual(result);
});
for (const [before, after] of [
  [0, 1],
  [false, true],
  ['a', 'b'],
  [null, 0],
  [1, '1'],
  ['1', null],
  [1, { nested: true }],
  [null, []],
] as [ScriptValue, ScriptValue][])
  it(`detects primitive/presence transition ${JSON.stringify(before)} to ${JSON.stringify(after)}`, async () => {
    execute.mockImplementation(async (_, timeline) => output(timeline, { n: after }));
    const session = createScriptSession(config, sources, { n: before });
    const result = await session.runWithPresentation(4, { stopWhenState: [changed] });
    expect(result.stoppedOnState).toEqual([0]);
    expect(result.checkpoint.timeline.tick).toBe(1);
  });
for (const value of [null, false, 0, -0, 'x'] as const)
  it(`does not stop on an unchanged primitive ${value}`, async () => {
    execute.mockImplementation(async (_, timeline, state) => output(timeline, state));
    const session = createScriptSession(config, sources, { n: value });
    const result = await session.runWithPresentation(3, { stopWhenState: [changed] });
    expect(result.stoppedOnState).toEqual([]);
    expect(result.checkpoint.timeline.tick).toBe(3);
  });
for (const [before, after] of [
  [{}, { n: null }],
  [{ n: null }, {}],
  [{}, { n: { present: true } }],
  [{}, {}],
] as const)
  it(`distinguishes missing paths ${JSON.stringify(before)} to ${JSON.stringify(after)}`, async () => {
    execute.mockImplementation(async (_, timeline) => output(timeline, after));
    const session = createScriptSession(config, sources, before);
    const result = await session.runWithPresentation(2, { stopWhenState: [changed] });
    const matches = Object.hasOwn(before, 'n') !== Object.hasOwn(after, 'n');
    expect(result.stoppedOnState).toEqual(matches ? [0] : []);
    expect(result.checkpoint.timeline.tick).toBe(matches ? 1 : 2);
  });
it('supports own literal and canonical array paths without watching length or inherited keys', async () => {
  execute.mockImplementation(async (_, timeline) => output(timeline, { 'a.b': { 'a/b': [2, 9] } }));
  const session = createScriptSession(config, sources, { 'a.b': { 'a/b': [1] } });
  const result = await session.runWithPresentation(3, {
    stopWhenState: [
      { path: ['a.b', 'a/b', '0'], changed: true },
      { path: ['a.b', 'a/b', '1'], changed: true },
      { path: ['a.b', 'a/b', 'length'], changed: true },
      { path: ['a.b', 'a/b', '00'], changed: true },
    ],
  });
  expect(result.stoppedOnState).toEqual([0, 1]);
});
it('retains mixed any-match semantics and zero-tick initial equality stops', async () => {
  execute.mockImplementation(async (_, timeline) => output(timeline, { n: 1 }));
  const session = createScriptSession(config, sources, { n: 0 });
  expect(
    (await session.runWithPresentation(0, { stopWhenState: [changed] })).stoppedOnState,
  ).toEqual([]);
  const held = await session.runWithPresentation(3, {
    stopWhenState: [changed, { path: ['n'], equals: 0 }],
  });
  expect(held.stoppedOnState).toEqual([1]);
  expect(execute).not.toHaveBeenCalled();
  const result = await session.runWithPresentation(3, {
    stopWhenState: [changed, { path: ['n'], comparison: 'gte', value: 1 }],
  });
  expect(result.stoppedOnState).toEqual([0, 1]);
});
for (const initial of [{ n: {} }, { n: [] }] satisfies ScriptState[])
  it('rejects an initial container atomically, even with zero ticks', async () => {
    const session = createScriptSession(config, sources, initial),
      before = session.checkpoint();
    await expect(session.run(0, { stopWhenState: [changed] })).rejects.toThrow(
      'initial primitive or missing',
    );
    expect(session.checkpoint()).toEqual(before);
    expect(execute).not.toHaveBeenCalled();
  });
it('rejects malformed complete watch lists before any dispatch and permits a fresh retry', async () => {
  const session = createScriptSession(config, sources, { n: 0 }),
    before = session.checkpoint();
  for (const request of [
    { path: ['n'], changed: false },
    { path: ['n'], changed: 1 },
    { path: ['n'], changed: true, equals: 0 },
    { path: ['n'], changed: true, value: 0 },
    { path: ['n'], changed: true, comparison: 'lt' },
    { path: [], changed: true },
    { path: ['constructor'], changed: true },
  ]) {
    await expect(session.run(1, { stopWhenState: [request as ScriptStateStop] })).rejects.toThrow();
    expect(session.checkpoint()).toEqual(before);
  }
  await expect(session.run(1, { stopWhenState: Array(33).fill(changed) })).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
  execute.mockImplementation(async (_, timeline) => output(timeline, { n: 1 }));
  expect(
    (await session.runWithPresentation(1, { stopWhenState: [changed] })).stoppedOnState,
  ).toEqual([0]);
});
it('snapshots path and changed selector before yielding', async () => {
  let release: () => void = () => {};
  execute.mockImplementation(async (_, timeline) => {
    await new Promise<void>((r) => (release = r));
    return output(timeline, { n: 1 });
  });
  const condition = { path: ['n'], changed: true as const };
  let reads = 0;
  Object.defineProperty(condition, 'changed', {
    get() {
      reads++;
      return true;
    },
    enumerable: true,
  });
  const session = createScriptSession(config, sources, { n: 0 });
  const pending = session.runWithPresentation(3, { stopWhenState: [condition] });
  condition.path[0] = 'other';
  release();
  expect((await pending).stoppedOnState).toEqual([0]);
  expect(reads).toBe(1);
});
it('failure and abort preserve the original checkpoint and discard baselines', async () => {
  const session = createScriptSession(config, sources, { n: 0 }),
    before = session.checkpoint();
  execute.mockRejectedValueOnce(Error('body failed'));
  await expect(session.run(3, { stopWhenState: [changed] })).rejects.toThrow('body failed');
  expect(session.checkpoint()).toEqual(before);
  const controller = new AbortController();
  execute.mockImplementation(async (_, timeline) => {
    controller.abort();
    return output(timeline, { n: 1 });
  });
  await expect(
    session.run(3, { stopWhenState: [changed], signal: controller.signal }),
  ).rejects.toThrow();
  expect(session.checkpoint()).toEqual(before);
  execute.mockImplementation(async (_, timeline) => output(timeline, { n: 2 }));
  expect(
    (await session.runWithPresentation(2, { stopWhenState: [changed] })).stoppedOnState,
  ).toEqual([0]);
});
it('parses explicit changed requests without evaluating or requiring a target value', () => {
  expect(parseScriptStateStop('["a.b","0"]', 'not JavaScript()', 'changed')).toEqual({
    path: ['a.b', '0'],
    changed: true,
  });
  expect(() => parseScriptStateStop('["constructor"]', '', 'changed')).toThrow();
  expect(() => parseScriptStateStop('[]', '', 'changed')).toThrow();
  expect(parseScriptStateStop('["n"]', '0')).toEqual({ path: ['n'], equals: 0 });
});

it('admits the exact 32-condition limit and rejects a malformed later request before dispatch', async () => {
  const session = createScriptSession(config, sources, { n: 0 }),
    before = session.checkpoint();
  execute.mockImplementation(async (_, timeline) => output(timeline, { n: 1 }));
  const conditions = Array.from({ length: 32 }, () => ({ path: ['n'], changed: true as const }));
  expect(
    (await session.runWithPresentation(1, { stopWhenState: conditions })).stoppedOnState,
  ).toEqual(Array.from({ length: 32 }, (_, i) => i));
  session.restore(before);
  execute.mockClear();
  Object.defineProperty(conditions[31], 'changed', {
    get() {
      throw Error('late selector');
    },
    enumerable: true,
  });
  await expect(session.run(1, { stopWhenState: conditions })).rejects.toThrow('late selector');
  expect(session.checkpoint()).toEqual(before);
  expect(execute).not.toHaveBeenCalled();
});

it('validates all inputs before an initial watch can dispatch', async () => {
  const session = createScriptSession(config, sources, { n: 0 }),
    before = session.checkpoint();
  await expect(
    session.run(1, { stopWhenState: [changed], events: [{ tick: 1, data: {} }] }),
  ).rejects.toThrow('input tick');
  expect(session.checkpoint()).toEqual(before);
  expect(execute).not.toHaveBeenCalled();
});
