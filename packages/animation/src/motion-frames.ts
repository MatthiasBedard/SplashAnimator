import { motionPathFromGuide, restrictedGuideRoute } from './motion-path-guide';
import { validateGuideBinding, resolveGuideArtwork, supportsPlacementChannel, validatePositionTiming, numericKeyAt, validateLiveScaleRange, validateLiveGraphicData, validateGradientColorTracks, validateLiveNumericKeys, liveNumericChannels, validateLiveColorKeys, liveColorChannels, hasKeyableSolidFill, type LiveMotionSpan } from '../../document/src/live-motion';
import { validateGroupMotionPaths, type GroupMotionPath } from '../../document/src/motion-group-paths';
import { prepareIndependentGroupPath } from './independent-group-path';
import {selectionTrajectoryStamp} from './selection-trajectory';
import {qualifyLiveGraphicMotion} from './live-graphics';
import {qualifyLiveMovieMotion} from './live-movies';
import {qualifyLiveMovieTreeMotion,captureLiveMovieTreeTopology} from './live-movie-trees';
import {motionLocalPivot} from './motion-pivots';
import {validateMotionContourCorrespondence} from '../../document/src/motion-contour';
import { validateMotionCurveSelfContacts } from './motion-curve-self-contact';
import { validateMotionCurveTangents } from './motion-tangents';
import { validateMotionContourContacts } from './motion-contact';
import { matchStraightMotionNodes, type MotionStraightNodes } from './motion-resample';
import { validateNestedGraphicMovies } from '../../document/src/live-motion';
import { validateMotionNodeMatching } from '../../document/src/motion-contour';
import { matchShapeTweenFrames } from './motion-shape-morph';
import { motionSymbolPlayback } from './motion-symbols';
import { sampleSymbolEffects } from './motion-symbol-effects';
import { SYMBOL_EFFECTS, validateSymbolMotionEffects } from '../../document/src/symbol-effects';
import { prepareRigidGroups, scaleGroupBasis, rigidGroupPosition } from './motion-rigid';
import {
  motionRotationDelta,
  validateMotionRotation,
  type MotionRotation,
} from './motion-rotation';
import { createMotionPathSampler, validateMotionPath, type MotionPath } from './motion-path';
import {
  fixedMotionNodes,
  validateMotionContourStart,
  type MotionContourStart,
  type MotionContourReverse,
  validateMotionContourReverse,
  validateMotionNodes,
  shiftMotionContourStart,
  validateMotionContourOrder,
  interpolateMotionNodes,
  validateMotionContourAreas,
  validateMotionContourEdges,
} from './motion-nodes';
import {
  clone,
  type MotionSpanOptions, validateMotionSpanOptions,
  symbolLayers,
  symbolArtworks,
  MAX_SYMBOL_ARTWORK,
  type Layer,
  type Project,
  type SymbolDefinition,
  type Vector,
} from '@splash/document';

import { captureOpacityEase, capturePaintEase, evaluatedMotionProgress, validateMotionEase, type MotionEase } from '../../document/src/motion-ease';
export { type CubicMotionEase, type MotionEase } from '../../document/src/motion-ease';
export function motionProgress(t: number, ease: MotionEase): number {
  validateMotionEase(ease);
  return evaluatedMotionProgress(t,ease);
}

