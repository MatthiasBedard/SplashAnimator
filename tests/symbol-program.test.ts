import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clone, newProject, type Vector } from '../packages/document/src';
import type { IsolatedSymbolFrameSourceState } from '../packages/document/src/symbol-frame-sources';
import { captureSymbolLocalProgram } from '../packages/scripting/src/symbol-program';
import { prepareScriptPreview } from '../packages/scripting/src/preview';
import { createScriptSession } from '../packages/scripting/src/session';
import { compileFrameSourceAsync } from '../packages/scripting/src/compile-async';
import { executeIsolatedFrameWithState } from '../packages/scripting/src/isolated-frame';
vi.mock('../packages/scripting/src/compile-async', () => ({ compileFrameSourceAsync: vi.fn() }));
vi.mock('../packages/scripting/src/isolated-frame', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../packages/scripting/src/isolated-frame')>()),
  executeIsolatedFrameWithState: vi.fn(),
}));
const compile = vi.mocked(compileFrameSourceAsync),
  execute = vi.mocked(executeIsolatedFrameWithState);
const good = { body: 'compiled', sourceMap: '{}', sourceLineOffset: 1, diagnostics: [] };
function fixture(): IsolatedSymbolFrameSourceState {
  const project = newProject();
  project.fps = 30;
  project.frameScripts = [{ frame: 40, source: 'main-only' }];
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 1,
    y: 2,
    width: 20,
    height: 10,
    rotation: 15,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 1,
    points: [],
  };
  project.symbols = [
    {
      id: 'local',
      name: 'Local',
      width: 40,
      height: 30,
      shapes: [
        art,
        {
          ...art,
          id: 'nested',
          kind: 'symbol',
          symbolId: 'child',
          symbolPlayback: { mode: 'movie', firstFrame: 1 },
        },
      ],
      timeline: {
        duration: 3,
        keys: [{ frame: 2, shapes: [{ ...art, x: 4 }] }],
        frameScripts: [
          { frame: 0, source: 'local-first' },
          { frame: 2, source: 'local-last' },
        ],
      },
    },
    {
      id: 'child',
      name: 'Child',
      width: 20,
      height: 10,
      shapes: [{ ...art, id: 'child-art' }],
      buttonStates: { up: 0, over: 1, down: 1, hit: 0 },
      timeline: {
        duration: 2,
        keys: [],
        frameScripts: [{ frame: 0, source: 'never dispatch child' }],
      },
    },
  ];
  project.assets = [{ id: 'opaque', path: 'assets/opaque.bin' }];
  return {
    project,
    definition: clone(project.symbols[0]),
    revision: 2,
    frame: 1,
    validateEnclosing: () => {},
  };
}
beforeEach(() => {
  compile.mockImplementation(async (source) => ({ ...good, body: 'compiled:' + source }));
  execute.mockImplementation(async (_source, timeline, state, options) => ({
    timeline: {
      ...timeline,
      frame: (timeline.frame + 1) % timeline.duration,
      tick: timeline.tick + 1,
    },
    state: {
      ...state,
      n: Number(state.n ?? 0) + 1,
      ...(options?.input ? { input: options.input } : {}),
    },
    entryPending: true,
  }));
});
afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('owns detached local config/sources and source-free artwork without changing the project/library', () => {
  const source = fixture(),
    before = clone(source.project),
    draft = clone(source.definition),
    owner = captureSymbolLocalProgram(() => source, 7),
    snapshot = owner.snapshot();
  expect(snapshot).toMatchObject({
    scope: 'symbol-local',
    definitionId: 'local',
    selectedFrame: 1,
    config: { duration: 3, fps: 30, seed: 7 },
    sources: source.definition.timeline!.frameScripts,
  });
  expect(JSON.parse(snapshot.namespace)).toMatchObject({
    scope: 'symbol-local',
    projectId: source.project.id,
    definitionId: 'local',
    revision: 2,
  });
  const clean = clone(draft);
  delete clean.timeline!.frameScripts;
  expect(snapshot.artwork.definition).toEqual(clean);
  expect(snapshot.artwork.symbols.every((s) => s.timeline?.frameScripts === undefined)).toBe(true);
  expect(snapshot.artwork.symbols[1].buttonStates).toEqual(source.project.symbols![1].buttonStates);
  snapshot.config.duration = 999;
  snapshot.sources[0].source = 'forged';
  snapshot.artwork.definition.shapes[0].x = 999;
  expect(owner.snapshot().config.duration).toBe(3);
  expect(owner.snapshot().sources[0].source).toBe('local-first');
  expect(source.project).toEqual(before);
  expect(source.definition).toEqual(draft);
  expect(execute).not.toHaveBeenCalled();
  owner.dispose();
});
it('compiles only selected definition bodies and starts standalone entry inspection at local zero', async () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source, 7),
    snapshot = owner.snapshot(),
    preview = (await owner.prepare({ n: 0 })).preview!;
  expect(compile.mock.calls.map((call) => call[0])).toEqual(['local-first', 'local-last']);
  expect(execute).not.toHaveBeenCalled();
  expect(preview.checkpoint().session.timeline).toMatchObject({
    duration: 3,
    fps: 30,
    frame: 0,
    tick: 0,
    seed: 7,
  });
  const output = await preview.runWithPresentation(3);
  expect(output.presentation.map((p) => p.frame)).toEqual([0, 1, 2, 0]);
  expect(output.checkpoint.session.state.n).toBe(2);
  expect(execute.mock.calls.map((call) => call[0])).toEqual([
    'compiled:local-first',
    'compiled:local-last',
  ]);
  expect(JSON.parse(output.checkpoint.session.program).namespace).toBe(snapshot.namespace);
  owner.dispose();
});
it('binds engine-limited local checkpoints to the same owner and execution mode', async () => {
  const source = fixture(), owner = captureSymbolLocalProgram(() => source, 7);
  const bounded = (await owner.prepare({}, { boundedEngine: true })).preview!;
  const ordinary = (await owner.prepare()).preview!;
  const before = bounded.checkpoint();
  const other = ordinary.checkpoint();
  expect(() => bounded.restore(other)).toThrow(/authored source/);
  expect(() => bounded.restore({ ...before, session: other.session })).toThrow(/different script program/);
  await bounded.run(1);
  expect(execute.mock.calls[0][3]).toMatchObject({ boundedEngine: true });
  expect(execute.mock.calls[0][0]).toBe('compiled:local-first');
  owner.dispose();
});
it('does not allow public snapshot mutation or root/nested tables to authorize execution', async () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source),
    snapshot = owner.snapshot();
  snapshot.sources = [{ frame: 0, source: 'forged' }];
  snapshot.namespace = 'main';
  snapshot.definitionId = 'child';
  snapshot.artwork.symbols = [];
  const preview = (await owner.prepare()).preview!;
  await preview.run(1);
  expect(execute.mock.calls[0][0]).toBe('compiled:local-first');
  expect(compile.mock.calls.map((call) => call[0])).not.toContain('main-only');
  owner.dispose();
});
it('rejects main, inner-main, other-capture and reopened checkpoints even when sources/config match', async () => {
  const source = fixture(),
    a = captureSymbolLocalProgram(() => source, 7),
    snapshot = a.snapshot(),
    preview = (await a.prepare()).preview!,
    main = (await prepareScriptPreview(snapshot.config, snapshot.sources)).preview!;
  expect(() => preview.restore(main.checkpoint())).toThrow(/authored source/);
  expect(() => main.restore(preview.checkpoint())).toThrow(/authored source/);
  const forged = preview.checkpoint();
  forged.session = main.checkpoint().session;
  expect(() => preview.restore(forged)).toThrow(/different script program/);
  const b = captureSymbolLocalProgram(() => source, 7),
    other = (await b.prepare()).preview!;
  expect(() => other.restore(preview.checkpoint())).toThrow();
  const saved = preview.checkpoint();
  a.dispose();
  const reopened = captureSymbolLocalProgram(() => source, 7),
    again = (await reopened.prepare()).preview!;
  expect(() => again.restore(saved)).toThrow();
  main.dispose();
  b.dispose();
  reopened.dispose();
});
it('replays detached local checkpoints and preserves exact explicit input and stop boundaries', async () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source, 7),
    preview = (await owner.prepare({ n: 0 })).preview!,
    initial = preview.checkpoint();
  const options = {
    events: [
      { tick: 0, data: { key: 'first' } },
      { tick: 2, data: { key: 'later' } },
    ],
    playback: [{ tick: 1, playing: true }],
    stopAtFrames: [2],
  };
  const result = await preview.runWithPresentation(10, options);
  expect(result.presentation.map((p) => p.frame)).toEqual([0, 1, 2]);
  expect(result.events).toEqual([{ tick: 0, data: { key: 'first' } }]);
  expect(result.playback).toEqual([{ tick: 1, playing: true }]);
  expect(result.stoppedAt).toBe(2);
  preview.restore(initial);
  expect(await preview.runWithPresentation(10, options)).toEqual(result);
  result.presentation[0].frame = 99;
  expect(preview.checkpoint().session.timeline.frame).toBe(2);
  owner.dispose();
});
it('returns local-frame diagnostics without partial programs and preserves source metadata', async () => {
  const source = fixture();
  source.definition.timeline!.frameScripts![0].source = '\uFEFFfirst\r\n';
  compile.mockResolvedValueOnce(good).mockResolvedValueOnce({
    sourceLineOffset: 1,
    diagnostics: [{ code: 1, line: 2, column: 3, message: 'bad local' }],
  });
  const owner = captureSymbolLocalProgram(() => source),
    result = await owner.prepare();
  expect(result.preview).toBeUndefined();
  expect(result.diagnostics).toEqual([
    { frame: 2, code: 1, line: 2, column: 3, message: 'bad local' },
  ]);
  expect(compile.mock.calls[0][0]).toBe('\uFEFFfirst\r\n');
  expect(execute).not.toHaveBeenCalled();
  owner.dispose();
});
it.each(['frame', 'revision', 'definition', 'library', 'root sources', 'fps'])(
  'rejects later %s changes before compiler or execution dispatch',
  async (kind) => {
    const source = fixture(),
      owner = captureSymbolLocalProgram(() => source);
    if (kind === 'frame') source.frame = 2;
    if (kind === 'revision') source.revision++;
    if (kind === 'definition') source.definition.shapes[0].x++;
    if (kind === 'library') source.project.symbols![1].name = 'changed';
    if (kind === 'root sources') source.project.frameScripts![0].source = 'changed';
    if (kind === 'fps') source.project.fps = 60;
    await expect(owner.prepare()).rejects.toThrow(/changed/);
    expect(compile).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    owner.dispose();
  },
);
it('rejects source changes during compilation without returning a stale preview and allows fresh capture', async () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source);
  compile.mockImplementationOnce(async () => {
    source.revision++;
    return good;
  });
  await expect(owner.prepare()).rejects.toThrow(/changed/);
  expect(execute).not.toHaveBeenCalled();
  owner.dispose();
  const fresh = captureSymbolLocalProgram(() => source);
  expect((await fresh.prepare()).preview).toBeDefined();
  fresh.dispose();
});
it('rejects state and execution-input getter source changes before worker dispatch', async () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source);
  const state = {
    get value() {
      source.revision++;
      return 1;
    },
  };
  await expect(owner.prepare(state)).rejects.toThrow(/accessors/);
  expect(source.revision).toBe(2);
  expect(compile).not.toHaveBeenCalled();
  owner.dispose();
  const fresh = captureSymbolLocalProgram(() => source),
    preview = (await fresh.prepare()).preview!,
    before = preview.checkpoint(),
    revision = source.revision;
  await expect(
    preview.run(1, {
      events: [
        {
          tick: 0,
          get data() {
            source.revision++;
            return { value: 1 };
          },
        },
      ],
    }),
  ).rejects.toThrow(/changed/);
  expect(execute).not.toHaveBeenCalled();
  source.revision = revision;
  expect(preview.checkpoint()).toEqual(before);
  fresh.dispose();
});
it('rolls back a completed worker response on final source rejection', async () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source),
    preview = (await owner.prepare({ n: 0 })).preview!,
    before = preview.checkpoint(),
    revision = source.revision;
  execute.mockImplementationOnce(async (_s, timeline, state) => {
    source.revision++;
    return {
      timeline: { ...timeline, tick: 1, frame: 1 },
      state: { ...state, n: 99 },
      entryPending: true,
    };
  });
  await expect(preview.run(1)).rejects.toThrow(/changed/);
  source.revision = revision;
  expect(preview.checkpoint()).toEqual(before);
  owner.dispose();
});
it('rejects restore getter source changes before replacing the checkpoint', async () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source),
    preview = (await owner.prepare()).preview!,
    before = preview.checkpoint(),
    revision = source.revision,
    checkpoint = preview.checkpoint(),
    session = checkpoint.session;
  session.state = { n: 999 };
  Object.defineProperty(checkpoint, 'session', {
    get() {
      source.revision++;
      return session;
    },
  });
  expect(() => preview.restore(checkpoint)).toThrow(/changed/);
  source.revision = revision;
  expect(preview.checkpoint()).toEqual(before);
  owner.dispose();
});
it('preserves checkpoint state on worker failure and invalid complete input batches', async () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source),
    preview = (await owner.prepare()).preview!,
    before = preview.checkpoint();
  execute.mockRejectedValueOnce(Error('local failure'));
  await expect(preview.run(1)).rejects.toThrow('Frame 1, tick 0: local failure');
  expect(preview.checkpoint()).toEqual(before);
  await expect(
    preview.run(2, {
      events: [
        { tick: 1, data: {} },
        { tick: 0, data: {} },
      ],
    }),
  ).rejects.toThrow(/ordered/);
  expect(preview.checkpoint()).toEqual(before);
  owner.dispose();
});
it('owns compilation cancellation, disposal and busy admission without stale output', async () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source);
  compile.mockImplementation(
    (_s, options) =>
      new Promise((_resolve, reject) =>
        options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason)),
      ),
  );
  const pending = owner.prepare();
  await expect(owner.prepare()).rejects.toThrow(/busy/);
  owner.dispose();
  await expect(pending).rejects.toThrow(/disposed/);
  expect(() => owner.snapshot()).toThrow(/disposed/);
  expect(execute).not.toHaveBeenCalled();
});
it('preserves the entry-session deadline and cancellation rollback in the qualified local scope', async () => {
  vi.useFakeTimers();
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source),
    preview = (await owner.prepare()).preview!,
    before = preview.checkpoint();
  execute.mockImplementation(
    (_s, _t, _state, options) =>
      new Promise((_resolve, reject) =>
        options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason)),
      ),
  );
  const pending = preview.run(1, { timeoutMs: 20 }),
    assertion = expect(pending).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(20);
  await assertion;
  expect(preview.checkpoint()).toEqual(before);
  const controller = new AbortController(),
    cancelled = preview.run(1, { signal: controller.signal }),
    check = expect(cancelled).rejects.toThrow();
  controller.abort();
  await check;
  expect(preview.checkpoint()).toEqual(before);
  owner.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
