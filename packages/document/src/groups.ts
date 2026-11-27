import { clone, id, type Vector } from './index';
export function inScope(s: Vector, scope: string[]) {
  return scope.every((group, index) => s.groups?.[index] === group);
}
export function selectionUnit(s: Vector, depth: number) {
  return s.groups?.[depth] ?? s.id;
}
export function expandSelection(shapes: Vector[], selected: string[], scope: string[]): string[] {
  const selectedIds = new Set(selected);
  const units = new Set(
    shapes
      .filter((s) => selectedIds.has(s.id) && inScope(s, scope))
      .map((s) => selectionUnit(s, scope.length)),
  );
  return shapes
    .filter((s) => inScope(s, scope) && units.has(selectionUnit(s, scope.length)))
    .map((s) => s.id);
}
/** Selected units become a contiguous group at the highest selected stacking position. */
export function groupVectors(shapes: Vector[], selected: string[], scope: string[]): string[] {
  const ids = expandSelection(shapes, selected, scope);
  const memberIds = new Set(ids);
  const members = shapes.filter((s) => memberIds.has(s.id));
  if (new Set(members.map((s) => selectionUnit(s, scope.length))).size < 2 || scope.length >= 32)
    return ids;
  if (members.some((s) => (s.groups?.length ?? 0) >= 32)) return ids;
  const group = id(),
    last = shapes.length - 1 - [...shapes].reverse().findIndex((s) => memberIds.has(s.id));
  const below = shapes.slice(0, last + 1).filter((s) => !memberIds.has(s.id));
  const above = shapes.slice(last + 1);
  members.forEach((s) => {
    s.groups = [...scope, group, ...(s.groups ?? []).slice(scope.length)];
  });
  shapes.splice(0, shapes.length, ...below, ...members, ...above);
  return ids;
}
export function ungroupVectors(shapes: Vector[], selected: string[], scope: string[]) {
  const ids = expandSelection(shapes, selected, scope);
  const memberIds = new Set(ids);
  shapes
    .filter((s) => memberIds.has(s.id))
    .forEach((s) => {
      if (s.groupBlur && s.groupBlur.group === s.groups?.[scope.length]) delete s.groupBlur;
      if (s.groups?.[scope.length]) s.groups.splice(scope.length, 1);
    });
  return ids;
}

export type GroupPlacement = { anchor: string; side: 'before' | 'after' };

/** Move complete selection units to an existing group (or root).
 * Without placement, append above destination children. An anchor identifies an
 * artwork member of a destination unit; insertion never splits that unit.
 * Group ancestry is organizational: coordinates, transforms and pivots stay authored.
 * The caller owns layer locking, symbol capacity and history publication.
 */
