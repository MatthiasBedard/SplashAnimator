import { selectionTrajectoryStamp } from '../packages/animation/src/selection-trajectory';
import { it, expect, vi, afterEach } from 'vitest';
import { newProject, newLayer, type Vector } from '../packages/document/src';
import { evaluateLayers } from '../packages/animation/src';
import {
  prepareLayerScene,
  disposeLayerScene,
  layerSceneMatchesSource,
} from '../packages/animation/src/layer-scene';
import {
  createMaskResourceBank,
  acquireMaskResourceLease,
} from '../packages/stage/src/mask-resources';
import { prepareMaskedLayerPainter } from '../packages/stage/src/masked-layers';
import { MASK_WORKING_PIXELS } from '../packages/stage/src/mask-budget';
class Fonts extends EventTarget {
  status = 'loaded';
  ready = Promise.resolve(this);
  load = vi.fn(async (_css: string, _text: string) => [] as FontFace[]);
  *[Symbol.iterator](): Generator<FontFace> {
    /* Empty native-face stand-in. */
  }
}
class Bitmap {
  width = 2;
  height = 2;
  close = vi.fn(() => {
    this.width = this.height = 0;
  });
}
function mock() {
  const fonts = new Fonts(),
    decode = vi.fn(async () => new Bitmap());
  vi.stubGlobal('document', { fonts });
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      decode = async () => {};
    },
  );
  vi.stubGlobal('createImageBitmap', decode);
  return { fonts, decode };
}
const rect = (id: string): Vector => ({
  id,
  kind: 'rectangle',
  x: 0,
  y: 0,
  width: 2,
  height: 2,
  rotation: 0,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
function fixture(text = false) {
  const p = newProject();
  p.width = 20;
  p.height = 20;
  p.duration = 2;
  const header = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
  header.write('IHDR', 12);
  header.writeUInt32BE(2, 16);
  header.writeUInt32BE(2, 20);
  p.assets = [
    {
      id: 'image',
      path: 'assets/bitmaps/image.json',
      bitmap: {
        name: 'Image',
        width: 2,
        height: 2,
        dataUrl: 'data:image/png;base64,' + header.toString('base64'),
      },
    },
  ];
  const shape = { ...rect('paint'), bitmap: { assetId: 'image', x: 0, y: 0, width: 2, height: 2 } };
  p.layers = [
    { ...newLayer('Target'), id: 'target', keys: [{ frame: 0, shapes: [shape] }] },
    { ...newLayer('Mask'), id: 'mask', keys: [{ frame: 0, shapes: [rect('mask')] }] },
  ];
  if (text) {
    p.layers[0].keys[0].shapes.push({
      ...rect('text'),
      kind: 'text',
      text: {
        content: 'AB',
        font: 'sans-serif',
        size: 12,
        bold: false,
        italic: false,
        align: 'left',
      },
    });
    p.layers[0].keys.push({ frame: 1, shapes: structuredClone(p.layers[0].keys[0].shapes) });
    p.layers[0].keys[1].shapes[1].text!.content = 'BA';
  }
  return p;
}
const masks = [{ maskLayerId: 'mask', layerIds: ['target'] }];
const scene = (p: ReturnType<typeof fixture>, frame = 0) =>
  prepareLayerScene(p, frame, masks, evaluateLayers);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('uses branded scene/source compatibility and rejects copied resource handles', async () => {
  mock();
  const p = fixture(),
    s = scene(p),
    bank = createMaskResourceBank(p);
  expect(layerSceneMatchesSource(s, selectionTrajectoryStamp(p))).toBe(true);
  const copy = scene(structuredClone(p));
  expect(layerSceneMatchesSource(copy, selectionTrajectoryStamp(p))).toBe(true);
  disposeLayerScene(copy);
  expect(() => layerSceneMatchesSource({ ...s }, selectionTrajectoryStamp(p))).toThrow('stale');
  expect(() => acquireMaskResourceLease({ ...bank }, s, new AbortController().signal)).toThrow(
    'original',
  );
  const other = structuredClone(p);
  other.name = 'Other';
  await expect(
    acquireMaskResourceLease(bank, scene(other), new AbortController().signal),
  ).rejects.toThrow('different');
  expect(bank.stats().leases).toBe(0);
  bank.dispose();
  disposeLayerScene(s);
});
it('deduplicates decoded images across different frame leases and retains them until bank disposal', async () => {
  const { decode } = mock(),
    p = fixture(),
    a = scene(p),
    b = scene(p, 1),
    bank = createMaskResourceBank(p);
  const first = await acquireMaskResourceLease(bank, a, new AbortController().signal),
    second = await acquireMaskResourceLease(bank, b, new AbortController().signal),
    image = first.images.get('image')! as unknown as Bitmap;
  expect(decode).toHaveBeenCalledTimes(1);
  expect(second.images.get('image')).toBe(image);
  expect(bank.stats()).toMatchObject({ decodedPixels: 4, rasterPixels: 8, ready: 1, leases: 2 });
  first.release();
  second.check();
  expect(image.close).not.toHaveBeenCalled();
  second.release();
  expect(bank.stats()).toMatchObject({ decodedPixels: 4, rasterPixels: 0, ready: 1, leases: 0 });
  bank.dispose();
  expect(image.close).toHaveBeenCalledTimes(1);
  bank.dispose();
  expect(image.close).toHaveBeenCalledTimes(1);
  disposeLayerScene(a);
  disposeLayerScene(b);
});
it('shares exact raster/decoded boundaries across leases with peak reservations until release', async () => {
  mock();
  const p = fixture(),
    s = scene(p),
    bank = createMaskResourceBank(p),
    a = await acquireMaskResourceLease(bank, s, new AbortController().signal),
    b = await acquireMaskResourceLease(bank, s, new AbortController().signal);
  a.admit(4096, 4095);
  b.admit(63, 65);
  expect(bank.stats().decodedPixels + bank.stats().rasterPixels).toBe(MASK_WORKING_PIXELS);
  expect(() => b.admit(64, 64)).toThrow('budget');
  expect(bank.stats().decodedPixels + bank.stats().rasterPixels).toBe(MASK_WORKING_PIXELS);
  a.admit(1, 1);
  expect(bank.stats().decodedPixels + bank.stats().rasterPixels).toBe(MASK_WORKING_PIXELS);
  a.release();
  b.admit(64, 64);
  expect(bank.stats().rasterPixels).toBe(16384);
  b.release();
  bank.dispose();
  disposeLayerScene(s);
});
it('caches equivalent font character sets and reloads after font-set changes', async () => {
  const { fonts } = mock(),
    p = fixture(true),
    bank = createMaskResourceBank(p),
    a = scene(p),
    b = scene(p, 1);
  (await acquireMaskResourceLease(bank, a, new AbortController().signal)).release();
  (await acquireMaskResourceLease(bank, b, new AbortController().signal)).release();
  expect(fonts.load).toHaveBeenCalledTimes(1);
  expect(fonts.load).toHaveBeenCalledWith('12px sans-serif', 'AB');
  fonts.dispatchEvent(new Event('loading'));
  (await acquireMaskResourceLease(bank, b, new AbortController().signal)).release();
  expect(fonts.load).toHaveBeenCalledTimes(2);
  bank.dispose();
  disposeLayerScene(a);
  disposeLayerScene(b);
});
it('a cancelled font waiter does not poison a shared pending request or a valid cache', async () => {
  const { fonts } = mock();
  let done!: (value: FontFace[]) => void;
  fonts.load.mockImplementation(
    () =>
      new Promise((r) => {
        done = r;
      }),
  );
  const p = fixture(true),
    s = scene(p),
    bank = createMaskResourceBank(p),
    abort = new AbortController();
  const a = acquireMaskResourceLease(bank, s, abort.signal).catch((e) => e),
    b = acquireMaskResourceLease(bank, s, new AbortController().signal);
  abort.abort(Error('Cancel first'));
  expect((await a).message).toBe('Cancel first');
  expect(bank.stats().leases).toBe(1);
  done([]);
  const lease = await b;
  expect(fonts.load).toHaveBeenCalledTimes(1);
  lease.release();
  bank.dispose();
  disposeLayerScene(s);
});
for (const action of ['cancel', 'dispose', 'source'])
  it(`owns pending bitmap completion across ${action}`, async () => {
    const { decode } = mock();
    let done!: (value: Bitmap) => void;
    decode.mockImplementation(
      () =>
        new Promise((r) => {
          done = r;
        }),
    );
    const p = fixture(),
      s = scene(p),
      bank = createMaskResourceBank(p),
      abort = new AbortController(),
      pending = acquireMaskResourceLease(bank, s, abort.signal).catch((e) => e);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    expect(bank.stats()).toMatchObject({ decodedPixels: 4, pending: 1, leases: 1 });
    if (action === 'cancel') abort.abort(Error('Cancel'));
    if (action === 'dispose') bank.dispose();
    if (action === 'source') p.name = 'Changed';
    const image = new Bitmap();
    done(image);
    const result = await pending;
    if (action === 'cancel') {
      expect(result.message).toBe('Cancel');
      await vi.waitFor(() => expect(bank.stats().ready).toBe(1));
      expect(image.close).not.toHaveBeenCalled();
      const lease = await acquireMaskResourceLease(bank, s, new AbortController().signal);
      expect(decode).toHaveBeenCalledTimes(1);
      lease.release();
      bank.dispose();
    } else {
      expect(result).toBeInstanceOf(Error);
      expect(bank.disposed).toBe(true);
    }
    await vi.waitFor(() => expect(image.close).toHaveBeenCalledTimes(1));
    expect(bank.stats()).toMatchObject({ decodedPixels: 0, rasterPixels: 0, leases: 0 });
    disposeLayerScene(s);
  });
it('dimension failure closes only the failed decode and permits a source-valid retry', async () => {
  const { decode } = mock(),
    bad = new Bitmap();
  bad.width = 1;
  decode.mockResolvedValueOnce(bad);
  const p = fixture(),
    s = scene(p),
    bank = createMaskResourceBank(p);
  await expect(acquireMaskResourceLease(bank, s, new AbortController().signal)).rejects.toThrow(
    'dimensions',
  );
  expect(bad.close).toHaveBeenCalledTimes(1);
  expect(bank.disposed).toBe(false);
  expect(bank.stats()).toMatchObject({ decodedPixels: 0, leases: 0 });
  const lease = await acquireMaskResourceLease(bank, s, new AbortController().signal);
  expect(decode).toHaveBeenCalledTimes(2);
  lease.release();
  bank.dispose();
  disposeLayerScene(s);
});
it('source invalidation notifies overlapping consumers once without source writes', async () => {
  mock();
  const p = fixture(),
    s = scene(p),
    bank = createMaskResourceBank(p),
    a = await acquireMaskResourceLease(bank, s, new AbortController().signal),
    b = await acquireMaskResourceLease(bank, s, new AbortController().signal),
    one = vi.fn(),
    two = vi.fn();
  a.listen(one);
  b.listen(two);
  p.background = '#123456';
  expect(() => a.check()).toThrow('source');
  expect(one).toHaveBeenCalledTimes(1);
  expect(two).toHaveBeenCalledTimes(1);
  expect(() => b.check()).toThrow();
  expect(p.background).toBe('#123456');
  bank.dispose();
  expect(two).toHaveBeenCalledTimes(1);
  disposeLayerScene(s);
});
it('captures original callbacks once and rejects swallowed resource validation reentry', async () => {
  mock();
  const p = fixture(),
    s = scene(p);
  let reads = 0,
    armed = false;
  const bank: ReturnType<typeof createMaskResourceBank> = createMaskResourceBank(p, {
    get validate() {
      reads++;
      return () => {
        if (armed) {
          armed = false;
          void acquireMaskResourceLease(bank, s, new AbortController().signal).catch(() => {});
        }
      };
    },
  });
  armed = true;
  await expect(acquireMaskResourceLease(bank, s, new AbortController().signal)).rejects.toThrow();
  expect(reads).toBe(1);
  expect(bank.disposed).toBe(true);
  expect(bank.stats().leases).toBe(0);
  disposeLayerScene(s);
});
it('rejects raw source getters/nonfinite values and asynchronous lifetime validators', () => {
  mock();
  const p = fixture();
  p.width = NaN;
  expect(() => createMaskResourceBank(p)).toThrow('nonfinite');
  let reads = 0;
  Object.defineProperty(p, 'width', {
    get() {
      reads++;
      return 20;
    },
    enumerable: true,
  });
  expect(() => createMaskResourceBank(p)).toThrow('data fields');
  expect(reads).toBe(0);
  expect(() =>
    createMaskResourceBank(fixture(), {
      validate: (() => Promise.reject(Error('async'))) as () => void,
    }),
  ).toThrow('synchronous');
});
it('preparation does not return a disposed painter when the bank dies at final admission', async () => {
  const { fonts } = mock();
  const p = fixture(),
    s = scene(p);
  let armed = false,
    hit = false;
  const bank: ReturnType<typeof createMaskResourceBank> = createMaskResourceBank(p);
  const add = EventTarget.prototype.addEventListener;
  vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (
    this: EventTarget,
    type,
    listener,
    options,
  ) {
    add.call(this, type, listener, options);
    if (armed && this === fonts && type === 'loading') {
      hit = true;
      bank.dispose();
    }
  });
  armed = true;
  await expect(prepareMaskedLayerPainter(s, { resources: bank })).rejects.toThrow();
  expect(hit).toBe(true);
  expect(bank.stats().leases).toBe(0);
  disposeLayerScene(s);
});

it('cancellation inside the native image constructor cannot orphan a decoded resource', async () => {
  const { decode } = mock(),
    abort = new AbortController();
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      constructor() {
        abort.abort(Error('Constructor cancellation'));
      }
      decode = async () => {};
    },
  );
  const p = fixture(),
    s = scene(p),
    bank = createMaskResourceBank(p);
  await expect(acquireMaskResourceLease(bank, s, abort.signal)).rejects.toThrow(
    'Constructor cancellation',
  );
  await vi.waitFor(() => expect(bank.stats().ready).toBe(1));
  expect(decode).toHaveBeenCalledTimes(1);
  const image = await decode.mock.results[0].value;
  expect(image.close).not.toHaveBeenCalled();
  bank.dispose();
  expect(image.close).toHaveBeenCalledTimes(1);
  expect(bank.stats().decodedPixels).toBe(0);
  disposeLayerScene(s);
});

