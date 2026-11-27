import { maskPaintChains } from '../../document/src/layer-masks';
import {
  withLayerScene,
  type PreparedLayerScene,
  type LayerSceneData,
} from '../../animation/src/layer-scene';
import { paintCommands, canvasPath, type RenderVector } from './render-data';
import type { Vector } from '../../document/src';
import { pathCommands } from '../../geometry/src/drawing';
import { paintStyledText } from './rich-text';
import { fontFamilyForRendering } from '../../geometry/src/font-family';
import { wrapText } from '../../geometry/src/text-layout';
import { admitMaskRaster, MASK_WORKING_PIXELS } from './mask-budget';
import {
  acquireMaskResourceLease,
  type MaskResourceBank,
  type MaskResourceLease,
} from './mask-resources';

export interface MaskedLayerPainter {
  paint(target: CanvasRenderingContext2D, validate?: () => void): void;
  dispose(): void;
  readonly disposed: boolean;
}
function sync(validate: (() => void) | undefined) {
  if (validate !== undefined && typeof validate !== 'function')
    throw Error('Invalid mask view validation.');
  const result = validate?.() as unknown;
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    void Promise.resolve(result).catch(() => {});
    throw Error('Mask view validation must be synchronous.');
  }
}
function view(ctx: CanvasRenderingContext2D) {
  const m = ctx.getTransform(),
    values = [ctx.canvas.width, ctx.canvas.height, m.a, m.b, m.c, m.d, m.e, m.f];
  if (
    !values.every(Number.isFinite) ||
    !Number.isFinite(m.a * m.d - m.b * m.c) ||
    m.a * m.d - m.b * m.c === 0 ||
    ctx.globalAlpha !== 1 ||
    ctx.globalCompositeOperation !== 'source-over' ||
    ctx.shadowBlur !== 0 ||
    ctx.shadowOffsetX !== 0 ||
    ctx.shadowOffsetY !== 0 ||
    (ctx.filter ?? 'none') !== 'none'
  )
    throw Error('Mask painting requires a finite affine source-over view without extra effects.');
  const smoothing = ctx.imageSmoothingEnabled,
    quality = ctx.imageSmoothingQuality;
  return {
    matrix: m,
    width: values[0],
    height: values[1],
    smoothing,
    quality,
    key: JSON.stringify([...values, smoothing, quality]),
  };
}
function fontState(fonts: FontFaceSet) {
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
class Painter implements MaskedLayerPainter {
  #scene: PreparedLayerScene | undefined;
  #images: Map<string, ImageBitmap>;
  #pixels: number;
  #fonts: FontFaceSet;
  #faces: ReturnType<typeof fontState>;
  #signal?: AbortSignal;
  #lease?: MaskResourceLease;
  #output?: HTMLCanvasElement;
  #group?: HTMLCanvasElement;
  #mask?: HTMLCanvasElement;
  #key: string | undefined;
  #busy = false;
  #compiled = new WeakMap<Vector, { data: RenderVector; path: Path2D | undefined }>();
  #invalidate = () => this.dispose();
  constructor(
    scene: PreparedLayerScene,
    images: Map<string, ImageBitmap>,
    pixels: number,
    signal?: AbortSignal,
    lease?: MaskResourceLease,
  ) {
    this.#scene = scene;
    this.#images = images;
    this.#pixels = pixels;
    this.#fonts = document.fonts;
    this.#faces = fontState(this.#fonts);
    this.#signal = signal;
    this.#lease = lease;
    EventTarget.prototype.addEventListener.call(this.#fonts, 'loading', this.#invalidate);
    if (signal)
      EventTarget.prototype.addEventListener.call(signal, 'abort', this.#invalidate, {
        once: true,
      });
    lease?.listen(this.#invalidate);
  }
  get disposed() {
    return !this.#scene;
  }
  #native() {
    this.#lease?.check();
    if (!this.#scene || document.fonts !== this.#fonts || this.#fonts.status !== 'loaded')
      throw Error('Mask painter is disposed or its fonts changed.');
    const now = fontState(this.#fonts);
    if (
      now.length !== this.#faces.length ||
      now.some(
        (face, i) => face.face !== this.#faces[i].face || face.stamp !== this.#faces[i].stamp,
      )
    )
      throw Error('Mask painter fonts changed.');
    if (
      this.#signal &&
      Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!.call(this.#signal)
    )
      this.dispose();
    if (!this.#scene) throw Error('Mask painter is disposed.');
  }
  paint(target: CanvasRenderingContext2D, validate?: () => void) {
    if (this.#busy) {
      this.dispose();
      throw Error('Mask painting cannot reenter.');
    }
    this.#busy = true;
    try {
      this.#native();
      const scene = this.#scene!,
        layout = view(target);
      sync(validate);
      this.#lease?.admit(layout.width, layout.height);
      admitMaskRaster(layout.width, layout.height, this.#pixels);
      withLayerScene(scene, (data) => {
        this.#native();
        if (this.#key === layout.key) return;
        this.#output ??= document.createElement('canvas');
        this.#group ??= document.createElement('canvas');
        this.#mask ??= document.createElement('canvas');
        for (const canvas of [this.#output, this.#group, this.#mask])
          if (canvas.width !== layout.width || canvas.height !== layout.height) {
            canvas.width = layout.width;
            canvas.height = layout.height;
          }
        const context = (canvas: HTMLCanvasElement) => {
          const ctx = canvas.getContext('2d');
          if (!ctx) throw Error('Mask canvas allocation failed.');
          return ctx;
        };
        const output = context(this.#output),
          group = context(this.#group),
          mask = context(this.#mask);
        const reset = (ctx: CanvasRenderingContext2D) => {
          ctx.resetTransform();
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          ctx.imageSmoothingEnabled = layout.smoothing;
          ctx.imageSmoothingQuality = layout.quality;
          ctx.clearRect(0, 0, layout.width, layout.height);
          ctx.setTransform(layout.matrix);
        };
        const draw = (ctx: CanvasRenderingContext2D, layer: LayerSceneData['layers'][number]) => {
          if (!layer.visible) return;
          for (const shape of layer.shapes) {
            let prepared = this.#compiled.get(shape);
            if (!prepared) {
              const data = { ...shape, commands: shape.kind === 'text' ? [] : pathCommands(shape) };
              prepared = { data, path: canvasPath(data) };
              this.#compiled.set(shape, prepared);
            }
            paintCommands(
              ctx,
              prepared.data,
              wrapText,
              shape.bitmap ? this.#images.get(shape.bitmap.assetId) : undefined,
              paintStyledText,
              prepared.path, undefined, undefined, this.#pixels + 3*layout.width*layout.height,
            );
          }
        };
        reset(output);
        const { chains, members } = maskPaintChains(data.masks),
          layers = new Map(data.layers.map((l) => [l.layerId, l]));
        for (const layer of data.layers) {
          const chain = chains.get(layer.layerId);
          if (chain) {
            if (!layer.visible || !layer.shapes.length) continue;
            reset(group);
            for (const pass of chain) {
              for (const id of pass.members) draw(group, layers.get(id)!);
              reset(mask);
              draw(mask, layers.get(pass.source)!);
              group.save();
              group.resetTransform();
              group.globalCompositeOperation = 'destination-in';
              group.drawImage(this.#mask, 0, 0);
              group.restore();
            }
            output.save();
            output.resetTransform();
            output.drawImage(this.#group, 0, 0);
            output.restore();
          } else if (!members.has(layer.layerId)) draw(output, layer);
        }
      });
      this.#native();
      if (view(target).key !== layout.key) throw Error('Mask target view changed.');
      sync(validate);
      withLayerScene(scene, () => this.#native());
      if (view(target).key !== layout.key) throw Error('Mask target view changed.');
      // Final source/view admission precedes one native publication; no host
      // callback executes between this admission and the target draw.
      target.save();
      try {
        target.resetTransform();
        target.drawImage(this.#output!, 0, 0);
      } finally {
        target.restore();
      }
      this.#key = layout.key;
    } catch (cause) {
      this.dispose();
      throw cause;
    } finally {
      this.#busy = false;
    }
  }
  dispose() {
    this.#scene = undefined;
    this.#key = undefined;
    this.#compiled = new WeakMap();
    if (this.#lease) this.#lease.release();
    else for (const image of new Set(this.#images.values())) image.close();
    this.#lease = undefined;
    this.#images.clear();
    for (const canvas of [this.#output, this.#group, this.#mask])
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    this.#output = this.#group = this.#mask = undefined;
    EventTarget.prototype.removeEventListener.call(this.#fonts, 'loading', this.#invalidate);
    if (this.#signal)
      EventTarget.prototype.removeEventListener.call(this.#signal, 'abort', this.#invalidate);
    this.#signal = undefined;
  }
}
/** Resource-ready, single-frame Canvas masks. Repeated views reuse privately
 * compiled paths, decoded images and same-view alpha rasters without PNG replay.
 * Empty plans stay on the caller's unchanged legacy renderer. Dispose both the
 * painter and its prepared scene when the owning view ends. */
export async function prepareMaskedLayerPainter(
  scene: PreparedLayerScene,
  options: { signal?: AbortSignal; timeoutMs?: number; resources?: MaskResourceBank } = {},
): Promise<MaskedLayerPainter> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined,
    external: AbortSignal | undefined,
    painter: Painter | undefined;
  let lease: MaskResourceLease | undefined;
  const controller = new AbortController(),
    images = new Map<string, ImageBitmap>();
  const abort = () =>
    controller.abort(
      Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!.call(external),
    );
  try {
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Reflect.ownKeys(options).some((k) => k !== 'signal' && k !== 'timeoutMs' && k !== 'resources')
    )
      throw Error('Invalid mask painter options.');
    const { signal, timeoutMs = 60000, resources } = options;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
      throw Error('Invalid mask painter deadline.');
    if (signal !== undefined) {
      if (!(signal instanceof AbortSignal)) throw Error('Invalid mask painter signal.');
      const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!.call(
        signal,
      );
      external = signal;
      EventTarget.prototype.addEventListener.call(signal, 'abort', abort, { once: true });
      if (aborted) abort();
    }
    const deadline = started + timeoutMs;
    timer = setTimeout(
      () => controller.abort(Error('Mask painter preparation timed out.')),
      Math.max(0, deadline - performance.now()),
    );
    const current = () => {
      if (performance.now() >= deadline)
        controller.abort(Error('Mask painter preparation timed out.'));
      controller.signal.throwIfAborted();
      withLayerScene(scene, () => {});
      if (performance.now() >= deadline)
        controller.abort(Error('Mask painter preparation timed out.'));
      controller.signal.throwIfAborted();
    };
    current();
    const data = withLayerScene(scene, (data) => data);
    if (!data.masks.length) throw Error('Use legacy rendering for an unmasked scene.');
    async function wait<T>(operation: Promise<T>, cleanup?: (value: T) => void) {
      let listener: (() => void) | undefined,
        abandoned = false,
        cleaned = false;
      const close = (value: T) => {
        if (!cleaned) {
          cleaned = true;
          cleanup?.(value);
        }
      };
      try {
        const value = await Promise.race([
          operation,
          new Promise<never>((_, reject) => {
            listener = () => {
              abandoned = true;
              reject(controller.signal.reason);
            };
            controller.signal.addEventListener('abort', listener, { once: true });
            if (controller.signal.aborted) listener();
          }),
        ]);
        try {
          current();
        } catch (cause) {
          close(value);
          throw cause;
        }
        return value;
      } finally {
        if (listener) controller.signal.removeEventListener('abort', listener);
        if (abandoned && cleanup) void operation.then(close, () => {});
      }
    }
    if (resources !== undefined) {
      lease = await wait(acquireMaskResourceLease(resources, scene, controller.signal), (value) =>
        value.release(),
      );
      current();
      lease.check();
      painter = new Painter(scene, lease.images, lease.pixels, external, lease);
      current();
      lease.check();
      if (painter.disposed)
        throw Error('Mask resource painter was invalidated during preparation.');
      lease = undefined;
      return painter;
    }
    const inactive = new Set(
      data.masks
        .filter((mask) => {
          const layer = data.layers.find((l) => l.layerId === mask.maskLayerId)!;
          return !layer.visible || !layer.shapes.length;
        })
        .flatMap((m) => [m.maskLayerId, ...m.layerIds]),
    );
    const fonts = document.fonts,
      loads = new Map<string, Set<string>>();
    for (const layer of data.layers)
      if (layer.visible && !inactive.has(layer.layerId))
        for (const shape of layer.shapes)
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
    for (const [css, chars] of loads) await wait(fonts.load(css, [...chars].join('')));
    await wait(fonts.ready);
    if (document.fonts !== fonts) throw Error('Mask painter font ownership changed.');
    const ids = new Set(
      data.layers
        .filter((l) => l.visible && !inactive.has(l.layerId))
        .flatMap((l) => l.shapes.flatMap((s) => (s.bitmap ? [s.bitmap.assetId] : []))),
    );
    const sources = new Map<string, { ids: string[]; width: number; height: number }>();
    let pixels = 0;
    for (const id of ids) {
      const asset = data.assets.find((a) => a.id === id)?.bitmap;
      if (!asset?.dataUrl) throw Error('Mask painter bitmap data is unavailable.');
      const existing = sources.get(asset.dataUrl);
      if (existing) existing.ids.push(id);
      else {
        pixels += asset.width * asset.height;
        sources.set(asset.dataUrl, { ids: [id], width: asset.width, height: asset.height });
      }
    }
    if (pixels + 4 > MASK_WORKING_PIXELS)
      throw Error('Mask decoded images exceed the working pixel budget.');
    for (const [url, source] of sources) {
      current();
      const image = new Image();
      try {
        image.src = url;
        await wait(image.decode());
        const bitmap = await wait(createImageBitmap(image), (image) => image.close());
        if (bitmap.width !== source.width || bitmap.height !== source.height) {
          bitmap.close();
          throw Error('Decoded mask bitmap dimensions changed.');
        }
        for (const id of source.ids) images.set(id, bitmap);
      } finally {
        image.src = '';
      }
    }
    current();
    if (document.fonts.status !== 'loaded')
      throw Error('Mask painter fonts changed while preparing.');
    painter = new Painter(scene, images, pixels, external);
    current();
    return painter;
  } catch (cause) {
    lease?.release();
    if (painter) painter.dispose();
    else for (const image of new Set(images.values())) image.close();
    throw cause;
  } finally {
    clearTimeout(timer);
    if (external) EventTarget.prototype.removeEventListener.call(external, 'abort', abort);
    controller.abort(Error('Mask preparation finished.'));
  }
}