export function validateMotionPose(shape: Vector): void {
  if (
    ![shape.x, shape.y, shape.rotation, shape.opacity === undefined ? 1 : shape.opacity].every(
      Number.isFinite,
    )
  )
    throw new Error('Motion endpoint position, rotation and opacity must be finite.');
}
export function affinePose(shape: Vector) {
  const [a, b, c, d] = shape.transform ?? [1, 0, 0, 1];
  const sx = Math.hypot(a, b),
    determinant = a * d - b * c;
  if (
    ![a, b, c, d, determinant, sx].every(Number.isFinite) ||
    sx === 0 ||
    Math.abs(determinant) < 1e-10
  )
    throw new Error('Motion scale and skew require nonsingular endpoint transforms.');
  return {
    sx,
    sy: determinant / sx,
    shear: (a * c + b * d) / sx,
    rotation: shape.rotation + (Math.atan2(b, a) * 180) / Math.PI,
  };
}
export function colorChannels(color: string): number[] {
  if (!/^#[0-9a-f]{6}$/i.test(color))
    throw new Error('Motion paint requires six-digit RGB colors.');
  return [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
}
function mixColor(from: string, to: string, t: number): string {
  const a = colorChannels(from),
    b = colorChannels(to);
  if (from.toLowerCase() === to.toLowerCase()) return from;
  return (
    '#' +
    a
      .map((channel, i) =>
        Math.round(channel * (1 - t) + b[i] * t)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
/** Blend encoded RGB using each stop's contribution to the interpolated opacity. */
function mixGradientColor(
  from: { color: string; opacity?: number },
  to: { color: string; opacity?: number },
  t: number,
  premultiplied: boolean,
): string {
  if (!premultiplied) return mixColor(from.color, to.color, t);
  const fromAlpha = from.opacity ?? 1,
    toAlpha = to.opacity ?? 1;
  const scale = Math.max(fromAlpha, toAlpha);
  // Normalize before multiplying by progress so subnormal opacities retain
  // their color ratio. Fully transparent pairs keep ordinary hidden RGB.
  if (scale === 0) return mixColor(from.color, to.color, t);
  const a = (fromAlpha / scale) * (1 - t),
    b = (toAlpha / scale) * t;
  return mixColor(from.color, to.color, a + b === 0 ? t : b / (a + b));
}
function validateGradientStops(g: NonNullable<Vector['gradient']>): void {
  if (
    g.stops.length < 2 ||
    g.stops.length > 32 ||
    g.stops.some(
      (stop, i) =>
        !Number.isFinite(stop.offset) ||
        stop.offset < 0 ||
        stop.offset > 1 ||
        (i > 0 && stop.offset < g.stops[i - 1].offset),
    )
  )
    throw new Error('Gradient stop matching requires 2 to 32 ordered offsets between 0 and 1.');
  for (const stop of g.stops) {
    colorChannels(stop.color);
    if (!Number.isFinite(stop.opacity ?? 1) || (stop.opacity ?? 1) < 0 || (stop.opacity ?? 1) > 1)
      throw new Error('Motion gradient opacity must be between 0 and 1.');
  }
}
export { type MotionGradientStops } from '../../document/src/motion-gradient';
import {
  validateGradientPairs,
  type MotionGradientStops,
} from '../../document/src/motion-gradient';
export function parseMotionGradientPairs(
  text: string,
  enabled: boolean,
  ordered: boolean,
): MotionGradientStops {
  if (!text.trim()) return enabled ? (ordered ? 'ordered' : true) : false;
  if (!enabled || !ordered)
    throw new Error('Enable ordered gradient stop matching to use group pairs.');
  if (text.trim().toLowerCase() === 'auto') return { pairs: 'auto' };
  const parts = text.split(',').map((part) => part.trim());
  if (parts.some((part) => !/^\d+\s*:\s*\d+$/.test(part)))
    throw new Error('Enter gradient group pairs as source:end indices, separated by commas.');
  const pairs = parts.map((part) => part.split(':').map(Number) as [number, number]);
  validateGradientPairs(pairs);
  return { pairs };
}

type GradientStop = NonNullable<Vector['gradient']>['stops'][number];
/** Minimum-cost monotone group alignment. At most 32x32x33 states; ties prefer
 * diagonal correspondence, then repetition of the source group. */
function automaticGradientPairs(
  left: GradientStop[][],
  right: GradientStop[][],
): [number, number][] {
  const rgba = (stop: GradientStop) => {
    const alpha = stop.opacity ?? 1;
    return [1, 3, 5]
      .map((i) => (parseInt(stop.color.slice(i, i + 2), 16) / 255) * alpha)
      .concat(alpha);
  };
  const costs = left.map(() => right.map(() => new Float64Array(33).fill(Infinity)));
  const parents = left.map(() =>
    right.map(() => new Array<[number, number, number] | undefined>(33)),
  );
  for (let i = 0; i < left.length; i++)
    for (let j = 0; j < right.length; j++) {
      const a = left[i],
        b = right[j],
        count = Math.max(a.length, b.length);
      let cost = 0;
      for (let k = 0; k < count; k++) {
        const x = rgba(a[Math.min(k, a.length - 1)]),
          y = rgba(b[Math.min(k, b.length - 1)]);
        cost += x.reduce((sum, v, c) => sum + (v - y[c]) ** 2, 0) / count;
      }
      // Color/opacity dominate; offset movement breaks visually equivalent choices.
      cost += 0.01 * (a[0].offset - b[0].offset) ** 2;
      if (i === 0 && j === 0) {
        costs[i][j][count] = cost;
        continue;
      }
      for (let used = count; used <= 32; used++) {
        for (const [pi, pj] of [
          [i - 1, j - 1],
          [i, j - 1],
          [i - 1, j],
        ]) {
          if (pi < 0 || pj < 0) continue;
          const candidate = costs[pi][pj][used - count] + (pi === i || pj === j ? 1e-6 : 0) + cost;
          if (candidate < costs[i][j][used]) {
            costs[i][j][used] = candidate;
            parents[i][j][used] = [pi, pj, used - count];
          }
        }
      }
    }
  const pairs: [number, number][] = [];
  let i = left.length - 1,
    j = right.length - 1,
    used = 0;
  // Among equal-cost feasible paths prefer the smaller expanded stop count.
  for (let count = 1; count <= 32; count++)
    if (costs[i][j][count] < costs[i][j][used]) used = count;
  if (!Number.isFinite(costs[i][j][used]))
    throw new Error('Matching gradients would exceed the existing 32-stop limit.');
  while (true) {
    pairs.push([i, j]);
    const previous = parents[i][j][used];
    if (!previous) break;
    [i, j, used] = previous;
  }
  return pairs.reverse();
}
/** Resolve the existing bounded heuristic before freezing a subdivided recipe. */
export function resolveAutomaticGradientPairs(from: Vector, to: Vector): [number,number][] | undefined {
  if(!from.gradient || !to.gradient) return undefined;
  const groups=[from.gradient,to.gradient].map(gradient=>{
    validateGradientStops(gradient);
    const result:(typeof gradient.stops)[]=[];
    for(const stop of gradient.stops){const last=result[result.length-1];if(last?.[0].offset===stop.offset)last.push(stop);else result.push([stop]);}
    return result;
  });
  return automaticGradientPairs(groups[0],groups[1]);
}
/** Match fixed combined offsets or moving ordered stop groups before color blending. */
function matchGradientStops(
  from: Vector,
  to: Vector,
  ordered = false,
  premultiplied = false,
  pairs?: 'auto' | readonly (readonly [number, number])[],
): void {
  if (!from.gradient || !to.gradient) return;
  const gradients = [from.gradient, to.gradient];
  gradients.forEach(validateGradientStops);
  if (ordered) {
    const groups = gradients.map((g) => {
      const result: (typeof g.stops)[] = [];
      for (const stop of g.stops) {
        const last = result[result.length - 1];
        if (last?.[0].offset === stop.offset) last.push(stop);
        else result.push([stop]);
      }
      return result;
    });
    if (pairs === 'auto') pairs = automaticGradientPairs(groups[0], groups[1]);
    if (pairs) {
      validateGradientPairs(pairs);
      if (pairs.at(-1)![0] !== groups[0].length - 1 || pairs.at(-1)![1] !== groups[1].length - 1)
        throw new Error('Gradient group pairs must match every selected gradient group count.');
    } else if (groups[0].length !== groups[1].length)
      throw new Error('Ordered gradient matching requires equal numbers of distinct stop groups.');
    const correspondence = pairs ?? groups[0].map((_, i) => [i, i] as const);
    const counts = correspondence.map(([a, b]) =>
      Math.max(groups[0][a].length, groups[1][b].length),
    );
    if (counts.reduce((sum, count) => sum + count, 0) > 32)
      throw new Error('Matching gradients would exceed the existing 32-stop limit.');
    gradients.forEach((g, side) => {
      g.stops = correspondence.flatMap((pair, i) => {
        const group = groups[side][pair[side]];
        return Array.from({ length: counts[i] }, (_, j) =>
          clone(group[Math.min(j, group.length - 1)]),
        );
      });
    });
    return;
  }

  // Preserve the largest multiplicity at each offset. First/last coincident
  // stops retain the left/right colors of a hard edge; missing copies repeat.
  const offsets = [...new Set(gradients.flatMap((g) => g.stops.map((s) => s.offset)))]
    .sort((a, b) => a - b)
    .flatMap((offset) =>
      Array.from(
        {
          length: Math.max(
            ...gradients.map((g) => g.stops.filter((s) => s.offset === offset).length),
          ),
        },
        (_, occurrence) => ({ offset, occurrence }),
      ),
    );
  if (offsets.length > 32)
    throw new Error('Matching gradients would exceed the existing 32-stop limit.');
  for (const g of gradients) {
    const stops = g.stops;
    g.stops = offsets.map(({ offset, occurrence }) => {
      const right = stops.findIndex((stop) => stop.offset >= offset);
      if (right !== -1 && stops[right].offset === offset) {
        let last = right;
        while (last + 1 < stops.length && stops[last + 1].offset === offset) last++;
        return clone(stops[Math.min(right + occurrence, last)]);
      }
      if (right === 0 || right === -1)
        return { ...clone(stops[right === 0 ? 0 : stops.length - 1]), offset };
      const a = stops[right - 1],
        b = stops[right],
        t = (offset - a.offset) / (b.offset - a.offset);
      return {
        offset,
        color: mixGradientColor(a, b, t, premultiplied),
        opacity: (a.opacity ?? 1) * (1 - t) + (b.opacity ?? 1) * t,
      };
    });
  }
}
/** Color key identity uses the same ordered stop list as sampled artwork. */
export function liveGradientEndpoints(a:Vector,b:Vector,options:MotionSpanOptions = {}) {
  if (!a.gradient || !b.gradient || a.fillEnabled === false || b.fillEnabled === false) return undefined;
  const first={...a,gradient:{...a.gradient}}, last={...b,gradient:{...b.gradient}};
  const matching=options.gradientStops;
  if (matching) matchGradientStops(first,last,matching!==true,options.gradientPremultiplied,typeof matching==='object'?matching.pairs:undefined);
  if (first.gradient.stops.length !== last.gradient.stops.length) return undefined;
  return {first:first.gradient.stops,last:last.gradient.stops};
}
export function prepareGradientColorKeys(a:Vector,b:Vector,options:MotionSpanOptions,
  tracks:NonNullable<LiveMotionSpan['gradientColorTracks']>,length:number,paintTiming:MotionEase) {
  const gradients=liveGradientEndpoints(a,b,options);
   return tracks.map(({stop,keys:values,eases})=>{
     if (!gradients?.first[stop] || !gradients.last[stop]) throw Error('Selected matched gradient stop is missing.');
     const first=gradients.first[stop], last=gradients.last[stop];
     const colors=[{offset:0,color:first.color},...values,{offset:length,color:last.color}].map(key=>{
       if (!options.gradientPremultiplied) return key;
       const t=motionProgress(key.offset/length,paintTiming);
       return {...key,opacity:(first.opacity ?? 1)*(1-t)+(last.opacity ?? 1)*t};
     });
     return {stop,colors,eases};
   });
}
function primitiveGeometry(shape: Vector): boolean {
  return (shape.kind === 'rectangle' || shape.kind === 'ellipse') && !shape.contours;
}
function validateMotionPrimitive(shape: Vector): void {
  if (
    primitiveGeometry(shape) &&
    ![
      shape.width,
      shape.height,
      ...(shape.kind === 'rectangle' ? [shape.cornerRadius ?? 0] : []),
    ].every((v) => Number.isFinite(v) && v >= 0)
  )
    throw new Error('Motion primitive dimensions and corner radii must be finite and nonnegative.');
}
function fixedArtwork(
  shape: Vector,
  affine: boolean,
  paint: boolean,
  nodes: boolean,
  primitives: boolean,
  gradientGeometry: boolean,
  strokeWidth: boolean,
  gradientBasis: boolean,
  pivots: boolean,
  strokeColor: boolean,
): string {
  const fixed = clone(shape);
  fixed.x = fixed.y = fixed.rotation = 0;
  delete fixed.opacity;
  if (fixed.kind === 'symbol') {
    delete fixed.symbolPlayback;
    delete fixed.instanceName;
    for (const { field } of SYMBOL_EFFECTS) delete fixed[field];
  }
  if (strokeColor) fixed.stroke = '#000000';
  if (strokeWidth) fixed.strokeWidth = 0;
  if (nodes) fixedMotionNodes(fixed);
  if (primitives && primitiveGeometry(fixed)) {
    fixed.width = fixed.height = 0;
    if (fixed.kind === 'rectangle') delete fixed.cornerRadius;
  }
  if (gradientGeometry && fixed.gradient) {
    fixed.gradient.from.x = fixed.gradient.from.y = 0;
    fixed.gradient.to.x = fixed.gradient.to.y = 0;
    for (const stop of fixed.gradient.stops) stop.offset = 0;
  }
  if (gradientBasis && fixed.gradient) delete fixed.gradient.transform;
  if (affine) delete fixed.transform;
  if (pivots) delete fixed.pivot;
  if (paint) {
    fixed.fill = fixed.stroke = '#000000';
    if (fixed.gradient)
      for (const stop of fixed.gradient.stops) {
        stop.color = '#000000';
        delete stop.opacity;
      }
  }
  return JSON.stringify(fixed, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
}
function prepare(
  layer: Layer,
  start: number,
  end: number,
  ease: MotionEase,
  affine: boolean,
  paint: boolean,
  nodes: boolean,
  path: MotionPath | undefined,
  primitives: boolean,
  gradientGeometry: boolean,
  rotation: MotionRotation,
  strokeWidth: boolean,
  gradientBasis: boolean,
  gradientStops: MotionGradientStops,
  contourAreas: boolean | 'edges' | 'contacts',
  contourStart: MotionContourStart,
  contourReverse: MotionContourReverse,
  contourOrder?: readonly number[],
  gradientPremultiplied = false,
  symbolPlayback = motionSymbolPlayback([]),
  matchStraightNodes: MotionStraightNodes = false,
  curveTangents = false,
  curveSelfContacts = false,
  sampleFrame?:number,
  captureSampler?: (sample: (frame: number) => Layer['keys'][number]) => void,
  pivots = false,
  defaultPivots = false,
  opacityEase?: MotionEase,
  paintEase?: MotionEase,
  strokeColor = false,
): Layer['keys'] {
  paintEase=capturePaintEase(paintEase,paint);
  if (typeof strokeColor !== 'boolean') throw new Error('Stroke color interpolation requires a boolean.');
  if (typeof defaultPivots !== 'boolean' || (defaultPivots && !pivots))
    throw new Error('Default pivot admission requires explicit saved pivot interpolation.');
  if (typeof pivots !== 'boolean' || (pivots && rotation.savedGroupPivots))
    throw new Error('Saved pivot interpolation requires an explicit boolean and cannot own rigid group pivot motion.');
  if (typeof curveSelfContacts !== 'boolean' || (curveSelfContacts && !nodes))
    throw new Error('Curve self-contact checking requires node interpolation.');
  if (typeof curveTangents !== 'boolean' || (curveTangents && !nodes))
    throw new Error('Curve tangent validation requires node interpolation.');
  if (
    (typeof matchStraightNodes !== 'boolean' &&
      (!matchStraightNodes ||
        typeof matchStraightNodes !== 'object' ||
        (matchStraightNodes.hints !== undefined && !Array.isArray(matchStraightNodes.hints)) ||
        (matchStraightNodes.curves !== undefined &&
          typeof matchStraightNodes.curves !== 'boolean') ||
        (matchStraightNodes.distance !== undefined &&
          typeof matchStraightNodes.distance !== 'boolean') ||
        (matchStraightNodes.shapes !== undefined && typeof matchStraightNodes.shapes !== 'boolean') ||
        (matchStraightNodes.shapes && !matchStraightNodes.curves) ||
        (matchStraightNodes.distance && !matchStraightNodes.curves) ||
        (matchStraightNodes.hints === undefined && matchStraightNodes.curves !== true))) ||
    (matchStraightNodes && !nodes)
  )
    throw new Error('Node matching requires node interpolation.');
  if (layer.locked || !layer.visible) throw new Error('Choose visible unlocked motion tracks.');
  if (gradientPremultiplied && !paint)
    throw new Error('Enable paint color interpolation for opacity-weighted gradients.');
  validateMotionContourStart(contourStart);
  validateMotionContourReverse(contourReverse);
  validateMotionContourOrder(contourOrder);
  if ((contourStart || contourReverse || contourOrder) && !nodes)
    throw new Error('Enable node interpolation to match contour starts.');
  if (contourAreas && !nodes)
    throw new Error('Enable node interpolation to validate polygon contour areas.');
  let first = layer.keys.find((k) => k.frame === start),
    last = layer.keys.find((k) => k.frame === end);
  if (!first?.shapes.length || !last?.shapes.length)
    throw new Error('Motion requires nonblank keys at both range endpoints.');
  if (layer.keys.some((k) => k.frame > start && k.frame < end))
    throw new Error('Motion would overwrite intermediate keys. Clear or move those keys first.');
  for (const key of [first, last]) for (const shape of key.shapes) {
    validateSymbolMotionEffects(shape);
    validateMotionPose(shape);
  }
  // Playback settings are authored independently at the two endpoints. Validate
  // originals before any clone can normalize NaN, then carry only the source clock.
  if (rotation.savedGroupPivots || pivots)
    for (const key of [first, last])
      for (const shape of key.shapes) {
        if (
          (pivots && !defaultPivots && shape.pivot === undefined) || shape.pivot !== undefined &&
          (!shape.pivot || ![shape.pivot.x, shape.pivot.y].every(Number.isFinite))
        )
          throw new Error('Saved artwork pivots must have finite coordinates.');
      }
  if (typeof matchStraightNodes === 'object' && 'artworkHints' in matchStraightNodes)
    validateMotionNodeMatching(matchStraightNodes);
  const shapeMatching=typeof matchStraightNodes==='object'&&matchStraightNodes.shapes===true;
  const pivotCount=shapeMatching?Math.max(first.shapes.length,last.shapes.length):first.shapes.length;
  const pivotEndpoints=pivots?[
    Array.from({length:pivotCount},(_,i)=>motionLocalPivot(first!.shapes[i]??last!.shapes[i],defaultPivots)),
    Array.from({length:pivotCount},(_,i)=>motionLocalPivot(last!.shapes[i]??first!.shapes[i],defaultPivots)),
  ]:undefined;
  const symbolClocks = first.shapes.map(symbolPlayback);
  last.shapes.forEach(symbolPlayback);
  if (nodes)
    for (const key of [first, last]) for (const shape of key.shapes) validateMotionNodes(shape);
  if (contourStart || contourReverse || contourOrder)
    last = {
      ...last,
      shapes: last.shapes.map((shape) =>
        shiftMotionContourStart(shape, contourStart, contourReverse, contourOrder),
      ),
    };
  if (matchStraightNodes) {
    if (!shapeMatching&&first.shapes.length !== last.shapes.length)
      throw new Error('Node matching requires the same artwork count.');
    const pairs = shapeMatching?matchShapeTweenFrames(first.shapes,last.shapes,
      typeof matchStraightNodes==='object'?matchStraightNodes.hints:undefined,
      typeof matchStraightNodes==='object'&&matchStraightNodes.distance===true,
      (a,b)=>fixedArtwork(a,affine,paint,nodes,primitives,gradientGeometry,strokeWidth,gradientBasis,pivots,strokeColor)===
        fixedArtwork(b,affine,paint,nodes,primitives,gradientGeometry,strokeWidth,gradientBasis,pivots,strokeColor),
      typeof matchStraightNodes==='object' ? matchStraightNodes.artworkHints : undefined,
    ):first.shapes.map((shape, i) => {
      return matchStraightMotionNodes(
        shape,
        last!.shapes[i],
        typeof matchStraightNodes === 'object' ? matchStraightNodes.hints : undefined,
        typeof matchStraightNodes === 'object' && matchStraightNodes.curves === true,
        typeof matchStraightNodes === 'object' && matchStraightNodes.distance === true,
      );
    });
    first = { ...first, shapes: pairs.map((pair) => pair[0]) };
    last = { ...last, shapes: pairs.map((pair) => pair[1]) };
  }
  if (typeof gradientStops === 'object') validateGradientPairs(gradientStops.pairs);
  if (gradientStops) {
    if (!paint) throw new Error('Enable paint color interpolation to match gradient stops.');
    if (gradientStops !== true && !gradientGeometry)
      throw new Error('Enable gradient geometry interpolation for ordered stop matching.');
    // Keep numeric validation on original values (JSON cloning would turn NaN into null).
    const detach = (key: Layer['keys'][number]) => ({
      ...key,
      shapes: key.shapes.map((shape) => ({
        ...shape,
        ...(shape.gradient ? { gradient: { ...shape.gradient } } : {}),
      })),
    });
    first = detach(first);
    last = detach(last);
    if (first.shapes.length === last.shapes.length)
      first.shapes.forEach((shape, i) =>
        matchGradientStops(
          shape,
          last!.shapes[i],
          gradientStops !== true,
          gradientPremultiplied,
          typeof gradientStops === 'object' ? gradientStops.pairs : undefined,
        ),
      );
  }
  if (
    first.shapes.length !== last.shapes.length ||
    first.shapes.some(
      (shape, i) =>
        fixedArtwork(
          shape,
          affine,
          paint,
          nodes,
          primitives,
          gradientGeometry,
          strokeWidth,
          gradientBasis,
          pivots,
          strokeColor,
        ) !==
        fixedArtwork(
          last.shapes[i],
          affine,
          paint,
          nodes,
          primitives,
          gradientGeometry,
          strokeWidth,
          gradientBasis,
          pivots,
          strokeColor,
        ),
    )
  )
    throw new Error(
      'Motion endpoints must contain the same ordered artwork, differing only in the enabled motion properties.',
    );
  if (strokeWidth)
    for (const shape of [...first.shapes, ...last.shapes])
      if (!Number.isFinite(shape.strokeWidth) || shape.strokeWidth < 0 || shape.strokeWidth > 200)
        throw new Error('Motion stroke widths must be between 0 and 200.');
  if (curveSelfContacts)
    first.shapes.forEach((shape, i) => validateMotionCurveSelfContacts(shape, last!.shapes[i]));
  if (curveTangents)
    first.shapes.forEach((shape, i) => validateMotionCurveTangents(shape, last!.shapes[i]));
  if (contourAreas) {
    first.shapes.forEach((shape, i) => {
      validateMotionContourAreas(shape, last!.shapes[i]);
      if (contourAreas === 'contacts') validateMotionContourContacts(shape, last!.shapes[i]);
      if (contourAreas === 'edges' || contourAreas === 'contacts')
        validateMotionContourEdges(shape, last!.shapes[i]);
    });
  }
  if (primitives)
    for (const shape of [...first.shapes, ...last.shapes]) validateMotionPrimitive(shape);
  if (gradientGeometry)
    for (const shape of [...first.shapes, ...last.shapes]) {
      const g = shape.gradient;
      if (
        g &&
        (![g.from.x, g.from.y, g.to.x, g.to.y].every(Number.isFinite) ||
          g.stops.some(
            (stop, i) =>
              !Number.isFinite(stop.offset) ||
              stop.offset < 0 ||
              stop.offset > 1 ||
              (i > 0 && stop.offset < g.stops[i - 1].offset),
          ))
      )
        throw new Error(
          'Motion gradient geometry requires finite endpoints and ordered stop offsets between 0 and 1.',
        );
    }
  const gradientPoses = gradientBasis
    ? first.shapes.map((shape, i) => {
        if (!shape.gradient) return undefined;
        const from = affinePose({ ...shape, rotation: 0, transform: shape.gradient.transform });
        const to = affinePose({
          ...last.shapes[i],
          rotation: 0,
          transform: last.shapes[i].gradient!.transform,
        });
        if (Math.sign(from.sy) !== Math.sign(to.sy))
          throw new Error('Motion gradient bases cannot change reflection between endpoints.');
        return { from, to };
      })
    : undefined;
  const poses = affine
    ? first.shapes.map((shape, i) => {
        const from = affinePose(shape),
          to = affinePose(last.shapes[i]);
        if (Math.sign(from.sy) !== Math.sign(to.sy))
          throw new Error(
            'Motion cannot change reflection between endpoints without collapsing artwork.',
          );
        return { from, to };
      })
    : undefined;
  if (strokeColor && !paint)
    for (const shape of [...first.shapes, ...last.shapes]) colorChannels(shape.stroke);
  if (paint)
    for (const shape of [...first.shapes, ...last.shapes]) {
      colorChannels(shape.fill);
      colorChannels(shape.stroke);
      for (const stop of shape.gradient?.stops ?? []) {
        colorChannels(stop.color);
        if (
          stop.opacity !== undefined &&
          (!Number.isFinite(stop.opacity) || stop.opacity < 0 || stop.opacity > 1)
        )
          throw new Error('Motion gradient opacity must be between 0 and 1.');
      }
    }
  if ((rotation.uniformGroupScale || rotation.axisGroupScale) && !affine)
    throw new Error('Enable scale/skew interpolation for group scaling.');
  if (
    rotation.rigidGroups &&
    ((affine && !rotation.uniformGroupScale && !rotation.axisGroupScale) || nodes || primitives)
  )
    throw new Error('Disable scale/skew, node and primitive interpolation for rigid group motion.');
  const rigid = rotation.rigidGroups
    ? prepareRigidGroups(first.shapes, last.shapes, rotation)
    : undefined;
  // Paths describe the leader reference route. Pivot endpoint offsets interpolate
  // on top of that route; the orbit correction below moves every member together.
  const paths = path
    ? first.shapes.map((shape, i) => {
        const leader = rigid?.[i]?.leader ?? i;
        return leader === i ? createMotionPathSampler(shape, last.shapes[i], path) : undefined;
      })
    : undefined;
  const sample = (frame: number): Layer['keys'][number] => {
    if (!Number.isSafeInteger(frame) || frame < start || frame > end)
      throw new Error('Sample frame must be an integer inside the motion range.');
    if (frame === start || frame === end) return clone(layer.keys.find(key => key.frame === frame)!);
    const raw=(frame-start)/(end-start),t = motionProgress(raw, ease),alpha=opacityEase===undefined?t:motionProgress(raw,opacityEase),color=paintEase===undefined?t:motionProgress(raw,paintEase);
    const shapes = first.shapes.map((shape, i) => {
      const target = last.shapes[i],
        result = clone(shape);
      if (pivots) {
        const from=pivotEndpoints![0][i],to=pivotEndpoints![1][i];
        result.pivot = {x:from.x*(1-t)+to.x*t,y:from.y*(1-t)+to.y*t};
        if (![result.pivot.x,result.pivot.y].every(Number.isFinite)) throw new Error('Interpolated saved pivot exceeds numeric limits.');
      }
      if (symbolClocks[i]) result.symbolPlayback = symbolClocks[i]!(frame - start);
      if (shape.kind === 'symbol') sampleSymbolEffects(result, shape, target, t, mixColor);
      if (strokeWidth) result.strokeWidth = shape.strokeWidth * (1 - t) + target.strokeWidth * t;
      if (nodes) interpolateMotionNodes(result, shape, target, t);
      if (primitives && primitiveGeometry(shape)) {
        result.width = shape.width * (1 - t) + target.width * t;
        result.height = shape.height * (1 - t) + target.height * t;
        if (
          shape.kind === 'rectangle' &&
          (shape.cornerRadius !== undefined || target.cornerRadius !== undefined)
        )
          result.cornerRadius =
            (shape.cornerRadius ?? 0) * (1 - t) + (target.cornerRadius ?? 0) * t;
      }
      if (gradientGeometry && result.gradient) {
        const from = shape.gradient!,
          to = target.gradient!;
        for (const key of ['from', 'to'] as const) {
          result.gradient[key].x = from[key].x * (1 - t) + to[key].x * t;
          result.gradient[key].y = from[key].y * (1 - t) + to[key].y * t;
        }
        result.gradient.stops.forEach((stop, index) => {
          stop.offset = from.stops[index].offset * (1 - t) + to.stops[index].offset * t;
        });
      }
      const gradientPose = gradientPoses?.[i];
      if (gradientPose && result.gradient) {
        const { from, to } = gradientPose;
        const mix = (a: number, b: number) => a * (1 - t) + b * t;
        const angle =
          ((from.rotation +
            motionRotationDelta(from.rotation, to.rotation, { direction: 'shortest', turns: 0 }) *
              t) *
            Math.PI) /
          180;
        const c = Math.cos(angle),
          s = Math.sin(angle),
          sx = mix(from.sx, to.sx),
          sy = mix(from.sy, to.sy),
          shear = mix(from.shear, to.shear);
        result.gradient.transform = [c * sx, s * sx, c * shear - s * sy, s * shear + c * sy];
        const [a, b, cBasis, d] = result.gradient.transform;
        if (
          result.gradient.transform.some((v) => !Number.isFinite(v) || Math.abs(v) > 100000) ||
          Math.abs(sx * sy) < 1e-10 ||
          Math.abs(a * d - b * cBasis) < 1e-10 ||
          Math.sign(a * d - b * cBasis) !== Math.sign(sy)
        )
          throw new Error('Motion gradient basis exceeds supported geometry limits.');
      }
      result.x = shape.x * (1 - t) + target.x * t;
      result.y = shape.y * (1 - t) + target.y * t;
      const member = rigid?.[i];
      const pathPose = paths?.[member?.leader ?? i]?.(t);
      if (pathPose) {
        result.x = pathPose.x;
        result.y = pathPose.y;
      }
      result.rotation += motionRotationDelta(shape.rotation, target.rotation, rotation) * t;
      if (poses && !(member && (rotation.uniformGroupScale || rotation.axisGroupScale))) {
        const { from, to } = poses[i];
        const mix = (a: number, b: number) => a * (1 - t) + b * t;
        const sx = mix(from.sx, to.sx),
          sy = mix(from.sy, to.sy),
          shear = mix(from.shear, to.shear);
        result.rotation =
          from.rotation + motionRotationDelta(from.rotation, to.rotation, rotation) * t;
        result.transform = [sx, 0, shear, sy];
        if (
          result.transform.some((v) => !Number.isFinite(v) || Math.abs(v) > 100000) ||
          Math.abs(sx * sy) < 1e-10
        )
          throw new Error('Motion scale and skew exceed supported geometry limits.');
      }
      if (pathPose?.tangentAngle !== undefined) result.rotation += pathPose.tangentAngle;
      if (member) {
        const a = first.shapes[member.leader],
          b = last.shapes[member.leader];
        const scale = 1 - t + t * member.endScale;
        const sx = 1 - t + t * member.endScaleX,
          sy = 1 - t + t * member.endScaleY;
        if (rotation.uniformGroupScale || rotation.axisGroupScale) {
          result.transform = rotation.axisGroupScale
            ? scaleGroupBasis(shape, sx, sy, t * member.endShear, t * member.endShearY)
            : ((shape.transform ?? [1, 0, 0, 1]).map((v) => v * scale) as [
                number,
                number,
                number,
                number,
              ]);
          const [a, b, c, d] = result.transform;
          if (
            result.transform.some((v) => !Number.isFinite(v) || Math.abs(v) > 100000) ||
            Math.abs(a * d - b * c) < 1e-10
          )
            throw new Error('Group scale exceeds supported geometry limits.');
        }
        const position = rigidGroupPosition(a, b, member, t, pathPose);
        result.x = position.x;
        result.y = position.y;
      }
      if (paint || strokeColor)
        result.stroke = mixColor(shape.stroke, target.stroke, strokeColor ? t : color);
      if (paint) {
        result.fill = mixColor(shape.fill, target.fill, color);
        result.gradient?.stops.forEach((stop, index) => {
          const from = shape.gradient!.stops[index],
            to = target.gradient!.stops[index];
          stop.color = mixGradientColor(from, to, color, gradientPremultiplied);
          if (from.opacity !== undefined || to.opacity !== undefined)
            stop.opacity = (from.opacity ?? 1) * (1 - color) + (to.opacity ?? 1) * color;
        });
      }
      if (shape.opacity !== undefined || target.opacity !== undefined)
        result.opacity = (shape.opacity ?? 1) + ((target.opacity ?? 1) - (shape.opacity ?? 1)) * alpha;
      if (![result.x, result.y, result.rotation, result.opacity ?? 1].every(Number.isFinite))
        throw new Error('Motion generated an invalid numeric value.');
      return result;
    });
    return { frame, shapes };
  };
  if (captureSampler) { captureSampler(sample); return []; }
  if (sampleFrame !== undefined) return [sample(sampleFrame)];
  const added: Layer['keys'] = [];
  for (let frame = start + 1; frame < end; frame++) added.push(sample(frame));
  return [...clone(layer.keys), ...added].sort((a, b) => a.frame - b.frame);
}
function range(start: number, end: number, duration: number, ease: MotionEase, adjacent = false) {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end - start < (adjacent ? 1 : 2) ||
    end >= duration
  )
    throw new Error(adjacent ? 'Choose two distinct endpoint frames.' : 'Choose endpoint keys with at least one frame between them.');
  motionProgress(0, ease);
}
/** Generate editable position/rotation/opacity keys; graphic playback offsets preserve exposure age; no live tween metadata. */
export function generateMotionFrames(
  project: Pick<Project, 'layers' | 'duration' | 'symbols'>,
  ids: string[],
  start: number,
  end: number,
  ease: MotionEase,
  affine = false,
  paint = false,
  nodes = false,
  path?: MotionPath,
  primitives = false,
  gradientGeometry = false,
  rotation: MotionRotation = { direction: 'shortest', turns: 0 },
  strokeWidth = false,
  gradientBasis = false,
  gradientStops: MotionGradientStops = false,
  contourAreas: boolean | 'edges' | 'contacts' = false,
  contourStart: MotionContourStart = 0,
  contourReverse: MotionContourReverse = false,
  contourOrder?: readonly number[],
  gradientPremultiplied = false,
  matchStraightNodes: MotionStraightNodes = false,
  curveTangents = false,
  curveSelfContacts = false,
  pivots = false,
  defaultPivots = false,
  opacityEase?: MotionEase,
  paintEase?: MotionEase,
  strokeColor = false,
): void {
  opacityEase=captureOpacityEase(opacityEase);
  paintEase=capturePaintEase(paintEase,paint);
  range(start, end, project.duration, ease);
  validateMotionRotation(rotation);
  if (path) validateMotionPath(path);
  const selected = [...new Set(ids)];
  if (!selected.length) throw new Error('Choose motion tracks.');
  const symbolPlayback = motionSymbolPlayback(project.symbols ?? []);
  const prepared = selected.map((id) => {
    const layer = project.layers.find((l) => l.id === id);
    if (!layer) throw new Error('Motion track is missing.');
    return {
      layer,
      keys: prepare(
        layer,
        start,
        end,
        ease,
        affine,
        paint,
        nodes,
        path,
        primitives,
        gradientGeometry,
        rotation,
        strokeWidth,
        gradientBasis,
        gradientStops,
        contourAreas,
        contourStart,
        contourReverse,
        contourOrder,
        gradientPremultiplied,
        symbolPlayback,
        matchStraightNodes,
        curveTangents,
        curveSelfContacts,
        undefined,
        undefined,
        pivots,
        defaultPivots,
        opacityEase,
        paintEase,
        strokeColor,
      ),
    };
  });
  for (const { layer, keys } of prepared) layer.keys = keys;
}
export function colorKeyAt(colors: readonly {offset:number;color:string;opacity?:number}[], offset:number, weighted=false, timing?:readonly MotionEase[]) {
  let low=1, high=colors.length-1;
  while(low<high){const mid=Math.floor((low+high)/2);if(colors[mid].offset<offset)low=mid+1;else high=mid;}
  const from=colors[low-1],to=colors[low];
  if(offset===to.offset)return to.color;
  const t=(offset-from.offset)/(to.offset-from.offset);
  return mixGradientColor(from,to,timing?motionProgress(t,timing[low-1]):t,weighted);
}
export function prepareNumericProperty(
  property: typeof liveNumericChannels[number]['property'], first:Vector, last:Vector,
  length:number, keys:readonly {offset:number;value:number}[], affine=false, intervalEases?:readonly MotionEase[],
) {
  function endpoint(shape:Vector) {
    if (property==='sx' || property==='sy' || property==='shear') return affinePose(shape)[property];
    if (property==='rotation' && affine) return affinePose(shape).rotation;
    return property==='opacity' ? shape.opacity ?? 1 : shape[property];
  }
  const points=[{offset:0,value:endpoint(first)},...keys,{offset:length,value:endpoint(last)}];
  if (property==='rotation' && points.some(p=>!Number.isFinite(p.value*Math.PI))) throw Error('Rotation exceeds numeric angle limits.');
  if (points.some((p,i)=>i && !Number.isFinite(p.value-points[i-1].value))) throw Error('Position key interpolation overflows.');
  return (shape:Vector,offset:number)=>{
    if(property==='sx'||property==='sy'||property==='shear'){
      if(!shape.transform)throw Error('Missing sampled affine transform.');
      shape.transform[property==='sx'?0:property==='sy'?3:2]=numericKeyAt(points,offset,true,intervalEases);
    }else shape[property]=numericKeyAt(points,offset,false,intervalEases);
  };
}
export type MotionFrameRecipe=Pick<LiveMotionSpan,'guide'|'nestedGraphicMovies'|'start'|'end'|'ease'|'options'|'path'|'rotation'|'correspondence'|'opacityEase'|'paintEase'|'symbolContinuity'|'groupPaths'|'gradientColorTracks'|'sxKeyEases'|'syKeyEases'|'shearKeyEases'|'fillKeyEases'|'strokeKeyEases'|'rotationKeyEases'|'opacityKeyEases'|'xKeyEases'|'yKeyEases'|'shearKeys'|'rotationKeys'|'scaleXKeys'|'scaleYKeys'|'opacityKeys'|'xKeys'|'yKeys'|'strokeColorKeys'|'fillColorKeys'>;
export interface MotionFrameSampler {
 sample(frame:number):Vector[];
 dispose():void;
}
/** Capture endpoint geometry and recipe values once. Later source edits are intentionally
 * invisible; callers must dispose/recreate on their source revision boundary. */
export function createMotionFrameSampler(project:Pick<Project,'layers'|'duration'|'symbols'>,layerId:string,layerRecipe:MotionFrameRecipe):MotionFrameSampler{
 if ('sxKeyEases' in layerRecipe || 'syKeyEases' in layerRecipe || 'shearKeyEases' in layerRecipe || 'fillKeyEases' in layerRecipe || 'strokeKeyEases' in layerRecipe || 'opacityKeyEases' in layerRecipe || 'rotationKeyEases' in layerRecipe || 'xKeyEases' in layerRecipe || 'yKeyEases' in layerRecipe){
   validateLiveGraphicData(layerRecipe);validatePositionTiming(layerRecipe);
 }
 const hasColorKeys = 'gradientColorTracks' in layerRecipe || liveColorChannels.some(channel => channel.field in layerRecipe);
 const hasNumericKeys = liveNumericChannels.some(channel => channel.field in layerRecipe);
 if (hasColorKeys || hasNumericKeys) {
   validateLiveGraphicData(layerRecipe);
   validateLiveGraphicData(project);
   for (const {field} of liveNumericChannels) {
     if (!(field in layerRecipe)) continue;
     const d = Object.getOwnPropertyDescriptor(layerRecipe,field);
     if (!d?.enumerable || !('value' in d) || ((field === 'xKeys' || field === 'yKeys') && layerRecipe.path) || layerRecipe.rotation?.rigidGroups || !supportsPlacementChannel(layerRecipe.symbolContinuity,field))
       throw Error('Position keys require an ordinary path-free live recipe.');
     if (field === 'rotationKeys' && layerRecipe.path?.tangent) throw Error('Tangent heading and rotation keys both own the angle.');
     if ((field === 'scaleXKeys' || field === 'scaleYKeys' || field === 'shearKeys') && !layerRecipe.options?.affine) throw Error('Scale and shear keys require affine interpolation.');
     validateLiveNumericKeys(d.value,layerRecipe.end-layerRecipe.start,field);
   }
   if ('gradientColorTracks' in layerRecipe) {
     const d = Object.getOwnPropertyDescriptor(layerRecipe,'gradientColorTracks');
     if (!d?.enumerable || !('value' in d) || !layerRecipe.options?.paint ||
         layerRecipe.symbolContinuity || layerRecipe.rotation?.rigidGroups)
       throw Error('Gradient color keys require ordinary RGB paint interpolation.');
     validateGradientColorTracks(d.value,layerRecipe.end-layerRecipe.start);
   }
   for (const {field} of liveColorChannels) {
     if (!(field in layerRecipe)) continue;
     const descriptor = Object.getOwnPropertyDescriptor(layerRecipe,field);
     if (!descriptor?.enumerable || !('value' in descriptor))
       throw Error('Color keys require original recipe data.');
     validateLiveColorKeys(descriptor.value,layerRecipe.end-layerRecipe.start);
   }
 }
 const groupField=Object.getOwnPropertyDescriptor(layerRecipe,'groupPaths');
 if(groupField&&'baseline' in layerRecipe)throw Error('Independent group paths require a sparse live recipe.');
 if((!groupField&&'groupPaths' in layerRecipe)||(groupField&&(!groupField.enumerable||!('value' in groupField))))throw Error('Independent group paths require original own data.');
 if(groupField?.value!==undefined){validateLiveGraphicData(project);validateLiveGraphicData(layerRecipe);validateGroupMotionPaths(groupField.value);}

 validateNestedGraphicMovies(layerRecipe);
 const continuity=Object.getOwnPropertyDescriptor(layerRecipe,'symbolContinuity');
 if((!continuity&&'symbolContinuity' in layerRecipe)||(continuity&&(!continuity.enumerable||!('value' in continuity)||(continuity.value!==undefined&&!['graphics','movies','movie-trees'].includes(continuity.value)))))throw Error('Invalid original graphic continuity mode.');
 if(continuity?.value==='graphics')qualifyLiveGraphicMotion(project,layerId,layerRecipe);
 if(continuity?.value==='movies')qualifyLiveMovieMotion(project,layerId,layerRecipe);
 if(continuity?.value==='movie-trees')qualifyLiveMovieTreeMotion(project as Project,layerId,layerRecipe);
 if ('guide' in layerRecipe) {
   if ('baseline' in layerRecipe) throw Error('Linked guides belong to sparse live tweens.');
   validateLiveGraphicData(project);
   validateGuideBinding(layerRecipe, project.duration);
 }
 const graphicStamp=layerRecipe.guide!==undefined||continuity?.value!==undefined||groupField?.value!==undefined||hasColorKeys||hasNumericKeys?selectionTrajectoryStamp({project,layerId,layerRecipe}):undefined;
 const opacityEase=captureOpacityEase(layerRecipe.opacityEase);
 const paintEase=capturePaintEase(layerRecipe.paintEase,layerRecipe.options?.paint??false);
 const recipe=structuredClone({symbolContinuity:layerRecipe.symbolContinuity,start:layerRecipe.start,end:layerRecipe.end,ease:layerRecipe.ease,
  options:layerRecipe.options,path:layerRecipe.path,rotation:layerRecipe.rotation,correspondence:layerRecipe.correspondence,groupPaths:groupField?.value as readonly GroupMotionPath[]|undefined});
 const {start,end,ease,options={},correspondence,rotation={direction:'shortest',turns:0}}=recipe;
 range(start,end,project.duration,ease,true);
 validateMotionSpanOptions(options);validateMotionRotation(rotation);
 if(recipe.path!==undefined)validateMotionPath(recipe.path);
 if(correspondence!==undefined)validateMotionContourCorrespondence(correspondence);
 const original=project.layers.find(layer=>layer.id===layerId);
 if(!original)throw new Error('Motion track is missing.');
 const authored=original.keys.filter(key=>key.frame===start||key.frame===end),keyStamp=graphicStamp===undefined?undefined:selectionTrajectoryStamp(authored);
 for(const key of authored)for(const shape of key.shapes)validateSymbolMotionEffects(shape);
 const keys=structuredClone(authored);
 if(keyStamp!==undefined&&selectionTrajectoryStamp(keys)!==keyStamp)throw Error('Live graphic endpoint clone changed.');
 if(keys.length!==2)throw new Error('Motion requires exactly two authored endpoint keys.');
 for(const key of keys)for(const shape of key.shapes)validateMotionPose(shape);
 let layer:Layer={id:original.id,name:original.name,visible:original.visible,locked:original.locked,keys};
 if(correspondence?.source){
  if(!options.nodes)throw new Error('Source contour alignment requires node interpolation.');
  const source=correspondence.source;
  layer={...layer,keys:keys.map(key=>key.frame!==start?key:{...key,shapes:key.shapes.map(shape=>{
   validateMotionNodes(shape);return shiftMotionContourStart(shape,source.start??0,source.reverse??false,source.order);
  })})};
 }
 let path = recipe.path;
 let guideSection: ReturnType<typeof restrictedGuideRoute> | undefined;
 if (layerRecipe.guide) {
   const from = keys.find(key=>key.frame===start)?.shapes[0], to = keys.find(key=>key.frame===end)?.shapes[0];
   if (!from || !to) throw Error('A linked guide needs artwork at both tween endpoints.');
   const artwork = resolveGuideArtwork(project.layers,layerId,layerRecipe.guide);
   if (layerRecipe.guide.interval) guideSection = restrictedGuideRoute(artwork,layerRecipe.guide,from,to);
   else path = motionPathFromGuide(from, to, artwork,
     {startX:0,startY:0,endX:0,endY:0}, layerRecipe.guide);
 }
 let evaluate:((frame:number)=>Layer['keys'][number])|undefined;
 prepare(layer,start,end,ease,options.affine??false,options.paint??false,options.nodes??false,path,
  options.primitives??false,options.gradientGeometry??false,rotation,options.strokeWidth??false,options.gradientBasis??false,
  options.gradientStops??false,options.contourContacts?'contacts':options.contourEdges?'edges':options.contourAreas??false,
  correspondence?.start??0,correspondence?.reverse??false,correspondence?.order,options.gradientPremultiplied??false,
  motionSymbolPlayback(project.symbols??[]),correspondence?.nodes??false,options.curveTangents??false,options.curveSelfContacts??false,undefined,sample=>{evaluate=sample},options.pivots??false,options.defaultPivots??false,opacityEase,paintEase,options.strokeColor??false);
 const groupPlans=(recipe.groupPaths??[]).map(binding=>prepareIndependentGroupPath(layer,recipe,binding));
 if(groupField?.value!==undefined&&selectionTrajectoryStamp(recipe.groupPaths)!==selectionTrajectoryStamp(groupField.value))throw Error('Independent group path clone changed.');
 const endpoints=keys;
 const numericTracks = liveNumericChannels.flatMap(({field,property}) => {
   const source = layerRecipe[field];
   if (!source) return [];
   if (keys.some(key => key.shapes.length !== 1 || key.shapes[0].groups?.length || key.shapes[0].id !== keys[0].shapes[0].id))
     throw Error('Property keys require one matching artwork item.');
   const captured = structuredClone(source);
   if (selectionTrajectoryStamp(captured) !== selectionTrajectoryStamp(source)) throw Error('Property key capture changed.');
   const timing=layerRecipe[`${property}KeyEases`];
   const capturedTiming=timing && structuredClone(timing);
   if(timing && selectionTrajectoryStamp(timing)!==selectionTrajectoryStamp(capturedTiming))throw Error('Position timing clone changed.');
   return [prepareNumericProperty(property,keys[0].shapes[0],keys[1].shapes[0],end-start,captured,options.affine,capturedTiming)];
 });
 if (layerRecipe.shearKeys || layerRecipe.scaleXKeys || layerRecipe.scaleYKeys)
   validateLiveScaleRange(layerRecipe,keys[0].shapes[0],keys[1].shapes[0]);
 const colorTracks = liveColorChannels.flatMap(channel => {
   const source = layerRecipe[channel.field];
   if (!source) return [];
   const captured = structuredClone(source);
   if (selectionTrajectoryStamp(captured) !== selectionTrajectoryStamp(source))
     throw Error(channel.label+' key capture changed during preparation.');
   if (!options[channel.option] || continuity?.value || rotation.rigidGroups ||
       keys.some(key => key.shapes.length !== 1 || key.shapes[0].groups?.length || key.shapes[0].id !== keys[0].shapes[0].id))
     throw Error(channel.label+' keys require one matching root with explicit interpolation.');
   if (channel.property === 'fill' && keys.some(key => !hasKeyableSolidFill(key.shapes[0])))
     throw Error('Fill keys require visible solid fill paint at both endpoints.');
   const colors = [{offset:0,color:keys[0].shapes[0][channel.property]}, ...captured,
     {offset:end-start,color:keys[1].shapes[0][channel.property]}];
   const timing=layerRecipe[`${channel.property}KeyEases`];
   const capturedTiming=timing && structuredClone(timing);
   if(timing && selectionTrajectoryStamp(timing)!==selectionTrajectoryStamp(capturedTiming))throw Error('Color timing changed during capture.');
   return [{property:channel.property, colors, timing:capturedTiming}];
 });
 const gradientTracks = (() => {
   const source=layerRecipe.gradientColorTracks;
   if (!source) return [];
   if (keys.some(key=>key.shapes.length!==1 || key.shapes[0].groups?.length || key.shapes[0].id!==keys[0].shapes[0].id))
     throw Error('Gradient keys require one matching root.');
   const captured=structuredClone(source);
   if (selectionTrajectoryStamp(captured)!==selectionTrajectoryStamp(source)) throw Error('Gradient key capture changed.');
   return prepareGradientColorKeys(keys[0].shapes[0],keys[1].shapes[0],options,captured,end-start,paintEase ?? ease);
 })();
 const tree=continuity?.value==='movie-trees'?captureLiveMovieTreeTopology(project as Project,layerId,layerRecipe):undefined;
 if(graphicStamp!==undefined&&(selectionTrajectoryStamp({project,layerId,layerRecipe})!==graphicStamp||selectionTrajectoryStamp(keys)!==keyStamp))throw Error('Live graphic source changed during preparation.');
 return {
  sample(frame:number){
   if(!evaluate)throw new Error('Motion sampler is disposed.');
   const sampled=evaluate(frame);
   if(frame===start||frame===end){const shapes=endpoints.find(key=>key.frame===frame)!.shapes;if(graphicStamp===undefined)return clone(shapes);const expected=selectionTrajectoryStamp(shapes),out=structuredClone(shapes);if(selectionTrajectoryStamp(shapes)!==expected||selectionTrajectoryStamp(out)!==expected)throw Error('Live graphic endpoint sample clone changed.');tree?.admit(frame,out);return out;}
   if (guideSection) {
     const t = motionProgress((frame-start)/(end-start),ease);
     const pose = guideSection(t);
     const leader = sampled.shapes[0];
     const dx = pose.x-leader.x, dy = pose.y-leader.y;
     for (const shape of sampled.shapes) {
       shape.x += dx;
       shape.y += dy;
       shape.rotation += pose.heading;
       validateMotionPose(shape);
     }
   }
   if(groupPlans.length){const t=motionProgress((frame-start)/(end-start),ease),members=new Map(sampled.shapes.map(shape=>[shape.id,shape]));
    for(const plan of groupPlans){const point=plan.route(t),dx=point.x-plan.dx*t,dy=point.y-plan.dy*t;
     if(![dx,dy].every(Number.isFinite))throw Error('Independent group pose exceeds numeric limits.');
     for(const id of plan.ids){const shape=members.get(id);if(!shape)throw Error('Independent group pose membership changed.');shape.x+=dx;shape.y+=dy;validateMotionPose(shape);}
    }
   }
   for (const apply of numericTracks) apply(sampled.shapes[0],frame-start);
   if (numericTracks.length) validateMotionPose(sampled.shapes[0]);
   for (const {property,colors,timing} of colorTracks) sampled.shapes[0][property]=colorKeyAt(colors,frame-start,false,timing);
   for (const {stop,colors,eases} of gradientTracks) sampled.shapes[0].gradient!.stops[stop].color=colorKeyAt(colors,frame-start,options.gradientPremultiplied,eases);
   tree?.admit(frame,sampled.shapes);return sampled.shapes;
  },
  dispose(){evaluate=undefined;endpoints.length=0;tree?.dispose()},
 };
}
/** Stateless integer-frame evaluation of an endpoint recipe. Does not adopt or overwrite
 * interior keys, inspect remembered baselines, execute scripts or publish timeline edits.
 * Uses the generation validators and interpolation, but allocates only one output pose.
 * Endpoint samples return exact detached authored shapes. Not a whole-span certification. */
export function sampleMotionFrame(project:Pick<Project,'layers'|'duration'|'symbols'>,layerId:string,recipe:MotionFrameRecipe,frame:number):Vector[]{
 const sampler=createMotionFrameSampler(project,layerId,recipe);
 try{return sampler.sample(frame)}finally{sampler.dispose()}
}

export function generateSymbolMotionFrames(
  definition: SymbolDefinition,
  ids: string[],
  start: number,
  end: number,
  ease: MotionEase,
  affine = false,
  paint = false,
  nodes = false,
  path?: MotionPath,
  primitives = false,
  gradientGeometry = false,
  symbols: SymbolDefinition[] = [definition],
  rotation: MotionRotation = { direction: 'shortest', turns: 0 },
  strokeWidth = false,
  gradientBasis = false,
  gradientStops: MotionGradientStops = false,
  contourAreas: boolean | 'edges' | 'contacts' = false,
  contourStart: MotionContourStart = 0,
  contourReverse: MotionContourReverse = false,
  contourOrder?: readonly number[],
  gradientPremultiplied = false,
  matchStraightNodes: MotionStraightNodes = false,
  curveTangents = false,
  curveSelfContacts = false,
  pivots = false,
  defaultPivots = false,
  opacityEase?: MotionEase,
  paintEase?: MotionEase,
  strokeColor = false,
): SymbolDefinition {
  opacityEase=captureOpacityEase(opacityEase);
  paintEase=capturePaintEase(paintEase,paint);
  range(start, end, definition.timeline?.duration ?? 1, ease);
  validateMotionRotation(rotation);
  const sourceLayers = symbolLayers(definition);
  let artworkCount = symbolArtworks(definition).reduce((sum, shapes) => sum + shapes.length, 0);
  for (const symbol of symbols)
    if (symbol.id !== definition.id)
      artworkCount += symbolArtworks(symbol).reduce((sum, shapes) => sum + shapes.length, 0);
  for (const id of new Set(ids)) {
    const layer = sourceLayers.find((l) => l.id === id);
    if (!layer) throw new Error('Motion track is missing.');
    artworkCount +=
      (end - start - 1) * (layer.keys.find((k) => k.frame === start)?.shapes.length ?? 0);
  }
  // Reject against the existing document capacity before cloning or generating any geometry.
  if (artworkCount > MAX_SYMBOL_ARTWORK)
    throw new Error(
      'Motion would exceed the existing project symbol artwork budget. Shorten the range or select fewer tracks.',
    );
  if (gradientStops || gradientPremultiplied)
    for (const layer of sourceLayers)
      if (ids.includes(layer.id))
        for (const key of layer.keys)
          if (key.frame === start || key.frame === end)
            for (const shape of key.shapes)
              if (shape.gradient) validateGradientStops(shape.gradient);
  // Only layer wrappers are writable during generation. Keep original values
  // available to the shared preflight; JSON cloning can normalize invalid data.
  const layers = sourceLayers.map((layer) => ({ ...layer }));
  generateMotionFrames(
    {
      layers,
      duration: definition.timeline!.duration,
      symbols: [...symbols.filter((s) => s.id !== definition.id), definition],
    },
    ids,
    start,
    end,
    ease,
    affine,
    paint,
    nodes,
    path,
    primitives,
    gradientGeometry,
    rotation,
    strokeWidth,
    gradientBasis,
    gradientStops,
    contourAreas,
    contourStart,
    contourReverse,
    contourOrder,
    gradientPremultiplied,
    matchStraightNodes,
    curveTangents,
    curveSelfContacts,
    pivots,
    defaultPivots,
    opacityEase,
    paintEase,
    strokeColor,
  );
  const result = clone(definition),
    detached = clone(layers);
  result.shapes = detached[0].keys[0].shapes;
  result.timeline = {
    ...result.timeline!,
    keys: detached[0].keys.slice(1),
    layers: detached.slice(1),
  };
  return result;
}