it('a synchronous font hook can acquire a second frame without duplicating its pending load', async () => {
  const { fonts } = mock(),
    p = fixture(true),
    s = scene(p),
    bank = createMaskResourceBank(p);
  let other: ReturnType<typeof acquireMaskResourceLease> | undefined,
    hit = false;
  fonts.load.mockImplementation(async () => {
    if (!hit) {
      hit = true;
      other = acquireMaskResourceLease(bank, s, new AbortController().signal);
    }
    return [];
  });
  const first = await acquireMaskResourceLease(bank, s, new AbortController().signal),
    second = await other!;
  expect(fonts.load).toHaveBeenCalledTimes(1);
  first.release();
  second.release();
  bank.dispose();
  disposeLayerScene(s);
});

it('a throwing retired-consumer callback cannot strand other leases or decoded images', async () => {
  const { decode } = mock(),
    p = fixture(),
    s = scene(p),
    bank = createMaskResourceBank(p),
    a = await acquireMaskResourceLease(bank, s, new AbortController().signal),
    b = await acquireMaskResourceLease(bank, s, new AbortController().signal),
    next = vi.fn();
  a.listen(() => {
    throw Error('Consumer teardown');
  });
  b.listen(next);
  bank.dispose();
  expect(next).toHaveBeenCalledTimes(1);
  expect(bank.stats()).toMatchObject({ leases: 0, decodedPixels: 0, rasterPixels: 0 });
  expect((await decode.mock.results[0].value).close).toHaveBeenCalledTimes(1);
  disposeLayerScene(s);
});

