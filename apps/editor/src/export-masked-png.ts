import { admitMaskRaster } from '../../../packages/stage/src/mask-budget';
import { validateProject, type Project } from '@splash/document';
import { captureLayerMasks, maskPaintChains, type LayerMask } from '../../../packages/document/src/layer-masks';
import { selectionTrajectoryStamp } from '../../../packages/animation/src/selection-trajectory';
import { captureDimensions } from '../../../packages/export-web/src';
import { exportPNGFrame } from './export-png';

export type MaskCaptureOptions = {
  signal?: AbortSignal;
  validate?: () => void;
  timeoutMs?: number;
  transparent?: boolean;
  scale?: number;
};
/** A four-RGBA-raster planning allowance shares the existing 64-megapixel budget:
 * output, group, detached replay/decoded image, and encoding allowance.
 * This is not a total browser-heap bound. */
export function maskedCaptureDimensions(
  width: number,
  height: number,
  scale: number,
  masked: boolean,
) {
  const result = captureDimensions(width, height, scale);
  if (masked) admitMaskRaster(result.width, result.height);
  return result;
}
const owners = new WeakMap<object, { invalid: boolean }>();

/** Complete-output-only, transient root-layer alpha masks. Each component uses
 * the existing detached script-free integer-frame replay (including Up buttons,
 * movie clocks and bitmap/font readiness). No document/export defaults change.
 */
export async function exportMaskedPNGFrame(
  project: Project,
  frame: number,
  request: readonly LayerMask[],
  options: MaskCaptureOptions = {},
): Promise<Blob> {
  const previous = owners.get(project);
  if (previous) {
    previous.invalid = true;
    throw Error('Mask capture cannot reenter its original source.');
  }
  const owner = { invalid: false };
  owners.set(project, owner);
  let output: HTMLCanvasElement | undefined, scratch: HTMLCanvasElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, external: AbortSignal | undefined;
  const controller = new AbortController();
  const started = performance.now();
  let deadline = Infinity;
  const abort = () =>
    controller.abort(
      external
        ? Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!.call(external)
        : new DOMException('Mask capture cancelled.', 'AbortError'),
    );
  try {
    const sourceStamp = selectionTrajectoryStamp(project);
    const current = () => {
      if (performance.now() >= deadline) controller.abort(Error('Mask capture timed out.'));
      controller.signal.throwIfAborted();
      if (owner.invalid || selectionTrajectoryStamp(project) !== sourceStamp)
        throw Error('Original mask source changed.');
    };
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Reflect.ownKeys(options).some(
        (key) => !['signal', 'validate', 'timeoutMs', 'transparent', 'scale'].includes(String(key)),
      )
    )
      throw Error('Invalid mask capture options.');
    const { signal, validate, timeoutMs = 60000, transparent = false, scale = 1 } = options;
    if (
      (validate !== undefined && typeof validate !== 'function') ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 60000 ||
      typeof transparent !== 'boolean'
    )
      throw Error('Mask capture needs synchronous validation and a bounded deadline.');
    if (signal !== undefined) {
      if (!(signal instanceof AbortSignal)) throw Error('Invalid mask abort signal.');
      // Brand-check before owning the signal; invalid input must not poison cleanup.
      const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!.call(
        signal,
      );
      external = signal;
      EventTarget.prototype.addEventListener.call(external, 'abort', abort, { once: true });
      if (aborted) abort();
    }
    deadline = started + timeoutMs;
    timer = setTimeout(
      () => controller.abort(new Error('Mask capture timed out.')),
      Math.max(0, deadline - performance.now()),
    );
    const admit = () => {
      current();
      const result = validate?.() as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('Mask validation must be synchronous.');
      }
      current();
    };
    admit();
    validateProject(project);
    if (!Number.isSafeInteger(frame) || frame < 0 || frame >= project.duration)
      throw Error('Choose an exact existing mask frame.');
    const masks = captureLayerMasks(project.layers, request);
    admit();
    const dimensions = maskedCaptureDimensions(
      project.width,
      project.height,
      scale,
      masks.length > 0,
    );
    const captured = structuredClone(project);
    admit();
    if (selectionTrajectoryStamp(captured) !== sourceStamp)
      throw Error('Captured mask source changed during cloning.');
    validateProject(captured);
    // Never return a partial result when the deadline/abort wins a browser wait.
    async function wait<T>(operation: Promise<T>, late?: (value: T) => void): Promise<T> {
      let listener: (() => void) | undefined,
        abandoned = false;
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
          admit();
        } catch (cause) {
          late?.(value);
          throw cause;
        }
        return value;
      } finally {
        if (listener) controller.signal.removeEventListener('abort', listener);
        if (abandoned && late) void operation.then(late, () => {});
      }
    }
    if (!masks.length) {
      const result = await wait(
        exportPNGFrame(captured, frame, controller.signal, transparent, scale),
      );
      admit();
      return result;
    }
    output = document.createElement('canvas');
    scratch = document.createElement('canvas');
    for (const canvas of [output, scratch]) {
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
    }
    const context = output.getContext('2d'),
      group = scratch.getContext('2d');
    if (!context || !group) throw Error('Mask raster allocation failed.');
    if (!transparent) {
      context.fillStyle = captured.background;
      context.fillRect(0, 0, dimensions.width, dimensions.height);
    }
    async function bitmap(ids: readonly string[]) {
      admit();
      const selected = new Set(ids);
      const scene = {
        ...captured,
        layers: captured.layers.map((layer) => ({
          ...layer,
          visible: layer.visible && selected.has(layer.id),
        })),
      };
      const blob = await wait(exportPNGFrame(scene, frame, controller.signal, true, scale));
      return wait(createImageBitmap(blob), (image) => image.close());
    }
    const { chains, members } = maskPaintChains(masks);
    const consumed = new Set([...chains.keys(), ...members]);
    for (let i = 0; i < captured.layers.length; i++) {
      admit();
      const layer = captured.layers[i],
        chain = chains.get(layer.id);
      if (chain) {
        // A hidden/empty source has zero coverage, never an inferred unmask.
        if (!layer.visible) continue;
        group.clearRect(0, 0, dimensions.width, dimensions.height);
        for (const pass of chain) {
          if (pass.members.length) {
            const content = await bitmap(pass.members);
            try {
              group.globalCompositeOperation = 'source-over';
              group.drawImage(content, 0, 0);
            } finally { content.close(); }
          }
          const alpha = await bitmap([pass.source]);
          try {
            group.globalCompositeOperation = 'destination-in';
            group.drawImage(alpha, 0, 0);
          } finally { alpha.close(); }
        }
        context.drawImage(scratch, 0, 0);
      } else if (!consumed.has(layer.id)) {
        const ids: string[] = [layer.id];
        while (i + 1 < captured.layers.length && !consumed.has(captured.layers[i + 1].id))
          ids.push(captured.layers[++i].id);
        const image = await bitmap(ids);
        try {
          context.drawImage(image, 0, 0);
        } finally {
          image.close();
        }
      }
    }
    admit();
    const result = await wait(
      new Promise<Blob>((resolve, reject) =>
        output!.toBlob(
          (blob) => (blob ? resolve(blob) : reject(Error('Mask PNG encoding failed.'))),
          'image/png',
        ),
      ),
    );
    admit();
    return result;
  } finally {
    controller.abort(new DOMException('Mask capture finished.', 'AbortError'));
    clearTimeout(timer);
    if (external) EventTarget.prototype.removeEventListener.call(external, 'abort', abort);
    if (output) output.width = output.height = 0;
    if (scratch) scratch.width = scratch.height = 0;
    owners.delete(project);
  }
}
