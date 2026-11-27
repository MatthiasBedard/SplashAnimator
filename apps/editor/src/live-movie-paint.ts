import { compositeLayerMasks } from '../../../packages/stage/src/layer-mask-compositor';
import { movieLayerView, type Project } from '../../../packages/document/src';
import { withLayerScene } from '../../../packages/animation/src/layer-scene';
import {
  createMaskResourceBank,
  acquireMaskResourceLease,
  type MaskResourceLease,
} from '../../../packages/stage/src/mask-resources';
import { renderData, paintCommands, canvasPath } from '../../../packages/stage/src/render-data';
import { paintStyledText } from '../../../packages/stage/src/rich-text';
import { wrapText } from '../../../packages/geometry/src/text-layout';
import { createLiveMovieSession, type LiveMovieFrame } from './live-movie-session';

/** Native readiness/publication is separate from logical clock advancement.
 * The caller owns the session, UI revisions and the visible canvas lifetime.
 * Failed/cancelled native jobs can retry the same admitted phase unchanged. */
export function createLiveMoviePainter(
  source: Project,
  session: ReturnType<typeof createLiveMovieSession>,
  validate: () => void,
  invalidate: () => void = () => {},
) {
  const bank = createMaskResourceBank(movieLayerView(source), { validate });
  let alive = true,
    epoch = 0,
    admitting = false,
    job: AbortController | undefined;
  let ready:
    | {
        phase: LiveMovieFrame;
        lease: MaskResourceLease;
        active: () => void;
      }
    | undefined;
  function clear() {
    epoch++;
    job?.abort();
    job = undefined;
    ready?.lease.release();
    ready = undefined;
  }
  function check(phase: LiveMovieFrame) {
    const admitted = ready;
    if (!admitted || admitted.phase !== phase) throw Error('Live movie resources are not ready.');
    admitted.active();
    admitted.lease.check();
    session.assertCurrent(phase);
    if (ready !== admitted) throw Error('Live movie native phase changed after admission.');
  }
  return {
    async prepare(phase: LiveMovieFrame, current: () => void) {
      clear();
      const controller = new AbortController(),
        owned = epoch;
      job = controller;
      const timer = setTimeout(
        () => controller.abort(Error('Live movie readiness timed out.')),
        60000,
      );
      const active = () => {
        if (admitting) {
          clear();
          throw Error('Live movie native admission cannot reenter.');
        }
        admitting = true;
        try {
          controller.signal.throwIfAborted();
          for (const call of [validate, current]) {
            const result = call() as unknown;
            if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
              void Promise.resolve(result).catch(() => {});
              throw Error('Live movie native admission must be synchronous.');
            }
          }
          if (!alive || job !== controller || epoch !== owned)
            throw Error('Live movie native phase changed.');
          session.assertCurrent(phase);
        } finally {
          admitting = false;
        }
      };
      let lease: MaskResourceLease | undefined;
      try {
        active();
        lease = await acquireMaskResourceLease(bank, session.scene(phase), controller.signal);
        active();
        lease.check();
        // Admission precedes allocation of either viewport raster. Existing
        // decoded-image/working-raster aggregate limits remain unchanged.
        lease.admit(source.width, source.height);
        ready = { phase, lease, active };
        const admitted = lease;
        lease.listen(() => {
          if (ready?.lease === admitted) {
            clear();
            invalidate();
          }
        });
        check(phase);
        lease = undefined;
      } catch (cause) {
        if (job === controller) clear();
        throw cause;
      } finally {
        clearTimeout(timer);
        lease?.release();
      }
    },
    check,
    publish(canvas: HTMLCanvasElement, phase: LiveMovieFrame) {
      check(phase);
      const r = ready!,
        scene = session.scene(phase);
      r.lease.admit(source.width, source.height);
      const work = document.createElement('canvas');
      try {
        work.width = source.width;
        work.height = source.height;
        const ctx = work.getContext('2d');
        if (!ctx) throw Error('Live movie canvas is unavailable.');
        ctx.fillStyle = source.background;
        ctx.fillRect(0, 0, work.width, work.height);
        withLayerScene(scene, (data) => {
          const paintLayer = (ctx: CanvasRenderingContext2D, id: string) => {
            const layer = data.layers.find((l) => l.layerId === id);
            if (!layer?.visible) return;
            for (const shape of layer.shapes) {
              const commands = renderData(shape);
              paintCommands(
                ctx,
                commands,
                wrapText,
                shape.bitmap ? r.lease.images.get(shape.bitmap.assetId) : undefined,
                paintStyledText,
                canvasPath(commands),
              );
            }
          };
          compositeLayerMasks(
            ctx,
            data.layers.map((l) => ({ id: l.layerId, visible: l.visible })),
            data.masks,
            paintLayer,
            r.lease.pixels + (data.masks.length ? source.width * source.height : 0),
          );
        });
        check(phase);
        if (canvas.width !== source.width) canvas.width = source.width;
        if (canvas.height !== source.height) canvas.height = source.height;
        const target = canvas.getContext('2d');
        if (!target) throw Error('Live movie output canvas is unavailable.');
        check(phase);
        target.save();
        try {
          target.setTransform(1, 0, 0, 1, 0, 0);
          target.globalAlpha = 1;
          target.globalCompositeOperation = 'copy';
          target.drawImage(work, 0, 0);
        } finally {
          target.restore();
        }
      } finally {
        work.width = work.height = 0;
      }
    },
    cancel: clear,
    dispose() {
      if (!alive) return;
      alive = false;
      clear();
      bank.dispose();
    },
  };
}
