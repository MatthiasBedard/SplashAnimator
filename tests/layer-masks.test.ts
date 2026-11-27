import { expect, it, vi, afterEach } from 'vitest';
import { newProject, newLayer, validateProject, migrateProject } from '../packages/document/src';
import { captureLayerMasks, maskPaintChains, type LayerMask } from '../packages/document/src/layer-masks';
const render = vi.hoisted(() => vi.fn());
vi.mock('../apps/editor/src/export-png', () => ({ exportPNGFrame: render }));
import {
  exportMaskedPNGFrame,
  maskedCaptureDimensions,
} from '../apps/editor/src/export-masked-png';
function fixture() {
  const p = newProject();
  p.layers = Array.from({ length: 6 }, (_, i) => ({ ...newLayer('Layer ' + i), id: 'l' + i }));
  return p;
}
const plan = [
  { maskLayerId: 'l2', layerIds: ['l0', 'l1'] },
  { maskLayerId: 'l5', layerIds: ['l4'] },
];
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  render.mockReset();
});
it('captures detached original root identities in original stack order without mutating schema53', () => {
  const p = fixture(),
    before = structuredClone(p),
    request = structuredClone(plan),
    result = captureLayerMasks(p.layers, request);
  request[0].layerIds[0] = 'forged';
  expect(result).toEqual(plan);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result[0].layerIds)).toBe(true);
  expect(p).toEqual(before);
  validateProject(p);
  expect(migrateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  expect(captureLayerMasks(p.layers, JSON.parse(JSON.stringify(result)))).toEqual(result);
});
it('composes the inner group before adding siblings regardless of saved binding order', () => {
  const p = fixture();
  const outer = { maskLayerId:'l4', layerIds:['l2','l3'] }, inner = { maskLayerId:'l2', layerIds:['l0','l1'] };
  for (const order of [[inner,outer],[outer,inner]]) {
    const admitted = captureLayerMasks(p.layers,order);
    expect([...maskPaintChains(admitted).chains.entries()]).toEqual([['l4',[
      {source:'l2',members:['l0','l1']},{source:'l4',members:['l3']},
    ]]]);
  }
});
for (const invalid of [
  null,
  {},
  [{ maskLayerId: 'missing', layerIds: ['l0'] }],
  [{ maskLayerId: 'l0', layerIds: ['l0'] }],
  [{ maskLayerId: 'l1', layerIds: [] }],
  [{ maskLayerId: 'l2', layerIds: ['l1', 'l0'] }],
  [{ maskLayerId: 'l2', layerIds: ['l0'] }],
  [{ maskLayerId: 'l2', layerIds: ['l1', 'l1'] }],
  [...plan, plan[0]],
  [{ maskLayerId:'l2', layerIds:['l1'] }, { maskLayerId:'l1', layerIds:['l2'] }],
  [
    { maskLayerId: 'l1', layerIds: ['l0'] },
    { maskLayerId: 'l2', layerIds: ['l0', 'l1'] },
  ],
  [{ maskLayerId: 'l2', layerIds: ['l0', 'l1'], mode: 'luma' }],
] as unknown[])
  it('rejects malformed/noncontiguous/self/overlapping mask ' + JSON.stringify(invalid), () => {
    const p = fixture(),
      before = structuredClone(p);
    expect(() => captureLayerMasks(p.layers, invalid as LayerMask[])).toThrow();
    expect(p).toEqual(before);
  });
it('rejects cross-folder ownership and duplicate source layer identities', () => {
  const p = fixture();
  p.layers[1].folderId = 'folder';
  expect(() => captureLayerMasks(p.layers, plan)).toThrow(/folder/);
  delete p.layers[1].folderId;
  p.layers[5].id = 'l2';
  expect(() => captureLayerMasks(p.layers, plan)).toThrow(/unique/);
});
it('snapshots request getters once without caller iterators', () => {
  const p = fixture();
  let reads = 0;
  const targets = ['l0', 'l1'];
  targets[Symbol.iterator] = () => {
    throw Error('caller iterator');
  };
  const request = [
    {
      get maskLayerId() {
        reads++;
        return 'l2';
      },
      get layerIds() {
        reads++;
        return targets;
      },
    },
  ];
  request[Symbol.iterator] = () => {
    throw Error('caller iterator');
  };
  expect(captureLayerMasks(p.layers, request)).toEqual([plan[0]]);
  expect(reads).toBe(2);
});
for (const change of ['grow', 'identity', 'folder', 'replace'] as const)
  it('rejects request-time ' + change + ' without source writes', () => {
    const p = fixture(),
      targets = ['l0', 'l1'];
    Object.defineProperty(targets, 0, {
      get() {
        if (change === 'grow') targets.push('l3');
        if (change === 'identity') p.layers[0].id = 'external';
        if (change === 'folder') p.layers[0].folderId = 'outside';
        if (change === 'replace') p.layers[0] = { ...p.layers[0] };
        return 'l0';
      },
    });
    expect(() => captureLayerMasks(p.layers, [{ maskLayerId: 'l2', layerIds: targets }])).toThrow();
  });