for (const characters of [2, 600])
  it(`readiness metadata eviction preserves all ${characters}-character requests and decoded images`, async () => {
    const { fonts, decode } = mock(),
      p = fixture(true);
    p.layers[0].keys[0].shapes[1].text!.content = Array.from({ length: characters }, (_, i) =>
      String.fromCodePoint(0x1000 + i),
    ).join('');
    const bank = createMaskResourceBank(p);
    const prepare = async (size: number) => {
      const s = prepareLayerScene(p, 0, masks, (source, f) =>
        evaluateLayers(source, f).map((layer) => ({
          ...layer,
          shapes: layer.shapes.map((shape) =>
            shape.text ? { ...shape, text: { ...shape.text, size } } : shape,
          ),
        })),
      );
      const lease = await acquireMaskResourceLease(bank, s, new AbortController().signal);
      lease.release();
      disposeLayerScene(s);
    };
    for (let i = 0; i < 130; i++) await prepare(12 + i);
    expect(fonts.load).toHaveBeenCalledTimes(130);
    expect(bank.stats().fonts).toBeLessThanOrEqual(characters === 600 ? 109 : 128);
    await prepare(12);
    expect(fonts.load).toHaveBeenCalledTimes(131);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(bank.stats().decodedPixels).toBe(4);
    bank.dispose();
  });

