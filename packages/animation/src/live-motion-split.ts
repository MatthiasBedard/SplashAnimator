import { splitIntervalEases, splitPositionTiming } from './motion-spans';
import { liveNumericChannels, liveColorChannels } from '../../document/src/live-motion';
import {
  validateProject,
  type Project,
  type Layer,
  type LiveMotionSpan,
  type MotionSpanOptions,
  type Vector,
} from '../../document/src';
import { validateMotionRotation, type MotionRotation } from '../../document/src/motion-rotation';
import { type MotionContourCorrespondence } from '../../document/src/motion-contour';
import {
  createMotionFrameSampler,
  motionProgress,
  affinePose,
  resolveAutomaticGradientPairs,
} from './motion-frames';
import { keyframeSplitEases } from './motion-keyframe-ease';
import { splitPreservedMotionPath } from './motion-path';
import { motionRotationDelta } from './motion-rotation';
import { matchStraightMotionNodes } from './motion-resample';
import { shiftMotionContourStart } from './motion-nodes';
import { sameMotionArtwork } from './motion-ownership';

/** Private caller admits original ownership/source and final complete candidate.
 * Restriction uses the legacy preserved-split rules, without baked key arrays. */
export function splitLiveMotionLayer(
  project: Project,
  layer: Layer,
  span: LiveMotionSpan,
  at: number,
  rightId: string,
): Layer {
  return splitLayer(project,layer,span,at,rightId,false);
}
/** Standard keyframe insertion also admits a one-interval half, represented by
 * its two authored keys without an invalid zero-interior tween recipe. */
