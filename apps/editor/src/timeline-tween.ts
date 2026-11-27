import {
  keyAt,
  validateProject,
  symbolArtworks,
  MAX_SYMBOL_ARTWORK,
  type Project,
  type Layer,
  type MotionSpanOptions,
  type LiveMotionSpan,
} from '../../../packages/document/src';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import { validateMotionEase, type MotionEase } from '../../../packages/document/src/motion-ease';
import {
  prepareCreateLiveMotionSpans,
  prepareRemoveLiveMotionSpans,
} from '../../../packages/animation/src/live-motion';
import {
  requireOwnedMotionInterior,
  checkMotionReconstruction,
} from '../../../packages/animation/src/motion-ownership';
import { selectionTrajectoryStamp } from '../../../packages/animation/src/selection-trajectory';
import { symbolizeTweenEndpoints } from './tween-symbol';
import { motionSymbolPlayback } from '../../../packages/animation/src/motion-symbols';
import { createBasicMotionSpan } from '../../../packages/animation/src/motion-spans';

import { createMotionFrameSampler } from '../../../packages/animation/src/motion-frames';
import { captureContourOwners } from '../../../packages/animation/src/motion-shape-morph';
import { parseMotionNodeHints } from '../../../packages/animation/src/motion-resample';

export type TweenKind = 'motion' | 'shape';
export type TimelineTweenInput = {
  start: number;
  end: number;
  kind: TweenKind;
  affine: boolean;
  createEndpoints: boolean;
  ease: MotionEase;
  /** Explicit automatic motion conversion; omitted preserves advanced legacy behavior. */
  symbolize?: boolean;
  shapeHints?: { spanId: string; text: string; pair?: { sourceId: string; targetId: string } };
};
export function tweenLayerLabel(layer: Layer) {
  const spans = [...(layer.liveMotionSpans ?? []), ...(layer.motionSpans ?? [])];
  const shape = spans.some((s) => s.options?.nodes || s.options?.primitives);
  const motion = spans.some((s) => !s.options?.nodes && !s.options?.primitives) ||
    layer.keys.some(key => key.openMotionTween && key.shapes.length);
  return shape && motion
    ? 'Motion / Shape tweens'
    : shape
      ? 'Shape tween'
      : motion
        ? 'Motion tween'
        : '';
}
export function timelineTweenRange(
  project: Project,
  layerId: string,
  at: number,
  selected?: { start: number; end: number },
) {
  const layer = project.layers.find((l) => l.id === layerId);
  if (!layer) throw Error('Choose an existing layer.');
  if (selected && selected.end - selected.start >= 2) return selected;
  const span =
    [...(layer.liveMotionSpans ?? []), ...(layer.motionSpans ?? [])].find(
      (s) => s.start <= at && at < s.end,
    ) ?? [...(layer.liveMotionSpans ?? []), ...(layer.motionSpans ?? [])].find((s) => s.end === at);
  if (span) return { start: span.start, end: span.end };
  const key = keyAt(layer, at),
    next = layer.keys.find((k) => k.frame > at);
  return {
    start: key.frame,
    end: next
      ? next.shapes.length
        ? next.frame
        : next.frame - 1
      : Math.min(project.duration - 1, key.frame + Math.max(2, Math.round(project.fps))),
  };
}

const preparing = new WeakMap<Project, { invalid: boolean }>();
/** Detached advanced conversion; explicit symbolization replaces only admitted
 * endpoint artwork. Unrelated keys/recipes and original source remain untouched. */