it('elapsed deadline after bank validation releases its lease without poisoning ready resources', async () => {
  const { decode } = mock(),
    p = fixture(),
    s = scene(p);
  let now = 0,
    armed = false;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const bank = createMaskResourceBank(p, {
    validate: () => {
      if (armed) now = 20;
    },
  });
  armed = true;
  await expect(prepareMaskedLayerPainter(s, { resources: bank, timeoutMs: 10 })).rejects.toThrow(
    'timed out',
  );
  expect(bank.stats()).toMatchObject({ leases: 0, rasterPixels: 0, ready: 1, decodedPixels: 4 });
  const retry = await prepareMaskedLayerPainter(s, { resources: bank, timeoutMs: 10 });
  retry.dispose();
  expect(decode).toHaveBeenCalledTimes(1);
  bank.dispose();
  disposeLayerScene(s);
});

it('does not report native images ready before dimension/source admission completes', async () => {
  const { decode } = mock(),
    p = fixture(),
    s = scene(p),
    bank = createMaskResourceBank(p),
    image = new Bitmap();
  let observed = -1;
  Object.defineProperty(image, 'width', {
    get() {
      observed = bank.stats().ready;
      return 2;
    },
    set() {},
    configurable: true,
  });
  decode.mockResolvedValueOnce(image);
  const lease = await acquireMaskResourceLease(bank, s, new AbortController().signal);
  expect(observed).toBe(0);
  expect(bank.stats()).toMatchObject({ ready: 1, pending: 0 });
  lease.release();
  bank.dispose();
  disposeLayerScene(s);
});

