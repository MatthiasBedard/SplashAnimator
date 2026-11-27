import { clone, id, type Point, type Vector } from '@splash/document';
import { hitPart } from './index';

/** Split only stroke paint; retain the complete compound fill and exact cubic contours. */
export function inkContour(
  source: Vector,
  point: Point,
  stroke: string,
  width: number,
  tolerance = 2,
): Vector[] | null {
  if (
    source.kind !== 'polygon' ||
    source.groups?.length ||
    !source.contours?.length ||
    !source.strokeWidth
  )
    return null;
  if (!Number.isFinite(width) || width < 0)
    throw new Error('Stroke width must be nonnegative and finite.');
  let selected = -1;
  for (let i = source.contours.length - 1; i >= 0; i--) {
    if (
      hitPart(
        { ...source, fillEnabled: false, contours: [source.contours[i]] },
        point,
        tolerance,
      ) === 'stroke'
    ) {
      selected = i;
      break;
    }
  }
  if (selected < 0 || (source.stroke === stroke && source.strokeWidth === width)) return null;
  const result: Vector[] = [];
  if (source.fillEnabled !== false) result.push({ ...clone(source), strokeWidth: 0 });
  const remaining = source.contours.filter((_, i) => i !== selected);
  if (remaining.length)
    result.push({
      ...clone(source),
      id: result.length ? id() : source.id,
      fillEnabled: false,
      contours: clone(remaining),
    });
  result.push({
    ...clone(source),
    id: result.length ? id() : source.id,
    fillEnabled: false,
    contours: clone([source.contours[selected]]),
    stroke,
    strokeWidth: width,
  });
  return result;
}

/** Repaint one existing anchor-to-anchor edge; split stroke chains without flattening curves. */
export function inkSegment(
  source: Vector,
  point: Point,
  stroke: string,
  width: number,
  tolerance = 2,
): Vector[] | null {
  if (source.groups?.length || !source.strokeWidth) return null;
  const rings =
    source.kind === 'polygon'
      ? source.contours
      : source.kind === 'bezier' && source.nodes
        ? [source.nodes]
        : undefined;
  if (!rings?.length) return null;
  if (!Number.isFinite(width) || width < 0)
    throw new Error('Stroke width must be nonnegative and finite.');
  const closed = source.kind === 'polygon' || !!source.closed;
  if (!closed && source.strokeCap !== 'butt') return null;
  const template: Vector = clone({ ...source, contours: undefined, nodes: undefined, points: [] });
  const path = (nodes: NonNullable<Vector['nodes']>, color: string, size: number): Vector => {
    const result = clone(template);
    delete result.contours;
    result.kind = 'bezier';
    result.nodes = clone(nodes);
    result.points = [];
    result.closed = false;
    result.fillEnabled = false;
    result.strokeCap = 'butt';
    result.stroke = color;
    result.strokeWidth = size;
    return result;
  };
  for (let r = rings.length - 1; r >= 0; r--) {
    const ring = rings[r],
      count = ring.length - (closed ? 0 : 1);
    for (let i = count - 1; i >= 0; i--) {
      const edge = path([ring[i], ring[(i + 1) % ring.length]], stroke, width);
      if (hitPart({ ...edge, strokeWidth: source.strokeWidth }, point, tolerance) !== 'stroke')
        continue;
      if (source.stroke === stroke && source.strokeWidth === width) return null;
      const result: Vector[] = [];
      if (source.fillEnabled !== false && closed) result.push({ ...clone(source), strokeWidth: 0 });
      const other = rings.filter((_, n) => n !== r);
      if (other.length)
        result.push({ ...clone(source), fillEnabled: false, contours: clone(other) });
      if (closed && ring.length > 1) {
        const rest = Array.from({ length: ring.length }, (_, n) => ring[(i + 1 + n) % ring.length]);
        result.push(path(rest, source.stroke, source.strokeWidth));
      } else if (!closed) {
        if (i > 0) result.push(path(ring.slice(0, i + 1), source.stroke, source.strokeWidth));
        if (i + 2 < ring.length)
          result.push(path(ring.slice(i + 1), source.stroke, source.strokeWidth));
      }
      result.push(edge);
      result.forEach((s, n) => {
        s.id = n ? id() : source.id;
      });
      return result;
    }
  }
  return null;
}

/** Detached connectivity candidates distinguish disconnected contours of the same object. */
export function contourInkPlan(candidates: Vector[], seed: string, point: Point, tolerance = 2) {
  const owners = new Map<string, { source: string; contour?: number }>();
  const strokes: Vector[] = [];
  let target: string | undefined;
  for (const source of candidates) {
    const contours = source.kind === 'polygon' ? source.contours : undefined;
    if (contours?.length) {
      for (let i = 0; i < contours.length; i++) {
        const piece = {
          ...clone({ ...source, contours: undefined }),
          id: id(),
          fillEnabled: false,
          contours: clone([contours[i]]),
        };
        strokes.push(piece);
        owners.set(piece.id, { source: source.id, contour: i });
        if (source.id === seed && hitPart(piece, point, tolerance) === 'stroke') target = piece.id;
      }
    } else {
      strokes.push({ ...clone(source), fillEnabled: false });
      owners.set(source.id, { source: source.id });
      if (source.id === seed) target = source.id;
    }
  }
  return {
    strokes,
    target,
    selected(connected: ReadonlySet<string>): string[] {
      const ids = new Set(
        [...connected].flatMap((token) => {
          const owner = owners.get(token);
          return owner ? [owner.source] : [];
        }),
      );
      return candidates.filter((source) => ids.has(source.id)).map((source) => source.id);
    },
    apply(artwork: Vector[], connected: Set<string>, stroke: string, width: number): Vector[] {
      const selected = new Map<string, Set<number>>();
      for (const token of connected) {
        const owner = owners.get(token);
        if (!owner) continue;
        const indices = selected.get(owner.source) ?? new Set<number>();
        indices.add(owner.contour ?? -1);
        selected.set(owner.source, indices);
      }
      return artwork.flatMap((source) => {
        const indices = selected.get(source.id);
        if (!indices || (source.stroke === stroke && source.strokeWidth === width)) return [source];
        if (indices.has(-1) || indices.size === source.contours?.length)
          return [{ ...clone(source), stroke, strokeWidth: width }];
        const result: Vector[] = [];
        if (source.fillEnabled !== false) result.push({ ...clone(source), strokeWidth: 0 });
        const remaining = source.contours!.filter((_, i) => !indices.has(i));
        result.push({
          ...clone(source),
          id: result.length ? id() : source.id,
          fillEnabled: false,
          contours: clone(remaining),
        });
        result.push({
          ...clone(source),
          id: id(),
          fillEnabled: false,
          contours: clone(source.contours!.filter((_, i) => indices.has(i))),
          stroke,
          strokeWidth: width,
        });
        return result;
      });
    },
  };
}