it('original layer accessors are rejected without invocation', () => {
  const p = fixture();
  let reads = 0;
  Object.defineProperty(p.layers[1], 'id', {
    get() {
      reads++;
      return 'l1';
    },
  });
  expect(() => captureLayerMasks(p.layers, plan)).toThrow(/data/);
  expect(reads).toBe(0);
});
it('empty mask output delegates to the exact existing detached PNG path', async () => {
  const p = fixture(),
    before = structuredClone(p),
    blob = new Blob(['exact legacy bytes']);
  render.mockResolvedValue(blob);
  expect(await exportMaskedPNGFrame(p, 0, [], { transparent: true, scale: 2 })).toBe(blob);
  expect(render).toHaveBeenCalledOnce();
  expect(render.mock.calls[0][0]).toEqual(p);
  expect(render.mock.calls[0][0]).not.toBe(p);
  expect(render.mock.calls[0].slice(3)).toEqual([true, 2]);
  expect(p).toEqual(before);
});
for (const kind of [
  'frame',
  'nonfinite',
  'callback',
  'async',
  'signal',
  'scale',
  'deadline',
  'unknown',
] as const)
  it('rejects original ' + kind + ' before rendering', async () => {
    const p = fixture(),
      options: Record<string, unknown> = {};
    if (kind === 'nonfinite') p.layers[0].keys[0].shapes.push({ x: NaN } as never);
    if (kind === 'callback')
      options.validate = () => {
        p.name = 'outside';
      };
    if (kind === 'async') options.validate = () => Promise.resolve();
    if (kind === 'signal') options.signal = {};
    if (kind === 'scale') options.scale = Infinity;
    if (kind === 'deadline') options.timeoutMs = 60001;
    if (kind === 'unknown') options.infer = true;
    await expect(
      exportMaskedPNGFrame(p, kind === 'frame' ? 0.5 : 0, plan, options),
    ).rejects.toThrow();
    expect(render).not.toHaveBeenCalled();
  });
it('mask target getter source mutation rejects before raster allocation', async () => {
  const p = fixture();
  await expect(
    exportMaskedPNGFrame(p, 0, [
      {
        get maskLayerId() {
          p.name = 'external';
          return 'l2';
        },
        layerIds: ['l0', 'l1'],
      },
    ]),
  ).rejects.toThrow(/changed/);
  expect(p.name).toBe('external');
  expect(render).not.toHaveBeenCalled();
});
it('clone-time tampering rejects before rendering without changing original artwork', async () => {
  const p = fixture(),
    before = structuredClone(p),
    clone = structuredClone;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
    const copy = clone(value) as typeof p;
    copy.background = '#00ff00';
    return copy;
  }) as typeof structuredClone);
  await expect(exportMaskedPNGFrame(p, 0, plan)).rejects.toThrow(/cloning/);
  expect(p).toEqual(before);
  expect(render).not.toHaveBeenCalled();
});
it('late source edits and explicit revision callbacks cannot publish a completed stale PNG', async () => {
  const p = fixture();
  render.mockImplementation(async () => {
    p.name = 'outside';
    return new Blob(['png']);
  });
  await expect(exportMaskedPNGFrame(p, 0, [])).rejects.toThrow(/changed/);
  expect(p.name).toBe('outside');
});
it('abort/deadline wins even if a renderer ignores cancellation, and the owner permits retry', async () => {
  vi.useFakeTimers();
  const p = fixture(),
    controller = new AbortController();
  render.mockImplementation(() => new Promise(() => {}));
  const capture = exportMaskedPNGFrame(p, 0, [], { signal: controller.signal });
  const failure = expect(capture).rejects.toThrow('stop');
  controller.abort(Error('stop'));
  await failure;
  const timed = exportMaskedPNGFrame(p, 0, [], { timeoutMs: 10 }),
    rejection = expect(timed).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(10);
  await rejection;
  render.mockResolvedValue(new Blob(['retry']));
  expect(await exportMaskedPNGFrame(p, 0, [])).toBeInstanceOf(Blob);
});
it('swallowed same-source async reentry invalidates the outer request and can retry freshly', async () => {
  const p = fixture();
  let nested: Promise<unknown> | undefined;
  const request = {
    get maskLayerId() {
      nested = exportMaskedPNGFrame(p, 0, []).catch(() => {});
      return 'l2';
    },
    layerIds: ['l0', 'l1'],
  };
  await expect(exportMaskedPNGFrame(p, 0, [request])).rejects.toThrow(/changed/);
  await nested;
  render.mockResolvedValue(new Blob());
  await expect(exportMaskedPNGFrame(p, 0, [])).resolves.toBeInstanceOf(Blob);
});