it('rechecks the original lifetime after native bitmap metadata reads', async () => {
  const { decode } = mock(),
    p = fixture(),
    s = scene(p),
    bank = createMaskResourceBank(p),
    image = new Bitmap();
  let armed = false;
  Object.defineProperty(image, 'width', {
    get() {
      if (armed) {
        armed = false;
        p.name = 'Changed by metadata';
      }
      return 2;
    },
    set() {},
    configurable: true,
  });
  decode.mockResolvedValueOnce(image);
  const lease = await acquireMaskResourceLease(bank, s, new AbortController().signal);
  armed = true;
  expect(() => lease.check()).toThrow('source');
  expect(bank.disposed).toBe(true);
  expect(bank.stats().leases).toBe(0);
  disposeLayerScene(s);
});

it('late consumer cancellation after image mapping cannot publish a closed lease', async () => {
  mock();
  const p = fixture(),
    abort = new AbortController();
  let mapped = false,
    armed = false;
  const s = prepareLayerScene(p, 0, masks, evaluateLayers, {
      validate: () => {
        if (armed && mapped) abort.abort(Error('Late scene cancellation'));
      },
    }),
    bank = createMaskResourceBank(p),
    set = Map.prototype.set;
  vi.spyOn(Map.prototype, 'set').mockImplementation(function (
    this: Map<unknown, unknown>,
    key,
    value,
  ) {
    const result = set.call(this, key, value);
    if (key === 'image' && value instanceof Bitmap) mapped = true;
    return result;
  });
  armed = true;
  await expect(acquireMaskResourceLease(bank, s, abort.signal)).rejects.toThrow(
    'Late scene cancellation',
  );
  expect(mapped).toBe(true);
  expect(bank.stats()).toMatchObject({ leases: 0, rasterPixels: 0, ready: 1 });
  armed = false;
  const retry = await acquireMaskResourceLease(bank, s, new AbortController().signal);
  retry.release();
  bank.dispose();
  disposeLayerScene(s);
});