export function splitLiveMotionLayerAtKey(project:Project,layer:Layer,span:LiveMotionSpan,at:number,rightId:string):Layer{
  return splitLayer(project,layer,span,at,rightId,true);
}
function splitLayer(project:Project,layer:Layer,span:LiveMotionSpan,at:number,rightId:string,atKey:boolean):Layer{
  if (span.groupPaths !== undefined) throw Error('Independent group trajectory restriction requires separate admission.');
  if (!Number.isSafeInteger(at) || at - span.start < (atKey?1:2) || span.end - at < (atKey?1:2))
    throw Error('Split requires at least three frames in each half.');
  if (
    !rightId ||
    typeof rightId !== 'string' ||
    layer.liveMotionSpans?.some((s) => s.id === rightId) ||
    layer.motionSpans?.some((s) => s.id === rightId)
  )
    throw Error('Choose a distinct new live span identity.');
  const first = layer.keys.find((key) => key.frame === span.start)!.shapes,
    last = layer.keys.find((key) => key.frame === span.end)!.shapes,
    fraction = (at - span.start) / (span.end - span.start);
  if (span.symbolContinuity !== undefined)throw Error('Live graphic split ownership requires separate admission.');
  if (span.rotation?.rigidGroups || [...first, ...last].some((shape) => shape.groups?.length))
    throw Error('Live complete-group split ownership requires separate admission.');
  const original = createMotionFrameSampler(project, layer.id, span);
  let leftPlan: ReturnType<typeof createMotionFrameSampler> | undefined, rightPlan: typeof leftPlan;
  try {
    const middle = original.sample(at),
      nodeMatching = span.correspondence?.nodes;
    const eases = keyframeSplitEases(span.ease, fraction,atKey && !span.guide),
      opacityEases =
        span.opacityEase === undefined
          ? undefined
          : keyframeSplitEases(span.opacityEase, fraction,atKey),
      paintEases =
        span.paintEase === undefined ? undefined : keyframeSplitEases(span.paintEase, fraction,atKey);
    let correspondences: [
      MotionContourCorrespondence | undefined,
      MotionContourCorrespondence | undefined,
    ] = [nodeMatching ? { nodes: nodeMatching } : undefined, span.correspondence];
    if (span.correspondence?.source) {
      const { source, ...target } = span.correspondence;
      correspondences = [
        {
          source: structuredClone(source),
          ...(target.nodes !== undefined ? { nodes: structuredClone(target.nodes) } : {}),
        },
        Object.keys(target).length ? structuredClone(target) : undefined,
      ];
    }
    if (typeof nodeMatching === 'object' && nodeMatching.hints) {
      let shared: number[][] | undefined;
      first.forEach((shape, i) => {
        const indices: number[][] = [],
          c = span.correspondence!;
        const target = shiftMotionContourStart(last[i], c.start ?? 0, c.reverse ?? false, c.order),
          source = c.source
            ? shiftMotionContourStart(
                shape,
                c.source.start ?? 0,
                c.source.reverse ?? false,
                c.source.order,
              )
            : shape;
        matchStraightMotionNodes(
          source,
          target,
          nodeMatching.hints,
          nodeMatching.curves === true,
          nodeMatching.distance === true,
          (ring) => indices.push(ring),
        );
        if (shared && JSON.stringify(shared) !== JSON.stringify(indices))
          throw Error('Preserved hints require shared expanded indices across artwork.');
        shared = indices;
      });
      const hints = nodeMatching.hints;
      correspondences = [
        {
          ...correspondences[0],
          nodes: {
            ...nodeMatching,
            hints: hints.map((ring, r) => ring.map(([a], i) => [a, shared![r][i]] as const)),
          },
        },
        {
          ...correspondences[1],
          nodes: {
            ...nodeMatching,
            hints: hints.map((ring, r) => ring.map(([, b], i) => [shared![r][i], b] as const)),
          },
        },
      ];
    }
    let options: [MotionSpanOptions | undefined, MotionSpanOptions | undefined] = [
      span.options,
      span.options,
    ];
    const matching = span.options?.gradientStops;
    if (typeof matching === 'object') {
      let pairs: readonly (readonly [number, number])[] | undefined =
        matching.pairs === 'auto' ? undefined : matching.pairs;
      if (matching.pairs === 'auto')
        for (let i = 0; i < first.length; i++) {
          const resolved = resolveAutomaticGradientPairs(first[i], last[i]);
          if (!resolved) continue;
          if (pairs && JSON.stringify(pairs) !== JSON.stringify(resolved))
            throw Error(
              'Preserved automatic gradient splits require shared correspondence across artwork.',
            );
          pairs = resolved;
        }
      if (pairs) {
        for (const shape of middle)
          if (shape.gradient) {
            const groups = shape.gradient.stops.filter(
              (stop, i, stops) => i === 0 || stop.offset !== stops[i - 1].offset,
            );
            if (groups.length !== pairs.length)
              throw Error('Preserved gradient pairing requires distinct resolved split groups.');
          }
        options = [
          {
            ...span.options,
            gradientStops: { pairs: pairs.map(([from], i) => [from, i] as const) },
          },
          { ...span.options, gradientStops: { pairs: pairs.map(([, to], i) => [i, to] as const) } },
        ];
      }
    }
    let rotations: [MotionRotation | undefined, MotionRotation | undefined] = [
      span.rotation,
      span.rotation,
    ];
    // Unwrapped angle tracks own both halves, including a half with no interior keys.
    if (!span.rotationKeys && span.rotation && span.rotation.direction !== 'shortest') {
      const progress = motionProgress(fraction, span.ease),
        rotation = span.rotation;
      const derive = (right: boolean): MotionRotation => {
        const counts = first.map((shape, i) => {
          const angle = (s: Vector) => (span.options?.affine ? affinePose(s).rotation : s.rotation);
          const from = angle(shape),
            to = angle(last[i]),
            mid = angle(middle[i]),
            total = motionRotationDelta(from, to, rotation),
            wanted = total * (right ? 1 - progress : progress),
            base = motionRotationDelta(right ? mid : from, right ? to : mid, {
              ...rotation,
              turns: 0,
            });
          const turns = Math.round(
              (wanted - base) / (rotation.direction === 'clockwise' ? 360 : -360),
            ),
            result = { ...rotation, turns };
          validateMotionRotation(result);
          const actual = motionRotationDelta(right ? mid : from, right ? to : mid, result);
          if (
            Math.abs(actual - wanted) >
            32 * Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(wanted))
          )
            throw Error('Preserved rotation split is numerically unresolved.');
          return turns;
        });
        if (counts.some((turns) => turns !== counts[0]))
          throw Error('Preserved rotation splits require shared extra-turn counts on each half.');
        return { ...rotation, turns: counts[0] };
      };
      rotations = [derive(false), derive(true)];
    }
    let paths = [span.path, span.path];
    if (span.path || span.guide) {
      const dx = last[0].x - first[0].x,
        dy = last[0].y - first[0].y;
      if (first.some((shape, i) => last[i].x - shape.x !== dx || last[i].y - shape.y !== dy))
        throw Error(
          'Preserved path splits require matching endpoint displacement for every artwork item.',
        );
      if (span.path) paths = splitPreservedMotionPath(
        first[0],
        last[0],
        span.path,
        motionProgress(fraction, span.ease),
      );
    }
    const halves = [structuredClone(span), structuredClone(span)];
    if (span.guide) {
      const range = span.guide.interval ?? {start:0,end:1};
      const cut = range.start + (range.end-range.start)*motionProgress(fraction,span.ease);
      if (!(cut > range.start && cut < range.end)) throw Error('Guide split progress is unresolved.');
      halves[0].guide!.interval = {start:range.start,end:cut};
      halves[1].guide!.interval = {start:cut,end:range.end};
    }
    for (let i = 0; i < 2; i++) {
      const half = halves[i];
      half.ease = structuredClone(eases[i]);
      if (opacityEases) half.opacityEase = structuredClone(opacityEases[i]);
      if (paintEases) half.paintEase = structuredClone(paintEases[i]);
      if (options[i] !== undefined) half.options = structuredClone(options[i]);
      if (rotations[i] !== undefined) half.rotation = structuredClone(rotations[i]);
      if (paths[i] !== undefined) half.path = structuredClone(paths[i]);
      if (correspondences[i] !== undefined)
        half.correspondence = structuredClone(correspondences[i]);
      else if (span.correspondence !== undefined) delete half.correspondence;
    }
    halves[0].end = at;
    halves[1].id = rightId;
    halves[1].start = at;
    for (const {field} of liveColorChannels) {
      const keys=span[field];
      if (!keys) continue;
      const splitOffset = at-span.start;
      halves[0][field] = keys.filter(key => key.offset < splitOffset);
      halves[1][field] = keys.filter(key => key.offset > splitOffset)
        .map(key => ({ ...key, offset:key.offset-splitOffset }));
    }
    for (const {field} of liveNumericChannels) {
      const keys=span[field];
      if (!keys) continue;
      const splitOffset = at-span.start;
      halves[0][field] = keys.filter(key => key.offset < splitOffset);
      halves[1][field] = keys.filter(key => key.offset > splitOffset)
        .map(key => ({ ...key, offset:key.offset-splitOffset }));
    }
    splitPositionTiming(span,at-span.start,halves);
    if (span.gradientColorTracks) {
      const offset=at-span.start;
      for (const [i,half] of halves.entries()) half.gradientColorTracks=span.gradientColorTracks.map(row=>({...row,
        ...(row.eases ? {eases:splitIntervalEases(row.keys,span.end-span.start,offset,row.eases)[i]} : {}),
        keys:i===0 ? row.keys.filter(key=>key.offset<offset) :
          row.keys.filter(key=>key.offset>offset).map(key=>({...key,offset:key.offset-offset}))
      }));
    }
    const kept=halves.filter(half=>half.end-half.start>=2);
    if(kept.length===1)kept[0].id=span.id;
    const draft: Layer = {
      ...layer,
      keys: [...layer.keys, { frame: at, shapes: middle }].sort((a, b) => a.frame - b.frame),
      liveMotionSpans: layer.liveMotionSpans!.flatMap((s) => (s.id === span.id ? kept : [s])),
    };
    const view = { ...project, layers: project.layers.map((l) => (l.id === layer.id ? draft : l)) };
    validateProject(view);
    if(halves[0].end-halves[0].start>=2)leftPlan = createMotionFrameSampler(view, layer.id, halves[0]);
    if(halves[1].end-halves[1].start>=2)rightPlan = createMotionFrameSampler(view, layer.id, halves[1]);
    // Full source/library admission belongs to the outer command. This temporary
    // numeric checker needs only original bitmap metadata, never duplicate payloads
    // or unrelated symbol artwork per proof frame. It changes no source budgets.
    const checker: Project = {
      ...project,
      duration: 1,
      symbols: [],
      layerMasks: undefined,
      opacityBindings: undefined,
      frameScripts: undefined,
      frameLabels: undefined,
      frameComments: undefined,
      audioClips: undefined,
      assets: project.assets.map((asset) =>
        asset.bitmap
          ? {
              ...asset,
              bitmap: {
                name: asset.bitmap.name,
                width: asset.bitmap.width,
                height: asset.bitmap.height,
              },
            }
          : asset,
      ),
      layers: [
        {
          ...layer,
          liveMotionSpans: undefined,
          motionSpans: undefined,
          keys: [{ frame: 0, shapes: [] }],
        },
      ],
    };
    for (let frame = span.start; frame <= span.end; frame++) {
      const before = original.sample(frame),
        after = (frame <= at ? leftPlan : rightPlan)?.sample(frame) ?? draft.keys.find(key=>key.frame===frame)!.shapes;
      if ((!atKey || span.guide) && !sameMotionArtwork(before, after))
        throw Error('Preserved sparse split cannot reproduce the original integer poses.');
      if (span.gradientColorTracks) {
        const prior=before[0].gradient!.stops, next=after[0].gradient!.stops;
        if (prior.length!==next.length || prior.some((stop,i)=>stop.color.toLowerCase()!==next[i].color.toLowerCase()))
          throw Error('Splitting here would change a matched gradient stop color.');
      }
      for (const {field,property} of liveColorChannels)
        if (span[field] && before[0][property].toLowerCase() !== after[0][property].toLowerCase())
          throw Error('This split would change a rounded '+property+' color. Choose an exact color key.');
      for (const shapes of [before, after]) {
        checker.layers[0].keys[0].shapes = shapes;
        validateProject(checker);
      }
    }
    return draft;
  } finally {
    original.dispose();
    leftPlan?.dispose();
    rightPlan?.dispose();
  }
}
