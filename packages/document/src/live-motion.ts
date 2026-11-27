import { validateGroupMotionPaths, type GroupMotionPath } from './motion-group-paths';
import { isImmutableSnapshot } from './immutable-snapshot';
import { validateRestrictedMotionArcGeometry } from './motion-restricted-arc';
import {
  validateMotionSpanOptions,
  type BasicMotionSpan,
  type Layer,
  type Vector,
  type RootOpacityBinding,
} from './index';
import { type MotionEase, evaluatedMotionProgress, validateMotionEase } from './motion-ease';
import { validateMotionPath } from './motion-path';
import { validateMotionRotation } from './motion-rotation';
import { validateMotionContourCorrespondence } from './motion-contour';

/** Separate sparse ownership: no generated-key baseline or automatic refresh. */
export type LiveNumericKey = { offset: number; value: number };
export type LivePositionKey = LiveNumericKey;
export const livePositionChannels = [
  { field: 'xKeys', property: 'x', label: 'X' },
  { field: 'yKeys', property: 'y', label: 'Y' },
] as const;
export const symbolPlacementFields = ['xKeys','yKeys','opacityKeys','rotationKeys','scaleXKeys','scaleYKeys','shearKeys'] as const;
export function supportsPlacementChannel(mode: LiveMotionSpan['symbolContinuity'], field: string) {
  return mode === undefined || ((mode === 'graphics' || mode === 'movies' || mode === 'movie-trees') && symbolPlacementFields.some(key => key === field));
}
export const liveNumericChannels = [
  ...livePositionChannels,
  { field:'shearKeys', property:'shear', label:'Shear' },
  { field:'rotationKeys', property:'rotation', label:'Rotation' },
  { field:'scaleXKeys', property:'sx', label:'Horizontal scale' },
  { field:'scaleYKeys', property:'sy', label:'Vertical scale' },
  { field:'opacityKeys', property:'opacity', label:'Opacity' },
] as const;
export function validateLiveNumericKeys(keys: readonly LiveNumericKey[], length: number, field: typeof liveNumericChannels[number]['field']) {
  validateLiveGraphicData(keys);
  if (!Array.isArray(keys) || keys.length >= length) throw Error('Invalid position key array.');
  let previous = 0;
  for (const key of keys) {
    if (!key || typeof key !== 'object' || Reflect.ownKeys(key).length !== 2 || !Object.hasOwn(key,'offset') || !Object.hasOwn(key,'value') ||
        !Number.isSafeInteger(key.offset) || key.offset <= previous || key.offset >= length || !Number.isFinite(key.value))
      throw Error('Position keys need increasing interior frames and finite coordinates.');
    if ((field === 'scaleXKeys' || field === 'scaleYKeys') && (Math.abs(key.value) > 100000 || key.value === 0 || (field === 'scaleXKeys' && key.value < 0)))
      throw Error('Scale keys require finite, nonsingular affine scales within document limits.');
    if (field === 'shearKeys' && Math.abs(key.value) > 100000) throw Error('Shear key exceeds the document transform limit.');
    if (field === 'rotationKeys' && !Number.isFinite(key.value * Math.PI)) throw Error('Rotation key exceeds numeric angle limits.');
    if (field === 'opacityKeys' && (key.value < 0 || key.value > 1)) throw Error('Opacity keys must be between 0 and 100 percent.');
    previous = key.offset;
  }
}
export function numericKeyAt(points: readonly {offset:number; value:number}[], offset:number, scale=false, eases?:readonly MotionEase[]) {
  let low=1, high=points.length-1;
  while (low<high) {
    const middle=Math.floor((low+high)/2);
    if (points[middle].offset<offset) low=middle+1;
    else high=middle;
  }
  const from=points[low-1], to=points[low];
  if (offset===from.offset) return from.value;
  if (offset===to.offset) return to.value;
  const fraction=(offset-from.offset)/(to.offset-from.offset);
  const t=eases ? evaluatedMotionProgress(fraction,eases[low-1]) : fraction;
  return scale ? from.value*(1-t)+to.value*t : from.value+(to.value-from.value)*t;
}
/** Check the complete intervals between axis keys, including subframe poses. */
export function validateLiveScaleRange(span: Pick<LiveMotionSpan,'start'|'end'|'ease'|'scaleXKeys'|'scaleYKeys'|'shearKeys'|'sxKeyEases'|'syKeyEases'>, first:Vector, last:Vector) {
  const length = span.end-span.start;
  function axes(shape:Vector) {
    const [a,b,c,d] = shape.transform ?? [1,0,0,1];
    const sx = Math.hypot(a,b);
    if (span.shearKeys && !(Math.abs((a*c+b*d)/sx) <= 100000)) throw Error('Endpoint shear exceeds the document transform limit.');
    return {sx,sy:(a*d-b*c)/sx};
  }
  const from = axes(first), to = axes(last);
  const points = (keys:readonly LiveNumericKey[] | undefined, axis:'sx'|'sy') => keys && [
    {offset:0,value:from[axis]}, ...keys, {offset:length,value:to[axis]},
  ];
  const scaleX = points(span.scaleXKeys,'sx'), scaleY = points(span.scaleYKeys,'sy');
  const offsets = new Set([0,length]);
  for (const track of [scaleX,scaleY]) for (const point of track ?? []) offsets.add(point.offset);
  let xInterval=0, yInterval=0;
  let previous: {sx:number; sy:number} | undefined;
  for (const offset of [...offsets].sort((a,b)=>a-b)) {
    const t = evaluatedMotionProgress(offset/length,span.ease);
    const sx = scaleX ? numericKeyAt(scaleX,offset,true,span.sxKeyEases) : from.sx*(1-t)+to.sx*t;
    const sy = scaleY ? numericKeyAt(scaleY,offset,true,span.syKeyEases) : from.sy*(1-t)+to.sy*t;
    if (!(sx > 0) || Math.sign(sy) !== Math.sign(from.sy) || ![sx,sy].every(n=>Number.isFinite(n) && Math.abs(n)<=100000))
      throw Error('Scale keys must preserve the original reflection and affine limits.');
    // Linear positive magnitudes have their smallest product at an endpoint.
    // An eased companion axis is bounded by its own interval minimum.
    while (scaleX && scaleX[xInterval+1].offset<offset) xInterval++;
    while (scaleY && scaleY[yInterval+1].offset<offset) yInterval++;
    const xEase=scaleX ? span.sxKeyEases?.[xInterval]??'linear' : span.ease;
    const yEase=scaleY ? span.syKeyEases?.[yInterval]??'linear' : span.ease;
    const independentTiming=(scaleX || scaleY) && (xEase!=='linear' || yEase!=='linear');
    const det = previous && independentTiming
      ? Math.min(sx,previous.sx)*Math.min(Math.abs(sy),Math.abs(previous.sy))
      : sx*Math.abs(sy);
    if (det < 1e-10) throw Error('Scale keys cannot certify a nonsingular continuous transform.');
    previous = {sx,sy};
  }
}
export function validateLivePositionKeys(keys: readonly LivePositionKey[], length: number) {
  validateLiveNumericKeys(keys,length,'xKeys');
}
export type LiveColorKey = { offset: number; color: string };
export const liveColorChannels = [
  { field: 'strokeColorKeys', property: 'stroke', option: 'strokeColor', label: 'Stroke' },
  { field: 'fillColorKeys', property: 'fill', option: 'paint', label: 'Fill' },
] as const;
export function hasKeyableSolidFill(shape: Vector) {
  if (shape.fillEnabled === false || shape.gradient || shape.bitmap) return false;
  return ['rectangle', 'ellipse', 'polygon', 'brush'].includes(shape.kind) ||
    ((shape.kind === 'bezier' || shape.kind === 'path') && shape.closed === true);
}
export type LiveMotionSpan = Omit<BasicMotionSpan, 'baseline' | 'autoRefresh'> & {
  fillKeyEases?: readonly MotionEase[];
  strokeKeyEases?: readonly MotionEase[];
  opacityKeyEases?: readonly MotionEase[];
  sxKeyEases?: readonly MotionEase[];
  syKeyEases?: readonly MotionEase[];
  shearKeyEases?: readonly MotionEase[];
  rotationKeyEases?: readonly MotionEase[];
  xKeyEases?: readonly MotionEase[];
  yKeyEases?: readonly MotionEase[];
  shearKeys?: readonly LiveNumericKey[];
  rotationKeys?: readonly LiveNumericKey[];
  scaleXKeys?: readonly LiveNumericKey[];
  scaleYKeys?: readonly LiveNumericKey[];
  opacityKeys?: readonly LiveNumericKey[];
  xKeys?: readonly LivePositionKey[];
  yKeys?: readonly LivePositionKey[];
  strokeColorKeys?: readonly LiveColorKey[];
  fillColorKeys?: readonly LiveColorKey[];
  guide?: { layerId: string; frame: number; shapeId: string; offset?: { x: number; y: number }; tangent?: true; interval?: { start: number; end: number } };
  nestedGraphicMovies?: true | 'members-and-descendants';
  symbolContinuity?: 'graphics' | 'movies' | 'movie-trees';
  groupPaths?: readonly GroupMotionPath[];
};
const fields = new Set([
  'id',
  'start',
  'end',
  'ease',
  'opacityEase',
  'paintEase',
  'options',
  'path',
  'rotation',
  'correspondence',
  'symbolContinuity',
  'nestedGraphicMovies',
  'groupPaths', 'guide',
  'sxKeyEases', 'syKeyEases', 'shearKeyEases', 'fillKeyEases', 'strokeKeyEases', 'opacityKeyEases', 'rotationKeyEases', 'xKeyEases', 'yKeyEases', 'xKeys', 'yKeys', 'opacityKeys', 'shearKeys', 'rotationKeys', 'scaleXKeys', 'scaleYKeys',
  'strokeColorKeys',
  'fillColorKeys', 'gradientColorTracks',
]);
export function validateLiveColorKeys(keys: readonly LiveColorKey[], length: number) {
  validateLiveGraphicData(keys);
  if (!Array.isArray(keys) || keys.length >= length)
    throw Error('Invalid color key array.');
  let previous = 0;
  for (const key of keys) {
    if (!key || typeof key !== 'object' ||
        Reflect.ownKeys(key).length !== 2 || !Object.hasOwn(key,'offset') || !Object.hasOwn(key,'color') ||
        !Number.isSafeInteger(key.offset) || key.offset <= previous || key.offset >= length ||
        typeof key.color !== 'string' || !/^#[\da-f]{6}$/i.test(key.color))
      throw Error('Color keys need increasing interior frames and six-digit hex colors.');
    previous = key.offset;
  }
}
export function validateGradientColorTracks(tracks: NonNullable<LiveMotionSpan['gradientColorTracks']>, length:number) {
  validateLiveGraphicData(tracks);
  if (!Array.isArray(tracks) || tracks.length > 32) throw Error('Invalid gradient color tracks.');
  let previous = -1;
  for (const row of tracks) {
    if (!row || typeof row !== 'object' || Reflect.ownKeys(row).length !== (Object.hasOwn(row,'eases') ? 3 : 2) || !Object.hasOwn(row,'keys') ||
        !Object.hasOwn(row,'stop') || !Number.isInteger(row.stop) || row.stop <= previous || row.stop >= 32)
      throw Error('Choose distinct matched gradient stops in order.');
    validateLiveColorKeys(row.keys,length);
    if (Object.hasOwn(row,'eases')) {
      validatePositionEaseArray(row.eases);
      if (row.eases.length !== row.keys.length+1) throw Error('Each gradient stop interval needs one easing curve.');
    }
    previous = row.stop;
  }
}
export { validateLiveColorKeys as validateStrokeColorKeys };

function denseGroupArray(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw Error('Live groups require dense original array data.');
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !d.enumerable || !('value' in d))
      throw Error('Live groups require dense original array data.');
  }
  if (
    Reflect.ownKeys(value).some(
      (k) =>
        k !== 'length' &&
        (typeof k !== 'string' || !/^(0|[1-9]\d*)$/.test(k) || Number(k) >= value.length),
    )
  )
    throw Error('Live group arrays contain unsupported fields.');
}
/** Reject original accessors/nonfinite values before any transport can normalize them. */
export function validateLiveMotionData(value: unknown): void {
  if (isImmutableSnapshot(value)) return;
  if (typeof value === 'number' && !Number.isFinite(value))
    throw Error('Live motion requires finite original values.');
  if (value && typeof value === 'object') {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw Error('Live motion requires data fields.');
      const d = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in d)) throw Error('Live motion requires original data fields, not accessors.');
      validateLiveMotionData(d.value);
    }
  } else if (value !== null && !['undefined', 'string', 'number', 'boolean'].includes(typeof value))
    throw Error('Live motion requires serializable original data.');
}
export const positionTimingFields=['xKeyEases','yKeyEases'] as const;
export const intervalTimingFields=[...positionTimingFields,'sxKeyEases','syKeyEases','shearKeyEases','opacityKeyEases','rotationKeyEases'] as const;
export const allIntervalTimingFields=[...intervalTimingFields,'fillKeyEases','strokeKeyEases'] as const;
export const intervalKeys={sxKeyEases:'scaleXKeys',syKeyEases:'scaleYKeys',shearKeyEases:'shearKeys',fillKeyEases:'fillColorKeys',strokeKeyEases:'strokeColorKeys',xKeyEases:'xKeys',yKeyEases:'yKeys',opacityKeyEases:'opacityKeys',rotationKeyEases:'rotationKeys'} as const;
export function validatePositionEaseArray(timing:readonly MotionEase[]) {
  validateLiveGraphicData(timing);
  if(!Array.isArray(timing))throw Error('Interval timing requires an easing array.');
  for(const ease of timing){
    if(typeof ease==='object' && (!ease || Reflect.ownKeys(ease).length!==5 || !['kind','x1','y1','x2','y2'].every(key=>Object.hasOwn(ease,key))))throw Error('Choose original cubic easing controls.');
    validateMotionEase(ease);
  }
}
export function validatePositionTiming(span:Pick<LiveMotionSpan,typeof allIntervalTimingFields[number]|typeof intervalKeys[keyof typeof intervalKeys]>) {
  for(const field of allIntervalTimingFields){
    if(!(field in span))continue;
    const descriptor=Object.getOwnPropertyDescriptor(span,field);
    if(!descriptor?.enumerable || !('value' in descriptor))throw Error('Interval timing requires original data.');
    const keyData=Object.getOwnPropertyDescriptor(span,intervalKeys[field]);
    const timing=descriptor.value, keys=keyData?.enumerable && 'value' in keyData ? keyData.value : undefined;
    if(!Array.isArray(keys) || !Array.isArray(timing) || timing.length!==keys.length+1)throw Error('Choose one easing per keyed interval.');
    validatePositionEaseArray(timing);
  }
}
export function validateNestedGraphicMovies(recipe: Pick<LiveMotionSpan,'nestedGraphicMovies'|'rotation'|'symbolContinuity'>) {
  if (!('nestedGraphicMovies' in recipe)) return;
  validateLiveGraphicData(recipe);
  const field = Object.getOwnPropertyDescriptor(recipe,'nestedGraphicMovies');
  if (!field?.enumerable || !('value' in field) || (field.value !== true && field.value !== 'members-and-descendants') ||
      recipe.symbolContinuity !== 'graphics' || !recipe.rotation?.rigidGroups || !recipe.rotation.savedGroupPivots)
    throw Error('Independent movie descendants require a graphic group with a saved pivot.');
}
export function validateGuideBinding(span: Pick<LiveMotionSpan, 'guide' | 'path' | 'symbolContinuity' | 'rotation' | 'groupPaths' | 'xKeys' | 'yKeys' | 'rotationKeys'>, duration: number) {
  if (!('guide' in span)) return;
  validateLiveGraphicData(span);
  const field = Object.getOwnPropertyDescriptor(span, 'guide');
  const guide = field?.value as LiveMotionSpan['guide'];
  if (!field?.enumerable || !guide || typeof guide !== 'object' ||
      Reflect.ownKeys(guide).some(key => !['layerId','shapeId','frame','offset','tangent','interval'].includes(String(key))) ||
      !['layerId','shapeId','frame'].every(key => Object.hasOwn(guide,key)) ||
      typeof guide.layerId !== 'string' || !guide.layerId ||
      typeof guide.shapeId !== 'string' || !guide.shapeId ||
      !Number.isSafeInteger(guide.frame) || guide.frame < 0 || guide.frame >= duration)
    throw Error('Choose an authored guide path on a specific layer and key.');
  if ('interval' in guide) {
    const range = guide.interval;
    if (!range || typeof range !== 'object' || Reflect.ownKeys(range).length !== 2 ||
        !Object.hasOwn(range,'start') || !Object.hasOwn(range,'end') ||
        !Number.isFinite(range.start) || !Number.isFinite(range.end) ||
        range.start < 0 || range.end > 1 || range.start >= range.end)
      throw Error('A linked guide needs an increasing travel interval inside its path.');
  }
  if ('offset' in guide) {
    const offset = guide.offset;
    if (!offset || typeof offset !== 'object' || Reflect.ownKeys(offset).length !== 2 || !Object.hasOwn(offset,'x') || !Object.hasOwn(offset,'y') ||
        !Number.isFinite(offset.x) || !Number.isFinite(offset.y))
      throw Error('A guide offset needs finite document X and Y values.');
  }
  if ('tangent' in guide && guide.tangent !== true)
    throw Error('Choose an explicit guide tangent orientation.');
  if (guide.tangent && span.rotationKeys)
    throw Error('Turn off guide tangent orientation before setting rotation keys.');
  if (span.path || span.symbolContinuity || span.rotation?.rigidGroups || span.groupPaths || span.xKeys || span.yKeys)
    throw Error('A linked guide needs sole ownership of the ordinary tween trajectory.');
}

