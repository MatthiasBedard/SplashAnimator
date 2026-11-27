import { clone, keyAt, validateProject, type Project } from '../../document/src';
import { expandSelection } from '../../document/src/groups';
import { transformVectors, type Matrix } from '../../geometry/src/affine';
import { lassoContains, combineSelection, type SelectionMode } from '../../geometry/src/lasso';
import type { Point } from '../../document/src';

/** Frontmost-first object/group picking across exposure-scoped identities. */
export function pickMultiFrameGroup<Track extends ReturnType<typeof multiFrameKeys>[number]>(
  tracks: Track[],
  contains: (shape: import('../../document/src').Vector, track: Track) => boolean,
  previous: string[] | null,
  cycle = false,
): string[] {
  const candidates: string[][] = [];
  for (const track of [...tracks].sort((a, b) => b.order - a.order))
    for (const key of [...track.keys].reverse()) {
      const seen = new Set<string>();
      for (const shape of [...key.shapes].reverse()) {
        if (seen.has(shape.id) || !contains(shape, track)) continue;
        const group = expandSelection(key.shapes, [shape.id], []);
        for (const id of group) seen.add(id);
        const candidate = group.map((id) => multiFrameId(track.layer.id, key.frame, id));
        if (!cycle) return candidate;
        candidates.push(candidate);
      }
    }
  if (!candidates.length) return [];
  const selected = new Set(previous ?? []);
  const current = candidates.findIndex(
    (ids) => ids.length === selected.size && ids.every((id) => selected.has(id)),
  );
  return candidates[(current + 1) % candidates.length];
}

export function selectMultiFrames(
  project: Project,
  layers: string[],
  start: number,
  end: number,
  ring: Point[],
  previous: string[] | null,
  mode: SelectionMode,
) {
  if (ring.length > 1024 || ring.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new Error('Multi-frame selection requires at most 1,024 finite points.');
  multiFrameMembers(project, layers, start, end, previous);
  const all: string[] = [],
    hits: string[] = [];
  for (const { layer, keys } of multiFrameKeys(project, layers, start, end))
    for (const key of keys) {
      all.push(...key.shapes.map((s) => multiFrameId(layer.id, key.frame, s.id)));
      const ids = expandSelection(
        key.shapes,
        key.shapes.filter((s) => lassoContains(s, ring)).map((s) => s.id),
        [],
      );
      hits.push(...ids.map((id) => multiFrameId(layer.id, key.frame, id)));
    }
  return combineSelection(previous ?? all, hits, mode);
}

export function deleteMultiFrames(
  project: Project,
  layers: string[],
  start: number,
  end: number,
  selection: string[] | null,
) {
  const candidate = clone(project);
  const members = new Set(multiFrameMembers(candidate, layers, start, end, selection));
  for (const { keys } of multiFrameKeys(candidate, layers, start, end))
    for (const key of keys) key.shapes = key.shapes.filter((s) => !members.has(s));
  validateProject(candidate);
  return candidate;
}

export function multiFrameId(layer: string, frame: number, shape: string) {
  return JSON.stringify([layer, frame, shape]);
}

export function multiFrameMembers(
  project: Project,
  layers: string[],
  start: number,
  end: number,
  selection: string[] | null = null,
) {
  const requested = selection === null ? null : new Set(selection);
  const remaining = new Set(requested);
  const members = multiFrameKeys(project, layers, start, end).flatMap(({ layer, keys }) =>
    keys.flatMap((key) => {
      if (!requested) return key.shapes;
      const picked = key.shapes.filter(shape => {
        const id = multiFrameId(layer.id, key.frame, shape.id);
        remaining.delete(id);
        return requested.has(id);
      }).map(shape => shape.id);
      const ids = new Set(expandSelection(key.shapes, picked, []));
      return key.shapes.filter((s) => ids.has(s.id));
    }),
  );
  if (remaining.size) throw new Error('Multi-frame selection is stale.');
  return members;
}

/** Whole key exposures intersecting an inclusive range; never split holds or reset symbol ages. */
export function multiFrameKeys(project: Project, layerIds: string[], start: number, end: number) {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end >= project.duration
  )
    throw new Error('Invalid multi-frame range.');
  if (!layerIds.length || new Set(layerIds).size !== layerIds.length)
    throw new Error('Choose unique multi-frame layers.');
  let count = 0,
    shapes = 0;
  return layerIds.map((id) => {
    const layer = project.layers.find((l) => l.id === id);
    if (!layer || layer.locked || !layer.visible)
      throw new Error('Multi-frame layers must be visible, unlocked and present.');
    const first = keyAt(layer, start).frame;
    const keys = layer.keys.filter((k) => k.frame >= first && k.frame <= end);
    count += keys.length;
    shapes += keys.reduce((total, key) => total + key.shapes.length, 0);
    if (count > 128 || shapes > 10000)
      throw new Error('Choose at most 128 exposures and 10,000 shapes for multi-frame editing.');
    return { layer, keys, order: project.layers.indexOf(layer) };
  });
}

export function translateMultiFrames(
  project: Project,
  layers: string[],
  start: number,
  end: number,
  dx: number,
  dy: number,
  selection: string[] | null = null,
) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy))
    throw new Error('Enter finite movement values.');
  const candidate = clone(project);
  for (const shape of multiFrameMembers(candidate, layers, start, end, selection)) {
    shape.x += dx;
    shape.y += dy;
  }
  validateProject(candidate);
  return candidate;
}

export function transformMultiFrames(
  project: Project,
  layers: string[],
  start: number,
  end: number,
  operation: Matrix,
  selection: string[] | null = null,
) {
  const candidate = clone(project);
  if (
    operation.some((n) => !Number.isFinite(n)) ||
    Math.abs(operation[0] * operation[3] - operation[1] * operation[2]) < 1e-10
  )
    throw new Error('Choose a finite, nonsingular multi-frame transform.');
  transformVectors(multiFrameMembers(candidate, layers, start, end, selection), operation);
  validateProject(candidate);
  return candidate;
}
