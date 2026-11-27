import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { newProject, clone, symbolLayers, type Vector } from '../packages/document/src';
import type { IsolatedSymbolFrameSourceState } from '../packages/document/src/symbol-frame-sources';
import {
  captureSymbolLocalProgram,
  prepareSymbolProgramArtwork,
} from '../packages/scripting/src/symbol-program';
import { createSymbolScriptArtworkProvider } from '../apps/editor/src/symbol-script-artwork';
import { renderScriptArtwork } from '../apps/editor/src/script-artwork';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
vi.mock('../apps/editor/src/script-artwork', () => ({ renderScriptArtwork: vi.fn() }));
it('getter-driven trajectory growth cannot bypass the original pose budget', () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source);
  const growing = [
    {
      get frame() {
        growing.push({ frame: 0, tick: 1 });
        return 0;
      },
      tick: 0,
    },
  ];
  expect(() => prepareSymbolProgramArtwork(owner, growing)).toThrow(/changed/);
  expect(growing).toHaveLength(2);
  expect(prepareSymbolProgramArtwork(owner, [{ frame: 0, tick: 0 }]).poses).toHaveLength(1);
  owner.dispose();
});
it('rejects recursive trajectory reads and permits a fresh source-valid request', () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source);
  expect(() =>
    prepareSymbolProgramArtwork(owner, [
      {
        get frame() {
          prepareSymbolProgramArtwork(owner, [{ frame: 0, tick: 0 }]);
          return 0;
        },
        tick: 0,
      },
    ]),
  ).toThrow(/reentered/);
  expect(prepareSymbolProgramArtwork(owner, [{ frame: 0, tick: 0 }]).poses).toEqual([
    { frame: 0, tick: 0 },
  ]);
  owner.dispose();
});
it('capture disposal aborts real provider admission during option reads before dispatch', async () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source),
    provider = createSymbolScriptArtworkProvider(owner);
  await expect(
    provider.render([{ frame: 0, tick: 0 }], {
      get timeoutMs() {
        owner.dispose();
        return 100;
      },
    }),
  ).rejects.toThrow(/disposed|closed/);
  expect(render).not.toHaveBeenCalled();
  provider.dispose();
});
const render = vi.mocked(renderScriptArtwork),
  poses = [
    { frame: 0, tick: 0 },
    { frame: 2, tick: 1 },
    { frame: 2, tick: 2 },
  ];