export function resolveGuideArtwork(layers: readonly Layer[], ownerId: string, guide: NonNullable<LiveMotionSpan['guide']>) {
  const source = layers.find(layer => layer.id === guide.layerId);
  const shape = source?.keys.find(key => key.frame === guide.frame)?.shapes.find(item => item.id === guide.shapeId);
  if (source?.id === ownerId || !shape || shape.closed || !['path','bezier'].includes(shape.kind))
    throw Error('The linked guide needs its original open path on another layer.');
  return shape;
}

export function validateLiveMotionSpan(span: LiveMotionSpan, duration: number): void {
  validateLiveMotionData(span);
  if (
    !span ||
    typeof span !== 'object' ||
    Array.isArray(span) ||
    Reflect.ownKeys(span).some((key) => typeof key !== 'string' || !fields.has(key)) ||
    !span.id ||
    typeof span.id !== 'string' ||
    !Number.isSafeInteger(span.start) ||
    !Number.isSafeInteger(span.end) ||
    span.start < 0 ||
    span.end <= span.start ||
    span.end >= duration
  )
    throw Error('Invalid live motion span.');
  validateGuideBinding(span, duration);
  validatePositionTiming(span);
  const continuity = Object.getOwnPropertyDescriptor(span, 'symbolContinuity');
  if (
    (!continuity && 'symbolContinuity' in span) ||
    (continuity &&
      (!continuity.enumerable ||
        !('value' in continuity) ||
        (continuity.value !== undefined &&
          !['graphics', 'movies', 'movie-trees'].includes(continuity.value))))
  )
    throw Error('Choose original explicit graphic continuity data.');
  validateNestedGraphicMovies(span);
  if (continuity?.value !== undefined && continuity.value !== 'graphics' && span.rotation?.rigidGroups)
    throw Error('Live graphic group continuity requires separate admission.');
  const groups = Object.getOwnPropertyDescriptor(span, 'groupPaths');
  if ((!groups && 'groupPaths' in span) || (groups && (!groups.enumerable || !('value' in groups))))
    throw Error('Group paths require original own data.');
  if (groups?.value !== undefined) {
    validateGroupMotionPaths(groups.value);
    if (span.path && groups.value.some(binding => binding.ease !== undefined && binding.path.waypoints))
      throw Error('Independent waypoint easing requires an absent shared route.');
    if (span.path && groups.value.some(binding => binding.ease !== undefined && binding.path.distance))
      throw Error('Independent distance easing requires an absent shared route.');
    if ((span.path?.curvedWaypoints || span.path?.tangent) && groups.value.some(binding => binding.ease !== undefined))
      throw Error('Independent group easing requires a shared cubic or straight waypoints without tangent heading.');
    if (groups.value.some(binding => binding.restrictedArc !== undefined) && span.path !== undefined)
      throw Error('Restricted independent arc timing cannot have a shared route.');
    if (
      !span.rotation?.rigidGroups ||
      (span.symbolContinuity !== undefined && span.symbolContinuity !== 'graphics') ||
      span.path?.tangent ||
      span.rotation.savedGroupPivots ||
      span.rotation.rigidPivot !== undefined ||
      (span.rotation.groupDepth ?? 0) !== 0
    )
      throw Error('Independent group paths require fixed outer-group translation admission.');
  }
  validateMotionEase(span.ease);
  validateMotionSpanOptions(span.options);
  for (const {field} of liveNumericChannels) {
    if (!(field in span)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(span,field);
    if (!descriptor?.enumerable || !('value' in descriptor) || ((field === 'xKeys' || field === 'yKeys') && span.path) || span.rotation?.rigidGroups || !supportsPlacementChannel(span.symbolContinuity,field))
      throw Error('Position keys require ordinary artwork without a motion path.');
    if (field === 'rotationKeys' && span.path?.tangent) throw Error('Turn off tangent heading before setting rotation keys.');
    if ((field === 'shearKeys' || field === 'scaleXKeys' || field === 'scaleYKeys') && !span.options?.affine) throw Error('Enable scale and skew interpolation before setting affine keys.');
    validateLiveNumericKeys(descriptor.value,span.end-span.start,field);
  }
  if ('gradientColorTracks' in span) {
    const d = Object.getOwnPropertyDescriptor(span,'gradientColorTracks');
    if (!d?.enumerable || !('value' in d) || !span.options?.paint || span.rotation?.rigidGroups || span.symbolContinuity)
      throw Error('Gradient color keys require RGB paint interpolation on ordinary artwork.');
    validateGradientColorTracks(d.value,span.end-span.start);
  }
  for (const channel of liveColorChannels) {
    if (!(channel.field in span)) continue;
    const field = Object.getOwnPropertyDescriptor(span,channel.field);
    if (!field?.enumerable || !('value' in field) || !span.options?.[channel.option] || span.rotation?.rigidGroups || span.symbolContinuity)
      throw Error(`${channel.label} keys require explicit single-artwork color interpolation.`);
    validateLiveColorKeys(field.value,span.end-span.start);
  }
  if (span.opacityEase !== undefined) validateMotionEase(span.opacityEase);
  if (span.paintEase !== undefined) {
    validateMotionEase(span.paintEase);
    if (span.options?.paint !== true)
      throw Error('Live paint easing requires explicit paint interpolation.');
  }
  if (span.path !== undefined) validateMotionPath(span.path);
  if (span.correspondence !== undefined) validateMotionContourCorrespondence(span.correspondence);
  if (span.rotation !== undefined) {
    validateMotionRotation(span.rotation);
    if (
      (span.rotation.savedGroupPivots && span.symbolContinuity !== 'graphics') ||
      span.rotation.rigidPivot !== undefined ||
      (span.rotation.rigidGroups && (span.rotation.groupDepth ?? 0) !== 0)
    )
      throw Error('Live group pivot or inner-depth continuity requires separate admission.');
  }
}
/** A movie placement keeps its authored offset on every sparse key. */
export function requireGroupMovieMember(from: Vector, to: Vector) {
  const first = from.symbolPlayback, last = to.symbolPlayback;
  if (!from.groups?.length || from.groups[0] !== to.groups?.[0] ||
      first?.mode !== 'movie' || last?.mode !== 'movie' ||
      !Number.isSafeInteger(first.firstFrame) || first.firstFrame < 0 || first.firstFrame >= 10000 ||
      last.firstFrame !== first.firstFrame || 'keyframeCut' in first || 'keyframeCut' in last)
    throw Error('Grouped movie clips need matching placements and the same movie offset on both keys.');
}

/** Grouped graphics retain their playback clock during translation or a saved-pivot orbit. */
export function validateGraphicGroupMotion(
  first: Vector[], last: Vector[], span: Pick<LiveMotionSpan, 'rotation' | 'path' | 'options'>,
) {
  const rotation = span.rotation;
  if (!rotation?.rigidGroups) return;
  const scales = rotation.uniformGroupScale || rotation.axisGroupScale;
  if (scales && (!rotation.savedGroupPivots || !span.options?.affine))
    throw Error('Grouped graphic scaling requires a saved pivot and explicit scale/skew interpolation.');
  if (!first.some(shape => shape.kind === 'symbol' && shape.groups?.length) ||
      rotation.turns || rotation.groupDepth || rotation.rigidPivot ||
      span.path?.tangent)
    throw Error('Choose complete outer groups containing a graphic symbol.');
  const groups = new Map<string, { count: number; dx: number; dy: number }>();
  for (const [index, from] of first.entries()) {
    const outer = from.groups?.[0];
    if (outer === undefined) continue;
    const to = last[index], dx = to.x - from.x, dy = to.y - from.y;
    const group = groups.get(outer) ?? { count: 0, dx, dy };
    if (rotation.savedGroupPivots && group.count === 0 &&
        (!from.pivot || !Number.isFinite(from.pivot.x) || !Number.isFinite(from.pivot.y)))
      throw Error('Each graphic group leader needs a finite saved pivot.');
    const changedTranslation = group.dx !== dx || group.dy !== dy || from.rotation !== to.rotation;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!rotation.savedGroupPivots && changedTranslation) ||
        (!scales && JSON.stringify(from.transform) !== JSON.stringify(to.transform)))
      throw Error('Grouped graphic translation requires fixed bases and equal member displacement.');
    group.count++;
    groups.set(outer, group);
  }
  if ([...groups.values()].some(group => group.count < 2))
    throw Error('Choose complete graphic groups with at least two members.');
}

