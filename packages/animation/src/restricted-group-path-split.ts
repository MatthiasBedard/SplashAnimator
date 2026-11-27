import { evaluatedMotionProgress } from '../../document/src/motion-ease';
import { splitSimpleMotionEase } from './motion-spans';
import type { Layer, LiveMotionSpan, Vector } from '../../document/src';
import {
  validateGroupMotionPaths,
  type GroupMotionPath,
} from '../../document/src/motion-group-paths';
import { prepareIndependentGroupPath } from './independent-group-path';
import { splitRestrictedArcGeometry } from './restricted-arc-geometry';
import { openRestrictedArcCorrespondence } from './restricted-arc-correspondence';
import { captureCubicDistanceCorrespondence } from './motion-path';
import { sameMotionArtwork } from './motion-ownership';
import {
  certifyRestrictedOriginalCurve,
  certifyRestrictedLinearGeometry,
} from './restricted-curve-certificate';

/** Restrict the original clock itself. All original table breakpoints bound the
 * piecewise-affine parameter comparison; no sampled grid or new half table owns
 * timing. The outer kernel still proves complete artwork and candidate data. */
export function splitRestrictedGroupPaths(
  layer: Layer,
  span: LiveMotionSpan,
  middle: Vector[],
  progress: number,
): [GroupMotionPath[], GroupMotionPath[]] {
  return splitGroupPaths(layer, span, middle, progress, false);
}
/** Separate persisted-source preparation. Never rebuild distance timing from
 * either rounded half; the captured parent polynomial owns geometry proof. */
export function splitRecursiveRestrictedGroupPaths(
  layer: Layer,
  span: LiveMotionSpan,
  middle: Vector[],
  progress: number,
): [GroupMotionPath[], GroupMotionPath[]] {
  return splitGroupPaths(layer, span, middle, progress, true);
}
function splitGroupPaths(
  layer: Layer,
  span: LiveMotionSpan,
  middle: Vector[],
  progress: number,
  recursive: boolean,
): [GroupMotionPath[], GroupMotionPath[]] {
  const bank = span.groupPaths;
  if (
    span.path !== undefined ||
    !bank?.length ||
    bank.some(
      (row) =>
        row.path.distance !== true ||
        row.path.waypoints !== undefined ||
        row.path.tangent ||
        (recursive ? !row.restrictedArc : row.restrictedArc),
    )
  )
    throw Error(
      recursive
        ? 'Choose persisted single-cubic original-clock banks without mixed or shared timing.'
        : 'Choose original single-cubic distance banks without shared or persisted restricted timing.',
    );
  validateGroupMotionPaths(bank);
  const first = layer.keys.find((k) => k.frame === span.start)!.shapes,
    last = layer.keys.find((k) => k.frame === span.end)!.shapes;
  const result: [GroupMotionPath[], GroupMotionPath[]] = [[], []];
  const banked = new Set<string>();
  for (const binding of bank) {
    const plan = prepareIndependentGroupPath(layer, span, binding),
      indices = plan.ids.map((id) => first.findIndex((s) => s.id === id)),
      i = indices[0];
    const a = first[i],
      m = middle[i],
      b = last[i];
    plan.ids.forEach((id) => banked.add(id));
    if (
      indices.some(
        (i) =>
          middle[i].x - first[i].x !== m.x - a.x ||
          middle[i].y - first[i].y !== m.y - a.y ||
          last[i].x - middle[i].x !== b.x - m.x ||
          last[i].y - middle[i].y !== b.y - m.y,
      )
    )
      throw Error('Restricted split requires exact promoted member displacement.');
    const cubic = [
      { x: 0, y: 0 },
      { x: binding.path.startX, y: binding.path.startY },
      { x: plan.dx + binding.path.endX, y: plan.dy + binding.path.endY },
      { x: plan.dx, y: plan.dy },
    ] as const;
    const saved = recursive ? binding.restrictedArc! : undefined;
    const distanceProgress = binding.ease ? evaluatedMotionProgress(progress, binding.ease) : progress;
    const eases = binding.ease && splitSimpleMotionEase(binding.ease, progress);
    const halves = splitRestrictedArcGeometry({
      geometry: {
        descriptor: saved?.descriptor ?? { version: 1, cubic, from: 0, to: 1 },
        origin: saved?.origin ?? { x: 0, y: 0 },
        cubic,
      },
      progress: distanceProgress,
      middle: saved
        ? { x: saved.origin.x + (m.x - a.x), y: saved.origin.y + (m.y - a.y) }
        : { x: m.x - a.x, y: m.y - a.y },
    });
    const original = captureCubicDistanceCorrespondence([saved?.descriptor.cubic ?? cubic]);
    const parent = saved ? openRestrictedArcCorrespondence(saved.descriptor) : undefined;
    const work = indices.map(() => ({ visits: 0 }));
    for (const side of [0, 1]) {
      const geometry = halves[side],
        map = openRestrictedArcCorrespondence(geometry.descriptor),
        start = side ? distanceProgress : 0,
        range = side ? 1 - distanceProgress : distanceProgress;
      const admit = (t: number) => {
        const absolute = map.first + (map.last - map.first) * map.parameter(t);
        const actual = parent ? (absolute - parent.first) / (parent.last - parent.first) : absolute;
        const expected = parent
          ? parent.parameter(start + range * t)
          : original.parameter(start + range * t);
        if (!sameMotionArtwork(actual, expected))
          throw Error('Restricted original arc continuous parameter correspondence is unresolved.');
      };
      admit(0);
      admit(1);
      for (const knot of original.knots) {
        const local = saved
          ? (knot.progress - saved.descriptor.from) / (saved.descriptor.to - saved.descriptor.from)
          : knot.progress;
        if (local > start && local < start + range) admit((local - start) / range);
      }
      const row: GroupMotionPath = {
        ...structuredClone(binding),
        ...(eases ? { ease: eases[side] } : {}),
        path: {
          ...structuredClone(binding.path),
          startX: geometry.cubic[1].x,
          startY: geometry.cubic[1].y,
          endX: geometry.cubic[2].x - geometry.cubic[3].x,
          endY: geometry.cubic[2].y - geometry.cubic[3].y,
        },
        restrictedArc: {
          descriptor: structuredClone(geometry.descriptor),
          origin: { ...geometry.origin },
        },
      };
      for (const [member, index] of indices.entries()) {
        const base = side ? middle[index] : first[index],
          end = side ? last[index] : middle[index];
        const dx = end.x - base.x,
          dy = end.y - base.y;
        const actual = [
          { x: base.x, y: base.y },
          { x: base.x + row.path.startX, y: base.y + row.path.startY },
          { x: base.x + (dx + row.path.endX), y: base.y + (dy + row.path.endY) },
          { x: base.x + dx, y: base.y + dy },
        ];
        certifyRestrictedOriginalCurve(
          cubic,
          parent ? (map.first - parent.first) / (parent.last - parent.first) : map.first,
          parent ? (map.last - parent.first) / (parent.last - parent.first) : map.last,
          { x: first[index].x, y: first[index].y },
          actual,
          work[member],
        );
      }
      result[side].push(row);
    }
  }
  first.forEach((shape, i) => {
    if (!banked.has(shape.id)) certifyRestrictedLinearGeometry(shape, last[i], middle[i], progress);
  });
  result.forEach(validateGroupMotionPaths);
  return result;
}
