import { validateProject, type Project } from '../../document/src';
import { fontFamilyForRendering } from '../../geometry/src/font-family';
import { selectionTrajectoryStamp } from '../../animation/src/selection-trajectory';
import {
  withLayerScene,
  layerSceneMatchesSource,
  type PreparedLayerScene,
  type LayerSceneData,
} from '../../animation/src/layer-scene';
import { admitMaskRaster, MASK_WORKING_PIXELS } from './mask-budget';

export interface MaskResourceBank {
  dispose(): void;
  readonly disposed: boolean;
  stats(): Readonly<{
    decodedPixels: number;
    rasterPixels: number;
    ready: number;
    pending: number;
    leases: number;
    fonts: number;
  }>;
}
export interface MaskResourceLease {
  images: Map<string, ImageBitmap>;
  pixels: number;
  check(): void;
  admit(width: number, height: number): void;
  listen(invalidate: () => void): void;
  release(): void;
}
type FontState = { face: FontFace; stamp: string }[];
// These bound only optional readiness-cache metadata. Eviction never rejects
// text/artwork or unloads native fonts; a miss performs full readiness again.
const FONT_CACHE_STYLES = 128,
  FONT_CACHE_CHARACTERS = 65536;
function faces(fonts: FontFaceSet): FontState {
  return [...fonts].map((face) => ({
    face,
    stamp: JSON.stringify([
      face.family,
      face.style,
      face.weight,
      face.stretch,
      face.featureSettings,
      face.status,
    ]),
  }));
}
function sameFaces(a: FontState, b: FontState) {
  return (
    a.length === b.length &&
    a.every((face, i) => face.face === b[i].face && face.stamp === b[i].stamp)
  );
}
function sync(validate: (() => void) | undefined) {
  const result = validate?.() as unknown;
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    void Promise.resolve(result).catch(() => {});
    throw Error('Mask resource validation must be synchronous.');
  }
}
type ImageEntry = {
  url: string;
  width: number;
  height: number;
  refs: number;
  reserved: boolean;
  closed: boolean;
  ready: boolean;
  image?: ImageBitmap;
  promise?: Promise<ImageBitmap>;
};
type Claim = {
  closed: boolean;
  raster: number;
  images: Map<string, ImageBitmap>;
  entries: ImageEntry[];
  invalidate?: () => void;
};
type Needs = {
  sources: Map<string, { ids: string[]; width: number; height: number }>;
  fonts: Map<string, string>;
};
function needs(data: LayerSceneData): Needs {
  const inactive = new Set(
    data.masks
      .filter((mask) => {
        const source = data.layers.find((layer) => layer.layerId === mask.maskLayerId)!;
        return !source.visible || !source.shapes.length;
      })
      .flatMap((mask) => [mask.maskLayerId, ...mask.layerIds]),
  );
  const ids = new Set<string>(),
    loads = new Map<string, Set<string>>();
  for (const layer of data.layers)
    if (layer.visible && !inactive.has(layer.layerId))
      for (const shape of layer.shapes) {
        if (shape.bitmap) ids.add(shape.bitmap.assetId);
        if (shape.text) {
          const text = shape.text;
          for (const style of [{}, ...(text.runs ?? []).map((run) => run.style)]) {
            const css = `${(style.italic ?? text.italic) ? 'italic ' : ''}${(style.bold ?? text.bold) ? 'bold ' : ''}${style.size ?? text.size}px ${fontFamilyForRendering(style.font ?? text.font)}`;
            let chars = loads.get(css);
            if (!chars) {
              chars = new Set();
              loads.set(css, chars);
            }
            for (const char of text.content) chars.add(char);
          }
        }
      }
  const sources: Needs['sources'] = new Map();
  for (const id of ids) {
    const asset = data.assets.find((asset) => asset.id === id)?.bitmap;
    if (!asset?.dataUrl) throw Error('Mask resource bitmap data is unavailable.');
    const source = sources.get(asset.dataUrl);
    if (source) {
      if (source.width !== asset.width || source.height !== asset.height)
        throw Error('Shared bitmap dimensions conflict.');
      source.ids.push(id);
    } else sources.set(asset.dataUrl, { ids: [id], width: asset.width, height: asset.height });
  }
  return {
    sources,
    fonts: new Map([...loads].map(([css, chars]) => [css, [...chars].sort().join('')])),
  };
}
class Resources {
  source: Project | undefined;
  stamp: string;
  validate: (() => void) | undefined;
  fonts: FontFaceSet;
  entries = new Map<string, ImageEntry>();
  claims = new Set<Claim>();
  pixels = 0;
  disposed = false;
  checking = false;
  controller = new AbortController();
  fontLoads = new Map<string, Promise<void>>();
  fontReady = new Map<string, { state: FontState; chars: Set<string> }>();
  fontCharacters = 0;
  loading = () => {
    this.fontReady.clear();
    this.fontCharacters = 0;
  };
  constructor(source: Project, validate: (() => void) | undefined) {
    this.source = source;
    this.stamp = selectionTrajectoryStamp(source);
    this.validate = validate;
    validateProject(source);
    this.fonts = document.fonts;
    this.check();
    EventTarget.prototype.addEventListener.call(this.fonts, 'loading', this.loading);
  }
  check() {
    if (this.disposed) throw Error('Mask resource bank is disposed.');
    if (this.checking) {
      this.dispose();
      throw Error('Mask resource validation cannot reenter.');
    }
    this.checking = true;
    try {
      sync(this.validate);
      if (
        this.disposed ||
        !this.source ||
        document.fonts !== this.fonts ||
        selectionTrajectoryStamp(this.source) !== this.stamp
      )
        throw Error('Mask resource source or lifetime changed.');
    } catch (cause) {
      this.dispose();
      throw cause;
    } finally {
      this.checking = false;
    }
  }
  raster() {
    let pixels = 0;
    for (const claim of this.claims) pixels += claim.raster;
    return pixels;
  }
  budget(extraPixels = 0, extraRaster = 0) {
    if (this.pixels + extraPixels + this.raster() + extraRaster > MASK_WORKING_PIXELS)
      throw Error('Shared mask resources exceed the 64-megapixel working budget.');
  }
  unreserve(entry: ImageEntry) {
    if (entry.reserved) {
      entry.reserved = false;
      this.pixels -= entry.width * entry.height;
    }
  }
  close(entry: ImageEntry) {
    if (entry.image && !entry.closed) {
      entry.closed = true;
      entry.image.close();
    }
  }
  release(claim: Claim) {
    if (claim.closed) return;
    claim.closed = true;
    claim.invalidate = undefined;
    this.claims.delete(claim);
    claim.images.clear();
    for (const entry of claim.entries) {
      entry.refs--;
      if (!entry.refs && !entry.promise && !entry.image) {
        if (this.entries.get(entry.url) === entry) this.entries.delete(entry.url);
        this.unreserve(entry);
      }
    }
    claim.entries = [];
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.abort(Error('Mask resource bank closed.'));
    EventTarget.prototype.removeEventListener.call(this.fonts, 'loading', this.loading);
    for (const claim of [...this.claims]) {
      const notify = claim.invalidate;
      this.release(claim);
      try {
        notify?.();
      } catch {
        /* One retired consumer cannot prevent other resource cleanup. */
      }
    }
    for (const entry of this.entries.values()) {
      this.close(entry);
      this.unreserve(entry);
      entry.url = '';
    }
    this.entries.clear();
    this.fontLoads.clear();
    this.fontReady.clear();
    this.fontCharacters = 0;
    this.source = undefined;
    this.validate = undefined;
    this.stamp = '';
  }
  async wait<T>(operation: Promise<T>, signal: AbortSignal) {
    let listener: (() => void) | undefined, bankListener: (() => void) | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          listener = () => reject(signal.reason);
          bankListener = () => reject(this.controller.signal.reason);
          signal.addEventListener('abort', listener, { once: true });
          this.controller.signal.addEventListener('abort', bankListener, { once: true });
          if (signal.aborted) listener();
          if (this.controller.signal.aborted) bankListener();
        }),
      ]);
    } finally {
      if (listener) signal.removeEventListener('abort', listener);
      if (bankListener) this.controller.signal.removeEventListener('abort', bankListener);
    }
  }
  loadFont(css: string, text: string) {
    this.check();
    const key = JSON.stringify([css, text]),
      ready = this.fontReady.get(css);
    if (
      ready &&
      this.fonts.status === 'loaded' &&
      sameFaces(ready.state, faces(this.fonts)) &&
      [...text].every((char) => ready.chars.has(char))
    ) {
      this.fontReady.delete(css);
      this.fontReady.set(css, ready);
      return Promise.resolve();
    }
    const previous = this.fontLoads.get(key);
    if (previous) return previous;
    // Publish the shared promise before calling native readiness hooks: they
    // can synchronously cancel a waiter or start another frame's acquisition.
    const promise = Promise.resolve().then(async () => {
      this.check();
      await this.fonts.load(css, text);
      await this.fonts.ready;
      this.check();
      if (this.fonts.status !== 'loaded') throw Error('Mask resource fonts changed.');
      const state = faces(this.fonts),
        previous = this.fontReady.get(css);
      const chars = new Set(previous && sameFaces(previous.state, state) ? previous.chars : []);
      for (const char of text) chars.add(char);
      if (chars.size <= FONT_CACHE_CHARACTERS) {
        if (previous) {
          this.fontCharacters -= previous.chars.size;
          this.fontReady.delete(css);
        }
        this.fontReady.set(css, { state, chars });
        this.fontCharacters += chars.size;
        while (
          this.fontReady.size > FONT_CACHE_STYLES ||
          this.fontCharacters > FONT_CACHE_CHARACTERS
        ) {
          const first = this.fontReady.entries().next().value!;
          this.fontCharacters -= first[1].chars.size;
          this.fontReady.delete(first[0]);
        }
      }
    });
    this.fontLoads.set(key, promise);
    void promise
      .finally(() => {
        if (this.fontLoads.get(key) === promise) this.fontLoads.delete(key);
      })
      .catch(() => {});
    return promise;
  }
  decode(entry: ImageEntry) {
    if (entry.closed || !entry.reserved || this.entries.get(entry.url) !== entry)
      return Promise.reject(Error('Shared bitmap preparation failed. Retry with a fresh lease.'));
    if (entry.promise) return entry.promise;
    if (entry.image) return Promise.resolve(entry.image);
    const promise = Promise.resolve().then(async () => {
      this.check();
      const image = new Image();
      let abort: (() => void) | undefined;
      try {
        this.check();
        image.src = entry.url;
        abort = () => {
          image.src = '';
        };
        this.controller.signal.addEventListener('abort', abort, { once: true });
        await this.wait(image.decode(), this.controller.signal);
        this.check();
        // The bank owns this operation even if every individual waiter cancels.
        const bitmap = await createImageBitmap(image);
        entry.image = bitmap;
        try {
          this.check();
          if (bitmap.width !== entry.width || bitmap.height !== entry.height)
            throw Error('Decoded shared bitmap dimensions changed.');
          this.check();
          entry.ready = true;
          return bitmap;
        } catch (cause) {
          this.close(entry);
          throw cause;
        }
      } finally {
        if (abort) this.controller.signal.removeEventListener('abort', abort);
        image.src = '';
      }
    });
    entry.promise = promise;
    void promise.catch(() => {
      if (this.entries.get(entry.url) === entry) this.entries.delete(entry.url);
      this.close(entry);
      this.unreserve(entry);
    });
    return promise;
  }
  async acquire(scene: PreparedLayerScene, signal: AbortSignal): Promise<MaskResourceLease> {
    this.check();
    signal.throwIfAborted();
    if (!layerSceneMatchesSource(scene, this.stamp))
      throw Error('Mask resource bank belongs to a different original scene source.');
    const data = withLayerScene(scene, (data) => data),
      wanted = needs(data);
    this.check();
    let added = 0;
    for (const [url, source] of wanted.sources) {
      const entry = this.entries.get(url);
      if (entry && (entry.width !== source.width || entry.height !== source.height))
        throw Error('Shared bitmap dimensions conflict.');
      if (!entry) added += source.width * source.height;
    }
    this.budget(added, 4);
    const claim: Claim = { closed: false, raster: 4, images: new Map(), entries: [] };
    this.claims.add(claim);
    for (const [url, source] of wanted.sources) {
      let entry = this.entries.get(url);
      if (!entry) {
        entry = {
          url,
          width: source.width,
          height: source.height,
          refs: 0,
          reserved: true,
          closed: false,
          ready: false,
        };
        this.entries.set(url, entry);
        this.pixels += source.width * source.height;
      }
      entry.refs++;
      claim.entries.push(entry);
    }
    const current = () => {
      this.check();
      signal.throwIfAborted();
      if (claim.closed) throw Error('Mask resource lease closed.');
      withLayerScene(scene, () => {});
      signal.throwIfAborted();
      if (claim.closed) throw Error('Mask resource lease closed.');
    };
    const abort = () => this.release(claim);
    signal.addEventListener('abort', abort, { once: true });
    try {
      current();
      for (const [css, text] of wanted.fonts) {
        await this.wait(this.loadFont(css, text), signal);
        current();
      }
      await this.wait(this.fonts.ready, signal);
      current();
      if (this.fonts.status !== 'loaded') throw Error('Mask resource fonts are not ready.');
      const fontState = faces(this.fonts);
      for (const entry of claim.entries) {
        current();
        const bitmap = await this.wait(this.decode(entry), signal);
        current();
        for (const id of wanted.sources.get(entry.url)!.ids) claim.images.set(id, bitmap);
      }
      current();
      if (!sameFaces(fontState, faces(this.fonts)))
        throw Error('Mask resource fonts changed during preparation.');
      const check = () => {
        this.check();
        if (claim.closed) throw Error('Mask resource lease closed.');
        for (const entry of claim.entries)
          if (
            !entry.ready ||
            !entry.image ||
            entry.closed ||
            entry.image.width !== entry.width ||
            entry.image.height !== entry.height
          ) {
            this.dispose();
            throw Error('Shared mask image ownership changed.');
          }
        // Native metadata reads are a host boundary too; admit the original
        // lifetime again after them before a painter can publish cached output.
        this.check();
        if (claim.closed) throw Error('Mask resource lease closed.');
      };
      return {
        images: claim.images,
        pixels: claim.entries.reduce((sum, e) => sum + e.width * e.height, 0),
        check,
        admit: (width, height) => {
          check();
          admitMaskRaster(width, height);
          const next = Math.max(claim.raster, 4 * width * height);
          this.budget(0, next - claim.raster);
          check();
          claim.raster = next;
        },
        listen: (invalidate) => {
          if (claim.closed) invalidate();
          else claim.invalidate = invalidate;
        },
        release: () => this.release(claim),
      };
    } catch (cause) {
      this.release(claim);
      throw cause;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
}
const banks = new WeakMap<object, Resources>();
/** Explicit cache owner for one immutable original source/lifetime. Retained
 * decoded pixels and each live lease's peak four-raster reservation share the
 * existing planning budget. Dispose the bank after all frame consumers end. */
export function createMaskResourceBank(
  project: Project,
  options: { validate?: () => void } = {},
): MaskResourceBank {
  const stamp = selectionTrajectoryStamp(project);
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Reflect.ownKeys(options).some((key) => key !== 'validate')
  )
    throw Error('Invalid mask resource bank options.');
  const validate = options.validate;
  if (validate !== undefined && typeof validate !== 'function')
    throw Error('Invalid mask resource validation.');
  const resources = new Resources(project, validate);
  if (selectionTrajectoryStamp(project) !== stamp) {
    resources.dispose();
    throw Error('Mask resource source changed during capture.');
  }
  const handle: MaskResourceBank = Object.freeze({
    dispose: () => resources.dispose(),
    get disposed() {
      return resources.disposed;
    },
    stats: () =>
      Object.freeze({
        decodedPixels: resources.pixels,
        rasterPixels: resources.raster(),
        ready: [...resources.entries.values()].filter((e) => e.ready && !e.closed).length,
        pending: [...resources.entries.values()].filter((e) => !e.ready).length,
        leases: resources.claims.size,
        fonts: resources.fontReady.size,
      }),
  });
  banks.set(handle, resources);
  return handle;
}
/** Internal painter bridge. A copied public handle cannot borrow resources. */
export function acquireMaskResourceLease(
  bank: MaskResourceBank,
  scene: PreparedLayerScene,
  signal: AbortSignal,
) {
  const resources = banks.get(bank);
  if (!resources) throw Error('Choose an original mask resource bank.');
  return resources.acquire(scene, signal);
}
