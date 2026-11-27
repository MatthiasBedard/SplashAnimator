import type { RenderVector } from './render-data';
import { softwareBlend } from './software-blend';

/** Device-pixel box blur of one isolated vector. Embedded verbatim in HTML playback. */
export function paintBoxBlur(
  target: CanvasRenderingContext2D,
  shape:
    | RenderVector
    | {
        blurRadius: number;
        opacity: number;
        blendMode?: RenderVector['blendMode'];
        tint?: { color: string; amount: number };
        worldBounds?: { left: number; top: number; right: number; bottom: number } | null;
      },
  paint: (context: CanvasRenderingContext2D) => void,
  decodedPixels: number,
  selectSoftwareBlend = softwareBlend,
) {
  const view = target.getTransform();
  const radius = Math.round(
    (shape.blurRadius ?? 0) * Math.max(Math.hypot(view.a, view.b), Math.hypot(view.c, view.d)),
  );
  if (!Number.isSafeInteger(radius) || radius < 0) throw Error('Invalid blur raster scale.');
  let left = 0,
    top = 0,
    right = target.canvas.width,
    bottom = target.canvas.height;
  // Children may extend beyond a symbol's registration box, including beyond
  // the visible viewport. Each output tile samples its complete input halo.
  if ('commands' in shape) {
    const m = view.translate(shape.x, shape.y).rotate(shape.rotation);
    if (shape.transform) m.multiplySelf(new DOMMatrix([...shape.transform, 0, 0]));
    left = top = Infinity;
    right = bottom = -Infinity;
    for (const command of shape.commands)
      for (let i = 1; i < command.length; i += 2) {
        const x = command[i] as number,
          y = command[i + 1] as number;
        const px = m.a * x + m.c * y + m.e,
          py = m.b * x + m.d * y + m.f;
        left = Math.min(left, px);
        right = Math.max(right, px);
        top = Math.min(top, py);
        bottom = Math.max(bottom, py);
      }
    if (left === Infinity) return;
    const padX = radius + 2 + 2 * shape.strokeWidth * Math.hypot(m.a, m.c);
    const padY = radius + 2 + 2 * shape.strokeWidth * Math.hypot(m.b, m.d);
    left = Math.max(0, Math.floor(left - padX));
    right = Math.min(target.canvas.width, Math.ceil(right + padX));
    top = Math.max(0, Math.floor(top - padY));
    bottom = Math.min(target.canvas.height, Math.ceil(bottom + padY));
  }
  if ('worldBounds' in shape && shape.worldBounds) {
    const b = shape.worldBounds;
    const xs = [b.left, b.right],
      ys = [b.top, b.bottom];
    left = top = Infinity;
    right = bottom = -Infinity;
    for (const x of xs)
      for (const y of ys) {
        const px = view.a * x + view.c * y + view.e,
          py = view.b * x + view.d * y + view.f;
        left = Math.min(left, px);
        right = Math.max(right, px);
        top = Math.min(top, py);
        bottom = Math.max(bottom, py);
      }
    left = Math.max(0, Math.floor(left - radius - 2));
    right = Math.min(target.canvas.width, Math.ceil(right + radius + 2));
    top = Math.max(0, Math.floor(top - radius - 2));
    bottom = Math.min(target.canvas.height, Math.ceil(bottom + radius + 2));
  }
  if (![left, right, top, bottom].every(Number.isSafeInteger))
    throw Error('Invalid blur raster bounds.');
  if (right <= left || bottom <= top) return;
  const tint = 'tint' in shape ? shape.tint : undefined;
  const rgb = tint ? parseInt(tint.color.slice(1),16) : 0;
  const blend = selectSoftwareBlend(shape.blendMode);
  const maxWidth = Math.min(512, right - left) + 2 * radius,
    maxHeight = Math.min(512, bottom - top) + 2 * radius;
  // Count the destination, decoded images, scratch canvas/readback/output and column sums.
  if (
    !Number.isSafeInteger(decodedPixels) ||
    decodedPixels < 0 ||
    maxWidth > 16384 ||
    maxHeight > 16384 ||
    target.canvas.width * target.canvas.height +
      Math.max(
        decodedPixels,
        (target as CanvasRenderingContext2D & { maskReservedPixels?: number }).maskReservedPixels ??
          0,
      ) +
      (radius ? 3 * maxWidth * maxHeight + 8 * maxWidth : (tint || blend ? 2 : 1) * maxWidth * maxHeight) +
      (blend ? Math.min(512, right - left) * Math.min(512, bottom - top) : 0) >
      64 * 1024 * 1024
  )
    throw Error('Blur working rasters exceed the stage pixel budget.');
  const tile =
    target.canvas.ownerDocument?.createElement('canvas') ??
    new OffscreenCanvas(maxWidth, maxHeight);
  const ctx = tile.getContext('2d', { willReadFrequently: true })!;
  Object.assign(ctx, {
    maskReservedPixels:
      target.canvas.width * target.canvas.height +
      Math.max(
        decodedPixels,
        (target as CanvasRenderingContext2D & { maskReservedPixels?: number }).maskReservedPixels ??
          0,
      ),
  });
  const side = 2 * radius + 1,
    area = side * side;
  function drawTile(x: number, y: number, w: number, h: number, source?: ImageData) {
    if (blend) {
      source ??= ctx.getImageData(0, 0, w, h);
      blend(source.data, target.getImageData(x, y, w, h).data);
    }
    if (source) ctx.putImageData(source, 0, 0);
    target.drawImage(tile, 0, 0, w, h, x, y, w, h);
  }
  target.save();
  try {
    target.resetTransform();
    target.globalAlpha *= shape.opacity ?? 1;
    // Every remaining authored mode is a native Canvas compositing operation.
    if (shape.blendMode)
      target.globalCompositeOperation = blend ? 'source-over' : shape.blendMode as GlobalCompositeOperation;
    for (let y = top; y < bottom; y += 512)
      for (let x = left; x < right; x += 512) {
        const w = Math.min(512, right - x),
          h = Math.min(512, bottom - y),
          width = w + 2 * radius,
          height = h + 2 * radius;
        tile.width = width;
        tile.height = height;
        ctx.setTransform(view.a, view.b, view.c, view.d, view.e - x + radius, view.f - y + radius);
        paint(ctx);
        if (!radius && !tint) {
          drawTile(x, y, w, h);
          continue;
        }
        const image = ctx.getImageData(0, 0, width, height), input = image.data;
        if (tint) {
          const keep = 1 - tint.amount;
          const r = (rgb >> 16) * tint.amount, g = ((rgb >> 8) & 255) * tint.amount, b = (rgb & 255) * tint.amount;
          for (let i = 0; i < input.length; i += 4) {
            input[i] = input[i] * keep + r;
            input[i+1] = input[i+1] * keep + g;
            input[i+2] = input[i+2] * keep + b;
          }
        }
        if (!radius) {
          drawTile(x, y, w, h, image);
          continue;
        }
        const output = ctx.createImageData(w, h);
        const columns = new Float64Array(width * 4);
        function addRow(row: number, sign: number) {
          let p = row * width * 4;
          for (let i = 0; i < columns.length; i += 4, p += 4) {
            const alpha = input[p + 3] * sign;
            columns[i] += input[p] * alpha;
            columns[i + 1] += input[p + 1] * alpha;
            columns[i + 2] += input[p + 2] * alpha;
            columns[i + 3] += alpha;
          }
        }
        for (let row = 0; row < side; row++) addRow(row, 1);
        for (let row = 0; row < h; row++) {
          if (row) {
            addRow(row - 1, -1);
            addRow(row + side - 1, 1);
          }
          const sum = [0, 0, 0, 0];
          for (let col = 0; col < side; col++)
            for (let k = 0; k < 4; k++) sum[k] += columns[col * 4 + k];
          for (let col = 0; col < w; col++) {
            const dst = (row * w + col) * 4,
              alpha = sum[3];
            if (alpha) for (let k = 0; k < 3; k++) output.data[dst + k] = sum[k] / alpha;
            output.data[dst + 3] = alpha / area;
            if (col + 1 < w)
              for (let k = 0; k < 4; k++)
                sum[k] += columns[(col + side) * 4 + k] - columns[col * 4 + k];
          }
        }
        drawTile(x, y, w, h, output);
      }
  } finally {
    target.restore();
    tile.width = tile.height = 0;
  }
}
