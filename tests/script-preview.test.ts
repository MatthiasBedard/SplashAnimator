import { afterEach, expect, it, vi } from 'vitest';
import { ScriptFrameExecutionError } from '../packages/scripting/src/session';
import { prepareScriptPreview } from '../packages/scripting/src/preview';
import { compileFrameSourceAsync } from '../packages/scripting/src/compile-async';
import { executeIsolatedFrameWithState } from '../packages/scripting/src/isolated-frame';
vi.mock('../packages/scripting/src/compile-async', () => ({ compileFrameSourceAsync: vi.fn() }));
vi.mock('../packages/scripting/src/isolated-frame', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../packages/scripting/src/isolated-frame')>()),
  executeIsolatedFrameWithState: vi.fn(),
}));
const compile = vi.mocked(compileFrameSourceAsync),
  execute = vi.mocked(executeIsolatedFrameWithState);
const config = { duration: 3, fps: 24, seed: 7 };
const good = { body: 'timeline.stop();', sourceMap: '{}', sourceLineOffset: 1, diagnostics: [] };
it('binds a selected breakpoint to captured source and rejects changes before the seek runs',async()=>{
  const sources=[{frame:0,source:'first'},{frame:2,source:'captured third'}];
  let current=true;
  compile.mockResolvedValue(good);
  const preview=(await prepareScriptPreview(config,sources,{},{
    validateSource(){if(!current)throw Error('Saved source changed.');},
  })).preview!;
  const before=preview.checkpoint();
  const breakpoint={frame:2,line:1,onPause:vi.fn()};
  await expect(preview.run(1,{breakpoint})).rejects.toThrow('pending saved frame body');
  sources[1].source='replacement third';
  compile.mockImplementationOnce(async(source)=>{
    expect(source).toBe('captured third');
    current=false;
    return {...good,statementLocations:[{line:1,column:1}]};
  });
  await expect(preview.run(1,{breakpoint:{...breakpoint,seek:true}})).rejects.toThrow('Saved source changed.');
  expect(execute).not.toHaveBeenCalled();
  expect(breakpoint.onPause).not.toHaveBeenCalled();
  current=true;
  expect(preview.checkpoint()).toEqual(before);
  preview.dispose();
});
it('forwards run-to-frame stops and reports the committed boundary without executing its body', async () => {
  compile.mockResolvedValue(good);
  const preview = (await prepareScriptPreview(config, [{ frame: 2, source: 'timeline.stop();' }]))
    .preview!;
  const result = await preview.runWithPresentation(10, { stopAtFrames: [2] });
  expect(result.stoppedAt).toBe(2);
  expect(result.checkpoint.session.timeline).toMatchObject({ frame: 2, tick: 2 });
  expect(result.presentation.map((p) => p.frame)).toEqual([0, 1, 2]);
  expect(execute).not.toHaveBeenCalled();
  preview.dispose();
});
afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('prepares without execution and binds replay to authored source even with identical emitted code', async () => {
  compile.mockResolvedValue(good);
  const state = { n: 1 },
    pending = prepareScriptPreview(config, [{ frame: 0, source: '// first' }], state);
  state.n = 9;
  const a = (await pending).preview!,
    b = (await prepareScriptPreview(config, [{ frame: 0, source: '// second' }])).preview!;
  expect(execute).not.toHaveBeenCalled();
  expect(a.checkpoint().session.state.n).toBe(1);
  expect(() => b.restore(a.checkpoint())).toThrow(/authored source/);
  const saved = a.checkpoint();
  saved.session.state.n = 5;
  expect(a.checkpoint().session.state.n).toBe(1);
  a.restore(saved);
  expect((await a.run(0)).session.state.n).toBe(5);
});
it('rechecks browser-only admission after compilation and before returning a preview', async () => {
  compile.mockImplementationOnce(async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    return good;
  });
  await expect(prepareScriptPreview(config, [{ frame: 0, source: 'timeline.stop();' }]))
    .rejects.toThrow('native application');
  expect(execute).not.toHaveBeenCalled();
});
it('returns diagnostics without a preview and denies native execution', async () => {
  compile.mockResolvedValue({
    ...good,
    body: undefined,
    diagnostics: [{ code: 1, message: 'bad', line: 1, column: 1 }],
  });
  expect(
    (await prepareScriptPreview(config, [{ frame: 2, source: 'bad' }])).preview,
  ).toBeUndefined();
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  await expect(prepareScriptPreview(config, [])).rejects.toThrow(/native/);
  expect(execute).not.toHaveBeenCalled();
});
it('bounds entire batches, rolls back and supports cancellation, disposal and busy guards', async () => {
  vi.useFakeTimers();
  compile.mockResolvedValue(good);
  execute.mockImplementation(
    (_source, _timeline, _state, options) =>
      new Promise((_resolve, reject) =>
        options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason)),
      ),
  );
  const preview = (await prepareScriptPreview(config, [{ frame: 0, source: '' }])).preview!,
    before = preview.checkpoint();
  const pending = preview.run(2, { timeoutMs: 20 }),
    check = expect(pending).rejects.toThrow(/timed out/);
  await expect(preview.run(1)).rejects.toThrow(/busy/);
  expect(() => preview.restore(before)).toThrow(/busy/);
  await vi.advanceTimersByTimeAsync(20);
  await check;
  expect(preview.checkpoint()).toEqual(before);
  const controller = new AbortController(),
    cancelled = preview.run(1, { signal: controller.signal });
  const cancellation = expect(cancelled).rejects.toThrow();
  controller.abort();
  await cancellation;
  expect(preview.checkpoint()).toEqual(before);
  const last = preview.run(1),
    disposed = expect(last).rejects.toThrow(/disposed/);
  preview.dispose();
  await disposed;
  expect(() => preview.checkpoint()).toThrow(/disposed/);
  await expect(preview.run(0)).rejects.toThrow(/disposed/);
  expect(vi.getTimerCount()).toBe(0);
});