function fixture(): IsolatedSymbolFrameSourceState {
  const project = newProject();
  project.background = '#102030';
  project.fps = 30;
  project.frameScripts = [{ frame: 40, source: 'main must stay inert' }];
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 20,
    y: 10,
    width: 20,
    height: 12,
    rotation: 15,
    transform: [-1, 0.25, 0.5, 1],
    pivot: { x: -20, y: 70 },
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 1,
    points: [],
  };
  project.symbols = [
    {
      id: 'local',
      name: 'Local',
      width: 100.2,
      height: 60.5,
      shapes: [art],
      timeline: {
        duration: 3,
        keys: [{ frame: 2, shapes: [{ ...clone(art), x: 40 }] }],
        frameScripts: [{ frame: 0, source: 'local source' }],
        layers: [
          {
            id: 'extra',
            name: 'Extra',
            visible: true,
            locked: true,
            keys: [
              {
                frame: 0,
                shapes: [
                  {
                    ...clone(art),
                    id: 'nested',
                    kind: 'symbol',
                    symbolId: 'child',
                    symbolPlayback: { mode: 'movie', firstFrame: 1 },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    {
      id: 'child',
      name: 'Child',
      width: 20,
      height: 12,
      shapes: [{ ...clone(art), id: 'child-art' }],
      buttonStates: { up: 0, over: 1, down: 1, hit: 0 },
      timeline: { duration: 2, keys: [], frameScripts: [{ frame: 0, source: 'child source' }] },
    },
  ];
  return {
    project,
    definition: clone(project.symbols[0]),
    revision: 2,
    frame: 1,
    validateEnclosing: () => {},
  };
}
beforeEach(() => {
  render.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
});
afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});
it('prepares source-free complete carriers with exact geometry/registration/options and local trajectory', () => {
  const source = fixture(),
    original = clone(source.project),
    definition = clone(source.definition),
    owner = captureSymbolLocalProgram(() => source),
    result = prepareSymbolProgramArtwork(owner, poses);
  expect(result.project).toMatchObject({
    width: 101,
    height: 61,
    fps: 30,
    duration: 3,
    background: '#102030',
  });
  expect(result.project.layers).toEqual(symbolLayers(definition));
  expect(result.project.frameScripts).toBeUndefined();
  expect(result.project.audioClips).toBeUndefined();
  expect(result.project.opacityBindings).toBeUndefined();
  expect(result.project.symbols!.every((s) => s.timeline?.frameScripts === undefined)).toBe(true);
  expect(result.project.symbols![1].buttonStates).toEqual(source.project.symbols![1].buttonStates);
  expect(result.poses).toEqual(poses);
  for (const point of [
    { x: 0, y: 0 },
    { x: 20, y: 12 },
    { x: -100, y: 70 },
  ])
    expect(mapPoint(matrix(result.project.layers[0].keys[0].shapes[0]), point)).toEqual(
      mapPoint(matrix(definition.shapes[0]), point),
    );
  result.project.layers[0].keys[0].shapes[0].x = 999;
  result.project.symbols![0].shapes[0].x = 888;
  result.poses[1].frame = 1;
  expect(prepareSymbolProgramArtwork(owner, poses).project.layers).toEqual(
    symbolLayers(definition),
  );
  expect(source.project).toEqual(original);
  expect(source.definition).toEqual(definition);
  owner.dispose();
});
it('private source snapshots and copied methods cannot forge image ownership', async () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source),
    data = owner.snapshot();
  data.artwork.definition.shapes[0].x = 999;
  data.artwork.symbols = [];
  for (const fake of [{ ...owner }, Object.create(owner), data, {}]) {
    expect(() => createSymbolScriptArtworkProvider(fake)).toThrow(/qualified/);
    expect(() => prepareSymbolProgramArtwork(fake, poses)).toThrow(/qualified/);
  }
  const provider = createSymbolScriptArtworkProvider(owner),
    metadata = provider.metadata();
  metadata.width = 999;
  await provider.render(poses);
  expect(render.mock.calls[0][0].layers).toEqual(symbolLayers(source.definition));
  expect(provider.metadata().width).toBe(101);
  provider.dispose();
  owner.dispose();
});
it.each([
  [],
  [{ frame: 1, tick: 0 }],
  [{ frame: 0, tick: 1 }],
  [
    { frame: 0, tick: 0 },
    { frame: 2, tick: 2 },
  ],
  [
    { frame: 0, tick: 0 },
    { frame: 3, tick: 1 },
  ],
  [{ frame: NaN, tick: 0 }],
  [{ frame: 0, tick: Infinity }],
  [{ frame: 0.5, tick: 0 }],
  Array(2),
])('rejects malformed original trajectories %j without consuming valid state', (input) => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source);
  expect(() => prepareSymbolProgramArtwork(owner, input)).toThrow();
  expect(prepareSymbolProgramArtwork(owner, poses).poses).toEqual(poses);
  owner.dispose();
});
it('rejects visual button states and enforces existing complete-trajectory capacity', () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source);
  expect(() =>
    prepareSymbolProgramArtwork(owner, [
      {
        frame: 0,
        tick: 0,
        // @ts-expect-error Raw visual-state requests must reject at runtime.
        buttonState: { instanceId: 'nested', symbolId: 'child', lifetime: 1, state: 'down' },
      },
    ]),
  ).toThrow(/Up/);
  const exact = Array.from({ length: 10001 }, (_, tick) => ({ frame: tick % 3, tick }));
  expect(prepareSymbolProgramArtwork(owner, exact).poses).toHaveLength(10001);
  expect(() => prepareSymbolProgramArtwork(owner, [...exact, { frame: 2, tick: 10001 }])).toThrow(
    /10001/,
  );
  owner.dispose();
});
it('snapshots finite target/viewport getters once and rejects actual source mutations after their reads', () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source);
  let f = 0,
    t = 0,
    w = 0,
    h = 0;
  const result = prepareSymbolProgramArtwork(
    owner,
    [
      {
        get frame() {
          f++;
          return 0;
        },
        get tick() {
          t++;
          return 0;
        },
      },
    ],
    {
      get width() {
        w++;
        return 200;
      },
      get height() {
        h++;
        return 100;
      },
    },
  );
  expect([f, t, w, h]).toEqual([1, 1, 1, 1]);
  expect(result.project.width).toBe(200);
  expect(() =>
    prepareSymbolProgramArtwork(owner, [
      {
        get frame() {
          source.revision++;
          return 0;
        },
        tick: 0,
      },
    ]),
  ).toThrow(/changed/);
  owner.dispose();
});
it.each([
  { width: NaN, height: 100 },
  { width: 100, height: Infinity },
  { width: 0, height: 100 },
  { width: 1.5, height: 100 },
  { width: 8193, height: 100 },
])('retains original viewport values and existing stage/raster rejection %j', (view) => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source);
  expect(() => prepareSymbolProgramArtwork(owner, poses, view)).toThrow();
  expect(
    prepareSymbolProgramArtwork(owner, poses, { width: 200, height: 100 }).project.layers,
  ).toEqual(symbolLayers(source.definition));
  owner.dispose();
});
it('requires explicit positive viewports for zero bounds and never clamps wide artwork', () => {
  const source = fixture();
  source.definition.width = 0;
  source.definition.height = 0;
  source.definition.shapes[0].x = 10000;
  const owner = captureSymbolLocalProgram(() => source);
  expect(() => prepareSymbolProgramArtwork(owner, poses)).toThrow(/dimensions/);
  const result = prepareSymbolProgramArtwork(owner, poses, { width: 500, height: 300 });
  expect(result.project.layers[0].keys[0].shapes[0].x).toBe(10000);
  expect(result.project.symbols![0].width).toBe(0);
  owner.dispose();
});
it('renders only freshly prepared private source-free data and emits no hit/activation controls', async () => {
  const source = fixture(),
    before = clone(source.project),
    owner = captureSymbolLocalProgram(() => source),
    provider = createSymbolScriptArtworkProvider(owner);
  expect(Object.keys(provider)).toEqual(['metadata', 'render', 'dispose']);
  expect(render).not.toHaveBeenCalled();
  const output = await provider.render(poses);
  expect(output.type).toBe('image/png');
  expect(render.mock.calls[0][0].frameScripts).toBeUndefined();
  expect(
    render.mock.calls[0][0].symbols!.every((s) => s.timeline?.frameScripts === undefined),
  ).toBe(true);
  expect(render.mock.calls[0][1]).toEqual(poses);
  expect(source.project).toEqual(before);
  provider.dispose();
  owner.dispose();
});
it.each(['source', 'candidate', 'output'])(
  'rejects late %s changes atomically and permits source-valid retry',
  async (kind) => {
    const source = fixture(),
      owner = captureSymbolLocalProgram(() => source),
      provider = createSymbolScriptArtworkProvider(owner);
    render.mockImplementationOnce(async (project) => {
      if (kind === 'source') source.revision++;
      if (kind === 'candidate') project.layers[0].keys[0].shapes[0].x++;
      return new Blob(['bad'], { type: kind === 'output' ? 'text/plain' : 'image/png' });
    });
    await expect(provider.render(poses)).rejects.toThrow();
    if (kind === 'source') source.revision = 2;
    expect((await provider.render(poses)).type).toBe('image/png');
    provider.dispose();
    owner.dispose();
  },
);
it('owns busy, external cancellation, whole-job deadline and capture disposal cleanup', async () => {
  vi.useFakeTimers();
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source),
    provider = createSymbolScriptArtworkProvider(owner);
  render.mockImplementation(
    (_project, _poses, signal) =>
      new Promise((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(signal!.reason)),
      ),
  );
  const pending = provider.render(poses, { timeoutMs: 20 }),
    timeout = expect(pending).rejects.toThrow(/timed out/);
  await expect(provider.render(poses)).rejects.toThrow(/busy/);
  await vi.advanceTimersByTimeAsync(20);
  await timeout;
  const controller = new AbortController(),
    cancelled = provider.render(poses, { signal: controller.signal }),
    check = expect(cancelled).rejects.toThrow();
  controller.abort();
  await check;
  const last = provider.render(poses),
    disposed = expect(last).rejects.toThrow(/closed/);
  owner.dispose();
  await disposed;
  expect(() => provider.metadata()).toThrow(/disposed/);
  expect(vi.getTimerCount()).toBe(0);
  provider.dispose();
});
it('rejects pre-aborts and invalid deadlines without creating artwork jobs', async () => {
  const source = fixture(),
    owner = captureSymbolLocalProgram(() => source),
    provider = createSymbolScriptArtworkProvider(owner);
  await expect(provider.render(poses, { signal: AbortSignal.abort() })).rejects.toThrow();
  for (const timeoutMs of [0, 0.5, Infinity, 60001])
    await expect(provider.render(poses, { timeoutMs })).rejects.toThrow(/deadline/);
  expect(render).not.toHaveBeenCalled();
  provider.dispose();
  owner.dispose();
});