export function prepareTimelineTween(
  project: Project,
  layerId: string,
  input: TimelineTweenInput,
  validate: () => void = () => {},
  symbolId?: string,
) {
  const prior = preparing.get(project);
  if (prior) {
    prior.invalid = true;
    throw Error('Timeline tween conversion cannot reenter.');
  }
  const entry = { invalid: false };
  preparing.set(project, entry);
  try {
    validateLiveGraphicData(project);
    validateLiveGraphicData(input);
    validateProject(project);
    if (
      Reflect.ownKeys(input).some(
        (k) =>
          !['start', 'end', 'kind', 'affine', 'createEndpoints', 'ease', 'symbolize', 'shapeHints'].includes(
            k as string,
          ),
      )
    )
      throw Error('Choose supported tween settings.');
    const source = selectionTrajectoryStamp(project),
      stamp = selectionTrajectoryStamp(input);
    const current = () => {
      const result = validate() as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('Tween admission must be synchronous.');
      }
      if (
        entry.invalid ||
        selectionTrajectoryStamp(project) !== source ||
        selectionTrajectoryStamp(input) !== stamp
      )
        throw Error('Original tween source or settings changed.');
      validateLiveGraphicData(project);
      validateLiveGraphicData(input);
    };
    const request = structuredClone(input);
    current();
    const { start, end, kind, affine, createEndpoints, ease, symbolize = false } = request;
    if (
      !['motion', 'shape'].includes(kind) ||
      typeof affine !== 'boolean' ||
      typeof createEndpoints !== 'boolean' ||
      typeof symbolize !== 'boolean' ||
      (symbolize && kind !== 'motion') ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end >= project.duration ||
      end < start
    )
      throw Error('Choose start/end frames at least two frames apart within the timeline.');
    validateMotionEase(ease);
    let candidate = structuredClone(project);
    current();
    if (symbolId !== undefined && (symbolize || !candidate.symbols?.some(symbol => symbol.id === symbolId) ||
      candidate.duration > 10000 || candidate.layers.some(track => track.liveMotionSpans)))
      throw Error('Choose a valid symbol timeline of at most 10,000 frames.');
    if (symbolize && selectionTrajectoryStamp(candidate) !== source)
      throw Error('Original tween snapshot changed.');
    let layer = candidate.layers.find((l) => l.id === layerId);
    if (!layer || !layer.visible || layer.locked) throw Error('Choose a visible, unlocked layer.');
    const overlaps = [...(layer.liveMotionSpans ?? []), ...(layer.motionSpans ?? [])].filter(
      (s) => s.start < end && s.end > start,
    );
    if (overlaps.some((s) => s.start !== start || s.end !== end) || overlaps.length > 1)
      throw Error('Convert one complete tween range without overlapping other tweens.');
    const old = overlaps[0];
    const startKey = layer.keys.find(key => key.frame === start);
    const endKey = layer.keys.find(key => key.frame === end);
    if (request.shapeHints !== undefined) {
      if (selectionTrajectoryStamp(candidate) !== source || selectionTrajectoryStamp(request) !== stamp)
        throw Error('Original shape tween snapshot changed.');
      const edit = request.shapeHints;
      const live = layer.liveMotionSpans?.find(s => s.id === edit?.spanId);
      const nodes = live?.correspondence?.nodes;
      if (!edit || typeof edit.text !== 'string' || !live || old !== live ||
          kind !== 'shape' || symbolize || symbolId !== undefined ||
          typeof nodes !== 'object' || !nodes.shapes || !nodes.curves ||
          Object.keys(live.correspondence!).some(k => k !== 'nodes') ||
          !startKey || !endKey)
        throw Error('Choose an existing shape tween with automatic contour matching.');
      const parsed = parseMotionNodeHints(edit.text, false, true, nodes.distance);
      if (typeof parsed !== 'object') throw Error('Choose curved shape matching.');
      const index = edit.pair ? startKey.shapes.findIndex(shape=>shape.id===edit.pair!.sourceId) : 0;
      const from = startKey.shapes[index], to = endKey.shapes[index];
      if (!from || !to || (edit.pair && to.id !== edit.pair.targetId))
        throw Error('Choose a matched pair from the original artwork.');
      if (!edit.pair && (startKey.shapes.length !== 1 || endKey.shapes.length !== 1 || nodes.artworkHints))
        throw Error('Choose an original artwork pair to edit.');
      const previous = nodes.artworkHints?.find(entry=>entry.sourceId===from.id && entry.targetId===to.id);
      const contourOwners = parsed.hints && captureContourOwners(from,to,parsed.hints,previous?.contourOwners);
      if (edit.pair || contourOwners) {
        if (!edit.pair) delete nodes.hints;
        const entries = (nodes.artworkHints ?? []).filter(entry=>entry.sourceId!==from.id);
        if (contourOwners || JSON.stringify(parsed.hints) !== JSON.stringify(nodes.hints))
          entries.push({sourceId:from.id,targetId:to.id,hints:parsed.hints ?? null,...(contourOwners ? {contourOwners} : {})});
        if (entries.length) nodes.artworkHints = entries;
        else delete nodes.artworkHints;
      } else {
        if (parsed.hints) nodes.hints = parsed.hints;
        else delete nodes.hints;
      }
      validateProject(candidate);
      const plan = createMotionFrameSampler(candidate, layerId, live);
      try { plan.sample(Math.floor((start + end) / 2)); } finally { plan.dispose(); }
      current();
      return candidate;
    }
    if (kind === 'motion' && !createEndpoints && !old &&
        (end === start || !endKey || (end === start + 1 && endKey.shapes.length))) {
      if (!startKey?.shapes.length) throw Error('Choose an authored keyframe with artwork to start the motion tween.');
      if (layer.keys.some(key => key.frame > start && key.frame < end))
        throw Error('Authored interior keys are protected. Choose adjacent endpoint keys.');
      if ([...(layer.liveMotionSpans ?? []), ...(layer.motionSpans ?? [])].some(span =>
        span.start <= start && start < span.end))
        throw Error('Choose an authored exposure outside another tween.');
      if (symbolize) symbolizeTweenEndpoints(candidate, layerId, startKey);
      startKey.openMotionTween = { affine, ease };
      validateProject(candidate);
      validateLiveGraphicData(candidate);
      current();
      return candidate;
    }
    if (end - start < 2)
      throw Error('Choose start/end frames at least two frames apart within the timeline.');
    if (old && layer.motionSpans?.includes(old as NonNullable<Layer['motionSpans']>[number])) {
      if (
        layer.keys.some(
          (k) => k.frame >= start && k.frame <= end && k.shapes.some((s) => s.kind === 'symbol'),
        )
      )
        throw Error('Use authored symbol endpoints before converting generated symbol animation.');
      const basic = old as NonNullable<Layer['motionSpans']>[number];
      const generated = requireOwnedMotionInterior(layer, basic);
      checkMotionReconstruction(
        candidate,
        layer,
        basic,
        generated,
        'Generated keys no longer match their recipe; detach to preserve edits.',
      );
      const owned = new Set(generated);
      layer.keys = layer.keys.filter((k) => !owned.has(k));
      layer.motionSpans = layer.motionSpans!.filter((s) => s !== old);
      if (!layer.motionSpans.length) delete layer.motionSpans;
    } else if (old) {
      candidate = prepareRemoveLiveMotionSpans(candidate, [{ layerId, spanId: old.id }], {
        validate: current,
      });
      layer = candidate.layers.find((l) => l.id === layerId)!;
    }
    if (layer.keys.some((k) => k.frame > start && k.frame < end))
      throw Error('Authored interior keys are protected. Choose adjacent endpoint keys.');
    const preserveHeldPlayback = symbolize || symbolId !== undefined;
    for (const at of [start, end]) {
      const existing = layer.keys.find((k) => k.frame === at);
      if (existing) {
        if (!existing.shapes.length)
          throw Error('Blank authored endpoint keys are preserved. Choose nonempty endpoints.');
        continue;
      }
      if (!createEndpoints)
        throw Error('Create authored endpoint keys first or enable matching endpoint creation.');
      const held = keyAt(layer, at);
      if (!held.shapes.length) throw Error('Draw or place artwork before creating a tween.');
      if (held.shapes.some((s) => s.kind === 'symbol') && !preserveHeldPlayback)
        throw Error(
          'Symbols need existing authored endpoint keys to preserve their playback clocks.',
        );
      const heldStamp = preserveHeldPlayback ? selectionTrajectoryStamp(held) : '';
      const created = { ...structuredClone(held), frame: at };
      if (preserveHeldPlayback && selectionTrajectoryStamp({ ...created, frame: held.frame }) !== heldStamp)
        throw Error('Matching tween endpoint changed.');
      delete created.openMotionTween;
      if (preserveHeldPlayback) {
        const playback = motionSymbolPlayback(candidate.symbols ?? []);
        for (const shape of created.shapes) {
          const clock = playback(shape);
          if (clock) shape.symbolPlayback = clock(at - held.frame);
        }
      }
      layer.keys.push(created);
      layer.keys.sort((a, b) => a.frame - b.frame);
      current();
    }
    const a = layer.keys.find((k) => k.frame === start)!,
      b = layer.keys.find((k) => k.frame === end)!;
    if (symbolize) {
      symbolizeTweenEndpoints(candidate, layerId, a, b);
      current();
    }
    delete a.openMotionTween;
    if (
      kind === 'shape' &&
      [a, b].some((k) =>
        k.shapes.some(
          (s) => s.kind === 'symbol' || s.kind === 'text' || s.bitmap || s.groups?.length,
        ),
      )
    )
      throw Error(
        'Shape tweens require ungrouped vector artwork; symbols, text and bitmaps stay untouched.',
      );
    const options: MotionSpanOptions = {
      ...old?.options,
      paint: symbolize && old ? (old.options?.paint ?? false) : true,
      affine,
    };
    const matching = old?.correspondence?.nodes;
    const automaticShapeMatching =
      old?.correspondence !== undefined &&
      Object.keys(old.correspondence).every((key) => key === 'nodes') &&
      typeof matching === 'object' &&
      matching.curves === true &&
      matching.shapes === true &&
      Object.keys(matching).every((key) => key === 'curves' || key === 'shapes');
    if (kind === 'shape') {
      options.nodes = true;
      options.primitives = true;
      options.strokeWidth = true;
    } else {
      if (old?.correspondence && !automaticShapeMatching)
        throw Error(
          'This shape tween has saved contour correspondence. Use the detailed tween controls to preserve it.',
        );
      for (const key of [
        'nodes',
        'primitives',
        'contourAreas',
        'contourEdges',
        'contourContacts',
        'curveTangents',
        'curveSelfContacts',
      ] as const)
        delete options[key];
    }
    let rotation = old?.rotation;
    if (!rotation && [a, b].some((k) => k.shapes.some((s) => s.groups?.length)))
      rotation = { direction: 'shortest', turns: 0, rigidGroups: true };
    const span = {
      ...old,
      id: old?.id ?? crypto.randomUUID(),
      start,
      end,
      ease,
      options,
      ...(kind === 'shape'
        ? {
            correspondence: {
              ...old?.correspondence,
              nodes: {
                ...(typeof old?.correspondence?.nodes === 'object' ? old.correspondence.nodes : {}),
                curves: true,
                shapes: true,
              },
            },
          }
        : {}),
      ...(rotation ? { rotation } : {}),
    };
    if (kind === 'motion' && automaticShapeMatching) delete span.correspondence;
    delete (span as { baseline?: string }).baseline;
    delete (span as { autoRefresh?: boolean }).autoRefresh;
    if (symbolId !== undefined) {
      // Symbol timelines store editable generated keys and their remembered recipe.
      const libraryCount = (candidate.symbols ?? []).filter(symbol => symbol.id !== symbolId)
        .reduce((count, symbol) => count + symbolArtworks(symbol).reduce((n, art) => n + art.length, 0), 0);
      const localCount = candidate.layers.reduce((count, track) =>
        count + track.keys.reduce((n, key) => n + key.shapes.length, 0), 0);
      if (libraryCount + localCount + (end - start - 1) * Math.max(a.shapes.length, b.shapes.length) > MAX_SYMBOL_ARTWORK)
        throw Error('Motion would exceed the existing project symbol artwork budget.');
      createBasicMotionSpan(candidate, [layerId], start, end, ease, options, span.path, rotation,
        span.correspondence, span.opacityEase, span.paintEase);
      const recipe = layer.motionSpans!.find(item => item.start === start && item.end === end)!;
      recipe.id = span.id;
      recipe.autoRefresh = true;
      validateProject(candidate);
      validateLiveGraphicData(candidate);
      current();
      return candidate;
    }
    const symbolModes = [undefined, 'graphics', 'movies', 'movie-trees'] as const;
    const continuity = (old as LiveMotionSpan | undefined)?.symbolContinuity;
    let result: Project | undefined, last: unknown, first: unknown;
    for (const mode of continuity ? [continuity] : symbolModes) {
      if (mode !== undefined && !a.shapes.some((s) => s.kind === 'symbol')) continue;
      try {
        result = prepareCreateLiveMotionSpans(
          candidate,
          [{ layerId, span: { ...span, ...(mode ? { symbolContinuity: mode } : {}) } }],
          { validate: current },
        );
        break;
      } catch (cause) {
        current();
        first ??= cause;
        last = cause;
      }
    }
    if (!result)
      throw (symbolize ? first : last) ?? Error('These endpoint shapes cannot form this tween.');
    current();
    validateProject(result);
    validateLiveGraphicData(result);
    current();
    return result;
  } finally {
    preparing.delete(project);
  }
}