it.each([-1, 0.5, NaN, Infinity, 0x100000000])('rejects raw seed %s before compilation', (seed) => {
  const source = fixture();
  expect(() => captureSymbolLocalProgram(() => source, seed)).toThrow();
  expect(compile).not.toHaveBeenCalled();
});
it('retains native execution denial and existing shared source budgets', async () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source);
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  await expect(owner.prepare()).rejects.toThrow(/native/);
  expect(compile).not.toHaveBeenCalled();
  owner.dispose();
  vi.unstubAllGlobals();
  source.project.frameScripts![0].source = 'x'.repeat(256 * 1024);
  expect(() => captureSymbolLocalProgram(() => source)).toThrow(/budget/);
});
it('keeps exact legacy session identity and enforces scoped identity budget within the existing ceiling', () => {
  const config = { duration: 3, fps: 30, seed: 7 },
    sources = [{ frame: 0, source: 'body' }],
    plain = createScriptSession(config, sources, {}, 'entry');
  expect(plain.checkpoint().program).toBe(
    JSON.stringify({ version: 1, ...config, sources, dispatch: 'entry' }),
  );
  expect(() => createScriptSession(config, sources, {}, 'entry', 'x'.repeat(256 * 1024))).toThrow(
    /256 KiB/,
  );
  const base = new TextEncoder().encode(
    JSON.stringify({ version: 1, ...config, sources: [], dispatch: 'entry', namespace: '' }),
  ).byteLength;
  const room = 256 * 1024 - base,
    namespace = 'é'.repeat(Math.floor(room / 2)) + 'x'.repeat(room % 2);
  const exact = createScriptSession(config, [], {}, 'entry', namespace);
  expect(new TextEncoder().encode(exact.checkpoint().program).byteLength).toBe(256 * 1024);
  expect(() => createScriptSession(config, [], {}, 'entry', namespace + 'x')).toThrow(/256 KiB/);
  for (const namespace of ['', null, 42])
    expect(() => createScriptSession(config, sources, {}, 'entry', namespace as string)).toThrow(
      /namespace/,
    );
});
it.each([undefined, [], [{ frame: 0, source: '' }]])(
  'keeps missing/empty body semantics in standalone inspection %j',
  async (frameScripts) => {
    const source = fixture();
    source.definition.timeline!.frameScripts = frameScripts;
    const owner = captureSymbolLocalProgram(() => source),
      preview = (await owner.prepare()).preview!;
    const output = await preview.runWithPresentation(3);
    expect(output.presentation.map((p) => p.frame)).toEqual([0, 1, 2, 0]);
    expect(execute).toHaveBeenCalledTimes(frameScripts?.length ?? 0);
    owner.dispose();
  },
);
it('rejects asynchronous source admission before compiler dispatch without changing legacy defaults', async () => {
  await expect(
    prepareScriptPreview(
      { duration: 3, fps: 30, seed: 7 },
      [],
      {},
      { namespace: 'explicit-local', validateSource: () => Promise.reject(Error('async guard')) },
    ),
  ).rejects.toThrow(/synchronous/);
  expect(compile).not.toHaveBeenCalled();
});
it('owns external compilation abort and permits a fresh unchanged-source retry', async () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source),
    controller = new AbortController();
  compile.mockImplementationOnce(
    (_s, options) =>
      new Promise((_resolve, reject) =>
        options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason)),
      ),
  );
  const pending = owner.prepare({}, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toThrow();
  compile.mockImplementation(async (source) => ({ ...good, body: 'compiled:' + source }));
  const preview = (await owner.prepare()).preview!;
  expect(preview.checkpoint().session.timeline.tick).toBe(0);
  owner.dispose();
});
