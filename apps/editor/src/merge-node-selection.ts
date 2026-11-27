import type { BezierNode, Point, Vector } from '../../../packages/document/src';
import { worldPoint, hit } from '../../../packages/geometry/src';
import { PAINT_GRID_STEP } from '../../../packages/geometry/src/paint-clipping';

export type NodePick = { index: number; part: 'anchor' | 'in' | 'out' };
export function captureMergeNodeSets(
  artwork: Vector[],
  sets: Record<string, number[]>,
  owner: string,
  pick: NodePick,
) {
  return artwork
    .flatMap((shape) => {
      const indices = sets[shape.id];
      if (!indices?.length) return [];
      const captured = captureMergeNodeSelection(
        shape,
        indices,
        shape.id === owner ? pick : { index: indices[0], part: 'anchor' },
      );
      return captured ? [captured] : [];
    })
    .sort((a, b) => Number(b.id === owner) - Number(a.id === owner));
}
export function restoreMergeNodeSets(
  captured: ReturnType<typeof captureMergeNodeSets>,
  artwork: Vector[],
) {
  const sets: Record<string, number[]> = {};
  let focus: ReturnType<typeof restoreMergeNodeSelection>;
  for (const original of captured) {
    const restored = restoreMergeNodeSelection(original, artwork);
    if (!restored) continue;
    focus ??= restored;
    sets[restored.id] = [...new Set([...(sets[restored.id] ?? []), ...restored.indices])];
  }
  return { sets, focus };
}
const nodes = (shape: Vector): BezierNode[] =>
  shape.contours?.flat() ?? shape.nodes ?? shape.points;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** UI selection only: never changes merged geometry, IDs, order or tolerances. */
export function captureMergeNodeSelection(shape: Vector, indices: number[], pick: NodePick) {
  const original = nodes(shape),
    active = original[pick.index];
  if (!active) return;
  const anchors = [...new Set([...indices, pick.index])]
    .filter((i) => original[i])
    .map((index) => ({ index, point: worldPoint(shape, original[index]) }));
  const anchor = worldPoint(shape, active),
    handle = pick.part === 'anchor' ? undefined : active[pick.part];
  const target = handle ? worldPoint(shape, handle) : anchor;
  const magnitude = Math.max(1, ...[anchor, target].flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));
  // Existing arrangement output may lie on the paint grid. This is a matching
  // allowance for UI metadata, never an input to geometry or hit ownership.
  const tolerance = Math.max(2 * PAINT_GRID_STEP, 32 * Number.EPSILON * magnitude);
  return {
    id: shape.id,
    anchors,
    anchor,
    target,
    pick: { ...pick },
    tolerance,
    fill: shape.fill,
    filled: shape.kind !== 'line' && shape.fillEnabled !== false,
    stroke: shape.stroke,
    strokeWidth: shape.strokeWidth,
    opacity: shape.opacity ?? 1,
  };
}

export function restoreMergeNodeSelection(
  captured: NonNullable<ReturnType<typeof captureMergeNodeSelection>>,
  artwork: Vector[],
) {
  const { tolerance } = captured,
    buckets = new Map<string, typeof captured.anchors>();
  const key = (x: number, y: number) => `${x},${y}`;
  for (const anchor of captured.anchors) {
    const cell = key(
      Math.floor(anchor.point.x / tolerance),
      Math.floor(anchor.point.y / tolerance),
    );
    const bucket = buckets.get(cell);
    if (bucket) bucket.push(anchor);
    else buckets.set(cell, [anchor]);
  }
  type Match = {
    id: string;
    indices: number[];
    pick: NodePick | null;
    score: number;
    error: number;
  };
  let best: Match | undefined, fallback: Vector | undefined;
  for (const shape of artwork) {
    const compatible = captured.filled
      ? shape.fillEnabled !== false && shape.fill === captured.fill
      : shape.fillEnabled === false &&
        shape.stroke === captured.stroke &&
        shape.strokeWidth === captured.strokeWidth;
    if (!compatible || (shape.opacity ?? 1) !== captured.opacity) continue;
    const mapped = new Map<number, { index: number; error: number }>();
    let active: { index: number; error: number; part: NodePick['part'] } | undefined;
    for (const [index, node] of nodes(shape).entries()) {
      const point = worldPoint(shape, node),
        x = Math.floor(point.x / tolerance),
        y = Math.floor(point.y / tolerance);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const anchor of buckets.get(key(x + dx, y + dy)) ?? []) {
            const error = distance(point, anchor.point);
            if (error <= tolerance && error < (mapped.get(anchor.index)?.error ?? Infinity))
              mapped.set(anchor.index, { index, error });
          }
      const error = distance(point, captured.anchor);
      if (error > tolerance) continue;
      let part: NodePick['part'] = 'anchor',
        handleError = Infinity;
      if (captured.pick.part !== 'anchor')
        for (const role of ['in', 'out'] as const)
          if (node[role]) {
            const d = distance(worldPoint(shape, node[role]!), captured.target);
            if (d <= tolerance && d < handleError) {
              part = role;
              handleError = d;
            }
          }
      if (!active || error < active.error || (part !== 'anchor' && active.part === 'anchor'))
        active = { index, error, part };
    }
    if (active) {
      const indices = [...new Set([...mapped.values()].map((v) => v.index))],
        score =
          indices.length * 4 +
          (active.part === captured.pick.part ? 2 : 0) +
          (shape.id === captured.id ? 1 : 0);
      if (!best || score > best.score || (score === best.score && active.error < best.error))
        best = {
          id: shape.id,
          indices,
          pick: { index: active.index, part: active.part },
          score,
          error: active.error,
        };
    } else if (!fallback && hit(shape, captured.anchor, tolerance)) fallback = shape;
  }
  if (best) return { id: best.id, indices: best.indices, pick: best.pick };
  // A collinear anchor may legitimately disappear during arrangement. Keep its
  // surviving line selected, without inventing a new authored anchor.
  if (fallback) return { id: fallback.id, indices: [], pick: null };
}