it('attributes a later failed entry to its host frame/tick and rolls the entire batch back', async () => {
  compile.mockResolvedValue(good);
  execute
    .mockImplementationOnce(async (_source, timeline, state) => ({
      timeline: { ...timeline, frame: 2, tick: timeline.tick + 1, playing: false },
      state: { ...state, n: 1 },
      entryPending: true,
    }))
    .mockRejectedValueOnce(new Error('later failure'));
  const preview = (
    await prepareScriptPreview(config, [
      { frame: 0, source: 'first' },
      { frame: 2, source: 'second' },
    ])
  ).preview!;
  const before = preview.checkpoint();
  await expect(preview.run(2)).rejects.toMatchObject({
    name: 'ScriptFrameExecutionError',
    frame: 2,
    tick: 1,
    message: 'Frame 3, tick 1: later failure',
  });
  expect(preview.checkpoint()).toEqual(before);
  execute.mockRejectedValueOnce(new Error('retry'));
  await expect(preview.run(1)).rejects.toMatchObject({ frame: 0, tick: 0 });
});
it('bounds execution messages and does not allow message text to replace host attribution', () => {
  const error = new ScriptFrameExecutionError(2, 8, new Error('Frame 900: ' + 'x'.repeat(5000)));
  expect(error.frame).toBe(2);
  expect(error.tick).toBe(8);
  expect(error.message.length).toBeLessThan(2050);
  expect(new ScriptFrameExecutionError(0, 0, { frame: 9, message: 'forged' }).message).toContain(
    'Unknown execution failure',
  );
});

