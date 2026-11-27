import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { simplifySymbolArtworkInWorker as run } from '../apps/editor/src/geometry-worker';
import { prepareSymbolSimplifyRequest as prepare } from '../packages/geometry/src/symbol-simplify-request';
import { symbolSimplifyFixture as fixture } from './symbol-simplify-fixture';
import { symbolSimplifyFrameFixture } from './symbol-simplify-frame-fixture';
import { isolatedSymbolSimplifyFixture } from './symbol-simplify-isolated-fixture';
import { captureNewStaticSymbolSimplifyContext } from '../apps/editor/src/new-symbol-simplify-context';
class WorkerStub {
  static instances: WorkerStub[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    WorkerStub.instances.push(this);
  }
}
beforeEach(() => {
  WorkerStub.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('Worker', WorkerStub);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('snapshots original request and detaches a complete admitted background result', async () => {
  const input = fixture(),
    before = structuredClone(input),
    promise = run(input),
    worker = WorkerStub.instances[0];
  const packet = worker.postMessage.mock.calls[0][0] as {
    symbolSimplify: ReturnType<typeof fixture>;
  };
  input.project.symbols![0].name = 'caller changed';
  input.selected = ['other'];
  expect(packet.symbolSimplify).toEqual(before);
  const result = prepare(packet.symbolSimplify);
  worker.onmessage!({ data: { id: 1, result } });
  const out = await promise;
  expect(out).toEqual(result);
  result.removed = 0;
  expect(out.removed).toBeGreaterThan(0);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('posted copies cannot rewrite the private host snapshot', async () => {
  const input = fixture(),
    promise = run(input),
    worker = WorkerStub.instances[0];
  const packet = worker.postMessage.mock.calls[0][0] as {
    symbolSimplify: ReturnType<typeof fixture>;
  };
  packet.symbolSimplify.project.symbols![1].name = 'retarget';
  worker.onmessage!({ data: { id: 1, result: prepare(packet.symbolSimplify) } });
  await expect(promise).rejects.toThrow(/Unrelated/);
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it('rejects invalid originals before launching a worker', async () => {
  const input = fixture();
  input.selected = [];
  await expect(run(input)).rejects.toThrow();
  expect(WorkerStub.instances).toHaveLength(0);
});
it('cancellation before and during work cannot accept a late result', async () => {
  const c = new AbortController();
  c.abort();
  await expect(run(fixture(), c.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(WorkerStub.instances).toHaveLength(0);
  const fresh = new AbortController(),
    input = fixture(),
    promise = run(input, fresh.signal),
    worker = WorkerStub.instances[0],
    late = worker.onmessage!;
  const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  fresh.abort();
  late({ data: { id: 1, result: prepare(input) } });
  await rejected;
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(worker.onmessage).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
it('rejects late invalid counts and preserves source data', async () => {
  const input = fixture(),
    before = structuredClone(input),
    promise = run(input),
    worker = WorkerStub.instances[0],
    result = prepare(input);
  result.removed++;
  worker.onmessage!({ data: { id: 1, result } });
  await expect(promise).rejects.toThrow(/count/);
  expect(input).toEqual(before);
});
it('timeouts and unreadable/error responses terminate and clear their timers', async () => {
  const p = run(fixture()),
    rejected = expect(p).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(15000);
  await rejected;
  const q = run(fixture()),
    bad = expect(q).rejects.toThrow(/could not be read/);
  WorkerStub.instances[1].onmessageerror!();
  await bad;
  const r = run(fixture()),
    failed = expect(r).rejects.toThrow(/failed/);
  WorkerStub.instances[2].onerror!();
  await failed;
  expect(WorkerStub.instances.every((w) => w.terminate.mock.calls.length === 1)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('detaches isolated ancestry before dispatch and admits only its original relative units', async () => {
  const input = isolatedSymbolSimplifyFixture(),
    before = structuredClone(input),
    promise = run(input),
    worker = WorkerStub.instances[0];
  const packet = worker.postMessage.mock.calls[0][0] as { symbolSimplify: typeof input };
  input.ancestry![0] = 'changed';
  input.selected = ['other'];
  expect(packet.symbolSimplify).toEqual(before);
  const result = prepare(packet.symbolSimplify);
  worker.onmessage!({ data: { id: 1, result } });
  const out = await promise;
  expect(out.selected).toEqual(['line', 'partner']);
  expect(out.project.symbols![0].shapes[2]).toStrictEqual(before.project.symbols![0].shapes[2]);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('posted ancestry cannot widen a private isolated host request', async () => {
  const input = isolatedSymbolSimplifyFixture(),
    promise = run(input),
    worker = WorkerStub.instances[0];
  const packet = worker.postMessage.mock.calls[0][0] as { symbolSimplify: typeof input };
  delete packet.symbolSimplify.ancestry;
  worker.onmessage!({ data: { id: 1, result: prepare(packet.symbolSimplify) } });
  await expect(promise).rejects.toThrow(/selection/);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('fits an immutable unpublished candidate while its caller still rejects changed pending source', async () => {
  const input = fixture(),
    definition = { id: 'pending', name: 'New prop', width: 400, height: 240, shapes: [] },
    source = {
      project: input.project,
      definition,
      history: {},
      session: {},
      revision: 0,
      folder: '',
      context: 'new',
      eligible: true,
    },
    context = captureNewStaticSymbolSimplifyContext(
      () => source,
      structuredClone(input.project.symbols![0].shapes),
    ),
    promise = run({ project: context.project, symbolId: 'pending', selected: ['line'] }),
    worker = WorkerStub.instances[0],
    packet = worker.postMessage.mock.calls[0][0] as { symbolSimplify: ReturnType<typeof fixture> };
  source.definition.width++;
  worker.onmessage!({ data: { id: 1, result: prepare(packet.symbolSimplify) } });
  const out = await promise;
  expect(out.project.symbols![2].width).toBe(400);
  expect(out.removed).toBeGreaterThan(100);
  expect(() => context.validate()).toThrow();
  expect(source.project.symbols).toHaveLength(2);
  expect(source.definition.shapes).toEqual([]);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps original frame/ancestry private across the posted copy and caller retargeting', async () => {
  const input = {
      ...symbolSimplifyFrameFixture('reflected', true),
      location: { layerId: 'detail', frame: 6 },
      ancestry: ['outer'],
    },
    before = structuredClone(input),
    promise = run(input),
    worker = WorkerStub.instances[0];
  const packet = worker.postMessage.mock.calls[0][0] as { symbolSimplify: typeof input };
  input.location.frame = 0;
  input.ancestry[0] = 'changed';
  input.project.symbols![0].buttonStates!.over = 0;
  expect(packet.symbolSimplify).toStrictEqual(before);
  const out = prepare(packet.symbolSimplify);
  worker.onmessage!({ data: { id: 1, result: out } });
  expect(await promise).toStrictEqual(out);
  expect(out.selected).toEqual(['line']);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