/** Structural persistent admission. Geometry qualification stays in the shared
 * endpoint kernel; structurally valid incompatible endpoints can still load. */
export function validateLiveMotionLayer(
  layer: Layer,
  duration: number,
  bindings: readonly RootOpacityBinding[] = [],
): void {
  if (layer.liveMotionSpans === undefined) return;
  if (!Array.isArray(layer.liveMotionSpans)) throw Error('Invalid live motion spans.');
  const ids = new Set<string>();
  let end = -1;
  for (const span of layer.liveMotionSpans) {
    validateLiveMotionSpan(span, duration);
    if (span.rotation?.rigidGroups === true || span.symbolContinuity !== undefined) {
      // This newly admitted mode must validate original hierarchy data before
      // ordinary document iteration/JSON transport can read or normalize it.
      const keys = Object.getOwnPropertyDescriptor(layer, 'keys');
      if (!keys || !keys.enumerable || !('value' in keys))
        throw Error('Live group keys require original data fields.');
      validateLiveMotionData(keys.value);
      denseGroupArray(keys.value);
      for (const key of keys.value) {
        if (!key || typeof key !== 'object')
          throw Error('Live group keys require original data fields.');
        const frame = Object.getOwnPropertyDescriptor(key, 'frame');
        const shapes = Object.getOwnPropertyDescriptor(key, 'shapes');
        if (
          !frame ||
          !frame.enumerable ||
          !('value' in frame) ||
          !shapes ||
          !shapes.enumerable ||
          !('value' in shapes)
        )
          throw Error('Live group artwork requires original data fields.');
        denseGroupArray(shapes.value);
        for (const shape of shapes.value) {
          if (!shape || typeof shape !== 'object')
            throw Error('Live groups require original artwork data.');
          for (const name of ['id', 'kind']) {
            const d = Object.getOwnPropertyDescriptor(shape, name);
            if (!d || !d.enumerable || !('value' in d))
              throw Error('Live groups require original artwork identities.');
          }
          if (span.symbolContinuity !== undefined) {
            if (![Object.prototype, null].includes(Object.getPrototypeOf(shape)))
              throw Error('Live graphics require original artwork records.');
            if (Object.getOwnPropertyDescriptor(shape, 'kind')!.value === 'symbol') {
              const symbol = Object.getOwnPropertyDescriptor(shape, 'symbolId');
              if (
                !symbol?.enumerable ||
                !('value' in symbol) ||
                typeof symbol.value !== 'string' ||
                !symbol.value
              )
                throw Error('Live graphics require original symbol identities.');
              const playback = Object.getOwnPropertyDescriptor(shape, 'symbolPlayback');
              if (
                (!playback && 'symbolPlayback' in shape) ||
                (playback && (!playback.enumerable || !('value' in playback)))
              )
                throw Error('Live graphics require original playback data.');
              if (playback?.value !== undefined) {
                const p = playback.value;
                if (
                  !p ||
                  typeof p !== 'object' ||
                  ![Object.prototype, null].includes(Object.getPrototypeOf(p)) ||
                  Reflect.ownKeys(p).some((k) => k !== 'mode' && k !== 'firstFrame' && k !== 'keyframeCut')
                )
                  throw Error('Live graphics require fixed graphic playback data.');
                const mode = Object.getOwnPropertyDescriptor(p, 'mode'),
                  first = Object.getOwnPropertyDescriptor(p, 'firstFrame'),
                  cut = Object.getOwnPropertyDescriptor(p, 'keyframeCut');
                if (
                  !mode?.enumerable ||
                  !first?.enumerable ||
                  !('value' in mode) ||
                  !('value' in first) ||
                  !(
                    span.symbolContinuity === 'movies' || span.symbolContinuity === 'movie-trees' || span.nestedGraphicMovies === 'members-and-descendants'
                      ? ['loop', 'once', 'single', 'movie']
                      : ['loop', 'once', 'single']
                  ).includes(mode.value) ||
                  !Number.isSafeInteger(first.value) ||
                  first.value < 0 ||
                  first.value >= 10000 ||
                  ('keyframeCut' in p && (!cut?.enumerable || !('value' in cut) ||
                    cut.value !== true || mode.value === 'movie'))
                )
                  throw Error('The symbol playback mode, frame offset or keyframe cut is invalid for this tween.');
              }
            }
          }
          const ancestry = Object.getOwnPropertyDescriptor(shape, 'groups');
          if (ancestry && (!ancestry.enumerable || !('value' in ancestry)))
            throw Error('Live groups require original ancestry data.');
          if (!ancestry && 'groups' in shape)
            throw Error('Live groups require original ancestry data.');
          if (ancestry?.value !== undefined) denseGroupArray(ancestry.value);
        }
      }
    }
    if (
      ids.has(span.id) ||
      span.start < end ||
      layer.motionSpans?.some(
        (baked) => baked.id === span.id || (baked.start < span.end && baked.end > span.start),
      )
    )
      throw Error('Live and baked motion ownership overlaps.');
    ids.add(span.id);
    end = span.end;
    if (bindings.some((b) => b.layerId === layer.id && b.start < span.end && b.end > span.start))
      throw Error('Live motion and opacity binding ownership overlaps.');
    const endpoints = layer.keys.filter(
      (key) => key.frame === span.start || key.frame === span.end,
    );
    if (
      endpoints.length !== 2 ||
      endpoints.some((key) => !key.shapes.length) ||
      layer.keys.some((key) => key.frame > span.start && key.frame < span.end)
    )
      throw Error('Live motion requires two nonempty authored endpoints without interior keys.');
    for (const key of endpoints)
      if (
        key.shapes.some(
          (shape) => !shape.id || (shape.kind === 'symbol' && span.symbolContinuity === undefined),
        )
      )
        throw Error('Live symbol continuity requires separate admission.');
    if ((span.gradientColorTracks || span.shearKeys || span.rotationKeys || span.scaleXKeys || span.scaleYKeys || span.opacityKeys || span.xKeys || span.yKeys || span.strokeColorKeys || span.fillColorKeys) && endpoints.some(key => key.shapes.length !== 1 || key.shapes[0].groups?.length ||
        key.shapes[0].id !== endpoints[0].shapes[0].id))
      throw Error('Color keys require one matching ungrouped artwork item at both endpoints.');
    if (span.shearKeys || span.scaleXKeys || span.scaleYKeys) validateLiveScaleRange(span,endpoints[0].shapes[0],endpoints[1].shapes[0]);
    if (span.gradientColorTracks && endpoints.some(key=>!key.shapes[0].gradient || key.shapes[0].fillEnabled === false)) throw Error('Gradient keys require a visible gradient at both endpoints.');
    if (span.fillColorKeys && endpoints.some(key => !hasKeyableSolidFill(key.shapes[0])))
      throw Error('Fill keys require visible solid fill paint at both endpoints.');
    if (span.symbolContinuity !== undefined) {
      const [first, last] = endpoints;
      if (
        !first.shapes.some((s) => s.kind === 'symbol') ||
        first.shapes.length !== last.shapes.length ||
        first.shapes.some(
          (s, i) =>
            s.id !== last.shapes[i].id ||
            s.kind !== last.shapes[i].kind ||
            (s.kind === 'symbol' && s.symbolId !== last.shapes[i].symbolId),
        ) ||
        (span.rotation?.rigidGroups
          ? !first.shapes.some(s=>s.kind==='symbol' && s.groups?.length)
          : endpoints.some((k) => k.shapes.some((s) => s.groups?.length)))
      )
        throw Error('Live graphics require matching endpoint identities and the selected group mode.');
      if (span.nestedGraphicMovies === 'members-and-descendants')
        first.shapes.forEach((s,i)=>{
          if (s.symbolPlayback?.mode === 'movie' || last.shapes[i].symbolPlayback?.mode === 'movie')
            requireGroupMovieMember(s,last.shapes[i]);
        });
      if (span.symbolContinuity === 'graphics') validateGraphicGroupMotion(first.shapes, last.shapes, span);
      if (
        (span.symbolContinuity === 'movies' || span.symbolContinuity === 'movie-trees') &&
        endpoints.some((key) =>
          key.shapes.some(
            (shape, i) =>
              shape.kind === 'symbol' &&
              (shape.symbolPlayback?.mode !== 'movie' ||
                shape.symbolPlayback.firstFrame !== first.shapes[i].symbolPlayback?.firstFrame),
          ),
        )
      )
        throw Error('Live movies require identical authored movie offsets at both endpoints.');
    }
    const grouped = endpoints.some((key) => key.shapes.some((shape) => shape.groups?.length));
    if (grouped || span.rotation?.rigidGroups) {
      if (span.rotation?.rigidGroups !== true)
        throw Error('Live grouped endpoints require explicit complete outer-group motion.');
      const [first, last] = endpoints;
      if (
        first.shapes.length !== last.shapes.length ||
        first.shapes.some((shape, i) => {
          const a = shape.groups,
            b = last.shapes[i].groups;
          return (
            shape.id !== last.shapes[i].id ||
            (a === undefined
              ? b !== undefined
              : !b || a.length !== b.length || a.some((id, j) => id !== b[j]))
          );
        })
      )
        throw Error('Live group endpoints require identical ordered membership and hierarchy.');
      const groups = new Map<string, number>();
      for (const shape of first.shapes) {
        const outer = shape.groups?.[0];
        if (outer) groups.set(outer, (groups.get(outer) ?? 0) + 1);
      }
      if (!groups.size || [...groups.values()].some((count) => count < 2))
        throw Error(
          'Live complete-group motion requires at least two members in every outer group.',
        );
      for (const bank of span.groupPaths ?? []) {
        if (!bank.restrictedArc) continue;
        const members = first.shapes.flatMap((s, i) => (s.groups?.[0] === bank.groupId ? [i] : [])),
          leader = members[0];
        if (members.length < 2)
          throw Error('Restricted arc timing requires complete original group membership.');
        const dx = last.shapes[leader].x - first.shapes[leader].x,
          dy = last.shapes[leader].y - first.shapes[leader].y;
        if (
          members.some(
            (i) =>
              first.shapes[i].kind === 'symbol' ||
              last.shapes[i].kind === 'symbol' ||
              last.shapes[i].x - first.shapes[i].x !== dx ||
              last.shapes[i].y - first.shapes[i].y !== dy ||
              first.shapes[i].rotation !== last.shapes[i].rotation ||
              JSON.stringify(first.shapes[i].transform) !==
                JSON.stringify(last.shapes[i].transform),
          )
        )
          throw Error(
            'Restricted arc timing requires fixed bases and exact complete-member translation.',
          );
        validateRestrictedMotionArcGeometry(bank.restrictedArc, [
          { x: 0, y: 0 },
          { x: bank.path.startX, y: bank.path.startY },
          { x: dx + bank.path.endX, y: dy + bank.path.endY },
          { x: dx, y: dy },
        ]);
      }
    }
  }
}

