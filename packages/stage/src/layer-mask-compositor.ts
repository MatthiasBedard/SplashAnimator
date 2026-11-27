import { MASK_WORKING_PIXELS } from './mask-budget';
import { maskPaintChains, type LayerMask } from '../../document/src/layer-masks';
/** Self-contained factory is also serialized into script-free standalone exports.
 * Four rasters include the caller's target. Publication happens only after every
 * layer has painted successfully; callback resource readiness stays host-owned. */
export function createLayerMaskCompositor(pixelBudget: number, plan: typeof maskPaintChains) {
  return function composite(
    ctx: CanvasRenderingContext2D,
    layers: readonly { id: string; visible: boolean }[],
    masks: readonly LayerMask[],
    paint: (ctx: CanvasRenderingContext2D, id: string) => void,
    decodedPixels = 0,
    groupOpacity = 1,
    outputOpacity?: number,
  ) {
    if (!masks.length) {
      for (const layer of layers) if (layer.visible) paint(ctx, layer.id);
      return;
    }
    const w = ctx.canvas.width,
      h = ctx.canvas.height,
      m = ctx.getTransform();
    if (
      !Number.isSafeInteger(w) ||
      !Number.isSafeInteger(h) ||
      w < 1 ||
      h < 1 ||
      w > 16384 ||
      h > 16384 ||
      !Number.isSafeInteger(decodedPixels) ||
      decodedPixels < 0 ||
      4 * w * h + decodedPixels > pixelBudget
    )
      throw Error('Mask working rasters exceed the shared 64-megapixel budget.');
    if (
      ![m.a, m.b, m.c, m.d, m.e, m.f].every(Number.isFinite) ||
      !Number.isFinite(m.a * m.d - m.b * m.c) ||
      m.a * m.d - m.b * m.c === 0 ||
      (ctx.globalAlpha !== 1 && outputOpacity === undefined) ||
      ctx.globalCompositeOperation !== 'source-over' ||
      ctx.shadowBlur !== 0 ||
      ctx.shadowOffsetX !== 0 ||
      ctx.shadowOffsetY !== 0 ||
      (ctx.filter ?? 'none') !== 'none' ||
      !Number.isFinite(groupOpacity) ||
      groupOpacity < 0 ||
      groupOpacity > 1 || (outputOpacity !== undefined && (!Number.isFinite(outputOpacity) || outputOpacity < 0 || outputOpacity > 1))
    )
      throw Error('Unsupported mask painting view.');
    const canvases = Array.from({ length: 3 }, () => document.createElement('canvas'));
    try {
      for (const canvas of canvases) {
        canvas.width = w;
        canvas.height = h;
      }
      const [output, content, alpha] = canvases.map((c) => c.getContext('2d')!);
      const inherited=(ctx as CanvasRenderingContext2D & {maskReservedPixels?:number}).maskReservedPixels??0;
      for(const surface of [output,content,alpha])Object.assign(surface,{maskReservedPixels:Math.max(decodedPixels,inherited)+3*w*h});
      const reset = (c: CanvasRenderingContext2D) => {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalCompositeOperation = 'source-over';
        c.globalAlpha = 1;
        c.clearRect(0, 0, w, h);
        c.setTransform(m);
        c.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
        c.imageSmoothingQuality = ctx.imageSmoothingQuality;
      };
      reset(output);
      const byId = new Map(layers.map((l) => [l.id, l])),
        { chains, members } = plan(masks);
      for (const layer of layers) {
        const chain = chains.get(layer.id);
        if (chain) {
          reset(content);
          for (const pass of chain) {
            for (const id of pass.members) if (byId.get(id)?.visible) paint(content, id);
            reset(alpha);
            if (byId.get(pass.source)?.visible) paint(alpha, pass.source);
            content.save();
            content.setTransform(1, 0, 0, 1, 0, 0);
            content.globalAlpha = 1;
            content.globalCompositeOperation = 'destination-in';
            content.drawImage(canvases[2], 0, 0);
            content.restore();
          }
          output.save();
          try {
            output.setTransform(1, 0, 0, 1, 0, 0);
            output.globalAlpha = groupOpacity;
            output.drawImage(canvases[1], 0, 0);
          } finally {
            output.restore();
          }
        } else if (!members.has(layer.id) && layer.visible) paint(output, layer.id);
      }
      ctx.save();
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha *= outputOpacity ?? 1;
        ctx.drawImage(canvases[0], 0, 0);
      } finally {
        ctx.restore();
      }
    } finally {
      for (const canvas of canvases) canvas.width = canvas.height = 0;
    }
  };
}
export const compositeLayerMasks = createLayerMaskCompositor(MASK_WORKING_PIXELS, maskPaintChains);
