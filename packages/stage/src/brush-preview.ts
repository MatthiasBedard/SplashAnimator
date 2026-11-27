import type { Vector } from '@splash/document';
import { brushOpacitySegment, brushPreviewParts, type BrushOpacityPart, type Command } from '../../geometry/src/drawing';

const PRESSURE_READ_TILE = 512;

type PaintBounds = { x: number; y: number; r: number; b: number };
type PressurePath = Pick<BrushOpacityPart, 'from' | 'to'> & { path: Path2D };

/** Append-only, viewport-sized presentation cache. Never changes saved samples.
 * Each update tessellates only the new sample pairs, regardless of stroke length.
 * An opaque coverage mask prevents translucent paint darkening at every join.
 */
class BrushRaster {
  private mask?: HTMLCanvasElement;
  private colored?: HTMLCanvasElement;
  private key = '';
  private count = 0;
  private fill: string | undefined;
  private pending?: Generator<Command[]>;
  private bounds?: PaintBounds;
  private bands = new Map<number, PaintBounds>();
  private unbounded = false;
  private compact = false;

  private clear() {
    this.key = '';
    this.count = 0;
    this.pending = undefined;
    this.fill = undefined;
    this.bounds = undefined;
    this.bands.clear();
    this.unbounded = false;
    this.compact = false;
    this.mask = this.colored = undefined;
  }

  private includePaint(bounds: PaintBounds, height: number) {
    const prior = this.bounds;
    this.bounds = prior
      ? { x: Math.min(prior.x, bounds.x), y: Math.min(prior.y, bounds.y),
          r: Math.max(prior.r, bounds.r), b: Math.max(prior.b, bounds.b) }
      : bounds;
    // Cap the number of display blits independently of zoom and device scale.
    const bandHeight = Math.max(64, Math.ceil(height / 24));
    for (let row = Math.floor(bounds.y / bandHeight); row * bandHeight < bounds.b; row++) {
      const old = this.bands.get(row);
      const band = { ...bounds, y: Math.max(bounds.y, row * bandHeight), b: Math.min(bounds.b, (row + 1) * bandHeight) };
      this.bands.set(row, old
        ? { x: Math.min(old.x, band.x), y: Math.min(old.y, band.y),
            r: Math.max(old.r, band.r), b: Math.max(old.b, band.b) }
        : band);
    }
  }

  private sparseBands(bounds: PaintBounds) {
    if (this.unbounded || this.bands.size < 2) return;
    let bandArea = 0;
    for (const band of this.bands.values()) bandArea += (band.r - band.x) * (band.b - band.y);
    const area = (bounds.r - bounds.x) * (bounds.b - bounds.y);
    // Keep one copy for dense paint. The bands only help when they exclude
    // a substantial transparent area from the bounding rectangle.
    if (bandArea <= area / 2) return this.bands.values();
  }

  private compositePaint(ctx: CanvasRenderingContext2D, bounds: PaintBounds) {
    const bands = this.sparseBands(bounds);
    if (this.compact && !bands) {
      ctx.drawImage(this.colored!, bounds.x, bounds.y);
      return;
    }
    const regions = bands ?? [bounds];
    const originX = this.compact ? bounds.x : 0;
    const originY = this.compact ? bounds.y : 0;
    for (const { x, y, r, b } of regions) {
      const width = r - x, height = b - y;
      ctx.drawImage(this.colored!, x - originX, y - originY, width, height, x, y, width, height);
    }
  }