it('publishes exact seek and stopped poses only after success, with bounded detached replay', async () => {
  compile.mockResolvedValue(good);
  execute.mockImplementation(async (_source, timeline, state) => ({
    timeline: { ...timeline, frame: 2, tick: timeline.tick + 1, playing: false },
    state,
    entryPending: timeline.tick === 0,
  }));
  const preview = (await prepareScriptPreview(config, [{ frame: 0, source: 'seek' }])).preview!,
    initial = preview.checkpoint();
  const output = await preview.runWithPresentation(4);
  expect(output.presentation).toEqual([
    { frame: 0, tick: 0, playing: true, entryPending: true },
    { frame: 2, tick: 1, playing: false, entryPending: true },
    { frame: 2, tick: 2, playing: false, entryPending: false },
    { frame: 2, tick: 3, playing: false, entryPending: false },
    { frame: 2, tick: 4, playing: false, entryPending: false },
  ]);
  expect(execute).toHaveBeenCalledTimes(1); // The destination has no authored body.
  preview.restore(initial);
  expect(await preview.runWithPresentation(4)).toEqual(output);
  output.presentation[0].frame = 99;
  expect(preview.checkpoint().session.timeline.frame).toBe(2);
  expect((await preview.runWithPresentation(1000)).presentation).toHaveLength(1001);
  expect((await preview.runWithPresentation(0)).presentation).toHaveLength(1);
  preview.restore(initial);
  execute.mockRejectedValueOnce(new Error('failed trace'));
  await expect(preview.runWithPresentation(2)).rejects.toThrow('failed trace');
  expect(preview.checkpoint()).toEqual(initial);
});

it('resumes completed stopped entries without repeating source and lets explicit input dispatch override', async () => {
  compile.mockResolvedValue(good);
  execute.mockImplementation(async (_source, timeline, state) => ({
    timeline: { ...timeline, tick: timeline.tick + 1, playing: false },
    state: { n: ((state.n as number) || 0) + 1 },
    entryPending: false,
  }));
  const preview = (await prepareScriptPreview(config, [{ frame: 0, source: 'stop' }])).preview!;
  await preview.run(1);
  const stopped = preview.checkpoint();
  const resumed = await preview.runWithPresentation(1, { playback: [{ tick: 1, playing: true }] });
  expect(resumed.checkpoint.session).toMatchObject({
    state: { n: 1 },
    timeline: { frame: 1, playing: true },
    entryPending: true,
  });
  expect(execute).toHaveBeenCalledTimes(1);
  preview.restore(stopped);
  const withInput = await preview.run(1, {
    playback: [{ tick: 1, playing: true }],
    events: [{ tick: 1, data: { go: true } }],
  });
  expect(withInput.session).toMatchObject({
    state: { n: 2 },
    timeline: { frame: 0, playing: false },
  });
  expect(execute).toHaveBeenCalledTimes(2);
  preview.restore(stopped);
  execute.mockRejectedValueOnce(new Error('playback rollback'));
  await expect(
    preview.run(1, { playback: [{ tick: 1, playing: true }], events: [{ tick: 1, data: {} }] }),
  ).rejects.toThrow('playback rollback');
  expect(preview.checkpoint()).toEqual(stopped);
});

it('forwards data-only state stops and returns all matching condition indices', async () => {
  compile.mockResolvedValue(good);
  const preview = (
    await prepareScriptPreview(config, [{ frame: 0, source: 'timeline.stop();' }], { ready: true })
  ).preview!;
  const result = await preview.runWithPresentation(10, {
    stopWhenState: [{ path: ['ready'], equals: true }],
  });
  expect(result.stoppedOnState).toEqual([0]);
  expect(result.checkpoint.session.timeline.tick).toBe(0);
  expect(execute).not.toHaveBeenCalled();
  preview.dispose();
});

it('forwards numeric stop ownership and rejects checkpoint restore from option getters before execution', async () => {
  compile.mockResolvedValue(good);
  const preview = (await prepareScriptPreview(config, [], { n: 4 })).preview!,
    before = preview.checkpoint();
  expect(
    (
      await preview.runWithPresentation(3, {
        stopWhenState: [{ path: ['n'], comparison: 'gte', value: 4 }],
      })
    ).stoppedOnState,
  ).toEqual([0]);
  expect(preview.checkpoint()).toEqual(before);
  await expect(
    preview.run(2, {
      get stopWhenState() {
        preview.restore({ ...before, session: { ...before.session, state: { n: 9 } } });
        return [];
      },
    }),
  ).rejects.toThrow(/busy/);
  expect(preview.checkpoint()).toEqual(before);
  await expect(
    preview.run(2, {
      get timeoutMs() {
        preview.restore(before);
        return 1;
      },
    }),
  ).rejects.toThrow(/busy/);
  expect(preview.checkpoint()).toEqual(before);
  expect(await preview.run(0)).toEqual(before);
  expect(execute).not.toHaveBeenCalled();
});