/** Opted-in graphic documents reject raw accessors/nonfinite source data before
 * ordinary library iteration or JSON transport. Legacy documents keep their path. */
const immutableGraphics = new WeakSet<object>();
export function validateLiveGraphicData(value: unknown): void {
  if (isImmutableSnapshot(value) && immutableGraphics.has(value)) return;
  validateLiveMotionData(value);
  const visit = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) denseGroupArray(v);
    else if (![Object.prototype, null].includes(Object.getPrototypeOf(v)))
      throw Error('Live graphics require original plain data records.');
    for (const key of Reflect.ownKeys(v)) {
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (!d.enumerable && !(Array.isArray(v) && key === 'length'))
        throw Error('Live graphics require enumerable original data.');
      visit(d.value);
    }
  };
  visit(value);
  if (isImmutableSnapshot(value)) immutableGraphics.add(value);
}

/** One descriptor pass over data already detached by a native worker message.
 * Main-thread sources still use the original raw-data validation path. */
export function validateDetachedLiveGraphicData(value: unknown): void {
  if (value === null) return;
  switch (typeof value) {
    case 'undefined':
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(value)) throw Error('Live motion requires finite original values.');
      return;
    case 'object':
      break;
    default:
      throw Error('Live motion requires serializable original data.');
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || keys.length < value.length + 1)
      throw Error('Live groups require dense original array data.');
    if (keys.length > value.length + 1) throw Error('Live group arrays contain unsupported fields.');
    // Matching key count plus one own data descriptor per index excludes extra fields.
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, i);
      if (!descriptor?.enumerable || !('value' in descriptor))
        throw Error('Live groups require dense original array data.');
      validateDetachedLiveGraphicData(descriptor.value);
    }
    return;
  }
  if (prototype !== Object.prototype && prototype !== null)
    throw Error('Live graphics require original plain data records.');
  for (const key of keys) {
    if (typeof key !== 'string') throw Error('Live motion requires data fields.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor))
      throw Error('Live motion requires original data fields, not accessors.');
    if (!descriptor.enumerable) throw Error('Live graphics require enumerable original data.');
    validateDetachedLiveGraphicData(descriptor.value);
  }
}
export function preflightLiveGraphicSource(project: unknown): void {
  if (!project || typeof project !== 'object') return;
  const layers = Object.getOwnPropertyDescriptor(project, 'layers');
  if (!layers || !('value' in layers) || !Array.isArray(layers.value)) return;
  for (const key of Reflect.ownKeys(layers.value)) {
    const item = Object.getOwnPropertyDescriptor(layers.value, key);
    if (!item || !('value' in item) || !item.value || typeof item.value !== 'object') continue;
    const spans = Object.getOwnPropertyDescriptor(item.value, 'liveMotionSpans');
    if (!spans || !('value' in spans) || !Array.isArray(spans.value)) continue;
    for (const name of Reflect.ownKeys(spans.value)) {
      const d = Object.getOwnPropertyDescriptor(spans.value, name),
        span = d && 'value' in d ? d.value : undefined;
      if (!span || typeof span !== 'object') continue;
      const mode = Object.getOwnPropertyDescriptor(span, 'symbolContinuity');
      if (mode || 'guide' in span || 'nestedGraphicMovies' in span || 'sxKeyEases' in span || 'syKeyEases' in span || 'shearKeyEases' in span || 'fillKeyEases' in span || 'strokeKeyEases' in span || 'opacityKeyEases' in span || 'rotationKeyEases' in span || 'xKeyEases' in span || 'yKeyEases' in span || 'symbolContinuity' in span || 'groupPaths' in span || 'gradientColorTracks' in span || 'shearKeys' in span || 'rotationKeys' in span || 'scaleXKeys' in span || 'scaleYKeys' in span || 'opacityKeys' in span || 'xKeys' in span || 'yKeys' in span || 'strokeColorKeys' in span || 'fillColorKeys' in span) {
        validateLiveGraphicData(project);
        return;
      }
    }
  }
}