export function reparentVectors(
  shapes: Vector[],
  selected: string[],
  scope: string[],
  destination: string[],
  placement?: GroupPlacement,
): string[] {
  if (
    placement !== undefined &&
    (!placement ||
      typeof placement !== 'object' ||
      Array.isArray(placement) ||
      Object.keys(placement).some((key) => key !== 'anchor' && key !== 'side') ||
      typeof placement.anchor !== 'string' ||
      !placement.anchor ||
      (placement.side !== 'before' && placement.side !== 'after'))
  )
    throw new Error('Invalid group placement.');
  const parents = new Map<string, string>();
  const last = new Map<string, number>();
  const shapeIds = new Set<string>();
  const scopedIds = new Set<string>();
  for (const [position, shape] of shapes.entries()) {
    if (shapeIds.has(shape.id)) throw new Error('Duplicate shape identity.');
    shapeIds.add(shape.id);
    const ancestry = shape.groups ?? [];
    if (
      !Array.isArray(ancestry) ||
      ancestry.length > 32 ||
      new Set(ancestry).size !== ancestry.length
    )
      throw new Error('Invalid group ancestry.');
    ancestry.forEach((group, depth) => {
      if (typeof group !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(group))
        throw new Error('Invalid group identity.');
      const parent = JSON.stringify(ancestry.slice(0, depth));
      if (
        (parents.has(group) && parents.get(group) !== parent) ||
        (last.has(group) && last.get(group) !== position - 1)
      )
        throw new Error('Invalid group parent or stacking.');
      parents.set(group, parent);
      last.set(group, position);
    });
  }
  for (const path of [scope, destination]) {
    if (
      !Array.isArray(path) ||
      path.length > 32 ||
      (path.length && !shapes.some((shape) => inScope(shape, path)))
    )
      throw new Error('Missing group scope.');
  }
  for (const shape of shapes) if (inScope(shape, scope)) scopedIds.add(shape.id);
  if (selected.some((key) => !scopedIds.has(key)))
    throw new Error('Selection is outside the source scope.');
  const ids = expandSelection(shapes, selected, scope);
  if (!ids.length) return ids;
  if (!placement && JSON.stringify(scope) === JSON.stringify(destination)) return ids;
  const selectedIds = new Set(ids);
  const members = shapes.filter((shape) => selectedIds.has(shape.id));
  const movedGroups = new Set(members.flatMap((shape) => (shape.groups ?? []).slice(scope.length)));
  if (destination.some((group) => movedGroups.has(group)))
    throw new Error('Cannot move a group into itself or its descendants.');
  const ancestry = members.map((shape) => [
    ...destination,
    ...(shape.groups ?? []).slice(scope.length),
  ]);
  if (ancestry.some((path) => path.length > 32)) throw new Error('Group nesting exceeds 32.');
  const remaining = shapes.filter((shape) => !selectedIds.has(shape.id));
  let insertion = remaining.length;
  if (placement) {
    const anchor = remaining.find((shape) => shape.id === placement.anchor);
    if (!anchor || !inScope(anchor, destination))
      throw new Error('Placement anchor must be an unmoved destination member.');
    const unit = selectionUnit(anchor, destination.length);
    const positions = remaining.flatMap((shape, index) =>
      inScope(shape, destination) && selectionUnit(shape, destination.length) === unit
        ? [index]
        : [],
    );
    insertion = placement.side === 'before' ? positions[0] : positions[positions.length - 1] + 1;
  } else if (destination.length) {
    insertion = 0;
    for (let index = remaining.length - 1; index >= 0; index--) {
      if (inScope(remaining[index], destination)) {
        insertion = index + 1;
        break;
      }
    }
    if (!insertion) {
      // Extracting the last child can temporarily empty an ancestor. Its original
      // stack position still owns the destination; the moved child retains it.
      const ancestor = destination.every((group, index) => scope[index] === group);
      if (!ancestor) throw new Error('Missing destination group.');
      const first = shapes.findIndex((shape) => inScope(shape, destination));
      insertion = shapes.slice(0, first).filter((shape) => !selectedIds.has(shape.id)).length;
    }
  }
  // All rejection paths precede either ancestry or stack mutation.
  if (JSON.stringify(scope) !== JSON.stringify(destination)) {
    members.forEach((shape, index) => {
      shape.groups = ancestry[index];
      if (shape.groupBlur && !shape.groups.includes(shape.groupBlur.group)) delete shape.groupBlur;
    });
  }
  remaining.splice(insertion, 0, ...members);
  shapes.splice(0, shapes.length, ...remaining);
  return ids;
}
/** Copy only ancestry below the editing context; remap every group identity once. */
export function copyVectors(
  shapes: Vector[],
  sourceDepth: number,
  destination: string[] = [],
  offset = { x: 16, y: 16 },
) {
  const remap = new Map<string, string>();
  return clone(shapes).map((s) => {
    const copy = {
      ...s,
      id: id(),
      x: s.x + offset.x,
      y: s.y + offset.y,
      groups: [
        ...destination,
        ...(s.groups ?? []).slice(sourceDepth).map((group) => {
          if (!remap.has(group)) remap.set(group, id());
          return remap.get(group)!;
        }),
      ],
    };
    if (copy.groupBlur) {
      const group = remap.get(copy.groupBlur.group);
      if (group && copy.groups.includes(group)) copy.groupBlur.group = group;
      else delete copy.groupBlur;
    }
    return copy;
  });
}
