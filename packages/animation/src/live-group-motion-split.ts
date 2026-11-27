import { compileMovieClockPlan } from './movie-clock-plan';
import { splitPoseDefinitions } from './split-pose-definitions';
import { splitIndependentGroupPaths } from './independent-group-path-split';
import { splitRestrictedGroupPaths, splitRecursiveRestrictedGroupPaths } from './restricted-group-path-split';
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
  colorChannels,
  createMotionFrameSampler,
  motionProgress,
  affinePose,
  resolveAutomaticGradientPairs,
} from './motion-frames';
import { keyframeSplitEases } from './motion-keyframe-ease';
import { splitPreservedMotionPath } from './motion-path';
import { motionRotationDelta } from './motion-rotation';
import { prepareRigidGroups } from './motion-rigid';
import { validateLiveMotionData } from '../../document/src/live-motion';
import { selectionTrajectoryStamp } from './selection-trajectory';
import { matchStraightMotionNodes } from './motion-resample';
import { shiftMotionContourStart } from './motion-nodes';
import { sameMotionArtwork } from './motion-ownership';

/** A stored RGB endpoint must lie on the original channel line before rounding.
 * Check the rational frame fraction by cross multiplication, including at non-dyadic cuts. */
function certifySolidColor(from:string, to:string, promoted:string, ease:LiveMotionSpan['ease'], offset:number, duration:number) {
  if (from === to) return;
  const linear = ease === 'linear' || (typeof ease === 'object' && ease.x1 === ease.y1 && ease.x2 === ease.y2);
  if (!linear) throw Error('Changing solid colors require linear paint timing for an original-distance split.');
  const first = colorChannels(from), last = colorChannels(to), middle = colorChannels(promoted);
  for (let i=0; i<first.length; i++) {
    if ((last[i]-first[i])*offset !== (middle[i]-first[i])*duration)
      throw Error('This distance cut would round a promoted color channel. Choose an exact color key.');
  }
}

/** Explicit complete-group restriction only. The outer command must still own
 * original source/revision and final all-track publication. This kernel returns
 * a detached layer with one key/two sparse recipes, never baked fallback keys. */
export function splitLiveGroupMotionLayer(
  project: Project,
  layer: Layer,
  span: LiveMotionSpan,
  at: number,
  rightId: string,
): Layer {
  return splitGroupLayer(project, layer, span, at, rightId, false);
}

/** Separately explicit original-clock preparation. Artwork changes require independently certified channels;
 * easing restriction and distance correspondence are checked independently. */
export function splitRestrictedArcLiveGroupMotionLayer(
  project: Project,
  layer: Layer,
  span: LiveMotionSpan,
  at: number,
  rightId: string,
): Layer {
  return splitGroupLayer(project, layer, span, at, rightId, true);
}
/** Separate recursive persisted-clock kernel. Original-clock creation and the
 * ordinary split remain guarded against already restricted source banks. */