it('mask working rasters share the existing pixel budget without altering the legacy empty-plan limit', () => {
  expect(maskedCaptureDimensions(4096, 4096, 1, true)).toEqual({ width: 4096, height: 4096 });
  expect(() => maskedCaptureDimensions(4097, 4096, 1, true)).toThrow(/working rasters/);
  expect(maskedCaptureDimensions(8192, 8192, 1, false)).toEqual({ width: 8192, height: 8192 });
  for (const scale of [0, NaN, Infinity, -1])
    expect(() => maskedCaptureDimensions(10, 10, scale, true)).toThrow();
});
it('explicit source revision validation and callback/options capture reject restored external state', async () => {
  const p = fixture();
  let revision = 0,
    reads = 0;
  render.mockImplementation(async () => {
    revision++;
    revision++;
    return new Blob();
  });
  await expect(
    exportMaskedPNGFrame(p, 0, [], {
      get validate() {
        reads++;
        return () => {
          if (revision) throw Error('revision changed');
        };
      },
    }),
  ).rejects.toThrow(/revision/);
  expect(reads).toBe(1);
});

it('invalid cancellation signals release original ownership and permit a fresh request', async () => {
  const p = fixture();
  await expect(exportMaskedPNGFrame(p, 0, [], { signal: {} as AbortSignal })).rejects.toThrow(
    /Invalid mask abort signal/,
  );
  render.mockResolvedValue(new Blob(['retry']));
  await expect(exportMaskedPNGFrame(p, 0, [])).resolves.toBeInstanceOf(Blob);
});
it('native cancellation ignores shadowed host signal methods and properties', async () => {
  const p = fixture(),
    controller = new AbortController();
  Object.defineProperties(controller.signal, {
    addEventListener: {
      value() {
        throw Error('shadowed add');
      },
    },
    removeEventListener: {
      get() {
        throw Error('shadowed remove');
      },
    },
    reason: {
      get() {
        throw Error('shadowed reason');
      },
    },
    aborted: {
      get() {
        throw Error('shadowed state');
      },
    },
  });
  render.mockImplementation(() => new Promise(() => {}));
  const capture = exportMaskedPNGFrame(p, 0, [], { signal: controller.signal });
  const rejection = expect(capture).rejects.toThrow('native abort');
  controller.abort(Error('native abort'));
  await rejection;
  render.mockResolvedValue(new Blob());
  await expect(exportMaskedPNGFrame(p, 0, [])).resolves.toBeInstanceOf(Blob);
});

it('elapsed synchronous validation cannot bypass the whole-job deadline before timers dispatch', async () => {
  const p = fixture();
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  await expect(
    exportMaskedPNGFrame(p, 0, [], {
      timeoutMs: 10,
      validate: () => {
        now = 20;
      },
    }),
  ).rejects.toThrow(/timed out/);
  expect(render).not.toHaveBeenCalled();
});

for (const kind of [
  'shrinking-request',
  'shrinking-targets',
  'negative-request',
  'negative-targets',
] as const)
  it('never silently drops masks or targets from ' + kind + ' length reads', () => {
    const p = fixture();
    let reads = 0;
    const request =
      kind === 'shrinking-request'
        ? new Proxy(plan, {
            get(target, key, receiver) {
              if (key === 'length') return ++reads === 1 ? 2 : 1;
              return Reflect.get(target, key, receiver);
            },
          })
        : kind === 'negative-request'
          ? new Proxy(plan, {
              get(target, key, receiver) {
                return key === 'length' ? -1 : Reflect.get(target, key, receiver);
              },
            })
          : [
              {
                maskLayerId: 'l2',
                layerIds: new Proxy(['l1'], {
                  get(target, key, receiver) {
                    if (key === 'length')
                      return kind === 'negative-targets' ? -1 : ++reads < 3 ? 2 : 1;
                    return Reflect.get(target, key, receiver);
                  },
                }),
              },
            ];
    expect(() => captureLayerMasks(p.layers, request)).toThrow();
  });
