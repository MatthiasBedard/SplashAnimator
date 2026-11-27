import { clone, validateProject, type Point, type Project } from '@splash/document';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import { multiFrameId, multiFrameKeys } from '../../../packages/animation/src/multi-frame';
import { captureAttachedFillEdit } from '../../../packages/geometry/src/attached-fill';
import {
  connectedAnchorSets,
  prepareAnchorSetEdit,
  subselectionNodes,
  subselectionOutline,
} from './subselection';

/** Resolve each pick in its own held key; only publish a fully prepared project. */
export function moveRangeAnchors(
  project: Project,
  layers: string[],
  start: number,
  end: number,
  selection: string[] | null,
  number: number,
  delta: Point,
) {
  validateLiveGraphicData(project);
  validateProject(project);
  if (!Number.isSafeInteger(number) || number < 1 || ![delta.x, delta.y].every(Number.isFinite))
    throw Error('Choose a positive anchor number and finite X/Y offsets.');
  if (!delta.x && !delta.y) return project;
  const candidate = clone(project),
    remaining = new Set(selection);
  let changed = false;
  for (const { layer, keys } of multiFrameKeys(candidate, layers, start, end))
    for (const key of keys) {
      const picked = key.shapes.filter(
        (shape) =>
          selection === null || remaining.delete(multiFrameId(layer.id, key.frame, shape.id)),
      );
      if (!picked.length) continue;
      if (
        layer.liveMotionSpans?.some((span) => key.frame >= span.start && key.frame <= span.end) ||
        layer.motionSpans?.some((span) => key.frame >= span.start && key.frame <= span.end)
      )
        throw Error('Edit tween-owned anchors with the tween tools.');
      const merge = layer.drawingMode === 'merge';
      let sets = Object.fromEntries(
        picked.map((shape) => {
          const nodes = subselectionNodes(shape),
            index = number - 1;
          if (!nodes[index])
            throw Error(`Anchor ${number} is missing on ${layer.name}, frame ${key.frame + 1}.`);
          const last = nodes.length - 1;
          const seam =
            merge &&
            !shape.contours &&
            shape.closed &&
            last > 0 &&
            (index === 0 || index === last) &&
            nodes[0].x === nodes[last].x &&
            nodes[0].y === nodes[last].y;
          return [shape.id, seam ? [0, last] : [index]];
        }),
      );
      const selectedFills = merge
        ? picked.filter(
            (s) => !s.strokeWidth && s.drawingMode !== 'object' && s.fillEnabled !== false,
          )
        : [];
      const allStrokes = selectedFills.length
        ? key.shapes.filter((s) => s.strokeWidth > 0 && s.drawingMode !== 'object')
        : [];
      const fillLinks = allStrokes.length
        ? captureAttachedFillEdit(
            key.shapes,
            allStrokes.map((s) => s.id),
          )
        : undefined;
      const linked = new Map<string, Set<number>>();
      if (fillLinks)
        for (const fill of selectedFills)
          for (const index of sets[fill.id]) {
            const sources = fillLinks.sourceAnchorsForFill(fill.id, index);
            if (!sources) continue;
            if (!sources.length)
              throw Error(
                'This fill anchor lies inside an attached stroke segment. Move a stroke anchor instead.',
              );
            const indices = linked.get(fill.id) ?? new Set<number>();
            indices.add(index);
            linked.set(fill.id, indices);
            for (const source of sources)
              sets[source.owner] = [...new Set([...(sets[source.owner] ?? []), source.slot])];
          }
      if (merge) sets = connectedAnchorSets(key.shapes, sets, true);
      const edits = prepareAnchorSetEdit(key.shapes, sets, delta);
      const replacements = new Map(edits.map((shape) => [shape.id, shape]));
      if (merge) {
        const strokes = edits.filter((s) => s.strokeWidth > 0 && s.drawingMode !== 'object');
        if (strokes.length) {
          const attached = captureAttachedFillEdit(
            key.shapes,
            strokes.map((s) => s.id),
          );
          for (const follower of attached.prepare(strokes)) {
            const direct = replacements.get(follower.id);
            const result = direct ? subselectionOutline(follower)! : follower;
            if (direct) {
              const requested = subselectionNodes(direct),
                followed = subselectionNodes(result);
              for (const index of sets[direct.id]) {
                if (!linked.get(direct.id)?.has(index))
                  Object.assign(followed[index], requested[index]);
                else if (
                  Math.abs(requested[index].x - followed[index].x) >
                    Number.EPSILON * 64 * Math.max(1, Math.abs(requested[index].x)) ||
                  Math.abs(requested[index].y - followed[index].y) >
                    Number.EPSILON * 64 * Math.max(1, Math.abs(requested[index].y))
                )
                  throw Error('The selected fill and stroke anchors disagree.');
              }
            }
            replacements.set(follower.id, result);
          }
        }
      }
      key.shapes = key.shapes.map((shape) => replacements.get(shape.id) ?? shape);
      changed = true;
    }
  if (remaining.size || !changed) throw Error('Choose artwork in the current multi-frame range.');
  validateProject(candidate);
  return candidate;
}