export function splitRecursiveRestrictedArcLiveGroupMotionLayer(
  project: Project,
  layer: Layer,
  span: LiveMotionSpan,
  at: number,
  rightId: string,
): Layer {
  return splitGroupLayer(project, layer, span, at, rightId, true, false, true);
}
/** Standard timeline keyframe insertion, retaining complete original group admission. */
export function splitLiveGroupMotionLayerAtKey(project:Project,layer:Layer,span:LiveMotionSpan,at:number,rightId:string):Layer{
  return splitGroupLayer(project,layer,span,at,rightId,false,true);
}
function splitGroupLayer(
  project: Project,
  layer: Layer,
  span: LiveMotionSpan,
  at: number,
  rightId: string,
  restricted: boolean,
  atKey=false,
  recursive=false,
): Layer {
  validateLiveMotionData(project);
  validateLiveMotionData(layer);
  validateLiveMotionData(span);
  validateProject(project);
  if (!project.layers.includes(layer) || !layer.liveMotionSpans?.includes(span))
    throw Error('Choose the original complete-group layer and recipe.');
  if (span.rotation?.rigidGroups !== true)
    throw Error('Explicit complete-group split requires original group admission.');
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
  const stationaryData = (shapes: Vector[]) =>
    selectionTrajectoryStamp(shapes.map((shape) => {
      const fixed = { ...shape, x: 0, y: 0 };
      delete fixed.opacity;
      if (span.options?.paint && !shape.gradient) fixed.fill = '';
      if (span.options?.paint || span.options?.strokeColor) fixed.stroke = '';
      if (span.options?.strokeWidth) fixed.strokeWidth = 0;
      return fixed;
    }));
  if (
    restricted &&
    (first.some((shape) => shape.kind === 'symbol') ||
      span.correspondence !== undefined ||
      span.rotation.turns !== 0 ||
      stationaryData(first) !== stationaryData(last))
  )
    throw Error(
      'Original-clock split currently requires fixed artwork apart from position, opacity, enabled stroke width and solid colors.',
    );
  const movieClocks = span.nestedGraphicMovies ? selectionTrajectoryStamp(compileMovieClockPlan(project)) : undefined;
  const members = prepareRigidGroups(first, last, span.rotation);
  const original = createMotionFrameSampler(project, layer.id, span);
  let leftPlan: ReturnType<typeof createMotionFrameSampler> | undefined, rightPlan: typeof leftPlan;
  try {
    const middle = original.sample(at),
      nodeMatching = span.correspondence?.nodes;
    if (restricted && stationaryData(middle) !== stationaryData(first))
      throw Error('Original-clock split cannot change continuous artwork properties.');
    if (restricted) {
      const paintEase = span.paintEase ?? span.ease;
      first.forEach((shape,i) => {
        if (span.options?.paint && !shape.gradient)
          certifySolidColor(shape.fill,last[i].fill,middle[i].fill,paintEase,at-span.start,span.end-span.start);
        if (span.options?.paint || span.options?.strokeColor)
          certifySolidColor(shape.stroke,last[i].stroke,middle[i].stroke,span.options.strokeColor ? span.ease : paintEase,at-span.start,span.end-span.start);
      });
    }
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
    if (span.rotation && span.rotation.direction !== 'shortest') {
      const progress = motionProgress(fraction, span.ease),
        rotation = span.rotation;
      const derive = (right: boolean): MotionRotation => {
        const counts = first.map((shape, i) => {
          const angle = (s: Vector) =>
            span.options?.affine && !members[i] ? affinePose(s).rotation : s.rotation;
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
    // Restricting document-axis scaling after a rotated middle pose requires
    // the existing shared-shear representation on the right. This derives recipe
    // metadata, as in legacy preserved group splitting; no interpolation option
    // is enabled and both halves still undergo their complete geometric proof.
    if (span.rotation.axisGroupScale) rotations[1] = { ...rotations[1]!, axisGroupShear: true };
    let paths = [span.path, span.path];
    if (span.path) {
      const bank = new Set(span.groupPaths?.map((binding) => binding.groupId));
      // Unbanked leaders/loose roots retain the shared path exactly. Banked
      // leaders may have different travel: their restricted route compensates
      // the shared header's new endpoint basis. Legacy no-bank reference is0.
      const reference = first.findIndex(
        (shape, i) =>
          (!members[i] || members[i]!.leader === i) && !bank.has(shape.groups?.[0] ?? ''),
      );
      const leader = reference < 0 ? 0 : reference;
      const dx = last[leader].x - first[leader].x,
        dy = last[leader].y - first[leader].y;
      if (
        first.some(
          (shape, i) =>
            (!members[i] || members[i]!.leader === i) &&
            !bank.has(shape.groups?.[0] ?? '') &&
            (last[i].x - shape.x !== dx || last[i].y - shape.y !== dy),
        )
      )
        throw Error(
          'Preserved path splits require matching endpoint displacement for every group leader and loose root.',
        );
      paths = splitPreservedMotionPath(
        first[leader],
        last[leader],
        span.path,
        motionProgress(fraction, span.ease),
      );
    }
    const groupPaths = restricted
      ? (recursive ? splitRecursiveRestrictedGroupPaths : splitRestrictedGroupPaths)(layer, span, middle, motionProgress(fraction, span.ease))
      : splitIndependentGroupPaths(layer, span, middle, motionProgress(fraction, span.ease), paths);
    const halves = [structuredClone(span), structuredClone(span)].map((half) =>
      restricted ? { ...half } : half,
    );
    for (let i = 0; i < 2; i++) {
      const half = halves[i];
      half.ease = structuredClone(eases[i]);
      if (opacityEases) half.opacityEase = structuredClone(opacityEases[i]);
      if (paintEases) half.paintEase = structuredClone(paintEases[i]);
      if (options[i] !== undefined) half.options = structuredClone(options[i]);
      if (rotations[i] !== undefined) half.rotation = structuredClone(rotations[i]);
      if (paths[i] !== undefined) half.path = structuredClone(paths[i]);
      if (groupPaths[i] !== undefined) half.groupPaths = structuredClone(groupPaths[i]);
      if (correspondences[i] !== undefined)
        half.correspondence = structuredClone(correspondences[i]);
      else if (span.correspondence !== undefined) delete half.correspondence;
      if (
        restricted &&
        (selectionTrajectoryStamp(half.options) !== selectionTrajectoryStamp(span.options) ||
          selectionTrajectoryStamp(half.rotation) !== selectionTrajectoryStamp(span.rotation))
      )
        throw Error(
          'Original-clock split cannot enable or rederive original options or group settings.',
        );
    }
    halves[0].end = at;
    halves[1].id = rightId;
    halves[1].start = at;
    const kept=halves.filter(half=>half.end-half.start>=2);
    if(kept.length===1)kept[0].id=span.id;
    const draft: Layer = {
      ...layer,
      keys: [...layer.keys, { frame: at, shapes: middle }].sort((a, b) => a.frame - b.frame),
      liveMotionSpans: layer.liveMotionSpans!.flatMap((s) => (s.id === span.id ? kept : [s])),
    };
    const view = { ...project, layers: project.layers.map((l) => (l.id === layer.id ? draft : l)) };
    validateProject(view);
    if (movieClocks !== undefined && selectionTrajectoryStamp(compileMovieClockPlan(view)) !== movieClocks)
      throw Error('The group key would change an independent movie exposure.');
    if(halves[0].end-halves[0].start>=2)leftPlan = createMotionFrameSampler(view, layer.id, halves[0]);
    if(halves[1].end-halves[1].start>=2)rightPlan = createMotionFrameSampler(view, layer.id, halves[1]);
    // Full source/library admission belongs to the outer command. This temporary
    // numeric checker needs only original bitmap metadata, never duplicate payloads
    // or unrelated symbol artwork per proof frame. It changes no source budgets.
    const checker: Project = {
      ...project,
      duration: 1,
      symbols: splitPoseDefinitions(project, first),
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
    const expected = selectionTrajectoryStamp(draft),
      output = structuredClone(draft);
    validateLiveMotionData(output);
    if (selectionTrajectoryStamp(output) !== expected)
      throw Error('Complete-group split layer clone changed.');
    return output;
  } finally {
    original.dispose();
    leftPlan?.dispose();
    rightPlan?.dispose();
  }
}
