import { splitSymbolPlacementKeys } from './motion-spans';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { selectionTrajectoryStamp } from './selection-trajectory';
import {
  validateProject,
  symbolArtworks,
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
import { compileMovieClockPlan } from './movie-clock-plan';

const preparing = new WeakMap<Project, { invalid: boolean }>();

/** Explicit bounded movie-root restriction. Private original frame ownership and
 * all-request/history publication remain the caller's separate responsibility. */
export function splitLiveMovieMotionLayer(
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
export function splitLiveMovieMotionLayerAtKey(project:Project,layer:Layer,span:LiveMotionSpan,at:number,rightId:string):Layer{
  return splitLayer(project,layer,span,at,rightId,true);
}
function splitLayer(project:Project,layer:Layer,span:LiveMotionSpan,at:number,rightId:string,atKey:boolean):Layer{
  const previous = preparing.get(project);
  if (previous) {
    previous.invalid = true;
    throw Error('Movie split preparation cannot reenter.');
  }
  const entry = { invalid: false };
  preparing.set(project, entry);
  try {
    const output = prepareMovieSplit(project, layer, span, at, rightId,atKey);
    if (entry.invalid) throw Error('Movie split preparation reentered.');
    return output;
  } finally {
    preparing.delete(project);
  }
}

function prepareMovieSplit(
  project: Project,
  layer: Layer,
  span: LiveMotionSpan,
  at: number,
  rightId: string,
  atKey:boolean,
): Layer {
  validateLiveGraphicData(project);
  validateLiveGraphicData(layer);
  validateLiveGraphicData(span);
  const sourceStamp = selectionTrajectoryStamp(project);
  const current = () => {
    validateLiveGraphicData(project);
    if (preparing.get(project)?.invalid) throw Error('Movie split preparation reentered.');
    if (
      !project.layers.includes(layer) ||
      !layer.liveMotionSpans?.includes(span) ||
      selectionTrajectoryStamp(project) !== sourceStamp
    )
      throw Error('Original movie split source or membership changed.');
  };
  current();
  validateProject(project);
  current();
  if (span.symbolContinuity !== 'movies')
    throw Error('Choose an original explicit movie continuity recipe.');
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
  if (span.rotation?.rigidGroups || [...first, ...last].some((shape) => shape.groups?.length))
    throw Error('Live complete-group split ownership requires separate admission.');
  const original = createMotionFrameSampler(project, layer.id, span);
  let leftPlan: ReturnType<typeof createMotionFrameSampler> | undefined, rightPlan: typeof leftPlan;
  try {
    // Equal authored offsets on promoted movie keys must never introduce a
    // new lifetime or reset an independently running movie. Compare the entire
    // original topology, including unrelated tracks and pre-span exposures.
    const topology = selectionTrajectoryStamp(compileMovieClockPlan(project));
    current();
    const middle = original.sample(at),
      nodeMatching = span.correspondence?.nodes;
    const eases = keyframeSplitEases(span.ease, fraction,atKey),
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
    if (span.path) {
      const dx = last[0].x - first[0].x,
        dy = last[0].y - first[0].y;
      if (first.some((shape, i) => last[i].x - shape.x !== dx || last[i].y - shape.y !== dy))
        throw Error(
          'Preserved path splits require matching endpoint displacement for every artwork item.',
        );
      paths = splitPreservedMotionPath(
        first[0],
        last[0],
        span.path,
        motionProgress(fraction, span.ease),
      );
    }
    const halves = [structuredClone(span), structuredClone(span)];
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
    splitSymbolPlacementKeys(span, at-span.start, halves);
    const kept=halves.filter(half=>half.end-half.start>=2);
    if(kept.length===1)kept[0].id=span.id;
    const draft: Layer = {
      ...layer,
      keys: [...layer.keys, { frame: at, shapes: middle }].sort((a, b) => a.frame - b.frame),
      liveMotionSpans: layer.liveMotionSpans!.flatMap((s) => (s.id === span.id ? kept : [s])),
    };
    const view = { ...project, layers: project.layers.map((l) => (l.id === layer.id ? draft : l)) };
    const expected = selectionTrajectoryStamp(draft);
    validateProject(view);
    current();
    if (selectionTrajectoryStamp(compileMovieClockPlan(view)) !== topology)
      throw Error('Movie split changed original clock topology or exposure lifetimes.');
    current();
    if (selectionTrajectoryStamp(draft) !== expected)
      throw Error('Movie split validation candidate changed.');
    if(halves[0].end-halves[0].start>=2)leftPlan = createMotionFrameSampler(view, layer.id, halves[0]);
    if(halves[1].end-halves[1].start>=2)rightPlan = createMotionFrameSampler(view, layer.id, halves[1]);
    // Original and replacement library/graph budgets are admitted above and at
    // output. Per-pose numeric validation uses only referenced root definition
    // metadata; it does not expand or duplicate the complete library per frame.
    // Use an existing non-symbol leaf solely to satisfy the definition schema.
    // This temporary checker is never an output scene or a replacement library.
    let leaf: Vector | undefined;
    for (const definition of project.symbols ?? []) {
      for (const artwork of symbolArtworks(definition)) {
        leaf = artwork.find((shape) => shape.kind !== 'symbol');
        if (leaf) break;
      }
      if (leaf) break;
    }
    if (!leaf) throw Error('Movie split numeric admission needs existing leaf artwork.');
    const rootDefinitionIds = new Set(
      first.filter((shape) => shape.kind === 'symbol').map((shape) => shape.symbolId),
    );
    const checker: Project = {
      ...project,
      duration: 1,
      symbols: (project.symbols ?? [])
        .filter((definition) => rootDefinitionIds.has(definition.id))
        .map((definition) => ({
          id: definition.id,
          name: definition.name,
          width: definition.width,
          height: definition.height,
          shapes: [leaf!],
          ...(definition.timeline
            ? { timeline: { duration: definition.timeline.duration, keys: [] } }
            : {}),
        })),
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
      if (!atKey && !sameMotionArtwork(before, after))
        throw Error('Preserved sparse split cannot reproduce the original integer poses.');
      for (const shapes of [before, after]) {
        checker.layers[0].keys[0].shapes = shapes;
        validateProject(checker);
      }
    }
    current();
    if (selectionTrajectoryStamp(draft) !== expected)
      throw Error('Movie split candidate changed during proof.');
    const output = structuredClone(draft);
    validateLiveGraphicData(output);
    const outputView = {
      ...project,
      layers: project.layers.map((item) => (item === layer ? output : item)),
    };
    validateProject(outputView);
    if (selectionTrajectoryStamp(compileMovieClockPlan(outputView)) !== topology)
      throw Error('Movie split output changed original clock topology or exposure lifetimes.');
    current();
    if (
      selectionTrajectoryStamp(output) !== expected ||
      selectionTrajectoryStamp(draft) !== expected
    )
      throw Error('Movie split layer clone or validation changed.');
    return output;
  } finally {
    original.dispose();
    leftPlan?.dispose();
    rightPlan?.dispose();
  }
}
