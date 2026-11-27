/** One viewport-sized raster. The scene and source keys are compared separately.
 * A null scene key bypasses reuse for transient previews. Failed paints never cache.
 */
export class StageBackdrop {
  private canvas?: HTMLCanvasElement;
  private key: string | null = null;
  private sourceKey?: string;

  clear() {
    if (this.canvas) this.canvas.width = this.canvas.height = 0;
    this.canvas = undefined;
    this.key = null;
    this.sourceKey = undefined;
  }

  updateRegion(
    width: number, height: number, key: string,
    before: string, after: string,
    region: { x: number; y: number; width: number; height: number },
    paint: (ctx: CanvasRenderingContext2D) => void,
  ) {
    const canvas = this.canvas;
    if (!canvas || canvas.width !== width || canvas.height !== height ||
      this.key !== key || this.sourceKey !== before) return;
    const ctx = canvas.getContext('2d')!;
    this.key = null;
    ctx.save();
    try {
      ctx.resetTransform();
      const clip = new Path2D();
      clip.rect(region.x, region.y, region.width, region.height);
      ctx.clip(clip);
      paint(ctx);
      this.key = key;
      this.sourceKey = after;
    } finally {
      ctx.restore();
    }
  }

  draw(
    target: CanvasRenderingContext2D,
    width: number,
    height: number,
    key: string | null,
    paint: (ctx: CanvasRenderingContext2D) => void,
    sourceKey?: string,
  ) {
    const canvas = (this.canvas ??= document.createElement('canvas'));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      this.key = null;
    }
    if (key === null || key !== this.key || sourceKey !== this.sourceKey) {
      this.key = null;
      const ctx = canvas.getContext('2d')!;
      ctx.resetTransform();
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      try {
        paint(ctx);
      } finally {
        ctx.restore();
      }
      this.key = key;
      this.sourceKey = sourceKey;
    }
    target.save();
    try {
      target.resetTransform();
      target.drawImage(canvas, 0, 0);
    } finally {
      target.restore();
    }
  }
}