  private paintPressureBatch(mask: CanvasRenderingContext2D, paths: PressurePath[], bounds: PaintBounds) {
    if (bounds.r <= bounds.x || bounds.b <= bounds.y) return;
    mask.save();
    mask.setTransform(1, 0, 0, 1, 0, 0);
    // Lighten uses opaque black under the incoming paths. Add it behind
    // retained coverage, so earlier pressure and antialiasing stay exact.
    mask.globalCompositeOperation = 'destination-over';
    mask.fillStyle = '#000000';
    mask.fillRect(bounds.x, bounds.y, bounds.r - bounds.x, bounds.b - bounds.y);
    mask.restore();

    const shade = (alpha: number) => `rgb(${alpha * 255} ${alpha * 255} ${alpha * 255})`;
    for (const { from, to, path } of paths) {
      if (from[2] === to[2] || (from[0] === to[0] && from[1] === to[1])) {
        mask.fillStyle = shade(Math.max(from[2], to[2]));
      } else {
        const ramp = mask.createLinearGradient(from[0], from[1], to[0], to[1]);
        ramp.addColorStop(0, shade(from[2]));
        ramp.addColorStop(1, shade(to[2]));
        mask.fillStyle = ramp;
      }
      mask.fill(path);
    }
  }

  draw(ctx: CanvasRenderingContext2D, brush: Vector, budget: { samples: number; parts: number }, released: boolean) {
    const transform = ctx.getTransform();
    const pressurePaint = !!brush.brush?.opacityProfile;
    const key = JSON.stringify([
      brush.id,
      brush.x,
      brush.y,
      brush.rotation,
      brush.transform,
      brush.brush,
      brush.strokeWidth,
      ctx.canvas.width,
      ctx.canvas.height,
      transform.a,
      transform.b,
      transform.c,
      transform.d,
      transform.e,
      transform.f,
    ]);
    if (key !== this.key || brush.points.length < this.count || (this.compact && this.fill !== brush.fill)) {
      this.clear();
      if (!budget.samples || !budget.parts) return true;
      this.key = key;
      this.mask = document.createElement('canvas');
      this.colored = document.createElement('canvas');
      for (const canvas of [this.mask, this.colored]) {
        canvas.width = ctx.canvas.width;
        canvas.height = ctx.canvas.height;
      }
      // The fresh color surface has no older pixels to recolor.
      this.fill = brush.fill;
    }
    const end = Math.min(
      brush.points.length,
      this.count + budget.samples,
    );
    let changed = false;
    // Bounds belong only to the new batch, never to the accumulated stroke.
    // Cubic control hulls conservatively enclose all rasterized curve pixels.
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    if (this.count !== end) {
      const mask = this.mask!.getContext('2d', pressurePaint ? { willReadFrequently: true } : undefined)!;
      const pressurePaths: PressurePath[] = [];
      mask.setTransform(transform);
      let path = new Path2D();
      const segment = { ...brush, points: [] as Vector['points'] };
      mask.save();
      mask.translate(brush.x, brush.y);
      mask.rotate((brush.rotation * Math.PI) / 180);
      if (brush.transform) mask.transform(...brush.transform, 0, 0);
      mask.fillStyle = '#ffffff';
      if (pressurePaint) mask.globalCompositeOperation = 'lighten';
      const matrix = mask.getTransform();
      const include = (x: number, y: number) => {
        const px = matrix.a * x + matrix.c * y + matrix.e;
        const py = matrix.b * x + matrix.d * y + matrix.f;
        left = Math.min(left, px);
        top = Math.min(top, py);
        right = Math.max(right, px);
        bottom = Math.max(bottom, py);
      };
      // Presentation budget only: keep all samples, and drain the remaining
      // queue on later frames, including while vector finishing is pending.
      let batchSamples = 0;
      while (this.count < end && budget.parts > 0) {
        const pressurePart = pressurePaint
          ? brushOpacitySegment(brush, brush.points[this.count - 1], brush.points[this.count])
          : undefined;
        if (!pressurePart && !this.pending) {
          const i = this.count;
          segment.points = i ? [brush.points[i - 1], brush.points[i]] : [brush.points[i]];
          this.pending = brushPreviewParts({ ...segment });
        }
        const next = pressurePart ? { done: false as const, value: pressurePart.commands } : this.pending!.next();
        if (next.done) {
          this.pending = undefined;
          this.count++;
          batchSamples++;
          budget.samples--;
          if (batchSamples % 128 === 0) {
            mask.fill(path);
            path = new Path2D();
          }
          continue;
        }
        changed = true;
        budget.parts--;
        for (const c of next.value) {
          if (c[0] === 'M' || c[0] === 'L') include(c[1], c[2]);
          else if (c[0] === 'C') {
            include(c[1], c[2]);
            include(c[3], c[4]);
            include(c[5], c[6]);
          }
          if (c[0] === 'M') path.moveTo(c[1], c[2]);
          else if (c[0] === 'L') path.lineTo(c[1], c[2]);
          else if (c[0] === 'C') path.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
          else path.closePath();
        }
        if (pressurePart) {
          pressurePaths.push({ from: pressurePart.from, to: pressurePart.to, path });
          path = new Path2D();
          this.count++;
          budget.samples--;
        }
      }
      // Pause only between complete closed parts. The lazy cursor resumes
      // without replaying any older samples or dabs on the next frame.
      if (pressurePaths.length) {
        const { width, height } = mask.canvas;
        const bounds = [left, top, right, bottom].every(Number.isFinite)
          ? { x: Math.max(0, Math.floor(left) - 2), y: Math.max(0, Math.floor(top) - 2),
              r: Math.min(width, Math.ceil(right) + 2), b: Math.min(height, Math.ceil(bottom) + 2) }
          : { x: 0, y: 0, r: width, b: height };
        this.paintPressureBatch(mask, pressurePaths, bounds);
      } else if (changed && !pressurePaint) mask.fill(path);
      mask.restore();
    }
    // Recolor only newly touched device pixels. A long stroke must not grow
    // either a vector replay or a full-canvas copy/recolor cost on every input.
    // Copy/source-in clear outside their source, so clip both operations to the
    // same dirty rectangle to retain all previously colored coverage exactly.
    const recolor = this.fill !== brush.fill;
    if (!this.compact && (changed || recolor)) {
      const width = this.colored!.width,
        height = this.colored!.height;
      const bounded = [left, top, right, bottom].every(Number.isFinite);
      if (changed && !bounded) this.unbounded = true;
      const x = recolor || !bounded ? 0 : Math.max(0, Math.min(width, Math.floor(left) - 2));
      const y = recolor || !bounded ? 0 : Math.max(0, Math.min(height, Math.floor(top) - 2));
      const r = recolor || !bounded ? width : Math.max(0, Math.min(width, Math.ceil(right) + 2));
      const b = recolor || !bounded ? height : Math.max(0, Math.min(height, Math.ceil(bottom) + 2));
      if (changed && bounded) {
        const touched = {
          x: Math.max(0, Math.floor(left) - 2),
          y: Math.max(0, Math.floor(top) - 2),
          r: Math.min(width, Math.ceil(right) + 2),
          b: Math.min(height, Math.ceil(bottom) + 2),
        };
        if (touched.r > touched.x && touched.b > touched.y) {
          this.includePaint(touched, height);
        }
      }
      if (r > x && b > y) {
        const color = this.colored!.getContext('2d')!;
        color.save();
        color.beginPath();
        color.rect(x, y, r - x, b - y);
        color.clip();
        if (pressurePaint) {
          const mask = this.mask!.getContext('2d')!;
          for (let top = y; top < b; top += PRESSURE_READ_TILE)
            for (let left = x; left < r; left += PRESSURE_READ_TILE) {
              const encoded = mask.getImageData(left, top,
                Math.min(PRESSURE_READ_TILE, r - left), Math.min(PRESSURE_READ_TILE, b - top));
              for (let i = 0; i < encoded.data.length; i += 4) encoded.data[i + 3] = encoded.data[i];
              color.putImageData(encoded, left, top);
            }
        } else {
          color.globalCompositeOperation = 'copy';
          color.drawImage(this.mask!, x, y, r - x, b - y, x, y, r - x, b - y);
        }
        color.globalCompositeOperation = 'source-in';
        color.fillStyle = brush.fill;
        color.fillRect(x, y, r - x, b - y);
        color.restore();
      }
      this.fill = brush.fill;
    }
    if (released && this.count === brush.points.length && !this.compact) {
      const tile = this.mask!, bounds = this.bounds;
      this.mask = undefined;
      this.compact = true;
      if (bounds) {
        const { x, y, r, b } = bounds;
        tile.width = r - x;
        tile.height = b - y;
        const compact = tile.getContext('2d')!;
        for (const band of this.sparseBands(bounds) ?? [bounds]) {
          const width = band.r - band.x, height = band.b - band.y;
          compact.drawImage(this.colored!, band.x, band.y, width, height, band.x - x, band.y - y, width, height);
        }
        this.colored = tile;
      } else {
        this.colored = undefined;
      }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha *= brush.opacity ?? 1;
    if (this.colored) {
      const bounds = this.bounds;
      if (bounds && !this.unbounded && ctx.globalCompositeOperation === 'source-over') {
        this.compositePaint(ctx, bounds);
      } else if (this.compact && bounds) {
        ctx.drawImage(this.colored, bounds.x, bounds.y);
      } else {
        ctx.drawImage(this.colored, 0, 0);
      }
    }
    ctx.restore();
    return this.count < brush.points.length;
  }
}

/** Composite completed input and the current gesture in stroke order, using
 * one repaint and one tessellation budget per display frame for the queue. */
export class BrushPreview {
  private rasters = new Map<string, BrushRaster>();
  private frame: number | undefined;
  private budget = { samples: 256, parts: 1024 };
  private repaint = false;

