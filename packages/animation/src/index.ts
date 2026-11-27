import { expandSymbols, type SymbolPaintItem } from '../../geometry/src/symbols';
import { keyAt, type Project, type Vector } from '@splash/document';
export function evaluate(
  project: Project,
  frame: number,
  movieFrames?: Record<string, number>,
  paintItems?: SymbolPaintItem[],
): Vector[] {
  const f = Math.max(0, Math.min(project.duration - 1, Math.floor(frame)));
  return project.layers
    .filter((l) => l.visible)
    .flatMap((l) => {
      const key = keyAt(l, f);
      return expandSymbols(
        project,
        key.shapes,
        f - key.frame,
        (s) => movieFrames?.[l.id + '/' + s.id + '/' + s.symbolId] ?? 0,
        undefined, undefined, paintItems,
      );
    });
}
/** Same basic evaluation as evaluate(), retaining original root-layer boundaries.
 * Interactive callers supply their already-resolved movie/button view separately;
 * this helper does not create, advance or prune runtime clocks. */
export function evaluateLayers(
  project: Project,
  frame: number,
  movieFrames?: Record<string, number>,
) {
  const f = Math.max(0, Math.min(project.duration - 1, Math.floor(frame)));
  return project.layers.map((layer) => {
    const key = keyAt(layer, f);
    return {
      layerId: layer.id,
      shapes: layer.visible
        ? expandSymbols(
            project,
            key.shapes,
            f - key.frame,
            (s) => movieFrames?.[layer.id + '/' + s.id + '/' + s.symbolId] ?? 0,
          )
        : [],
    };
  });
}
export function frameAtTime(seconds: number, fps: number, duration: number): number {
  return Math.floor(Math.max(0, seconds) * fps) % duration;
}