  constructor(private readonly paint?: () => void) {}

  requestDraw() {
    this.schedule(true);
  }

  private schedule(repaint: boolean) {
    this.repaint ||= repaint;
    if (!this.paint || this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.budget = { samples: 256, parts: 1024 };
      const repaint = this.repaint;
      this.repaint = false;
      if (repaint) this.paint?.();
    });
  }

  clear() {
    this.rasters.clear();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.repaint = false;
    this.budget = { samples: 256, parts: 1024 };
  }

  draw(ctx: CanvasRenderingContext2D, brush: Vector) {
    this.drawQueue(ctx, [], brush);
  }

  drawQueue(ctx: CanvasRenderingContext2D, released: readonly Vector[], active?: Vector | null, drawOther?: (shape: Vector) => void) {
    if (!this.paint) this.budget = { samples: Infinity, parts: Infinity };
    const brushes = active ? [...released, active] : released;
    const present = new Set(brushes.map((brush) => brush.id));
    for (const id of this.rasters.keys()) if (!present.has(id)) this.rasters.delete(id);
    let pending = false;
    const before = this.budget.parts;
    // Reserve work for the pointer while a previous long stroke still drains.
    const reserve = {
      samples: active?.kind === 'brush' && released.length ? Math.min(64, this.budget.samples) : 0,
      parts: active?.kind === 'brush' && released.length ? Math.min(256, this.budget.parts) : 0,
    };
    this.budget.samples -= reserve.samples;
    this.budget.parts -= reserve.parts;
    for (const brush of brushes) {
      if (drawOther && brush.kind !== 'brush') {
        drawOther(brush);
        continue;
      }
      if (brush === active) {
        this.budget.samples += reserve.samples;
        this.budget.parts += reserve.parts;
      }
      let raster = this.rasters.get(brush.id);
      if (!raster) {
        raster = new BrushRaster();
        this.rasters.set(brush.id, raster);
      }
      pending = raster.draw(ctx, brush, this.budget, brush !== active) || pending;
    }
    if (pending || this.budget.parts !== before) this.schedule(pending);
  }
}
