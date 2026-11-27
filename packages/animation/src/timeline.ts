import { liveNumericChannels, liveColorChannels } from '../../document/src/live-motion';
import { copyLayerArtwork } from './layers';
import { graphicFrameAtAge } from './motion-symbols';
import { createBasicMotionSpan, reverseBasicMotionSpan } from './motion-spans';
import { clearFrames, copyFrames, placeFrameClip, moveFrames as moveExposures, type FrameClip } from './frame-exposures';
export { clearFrames, copyFrames, type FrameClip } from './frame-exposures';
import { createMotionFrameSampler } from './motion-frames';
import {
  checkMotionReconstruction,
  motionInteriorBaseline,
  requireOwnedMotionInterior,
} from './motion-ownership';
import { prepareRootOpacityBindings } from '../../document/src/opacity-bindings';
import { validateLiveGraphicData, type LiveMotionSpan } from '../../document/src/live-motion';
import {
  clone,
  id,
  insertKey,
  keyAt,
  MAX_SYMBOL_ARTWORK,
  symbolArtworks,
  validateProject,
  type BasicMotionSpan,
  type ButtonStates,
  type Layer,
  type Project,
} from '@splash/document';
/** Active-layer edits: other layers keep their frame positions. */
export function editFrameRange(
  project: Project,
  layerId: string,
  start: number,
  end: number,
  action: 'duplicate' | 'remove' | 'reverse' | 'keys',
) {
  const layer = project.layers.find((l) => l.id === layerId);
  if (!layer || layer.locked) throw new Error('Timeline layer is locked or missing.');
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end >= project.duration
  )
    throw new Error('Invalid frame range.');
  if (action === 'keys') {
    layer.keys = keyEveryFrame(layer, start, end);
    return;
  }
  if (action === 'reverse') {
    reverseLayerFrameRanges(project, [layerId], start, end);
    return;
  }
  if (action === 'duplicate') duplicateLayerFrameRanges(project, [layerId], start, end);
  else removeLayerFrameRanges(project, [layerId], start, end);
}
function restoredExposure(
  held: Layer['keys'][number], frame: number,
  definitions: ReadonlyMap<string, NonNullable<Project['symbols']>[number]>,
) {
  const shapes = clone(held.shapes);
  for (const shape of shapes) {
    if (shape.kind !== 'symbol') continue;
    const definition = definitions.get(shape.symbolId!);
    const mode = shape.symbolPlayback?.mode ?? 'loop';
    if (!definition?.timeline || definition.buttonStates || mode === 'movie' || mode === 'single') continue;
    const first = shape.symbolPlayback?.firstFrame ?? 0;
    const firstFrame = graphicFrameAtAge(definition.timeline.duration, mode, first, frame - held.frame);
    if (firstFrame !== first) shape.symbolPlayback = { mode, firstFrame };
  }
  return shapes;
}

function reverseLayerFrameRanges(project: Project, ids: string[], start: number, end: number) {
  if (start === end) return;
  const selected = new Set(ids);
  const guarded = project.opacityBindings !== undefined ||
    project.layers.some(layer => selected.has(layer.id) && layer.motionSpans?.length);
  const captured = guarded ? validateProject(project) : project;
  const mirror = (frame: number) => start + end - frame;
  const definitions = new Map(captured.symbols?.map(symbol => [symbol.id, symbol]));

  const layers = project.layers.map((source, index) => {
    if (!selected.has(source.id)) return source;
    const layer = captured.layers[index];
    const clip = copyFrames(layer, start, end);
    const keys = new Map(layer.keys.filter(k => k.frame < start || k.frame > end).map(k => [k.frame, k]));
    for (const [i, key] of clip.keys.entries()) {
      // Reverse whole held exposures. Their lengths stay with their artwork.
      const frame = start + clip.duration - (clip.keys[i + 1]?.frame ?? clip.duration);
      keys.set(frame, { ...key, frame });
    }
    if (end + 1 < project.duration && !keys.has(end + 1)) {
      const held = keyAt(layer, end + 1);
      const shapes = restoredExposure(held, end + 1, definitions);
      keys.set(end + 1, { frame:end + 1, shapes });
    }

    const recipes = layer.motionSpans?.map(span => {
      if (span.end <= start || span.start >= end) {
        const joint = span.end === start ? start : span.start === end ? end : undefined;
        if (joint !== undefined) {
          const authored = layer.keys.find(key => key.frame === joint);
          const reflected = keyAt(layer, mirror(joint));
          if (!authored || motionInteriorBaseline([authored]) !==
              motionInteriorBaseline([{frame:joint, shapes:reflected.shapes}]))
            throw new Error('Reversal would replace a shared remembered endpoint.');
          keys.set(joint, authored);
        }
        return span;
      }
      if (span.start < start || span.end > end)
        throw new Error('Cannot reverse part of a remembered motion span.');
      requireOwnedMotionInterior(source, span);
      const draft = { ...layer, visible:true, motionSpans:[span],
        keys:layer.keys.filter(key => key.frame >= span.start && key.frame <= span.end) };
      reverseBasicMotionSpan({ ...captured, layers:[draft], duration:span.end + 1 }, [layer.id], span.start, span.end);
      const offset = start + end - span.start - span.end;
      const reversed = draft.keys.map(key => ({ ...key, frame:key.frame + offset }));
      for (const key of reversed) keys.set(key.frame, key);
      return { ...draft.motionSpans[0], start:mirror(span.end), end:mirror(span.start),
        baseline:motionInteriorBaseline(reversed.slice(1, -1)) };
    });

    for (const binding of project.opacityBindings ?? []) {
      const first = Math.max(start, binding.start), last = Math.min(end, binding.end);
      if (binding.layerId !== layer.id || first > last) continue;
      // A target ID can reappear after a blank. The reflected exposure and
      // the absolute binding must belong to the same continuous lifetime.
      prepareRootOpacityBindings({ duration:project.duration, layers:[layer] }, [{
        ...binding, start:Math.min(binding.start, mirror(last)), end:Math.max(binding.end, mirror(first)),
      }]);
    }
    return { ...layer, keys:[...keys.values()].sort((a,b) => a.frame-b.frame),
      ...(recipes ? { motionSpans:recipes.sort((a,b) => a.start-b.start) } : {}) };
  });
  if (guarded) validateProject({ ...project, layers });
  for (const [index, layer] of project.layers.entries()) {
    if (!selected.has(layer.id)) continue;
    layer.keys = layers[index].keys;
    if (layers[index].motionSpans) layer.motionSpans = layers[index].motionSpans;
  }
}
function shortenAutomaticMotion(
  project: Project, layer: Layer, span: BasicMotionSpan, start: number, end: number,
  keys: ReadonlyMap<number, Layer['keys'][number]>, replacement: Map<number, Layer['keys'][number]>,
): BasicMotionSpan | undefined {
  const owned = requireOwnedMotionInterior(layer, span);
  checkMotionReconstruction(project, { ...layer, visible: true }, span, owned,
    'Refresh remembered motion before removing its generated artwork.');

  const trimStart = span.start >= start, trimEnd = span.end <= end;
  const first = trimStart ? start : span.start;
  const last = trimEnd ? start - 1 : span.end - (end - start + 1);
  // A single surviving pose or two adjacent authored keys need no recipe.
  if (last - first < 2) return;
  if ((trimStart || trimEnd) && (span.path || span.correspondence ||
      (span.rotation && (span.rotation.direction !== 'shortest' || span.rotation.turns ||
        span.rotation.savedGroupPivots || span.rotation.rigidPivot))))
    throw Error('Remove the custom tween before deleting its endpoint frames.');

  const firstKey = keys.get(first), lastKey = keys.get(last);
  if (!firstKey || !lastKey) throw Error('The shortened tween is missing its surviving endpoint poses.');
  const recipe = { ...span, start: first, end: last };
  const sampler = createMotionFrameSampler({ ...project,
    layers: [{ ...layer, visible: true, keys: [firstKey, lastKey] }],
  }, layer.id, recipe);
  const interior: Layer['keys'] = [];
  try {
    for (let frame = first + 1; frame < last; frame++) {
      const key = { frame, shapes: sampler.sample(frame) };
      replacement.set(frame, key);
      interior.push(key);
    }
  } finally {
    sampler.dispose();
  }
  return { ...recipe, baseline: motionInteriorBaseline(interior) };
}

function durationAfterFrameRemoval(
  project: Project,
  selected: ReadonlySet<string>,
  start: number,
  end: number,
  buttonStates?: ButtonStates,
) {
  if (end !== project.duration - 1) return project.duration;

  // The last authored timing on an unaffected track or absolute channel can keep
  // the shared timeline longer than the selected tracks.
  let duration = Math.max(1, start);
  for (const layer of project.layers) {
    if (selected.has(layer.id)) continue;
    duration = Math.max(duration, (layer.keys.at(-1)?.frame ?? 0) + 1);
  }
  for (const entries of [project.frameLabels, project.frameComments, project.frameScripts]) {
    for (const entry of entries ?? []) duration = Math.max(duration, entry.frame + 1);
  }
  for (const binding of project.opacityBindings ?? []) duration = Math.max(duration, binding.end + 1);
  for (const frame of Object.values(buttonStates ?? {})) duration = Math.max(duration, frame + 1);

  const clips = project.audioClips;
  if (clips?.length) {
    const audio = new Map(project.assets.map(asset => [asset.id, asset.audio]));
    for (const clip of clips) {
      const asset = audio.get(clip.assetId);
      if (!asset) return project.duration;
      const length = Math.ceil((asset.frames - clip.offsetSamples) * project.fps / asset.sampleRate);
      duration = Math.max(duration, clip.startFrame + Math.max(1, length));
    }
  }
  return Math.min(duration, project.duration);
}

function removeLayerFrameRanges(
  project: Project, ids: string[], start: number, end: number,
  symbolId?: string, buttonStates?: ButtonStates,
) {
  const symbol = symbolId === undefined ? undefined : project.symbols?.find(s => s.id === symbolId);
  if (symbolId !== undefined && !symbol)
    throw Error('The original symbol is missing.');
  const selected = new Set(ids);
  const count = end - start + 1,
    tail = project.duration - count;
  const guarded =
    project.opacityBindings !== undefined ||
    project.layers.some((layer) => selected.has(layer.id) &&
      (layer.motionSpans?.length || layer.liveMotionSpans?.length));
  const captured = guarded || end === project.duration - 1 ? validateProject(project) : project;
  const duration = durationAfterFrameRemoval(captured, selected, start, end, buttonStates ?? symbol?.buttonStates);

  const layers = project.layers.map((layer, index) => {
    if (!selected.has(layer.id)) return layer;
    const keys = layer.keys
      .filter((key) => key.frame < start || key.frame > end)
      .map((key) => (key.frame > end ? { ...key, frame: key.frame - count } : key));
    if (start < tail && !keys.some((key) => key.frame === start))
      keys.push({ frame: start, shapes: clone(keyAt(layer, end + 1).shapes) });
    if (tail < duration) keys.push({ frame: tail, shapes: [] });
    keys.sort((a, b) => a.frame - b.frame);
    const next = { ...layer, keys };

    if (layer.liveMotionSpans?.length) {
      const spans = layer.liveMotionSpans.flatMap(span => {
        if (span.end < start) return [span];
        if (span.start > end)
          return [{ ...span, start: span.start - count, end: span.end - count }];
        if (span.start >= start && span.end <= end) return [];
        throw Error('Select the complete live tween before deleting frames that overlap it.');
      });
      setFrameBlockLiveSpans(next, spans);
    }

    if (layer.motionSpans?.length) {
      const spans: BasicMotionSpan[] = [];
      const replacements = new Map<number, Layer['keys'][number]>();
      const shiftedKeys = new Map(keys.map(key => [key.frame, key]));
      for (const span of layer.motionSpans) {
        if (span.end < start) {
          spans.push(span);
          continue;
        }
        if (span.end >= project.duration)
          throw new Error('Remembered motion exceeds the timeline.');
        if (span.start >= start && span.end <= end) {
          const generated = requireOwnedMotionInterior(layer, span);
          checkMotionReconstruction(
            captured,
            { ...captured.layers[index], visible: true },
            clone(span),
            clone(generated),
            'Refresh remembered motion before removing its generated artwork.',
          );
          continue;
        }
        if (span.start > end) {
          spans.push(shiftOwnedSpan(layer, span, -count));
          continue;
        }
        if (symbolId !== undefined && span.autoRefresh) {
          const shortened = shortenAutomaticMotion(captured, layer, span, start, end, shiftedKeys, replacements);
          if (shortened) spans.push(shortened);
          continue;
        }
        // Removing an endpoint is safe only when the exact authored key exists
        // at its replacement position and every interior stays with the recipe.
        const left = span.end === start;
        if (!left && span.start !== end)
          throw new Error('Cannot remove part of a remembered motion span.');
        const original = layer.keys.find((key) => key.frame === (left ? start : end));
        const replacement = keys.find((key) => key.frame === (left ? start : start - 1));
        if (
          !original ||
          !replacement ||
          motionInteriorBaseline([original]) !==
            motionInteriorBaseline([{ ...replacement, frame: original.frame }])
        )
          throw new Error('Removing frames would replace a remembered motion endpoint.');
        spans.push(shiftOwnedSpan(layer, span, left ? 0 : -count));
      }
      if (replacements.size) next.keys = keys.map(key => replacements.get(key.frame) ?? key);
      if (spans.length) next.motionSpans = spans;
      else delete next.motionSpans;
    }

    // For affected absolute channels, follow the original artwork through the
    // removed time to the last exposure that now paints inside the interval.
    for (const binding of project.opacityBindings ?? []) {
      if (binding.layerId !== layer.id || binding.end < start) continue;
      if (binding.end >= tail)
        throw new Error('Frame removal would leave an opacity channel in the blank tail.');
      prepareRootOpacityBindings({ layers: [layer], duration: project.duration }, [
        { ...binding, end: binding.end + count },
      ]);
    }
    return next;
  });
  if (symbolId !== undefined) {
    const count = (project.symbols ?? []).filter(symbol => symbol.id !== symbolId).reduce((sum, symbol) =>
      sum + symbolArtworks(symbol).reduce((n, artwork) => n + artwork.length, 0), 0) +
      layers.reduce((sum, layer) => sum + layer.keys.reduce((n, key) => n + key.shapes.length, 0), 0);
    if (count > MAX_SYMBOL_ARTWORK) throw Error('Motion would exceed the existing project symbol artwork budget.');
  }
  const candidate = { ...project, layers, duration };
  if (guarded || duration !== project.duration) validateProject(candidate);
  if (guarded)
    for (const layer of layers) if (selected.has(layer.id)) checkFrameBlockLiveRecipes(candidate, layer);
  for (const [i, layer] of layers.entries()) {
    if (layer === project.layers[i]) continue;
    project.layers[i].keys = layer.keys;
    if (layer.motionSpans !== undefined) project.layers[i].motionSpans = layer.motionSpans;
    else delete project.layers[i].motionSpans;
    if (project.layers[i].liveMotionSpans?.length)
      setFrameBlockLiveSpans(project.layers[i], layer.liveMotionSpans ?? []);
  }
  project.duration = duration;
}

export function adjacentKey(layer: Layer, frame: number, direction: -1 | 1, authoredOnly = false): number {
  const isKey = (key: Layer['keys'][number]) =>
    (direction < 0 ? key.frame < frame : key.frame > frame) &&
    (!authoredOnly || !layer.motionSpans?.some(span =>
      span.autoRefresh && span.start < key.frame && key.frame < span.end,
    ));
  return (
    (direction < 0
      ? [...layer.keys].reverse().find(isKey)
      : layer.keys.find(isKey)
    )?.frame ?? frame
  );
}

export function shiftOwnedSpan(
  source: Pick<Layer, 'keys'>,
  span: BasicMotionSpan,
  offset: number,
  freshId = false,
): BasicMotionSpan {
  if (
    !source.keys.some((k) => k.frame === span.start) ||
    !source.keys.some((k) => k.frame === span.end)
  )
    throw new Error('Remembered motion needs both authored endpoint keys.');
  const generated = requireOwnedMotionInterior(source, span);
  return {
    ...span,
    id: freshId ? id() : span.id,
    start: span.start + offset,
    end: span.end + offset,
    baseline: motionInteriorBaseline(generated.map((k) => ({ ...k, frame: k.frame + offset }))),
  };
}

function editableLayerAt(project: Project, layerId: string, frame: number) {
  const layer = project.layers.find((l) => l.id === layerId);
  if (!layer || layer.locked) throw new Error('Timeline layer is locked or missing.');
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= project.duration)
    throw new Error('Invalid keyframe position.');
  return layer;
}

export function insertRootKey(project: Project, layerId: string, frame: number, blank = false) {
  const layer = editableLayerAt(project, layerId, frame);
  if (project.opacityBindings === undefined) {
    insertKey(layer, frame, blank);
    return;
  }
  validateProject(project);
  const next = { ...layer, keys: layer.keys.map((k) => ({ ...k })) };
  insertKey(next, frame, blank);
  validateProject({ ...project, layers: project.layers.map((l) => (l === layer ? next : l)) });
  layer.keys = next.keys;
}

// The fixed interval and its shifted original starting pose must share one lifetime.
function validateShiftedOpacityStart(project: Project, layer: Layer, at: number, count: number) {
  for (const binding of project.opacityBindings ?? []) {
    if (binding.layerId !== layer.id || at > binding.start) continue;
    prepareRootOpacityBindings({ layers: [layer], duration: project.duration + count }, [
      { ...binding, end: Math.max(binding.end, binding.start + count) },
    ]);
  }
}

export function editRootExposure(
  project: Project,
  layerId: string,
  frame: number,
  action: 'insert-frame' | 'remove-key',
) {
  const layer = editableLayerAt(project, layerId, frame);
  const extend = action === 'insert-frame';
  if (extend && project.duration >= 100000) throw new Error('Timeline duration limit exceeded.');
  const index = extend ? -1 : layer.keys.findIndex((key) => key.frame === frame);
  if (!extend && (frame === 0 || index < 0)) return;
  const bound = project.opacityBindings !== undefined;
  if (bound) validateProject(project);
  const duration = project.duration + (extend ? 1 : 0);
  const keys = extend
    ? layer.keys.map((key) => (key.frame > frame ? { ...key, frame: key.frame + 1 } : key))
    : layer.keys.filter((_, i) => i !== index);
  if (bound) {
    const next = { ...layer, keys };
    if (extend) {
      validateShiftedOpacityStart(project, next, frame + 1, 1);
    } else {
      const following = layer.keys[index + 1]?.frame ?? duration;
      for (const binding of project.opacityBindings ?? []) {
        if (binding.layerId !== layerId || binding.start >= following || binding.end < frame)
          continue;
        // The previous held pose will take over. Check its identity against the
        // original exposure even when removal replaces the entire binding.
        prepareRootOpacityBindings({ layers: [layer], duration }, [
          { ...binding, start: Math.min(binding.start, frame - 1) },
        ]);
      }
    }
    validateProject({
      ...project,
      duration,
      layers: project.layers.map((l) => (l === layer ? next : l)),
    });
  }
  layer.keys = keys;
  project.duration = duration;
}

const reconnectableLiveFields = new Set([
  'id', 'start', 'end', 'ease', 'opacityEase', 'paintEase', 'options', 'rotation',
  'correspondence', 'symbolContinuity', 'nestedGraphicMovies',
]);

/** Reconnect surviving endpoint poses after clearing authored live keys. */
function clearLiveKeyEndpoints(
  layer: Layer, next: Layer, deleted: ReadonlySet<number>, start: number, end: number,
) {
  const spans = layer.liveMotionSpans!;
  const affected = spans.filter(span => deleted.has(span.start) || deleted.has(span.end));
  const retained = spans.filter(span => !deleted.has(span.start) && !deleted.has(span.end));
  const endpoints = new Map(next.keys.map(key => [key.frame, key]));
  const neighbors = (at: number, before: number) => {
    const a = endpoints.get(at), b = layer.keys.find(key => key.frame === before);
    return a && b && a.shapes.length > 0 && a.shapes.length === b.shapes.length &&
      a.shapes.every((shape, i) => shape.id === b.shapes[i].id && shape.kind === b.shapes[i].kind);
  };
  const joined: LiveMotionSpan[] = [];
  for (let i = 0; i < affected.length; i++) {
    const first = i, head = affected[i];
    let tail = head;
    while (affected[i + 1]?.start === tail.end && deleted.has(tail.end)) tail = affected[++i];
    // A whole selected tween is cleared. A one-frame half of an inserted key
    // has no recipe and can only be recovered from a matching adjacent key.
    if (head.start >= start && tail.end <= end) continue;
    const left = deleted.has(head.start) ? head.start - 1 : head.start;
    const right = deleted.has(tail.end) ? tail.end + 1 : tail.end;
    if (right - left < 2 ||
      (left !== head.start && !neighbors(left, head.start)) ||
      (right !== tail.end && !neighbors(right, tail.end)) ||
      next.keys.some(key => left < key.frame && key.frame < right) ||
      [...retained, ...(next.motionSpans ?? [])].some(span => span.start < right && span.end > left))
      continue;
    const settings = (span: LiveMotionSpan) => {
      const { options, rotation, correspondence, symbolContinuity, nestedGraphicMovies } = span;
      const nodes = correspondence?.nodes;
      if (Object.keys(span).some(key => !reconnectableLiveFields.has(key)) ||
        (correspondence && (Object.keys(correspondence).some(key => key !== 'nodes') ||
          (typeof nodes === 'object' && Object.keys(nodes).some(key => !['curves','distance','shapes'].includes(key))))) ||
        (rotation && (rotation.direction !== 'shortest' || rotation.turns ||
          rotation.rigidPivot || rotation.savedGroupPivots)) ||
        typeof options?.gradientStops === 'object' && options.gradientStops.pairs !== 'auto')
        throw Error('Clear the custom path, matching, or channel keys before joining this tween.');
      return JSON.stringify({ options, rotation, correspondence, symbolContinuity, nestedGraphicMovies });
    };
    const mode = settings(head);
    if (affected.slice(first + 1, i + 1).some(span => settings(span) !== mode))
      throw Error('Match the settings of the neighboring tweens before clearing their shared key.');
    joined.push({ ...head, start: left, end: right });
  }
  setFrameBlockLiveSpans(next, [...retained, ...joined].sort((a, b) => a.start - b.start));
  return joined;
}

/** Remove stored keys without moving time. Prepare every track before writing any. */
export function removeLayerKeyframes(project: Project, ids: readonly string[], start: number, end: number, symbolId?: string) {
  validateLiveGraphicData(project);
  validateProject(project);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 ||
      end < start || end >= project.duration)
    throw Error('Choose an existing frame range.');
  const selected = new Set(ids);
  if (!selected.size || [...selected].some(id =>
    !project.layers.some(layer => layer.id === id && !layer.locked)))
    throw Error('Select existing, unlocked timeline layers.');
  if (symbolId !== undefined && !project.symbols?.some(symbol => symbol.id === symbolId))
    throw Error('The original symbol is missing.');

  const joins: { layer: Layer; start: number; end: number; recipe: BasicMotionSpan }[] = [];
  const liveJoins: { layer: Layer; spans: LiveMotionSpan[] }[] = [];

  const layers = project.layers.map(layer => {
    if (!selected.has(layer.id)) return layer;
    const automatic = new Set(symbolId === undefined ? [] : (layer.motionSpans ?? []).filter(span => span.autoRefresh));
    const generated = new Set<number>();
    for (const span of automatic)
      for (let frame = span.start + 1; frame < span.end; frame++) generated.add(frame);
    const removed = layer.keys.filter(key => key.frame > 0 && key.frame >= start && key.frame <= end &&
      !generated.has(key.frame));
    if (!removed.length) return layer;
    const first = removed[0].frame, last = removed[removed.length - 1].frame;
    const deleted = new Set(removed.map(key => key.frame));
    const affected = [...automatic].filter(span => deleted.has(span.start) || deleted.has(span.end));
    const affectedSet = new Set(affected);
    const obsolete = new Set(deleted);
    for (const span of affected) {
      const owned = requireOwnedMotionInterior(layer, span);
      checkMotionReconstruction(project, { ...layer, visible: true }, span, owned,
        'Refresh remembered motion before removing its generated keys.');
      for (const key of owned) obsolete.add(key.frame);
    }
    const next = { ...layer, keys: layer.keys.filter(key => !obsolete.has(key.frame)) };
    const follows = layer.keys.find(key => key.frame > last)?.frame ?? project.duration;
    for (const binding of project.opacityBindings ?? []) {
      if (binding.layerId !== layer.id || binding.start >= follows || binding.end < first) continue;
      prepareRootOpacityBindings({ layers: [layer], duration: project.duration }, [
        { ...binding, start: Math.min(binding.start, first - 1) },
      ]);
    }
    const retain = (span: BasicMotionSpan) => {
      if (span.end < first || span.start > last) return true;
      if (span.start >= start && span.end <= end) return false;
      throw Error('Select the complete tween before removing keyframes that belong to it.');
    };
    if (layer.motionSpans?.length) {
      const spans = layer.motionSpans.filter(span => {
        if (affectedSet.has(span)) return false;
        if (automatic.has(span)) return true;
        if (retain(span)) return true;
        checkMotionReconstruction(project, { ...layer, visible: true }, span,
          requireOwnedMotionInterior(layer, span), 'Refresh remembered motion before removing its generated keys.');
        return false;
      });
      if (spans.length) next.motionSpans = spans;
      else delete next.motionSpans;
    }
    if (layer.liveMotionSpans?.length) {
      const spans = clearLiveKeyEndpoints(layer, next, deleted, start, end);
      if (spans.length) liveJoins.push({ layer: next, spans });
    }
    if (!affected.length) return next;
    const originalKeys = new Map(layer.keys.map(key => [key.frame, key]));
    const joinsAdjacentKey = (endpoint: number, neighbor: number) => {
      const key = originalKeys.get(neighbor);
      const artwork = originalKeys.get(endpoint)!.shapes;
      return key && !obsolete.has(neighbor) && !generated.has(neighbor) && key.shapes.length === artwork.length &&
        key.shapes.every((shape, i) => shape.id === artwork[i].id && shape.kind === artwork[i].kind);
    };
    for (let i = 0; i < affected.length; i++) {
      const from = i;
      const recipe = affected[i];
      let tail = recipe;
      while (affected[i + 1]?.start === tail.end && deleted.has(tail.end)) tail = affected[++i];
      // An adjacent half of a split has no generated recipe. Its surviving
      // matching authored key can still close the gap across the removed key.
      const left = deleted.has(recipe.start) ? recipe.start - 1 : recipe.start;
      const right = deleted.has(tail.end) ? tail.end + 1 : tail.end;
      if ((left !== recipe.start && !joinsAdjacentKey(recipe.start, left)) ||
          (right !== tail.end && !joinsAdjacentKey(tail.end, right))) continue;
      const properties = JSON.stringify([recipe.options, recipe.rotation]);
      if (affected.slice(from, i + 1).some(span => span.path || span.correspondence ||
          JSON.stringify([span.options, span.rotation]) !== properties ||
          (span.rotation && (span.rotation.direction !== 'shortest' || span.rotation.turns ||
            span.rotation.rigidPivot || span.rotation.savedGroupPivots))))
        throw Error('Remove the tween before clearing a key that joins custom motion.');
      joins.push({ layer: next, start: left, end: right, recipe });
    }
    return next;
  });
  if (symbolId !== undefined) {
    let count = (project.symbols ?? []).filter(symbol => symbol.id !== symbolId).reduce((total, symbol) =>
      total + symbolArtworks(symbol).reduce((sum, artwork) => sum + artwork.length, 0), 0);
    count += layers.reduce((total, layer) => total + layer.keys.reduce((sum, key) => sum + key.shapes.length, 0), 0);
    for (const join of joins) {
      const artwork = join.layer.keys.find(key => key.frame === join.start)!.shapes;
      const target = join.layer.keys.find(key => key.frame === join.end)!.shapes;
      count += (join.end - join.start - 1) * Math.max(artwork.length, target.length);
    }
    if (count > MAX_SYMBOL_ARTWORK) throw Error('Motion would exceed the existing project symbol artwork budget.');
  }
  for (const { layer, start, end, recipe } of joins) {
    createBasicMotionSpan({ ...project, layers }, [layer.id], start, end, recipe.ease, recipe.options,
      undefined, recipe.rotation, undefined, recipe.opacityEase, recipe.paintEase);
    const joined = layer.motionSpans!.find(span => span.start === start && span.end === end)!;
    joined.id = recipe.id;
    joined.autoRefresh = true;
  }
  const candidate = { ...project, layers };
  validateProject(candidate);
  for (const { layer, spans } of liveJoins) {
    const view = { ...candidate, layers: layers.map(track =>
      track === layer ? { ...track, visible: true } : track,
    ) };
    for (const span of spans) createMotionFrameSampler(view, layer.id, span).dispose();
  }
  project.layers = layers;
}

export function pasteFrames(project: Project, layerId: string, at: number, clip: FrameClip) {
  if (
    project.opacityBindings !== undefined ||
    clip.motionSpans !== undefined ||
    project.layers.find((l) => l.id === layerId)?.motionSpans?.length
  ) {
    pasteLayerFrames(project, at, { projectId: project.id, tracks: [{ layerId, clip }] });
    return;
  }
  const layer = project.layers.find((l) => l.id === layerId);
  if (!layer || layer.locked) throw new Error('Timeline layer is locked or missing.');
  layer.keys = pastedKeys(layer, project.duration, at, clone(clip));
  project.duration += clip.duration;
}

function pastedKeys(layer: Layer, duration: number, at: number, clip: FrameClip) {
  if (
    !Number.isSafeInteger(at) ||
    at < 0 ||
    at > duration ||
    !Number.isSafeInteger(clip.duration) ||
    clip.duration < 1 ||
    duration + clip.duration > 100000
  )
    throw new Error('Timeline insertion exceeds limits.');
  if (
    !clip.keys.length ||
    clip.keys[0].frame !== 0 ||
    clip.keys.some(
      (k, i) =>
        !Number.isSafeInteger(k.frame) ||
        k.frame >= clip.duration ||
        (i > 0 && k.frame <= clip.keys[i - 1].frame),
    )
  )
    throw new Error('Invalid clipboard exposure ordering.');
  const keys = layer.keys.map((k) => ({
    ...k,
    frame: k.frame >= at ? k.frame + clip.duration : k.frame,
  }));
  keys.push(...clip.keys.map((k) => ({ ...k, frame: at + k.frame })));
  if (at < duration && !keys.some((k) => k.frame === at + clip.duration))
    keys.push({ frame: at + clip.duration, shapes: clone(keyAt(layer, at).shapes) });
  return keys.sort((a, b) => a.frame - b.frame);
}
/** One bounded edge-scroll step; invoked at a fixed cadence, not pointer-event frequency. */
export function timelineScrollStep(
  start: number,
  pointerX: number,
  width: number,
  duration: number,
  cellWidth = 18,
): number {
  if (![start, pointerX, width, duration, cellWidth].every(Number.isFinite) || width <= 0 || cellWidth <= 0) return start;
  const visible = Math.max(1, Math.floor(width / cellWidth)),
    max = Math.max(0, duration - visible);
  const direction = pointerX < 24 ? -1 : pointerX > width - 24 ? 1 : 0;
  const distance = direction < 0 ? 24 - pointerX : pointerX - (width - 24);
  const speed = direction ? Math.min(6, Math.max(1, Math.ceil(distance / 8))) : 0;
  return Math.max(0, Math.min(max, start + direction * speed));
}

/** Apply a shared range against one time base and commit only after every layer succeeds. */
export function editLayerFrameRanges(
  project: Project,
  layerIds: string[],
  start: number,
  end: number,
  action: 'duplicate' | 'remove' | 'clear' | 'reverse' | 'keys',
  symbolId?: string,
  buttonStates?: ButtonStates,
) {
  const ids = [...new Set(layerIds)];
  if (!ids.length || ids.some((id) => !project.layers.some((l) => l.id === id && !l.locked)))
    throw new Error('Select existing, unlocked timeline layers.');
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end >= project.duration
  )
    throw new Error('Invalid frame range.');
  if (action === 'duplicate') {
    duplicateLayerFrameRanges(project, ids, start, end);
    return;
  }
  if (action === 'remove') {
    removeLayerFrameRanges(project, ids, start, end, symbolId, buttonStates);
    return;
  }
  if (action === 'reverse') {
    reverseLayerFrameRanges(project, ids, start, end);
    return;
  }
  if (action === 'clear') {
    clearLayerFrameRanges(project, ids, start, end);
    return;
  }
  const next = clone(project),
    duration = project.duration;
  for (const id of ids) {
    next.duration = duration;
    editFrameRange(next, id, start, end, action);
  }
  for (const layer of project.layers) {
    if (ids.includes(layer.id)) layer.keys = next.layers.find((l) => l.id === layer.id)!.keys;
  }
  project.duration = next.duration;
}

/** Scale clipped exposure timing, shifting the selected tracks' following keys together.
 * Compression must preserve every exposure, including explicit blank keys.
 */
export function retimeLayerFrameRanges(
  project: Project,
  layerIds: string[],
  start: number,
  end: number,
  length: number,
) {
  const ids = [...new Set(layerIds)];
  if (!ids.length || ids.some((id) => !project.layers.some((l) => l.id === id && !l.locked)))
    throw new Error('Select existing, unlocked timeline layers.');
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end >= project.duration
  )
    throw new Error('Invalid frame range.');
  const oldLength = end - start + 1,
    delta = length - oldLength;
  if (!Number.isInteger(length) || length < 1 || project.duration + delta > 100000)
    throw new Error('Retimed duration must fit within 100000 frames.');
  if (!delta) return;
  const selected = new Set(ids);
  const guarded = project.opacityBindings !== undefined ||
    project.layers.some(layer => selected.has(layer.id) && layer.motionSpans?.length);
  const captured = guarded ? validateProject(project) : project;
  const duration = project.duration + Math.max(0, delta);
  const layers = project.layers.map((source, index) => {
    if (!selected.has(source.id)) return source;
    const layer = guarded ? captured.layers[index] : clone(source);
    const spans = layer.motionSpans ?? [];
    const contained = spans.filter(span => span.start >= start && span.end <= end);
    const generatedFrames = new Set<number>();
    for (const span of contained) {
      const owned = requireOwnedMotionInterior(source, span);
      checkMotionReconstruction(captured, { ...layer, visible: true }, span, owned,
        'Refresh remembered motion before retiming its generated artwork.');
      for (const key of owned) generatedFrames.add(key.frame);
    }
    // Preserve the authored final endpoint at the last new frame. Ordinary
    // exposure starts retain the timeline's existing floor-based scaling.
    const movesEndpoint = spans.some(span => span.start === end || span.end === end);
    const mapped = (frame: number) => {
      if (frame < start) return frame;
      if (frame > end) return frame + delta;
      if (frame === end && movesEndpoint) return start + length - 1;
      return start + Math.floor((frame - start) * length / oldLength);
    };
    if (start === end && movesEndpoint)
      throw new Error('Select the complete remembered motion span to retime its endpoint.');
    const resized = new Set(contained);
    const recipes = spans.map(span => {
      if (resized.has(span)) {
        const from = mapped(span.start), to = mapped(span.end);
        if (to - from < 2) throw new Error('Retiming must leave at least three frames in every remembered span.');
        return { ...span, start: from, end: to };
      }
      if (span.end <= start) return span;
      if (span.start >= end) return shiftOwnedSpan(source, span, delta);
      throw new Error('Cannot retime part of a remembered motion span.');
    });

    const origins = new Map<number, number>();
    const keys: Layer['keys'] = [];
    const place = (frame: number, source: number, shapes: Layer['keys'][number]['shapes']) => {
      if (origins.has(frame)) throw new Error('Compression would collapse keyframes. Choose a longer duration.');
      origins.set(frame, source);
      keys.push({ frame, shapes });
    };
    if (!layer.keys.some(key => key.frame === start))
      place(start, start, clone(keyAt(layer, start).shapes));
    for (const key of layer.keys)
      if (!generatedFrames.has(key.frame)) place(mapped(key.frame), key.frame, key.shapes);
    const after = start + length;
    // A retimed endpoint already starts the following hold at its correct age.
    if (!movesEndpoint && end + 1 < project.duration && !origins.has(after))
      place(after, end + 1, clone(keyAt(layer, end + 1).shapes));
    if (delta < 0) place(project.duration + delta, project.duration, []);
    for (const [index, span] of spans.entries()) {
      if (!resized.has(span)) continue;
      const recipe = recipes[index];
      const sampler = createMotionFrameSampler({ ...project, duration, layers: [{ ...layer, visible:true, keys }] }, layer.id, recipe);
      const interior: Layer['keys'] = [];
      try {
        for (let frame = recipe.start + 1; frame < recipe.end; frame++) {
          const shapes = sampler.sample(frame);
          place(frame, span.start + 1, shapes);
          interior.push({frame, shapes});
        }
      } finally {
        sampler.dispose();
      }
      recipe.baseline = motionInteriorBaseline(interior);
    }
    keys.sort((a,b) => a.frame - b.frame);
    const next = { ...layer, keys, ...(spans.length ? {motionSpans: recipes} : {}) };
    // Trace both ends back across the original exposures. Checking the
    // candidate alone could bind an absolute channel to a disconnected ID.
    for (const binding of project.opacityBindings ?? []) {
      if (binding.layerId !== layer.id || binding.end < start) continue;
      const first = origins.get(keyAt(next, binding.start).frame)!;
      const last = origins.get(keyAt(next, binding.end).frame)!;
      prepareRootOpacityBindings({ layers:[layer], duration:project.duration }, [{
        ...binding, start:Math.min(binding.start, first), end:Math.max(binding.end, last),
      }]);
    }
    return next;
  });
  if (guarded) validateProject({ ...project, duration, layers });
  for (const [i, next] of layers.entries()) {
    const layer = project.layers[i];
    if (layer === next) continue;
    layer.keys = next.keys;
    if (next.motionSpans) layer.motionSpans = next.motionSpans;
  }
  project.duration = duration;
}

export type LayerFrameClip = { projectId: string; tracks: { layerId: string; clip: FrameClip }[] };
export function copyLayerFrames(
  project: Project,
  ids: string[],
  start: number,
  end: number,
  includeMotion = true,
): LayerFrameClip {
  const selected = [...new Set(ids)];
  if (
    !selected.length ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end >= project.duration
  )
    throw new Error('Invalid layer frame range.');
  const captured =
    includeMotion &&
    project.layers.some(
      (layer) =>
        selected.includes(layer.id) &&
        layer.motionSpans?.some((s) => s.start >= start && s.end <= end),
    )
      ? validateProject(project)
      : undefined;
  return {
    projectId: project.id,
    tracks: selected.map((id) => {
      const layer = project.layers.find((l) => l.id === id);
      if (!layer || layer.locked) throw new Error('Select existing, unlocked timeline layers.');
      const clip = copyFrames(layer, start, end);
      if (captured) {
        const detached = captured.layers.find((l) => l.id === id)!;
        const spans = (layer.motionSpans ?? []).filter((s) => s.start >= start && s.end <= end);
        if (spans.length)
          clip.motionSpans = spans.map((span) => {
            const relative = shiftOwnedSpan(layer, span, -start);
            checkMotionReconstruction(
              captured,
              { ...detached, visible: true },
              clone(span),
              detached.keys.filter((k) => k.frame > span.start && k.frame < span.end),
              'Refresh remembered motion before copying its generated artwork.',
            );
            return clone(relative);
          });
      }
      return { layerId: id, clip };
    }),
  };
}
/** The temporary range belongs to this edit; the user's clipboard is independent. */
function duplicateLayerFrameRanges(project: Project, ids: string[], start: number, end: number) {
  if (project.duration + (end - start + 1) > 100000)
    throw new Error('Timeline duration limit exceeded.');
  const range = copyLayerFrames(project, ids, start, end);
  pasteLayerFrames(project, end + 1, range);
}

/** Capture complete recipes and clear their source artwork as one transaction. */
export function cutLayerFrames(
  project: Project,
  ids: string[],
  start: number,
  end: number,
): LayerFrameClip {
  const clipboard = copyLayerFrames(project, ids, start, end);
  clearLayerFrameRanges(project, ids, start, end, clipboard);
  return clipboard;
}

function clearLayerFrameRanges(
  project: Project, ids: string[], start: number, end: number, clipboard?: LayerFrameClip,
) {
  const selected = new Set(ids);
  const guarded = project.opacityBindings !== undefined || project.layers.some(layer =>
    selected.has(layer.id) && layer.motionSpans?.some(span => span.start <= end && span.end >= start));
  // Cut has already validated the project and reconstructed every copied recipe.
  const validatedByCopy = clipboard?.tracks.some(track => track.clip.motionSpans?.length);
  const captured = guarded && !validatedByCopy ? validateProject(project) : project;
  const definitions = new Map(project.symbols?.map(symbol => [symbol.id, symbol]));
  const layers = project.layers.map((layer, index) => {
    if (!selected.has(layer.id)) return layer;
    const spans = layer.motionSpans ?? [];
    const removed = spans.filter(span => span.start >= start && span.end <= end);
    if (!clipboard) {
      for (const span of removed) {
        const owned = requireOwnedMotionInterior(layer, span);
        checkMotionReconstruction(captured, { ...captured.layers[index], visible:true },
          clone(span), owned, 'Refresh remembered motion before clearing its generated artwork.');
      }
    }
    const remaining = spans.filter(span => span.start < start || span.end > end);
    let firstBlank = start, lastBlank = end;
    for (const span of remaining) {
      if (span.end < start || span.start > end) continue;
      if (span.end === start && removed.some(member => member.start === start)) firstBlank = start + 1;
      else if (span.start === end && removed.some(member => member.end === end)) lastBlank = end - 1;
      else throw new Error(`${clipboard ? 'Cut' : 'Clear'} the complete remembered motion span or detach it first.`);
    }

    const next = { ...layer };
    const after = lastBlank + 1;
    const restore = after < project.duration && !layer.keys.some(key => key.frame === after)
      ? restoredExposure(keyAt(layer, after), after, definitions) : undefined;
    clearFrames(next, firstBlank, lastBlank, project.duration, restore);
    if (removed.length) {
      if (remaining.length) next.motionSpans = remaining;
      else delete next.motionSpans;
    }
    return next;
  });
  if (guarded) validateProject({ ...project, layers });
  for (let i = 0; i < layers.length; i++) {
    if (layers[i] === project.layers[i]) continue;
    project.layers[i].keys = layers[i].keys;
    if (layers[i].motionSpans !== undefined) project.layers[i].motionSpans = layers[i].motionSpans;
    else delete project.layers[i].motionSpans;
  }
}

/** Clipboard tracks return to their original layers, even after layer reordering. */
export function pasteLayerFrames(project: Project, at: number, clipboard: LayerFrameClip) {
  if (
    clipboard.projectId !== project.id ||
    !clipboard.tracks.length ||
    new Set(clipboard.tracks.map((t) => t.layerId)).size !== clipboard.tracks.length ||
    clipboard.tracks.some((t) => t.clip.duration !== clipboard.tracks[0].clip.duration)
  )
    throw new Error('Invalid multi-layer clipboard for this project.');
  if (
    project.opacityBindings !== undefined ||
    clipboard.tracks.some(
      (t) =>
        t.clip.motionSpans !== undefined ||
        project.layers.find((l) => l.id === t.layerId)?.motionSpans?.length,
    )
  )
    validateProject(project);
  const layers = [...project.layers];
  for (const track of clipboard.tracks) {
    const index = project.layers.findIndex((l) => l.id === track.layerId);
    const layer = project.layers[index];
    if (!layer || layer.locked) throw new Error('Timeline layer is locked or missing.');
    const keys = pastedKeys(layer, project.duration, at, track.clip);
    layers[index] = { ...layer, keys };
    if (layer.motionSpans?.length || track.clip.motionSpans !== undefined) {
      const shifted = (layer.motionSpans ?? []).map((span) => {
        if (span.end < at) return span;
        // At a junction the clip's first key may preserve the left authored endpoint
        // while insertion moves the right span, including its own endpoint, forward.
        if (span.end === at) {
          const endpoint = layer.keys.find((key) => key.frame === at);
          if (
            endpoint &&
            motionInteriorBaseline([endpoint]) ===
              motionInteriorBaseline([{ ...track.clip.keys[0], frame: at }])
          )
            return span;
        }
        if (span.start < at) {
          // Inserting immediately after a junction can shift the right recipe
          // when the clip supplies an exact authored replacement at its new start.
          const last = track.clip.keys.at(-1)!;
          const junction = layer.keys.find((key) => key.frame === span.start);
          if (
            at !== span.start + 1 ||
            last.frame !== track.clip.duration - 1 ||
            !junction ||
            motionInteriorBaseline([junction]) !==
              motionInteriorBaseline([{ ...last, frame: span.start }])
          )
            throw new Error('Cannot insert frames inside a remembered motion span.');
        }
        if (span.end >= project.duration)
          throw new Error('A displaced motion span exceeds the timeline.');
        return shiftOwnedSpan(layer, span, track.clip.duration);
      });
      const incoming = track.clip.motionSpans;
      if (incoming !== undefined && !Array.isArray(incoming))
        throw new Error('Invalid clipboard motion recipes.');
      const copiedIds = new Set<string>();
      let previousEnd = -1;
      for (const span of incoming ?? []) {
        if (!span || typeof span.id !== 'string' || !span.id || copiedIds.has(span.id))
          throw new Error('Invalid clipboard motion recipe identity.');
        copiedIds.add(span.id);
        if (
          !Number.isSafeInteger(span.start) ||
          !Number.isSafeInteger(span.end) ||
          span.start < 0 ||
          span.start < previousEnd ||
          span.end - span.start < 2 ||
          span.end >= track.clip.duration
        )
          throw new Error('Invalid clipboard motion span range.');
        previousEnd = span.end;
        shifted.push(shiftOwnedSpan(track.clip, span, at, true));
      }
      layers[index].motionSpans = shifted.sort((a, b) => a.start - b.start);
    }
    validateShiftedOpacityStart(project, layers[index], at, track.clip.duration);
  }
  // Validate clipboard artwork before any JSON clone can normalize malformed values.
  const next = validateProject({
    ...project,
    layers,
    duration: project.duration + clipboard.tracks[0].clip.duration,
  });
  for (const track of clipboard.tracks) {
    if (!track.clip.motionSpans?.length) continue;
    const layer = next.layers.find((l) => l.id === track.layerId)!;
    for (const span of layer.motionSpans ?? []) {
      if (span.start < at || span.end >= at + track.clip.duration) continue;
      checkMotionReconstruction(
        next,
        { ...layer, visible: true },
        span,
        requireOwnedMotionInterior(layer, span),
        'Pasted motion cannot reconstruct its captured artwork on this track.',
      );
    }
  }
  for (let i = 0; i < layers.length; i++) {
    if (layers[i] === project.layers[i]) continue;
    project.layers[i].keys = next.layers[i].keys;
    if (next.layers[i].motionSpans !== undefined)
      project.layers[i].motionSpans = next.layers[i].motionSpans;
  }
  project.duration = next.duration;
}
/** Place and reconstruct on a private candidate before its caller publishes any layer. */
export function placeMotionFrameClip(
  project: Project, target: Layer, previousDuration: number, at: number,
  clip: FrameClip, freshRecipeIds: boolean, destinationLabel = 'Destination',
) {
  if (target.motionSpans?.some(span => span.start < at + clip.duration && span.end >= at))
    throw new Error(`${destinationLabel} contains remembered motion.`);
  target.keys = placeFrameClip(target, previousDuration, at, clip, `${destinationLabel} contains artwork.`);
  if (!clip.motionSpans?.length) return;
  const transferred = clip.motionSpans.map(span => shiftOwnedSpan(clip, span, at, freshRecipeIds));
  for (const span of transferred) {
    if (target.motionSpans?.some(existing => existing.id === span.id))
      throw new Error('Destination already owns this remembered recipe ID.');
    checkMotionReconstruction(project, { ...target, visible:true }, span, requireOwnedMotionInterior(target, span),
      'Transferred motion could not reconstruct the destination artwork.');
  }
  target.motionSpans = [...(target.motionSpans ?? []), ...transferred].sort((a,b) => a.start-b.start);
}

export function moveFrames(
  project: Project | Pick<Project, 'layers' | 'duration'>,
  layerId: string, start: number, end: number, at: number,
) {
  if ('schemaVersion' in project) moveLayerFrames(project, [layerId], start, end, at);
  else moveExposures(project, layerId, start, end, at);
}

export function moveLayerFrames(
  project: Project,
  ids: string[],
  start: number,
  end: number,
  at: number,
) {
  const count = end - start + 1;
  if (!Number.isSafeInteger(at) || at < 0 || at + count > 100000)
    throw new Error('Invalid move destination.');
  if (at === start) {
    copyLayerFrames(project, ids, start, end, false);
    return;
  }
  const next = validateProject(project);
  const duration = project.duration;
  // Absolute opacity targets are validated on the assembled move. An overlap
  // can replenish a bound frame that is blank on the private cleared source.
  delete next.opacityBindings;
  const clipboard = copyLayerFrames(project, ids, start, end);
  const definitions = new Map(project.symbols?.map(symbol => [symbol.id, symbol]));
  for (const {layerId, clip} of clipboard.tracks) {
    const original = project.layers.find(layer => layer.id === layerId)!;
    const held = keyAt(original, start);
    if (held.frame < start) clip.keys[0].shapes = restoredExposure(held, start, definitions);
  }
  clearLayerFrameRanges(next, ids, start, end, clipboard);
  next.duration = Math.max(duration, at + count);
  for (const {layerId, clip} of clipboard.tracks) {
    const layer = next.layers.find(track => track.id === layerId)!;
    placeMotionFrameClip(next, layer, duration, at, clip, false);
    for (const binding of project.opacityBindings ?? []) {
      const first = Math.max(at, binding.start), last = Math.min(at + count - 1, binding.end);
      if (binding.layerId !== layerId || first > last) continue;
      prepareRootOpacityBindings(project, [{
        ...binding, start:Math.min(binding.start, first + start - at), end:Math.max(binding.end, last + start - at),
      }]);
    }
  }
  validateProject({ ...next, opacityBindings: project.opacityBindings });
  for (const {layerId} of clipboard.tracks) {
    const source = project.layers.find(track => track.id === layerId)!;
    const moved = next.layers.find(track => track.id === layerId)!;
    source.keys = moved.keys;
    if (moved.motionSpans !== undefined) source.motionSpans = moved.motionSpans;
    else delete source.motionSpans;
  }
  project.duration = next.duration;
}

/** Transfer a range to a different compatible layer without overwriting occupied exposures. */
export function transferLayerFrames(
  project: Project,
  sourceId: string,
  targetId: string,
  start: number,
  end: number,
  at: number,
  action: 'copy' | 'copy-with-opacity' | 'move' | 'move-with-opacity',
) {
  if (sourceId === targetId) throw new Error('Choose different source and destination layers.');
  transferFrameTracks(project, [{sourceId,targetId}], start, end, at, action);
}

export type FrameTrackMapping = { sourceId: string; targetId: string };
export type FrameBlockArtwork = { keys: Layer['keys']; spans: BasicMotionSpan[]; incomingLive: LiveMotionSpan[]; routedShapeIds?: ReadonlyMap<string,string> };

export function routeFrameBlockArtwork(source: Layer, target: Layer, offset: number, copy: boolean): FrameBlockArtwork {
  const across = source.id !== target.id;
  if (across && target.drawingMode === 'merge' && source.drawingMode !== 'merge' &&
      source.keys.some(key => key.shapes.some(shape => shape.kind === 'symbol' || shape.kind === 'text' || shape.groups?.length)))
    throw Error('This frame contains symbols, text, or groups. Move it to an Object Drawing layer.');
  const remapped = across || copy ? copyLayerArtwork(source) : undefined;
  const routed = remapped?.layer ?? source;
  return {
    routedShapeIds: remapped?.ids,
    keys: routed.keys.map(key => ({ ...key, frame: key.frame + offset })),
    spans: (routed.motionSpans ?? []).map(span => shiftOwnedSpan(routed, span, offset, copy)),
    incomingLive: (routed.liveMotionSpans ?? []).map(span => ({
      ...span, id: copy ? id() : span.id, start: span.start + offset, end: span.end + offset,
      ...(span.groupPaths ? { groupPaths: span.groupPaths.map(binding => {
        const groupId = remapped?.groups.get(binding.groupId);
        if (!groupId) throw Error('The transferred live group is missing from the selected keys.');
        return { ...binding, groupId };
      }) } : {}),
    })),
  };
}

export function setFrameBlockLiveSpans(layer: Layer, spans: LiveMotionSpan[]) {
  if (spans.length) layer.liveMotionSpans = spans;
  else delete layer.liveMotionSpans;
}

export function replaceFrameBlockArtwork(target: Layer, at: number, tail: number, artwork: FrameBlockArtwork, replaceLive = true) {
  if (replaceLive) {
    const retained = (target.liveMotionSpans ?? []).filter(span => {
      if (span.end < at || span.start >= tail) return true;
      if (span.start < at || span.end >= tail) throw Error('The drop would replace part of a live tween.');
      return false;
    });
    if (artwork.incomingLive.length || retained.length !== (target.liveMotionSpans?.length ?? 0))
      setFrameBlockLiveSpans(target, [...retained, ...artwork.incomingLive].sort((a, b) => a.start - b.start));
  }
  for (const span of target.motionSpans ?? []) {
    if (span.end < at || span.start >= tail) continue;
    if (span.start < at || span.end >= tail) throw Error('The drop would replace part of a remembered motion span.');
  }
  target.keys = [...target.keys.filter(key => key.frame < at || key.frame >= tail), ...artwork.keys].sort((a, b) => a.frame - b.frame);
  if (target.motionSpans)
    target.motionSpans = target.motionSpans.filter(span => span.end < at || span.start >= tail);
  if (artwork.spans.length)
    target.motionSpans = [...(target.motionSpans ?? []), ...artwork.spans].sort((a, b) => a.start - b.start);
}

export function checkFrameBlockLiveRecipes(project: Project, layer: Layer) {
  if (!layer.liveMotionSpans?.length) return;
  const view = { ...project, layers: project.layers.map(track =>
    track.id === layer.id ? { ...layer, visible: true, locked: false } : track,
  ) };
  for (const span of layer.liveMotionSpans ?? []) createMotionFrameSampler(view, layer.id, span).dispose();
}
/** Disjoint transfers or same-span permutations read original tracks and commit atomically. */
export function transferFrameTracks(
  project: Project,
  mappings: FrameTrackMapping[],
  start: number,
  end: number,
  at: number,
  action: 'copy' | 'copy-with-opacity' | 'move' | 'move-with-opacity' | 'swap',
) {
  return transferTracks(project,mappings,start,end,at,action,false);
}
/** Rectangular block transfer snapshots every source before clearing any of
 * them, so vertically overlapping destinations are safe and atomic. */
export function transferFrameBlock(
  project: Project,
  mappings: FrameTrackMapping[],
  start: number,
  end: number,
  at: number,
  copy = false,
) {
  if (copy) {
    validateLiveGraphicData({ mappings, start, end, at });
    validateLiveGraphicData(project);
    const tracks = new Set(mappings.flatMap(({ sourceId, targetId }) => [sourceId, targetId]));
    const animated = project.layers.some(layer => tracks.has(layer.id) &&
      (layer.liveMotionSpans?.length || layer.motionSpans?.length));
    if (!animated) return transferTracks(project, mappings, start, end, at, 'copy', true);
  }
  return relocateFrameKeys(project, mappings, start, end, at, copy);
}
/** Key relocation and animated block copying use stored keys without adding
 * exposure boundaries. Destination keys in the drop rectangle
 * are replaced; all sources are captured before any overlapping row is edited. */
export function relocateFrameKeys(
  project: Project,
  mappings: FrameTrackMapping[],
  start: number,
  end: number,
  at: number,
  copy = false,
) {
  validateLiveGraphicData({ mappings, start, end, at });
  validateLiveGraphicData(project);
  const sources = mappings.map((m) => m.sourceId),
    targets = mappings.map((m) => m.targetId),
    count = end - start + 1,
    tail = at + count,
    offset = at - start;
  if (
    !mappings.length ||
    new Set(sources).size !== sources.length ||
    new Set(targets).size !== targets.length
  )
    throw Error('Choose one unique destination for each source track.');
  if (
    ![start, end, at].every(Number.isSafeInteger) ||
    start < 0 ||
    end < start ||
    end >= project.duration ||
    at < 0 ||
    tail > 100000
  )
    throw Error('Invalid keyframe move range.');
  const signature = JSON.stringify(project),
    next = validateProject(project),
    byId = new Map(next.layers.map((layer) => [layer.id, layer]));
  const current = () => {
    validateLiveGraphicData(project);
    if (JSON.stringify(project) !== signature)
      throw Error('Timeline changed before the keyframe move finished.');
  };
  current();
  if (copy && at <= end && tail > start && targets.some(target => sources.includes(target))) {
    if (at === start && mappings.every(m => m.sourceId === m.targetId)) return false;
    throw Error('The copy overlaps its source frames. Choose a separate destination.');
  }
  const plans = mappings.map(({ sourceId, targetId }) => {
    const source = byId.get(sourceId),
      target = byId.get(targetId);
    if (!source || !target || source.locked || target.locked)
      throw Error('Choose existing, unlocked source and destination layers.');
    const across = sourceId !== targetId;
    const complete = across || copy;
    const keys = clone(source.keys.filter((k) => k.frame >= start && k.frame <= end)),
      spans = source.motionSpans?.filter((s) => s.start <= end && s.end >= start) ?? [];
    const live = complete ? source.liveMotionSpans?.filter(span => span.start <= end && span.end >= start) ?? [] : [];
    if (live.some(span => span.start < start || span.end > end))
      throw Error(copy ? 'Select the complete live tween to copy it.' : 'Select the complete live tween to move it to another layer.');
    for (const span of spans) {
      if (span.start < start || span.end > end)
        throw Error(`${copy ? 'Copy' : 'Move'} the complete remembered motion span or detach it first.`);
      checkMotionReconstruction(
        next,
        { ...source, visible: true },
        span,
        requireOwnedMotionInterior(source, span),
        'Refresh remembered motion before moving its keyframes.',
      );
    }
    const captured = { ...source, keys, motionSpans: clone(spans), liveMotionSpans: live };
    return {
      sourceId,
      targetId,
      complete,
      ...routeFrameBlockArtwork(captured, target, offset, copy),
      // A cross-layer move transfers a complete recipe. Same-layer edits
      // can retime individual endpoints without changing their ownership.
      retainedLive: copy ? undefined : across ? source.liveMotionSpans?.filter(span => span.end < start || span.start > end) : source.liveMotionSpans?.flatMap((span) => {
        const moved = (frame: number) => frame >= start && frame <= end ? frame + offset : frame;
        const from = moved(span.start), to = moved(span.end);
        if (to < from) throw Error('Move a tween key before its next endpoint or onto it to replace it.');
        const retimed = {...span,start:from,end:to};
        if (to-from !== span.end-span.start) {
          if (span.gradientColorTracks) retimed.gradientColorTracks=span.gradientColorTracks.map(row=>{
            const keys=row.keys.map(key=>({...key,offset:key.offset+span.start-from}));
            if (keys.some(key=>key.offset<=0 || key.offset>=to-from)) throw Error('Moving this endpoint would cross a gradient color key.');
            return {...row,keys};
          });
          for (const {field,property} of liveColorChannels) {
            const existing=span[field];
            if (!existing?.length) continue;
            const keys=existing.map(key=>({...key,offset:key.offset+span.start-from}));
            if (keys.some(key=>key.offset<=0 || key.offset>=to-from))
              throw Error('Moving this endpoint would cross an interior '+property+' color key.');
            retimed[field]=keys;
          }
          for (const {field,property} of liveNumericChannels) {
            const existing=span[field];
            if (!existing?.length) continue;
            const keys=existing.map(key=>({...key,offset:key.offset+span.start-from}));
            if (keys.some(key=>key.offset<=0 || key.offset>=to-from))
              throw Error('Moving this endpoint would cross an interior '+property+' position key.');
            retimed[field]=keys;
          }
        }
        // Coincident endpoints collapse; a single interval has no interior
        // sample, matching ordinary Insert key's sparse split representation.
        return to - from < 2 ? [] : [retimed];
      }).sort((a, b) => a.start - b.start),
    };
  });
  if (
    plans.every((p) => !p.keys.length) ||
    (at === start && mappings.every((m) => m.sourceId === m.targetId))
  ) {
    current();
    return false;
  }
  for (const plan of plans) {
    if (!plan.keys.length) continue;
    const target = byId.get(plan.targetId)!;
    for (const span of target.motionSpans ?? []) {
      if (!copy && sources.includes(target.id) && span.start >= start && span.end <= end) continue;
      if (span.end < at || span.start >= tail) continue;
      if (span.start < at || span.end >= tail)
        throw Error('The drop would replace part of a remembered motion span.');
      checkMotionReconstruction(
        next,
        { ...target, visible: true },
        span,
        requireOwnedMotionInterior(target, span),
        'Refresh destination motion before replacing its keyframes.',
      );
    }
  }
  for (const plan of plans) {
    if (copy || !plan.keys.length) continue;
    const source = byId.get(plan.sourceId)!;
    source.keys = source.keys.filter((k) => k.frame < start || k.frame > end);
    if (source.motionSpans)
      source.motionSpans = source.motionSpans.filter((s) => s.end < start || s.start > end);
    if (plan.retainedLive !== undefined) setFrameBlockLiveSpans(source, plan.retainedLive);
  }
  for (const plan of plans) {
    if (!plan.keys.length) continue;
    replaceFrameBlockArtwork(byId.get(plan.targetId)!, at, tail, plan, plan.complete);
  }
  const changed = new Set(
    plans.filter((p) => p.keys.length).flatMap((p) => copy ? [p.targetId] : [p.sourceId, p.targetId]),
  );
  for (const layer of next.layers) {
    if (!changed.has(layer.id)) continue;
    if (!layer.keys.some((k) => k.frame === 0)) layer.keys.unshift({ frame: 0, shapes: [] });
    if (
      layer.motionSpans &&
      !layer.motionSpans.length &&
      project.layers.find((l) => l.id === layer.id)?.motionSpans?.length
    )
      delete layer.motionSpans;
  }
  next.duration = Math.max(project.duration, tail);
  if (!copy) {
    const incoming = plans.filter(plan => plan.keys.length);
    const movedFrom = new Map(incoming.map(plan => [plan.sourceId, plan]));
    const overwritten = new Set(incoming.map(plan => plan.targetId));
    for (const layer of next.layers) {
      for (const span of layer.liveMotionSpans ?? []) {
        const guide = span.guide;
        if (!guide) continue;
        const plan = movedFrom.get(guide.layerId);
        if (plan && guide.frame >= start && guide.frame <= end) {
          span.guide = { ...guide, layerId: plan.targetId, frame: guide.frame + offset,
            shapeId: plan.routedShapeIds?.get(guide.shapeId) ?? guide.shapeId };
          changed.add(layer.id);
        } else if (overwritten.has(guide.layerId) && guide.frame >= at && guide.frame < tail) {
          throw Error('The drop would replace a linked guide key. Move its guide or unlink the follower first.');
        }
      }
    }
  }
  for (const layer of next.layers) {
    if (!changed.has(layer.id)) continue;
    if (layer.liveMotionSpans?.some(span => layer.keys.some(key => span.start < key.frame && key.frame < span.end)))
      throw Error('The moved tween would cross another keyframe. Include that keyframe in the selected block or drop onto it to replace it.');
  }
  validateLiveGraphicData(next);
  validateProject(next);
  for (const plan of plans)
    for (const span of plan.spans) {
      const target = byId.get(plan.targetId)!;
      checkMotionReconstruction(
        next,
        { ...target, visible: true },
        span,
        requireOwnedMotionInterior(target, span),
        'Moved motion cannot reconstruct its original keyframes.',
      );
    }
  // Qualify every affected sparse recipe against the final replaced keys,
  // library and all-track candidate before publishing any original layer.
  const candidateStamp = JSON.stringify(next);
  for (const layer of next.layers) {
    if (changed.has(layer.id)) checkFrameBlockLiveRecipes(next, layer);
  }
  validateLiveGraphicData(next);
  if (JSON.stringify(next) !== candidateStamp)
    throw Error('Prepared timeline movement changed during sparse recipe admission.');
  current();
  for (const layer of project.layers) {
    if (!changed.has(layer.id)) continue;
    const replacement = byId.get(layer.id)!;
    layer.keys = replacement.keys;
    if (replacement.motionSpans) layer.motionSpans = replacement.motionSpans;
    else delete layer.motionSpans;
    if (replacement.liveMotionSpans) layer.liveMotionSpans = replacement.liveMotionSpans;
    else delete layer.liveMotionSpans;
  }
  project.duration = next.duration;
  return true;
}
function transferTracks(project:Project,mappings:FrameTrackMapping[],start:number,end:number,at:number,action:'copy'|'copy-with-opacity'|'move'|'move-with-opacity'|'swap',overlap:boolean){
  const sources = mappings.map((m) => m.sourceId),
    targets = mappings.map((m) => m.targetId);
  if (
    !mappings.length ||
    new Set(sources).size !== sources.length ||
    new Set(targets).size !== targets.length
  )
    throw new Error('Choose one unique destination for each source track.');
  if (action === 'swap') {
    if (
      at !== start ||
      targets.some((id) => !sources.includes(id)) ||
      mappings.some((m) => m.sourceId === m.targetId)
    )
      throw new Error('Swap requires a permutation of selected tracks at the source frame.');
  } else if (!overlap && targets.some(id => sources.includes(id))) {
    throw new Error('Destination tracks must be separate from the selected source tracks.');
  }

  const duration = project.duration, tail = at + end - start + 1;
  if (!Number.isSafeInteger(at) || at < 0 || tail > 100000)
    throw new Error('Invalid transfer destination.');
  const next = validateProject(project);
  const byId = new Map(next.layers.map(layer => [layer.id, layer]));
  for (const {sourceId,targetId} of mappings) {
    const source = byId.get(sourceId), target = byId.get(targetId);
    if (!source || !target || source.locked || target.locked)
      throw new Error('Choose existing, unlocked source and destination layers.');
    if ((source.drawingMode ?? 'object') !== (target.drawingMode ?? 'object'))
      throw new Error('Source and destination must use the same drawing mode.');
  }
  const clipboard = copyLayerFrames(project, sources, start, end);
  const definitions = new Map(project.symbols?.map(symbol => [symbol.id, symbol]));
  const copying = action === 'copy' || action === 'copy-with-opacity';
  type Channels = NonNullable<Project['opacityBindings']>;
  const channelsBySource = new Map<string, Channels>();
  if (action === 'copy-with-opacity' || action === 'move-with-opacity') {
    for (const sourceId of sources) channelsBySource.set(sourceId, []);
    const retained: Channels = [];
    for (const binding of next.opacityBindings ?? []) {
      const channels = channelsBySource.get(binding.layerId);
      if (!channels || binding.end < start || binding.start > end) {
        retained.push(binding);
        continue;
      }
      if (binding.start < start || binding.end > end)
        throw new Error('Select the complete opacity channel interval to transfer its animation.');
      channels.push(binding);
    }
    // Only channels travelling with the artwork may be removed before the source clear.
    if (!copying && next.opacityBindings) next.opacityBindings = retained;
  }
  const transferredBindings: Channels = [];
  if (!copying) clearLayerFrameRanges(next, sources, start, end, clipboard);
  if(!overlap)next.duration = Math.max(duration, tail);
  const blockClips:LayerFrameClip={projectId:project.id,tracks:[]};
  for (const [i, {layerId, clip}] of clipboard.tracks.entries()) {
    const original = project.layers.find(layer => layer.id === layerId)!;
    const held = keyAt(original, start);
    if (held.frame < start) clip.keys[0].shapes = restoredExposure(held, start, definitions);
    const target = byId.get(targets[i])!;
    // The private project keeps its layer objects when clear publishes prepared keys.
    const { layer, ids } = overlap&&!copying&&original.id===target.id
      ? {layer:{...original,keys:clone(clip.keys),motionSpans:clip.motionSpans===undefined?undefined:clone(clip.motionSpans)},ids:new Map(clip.keys.flatMap(key=>key.shapes.map(shape=>[shape.id,shape.id] as const)))}
      : copyLayerArtwork({ ...original, keys:clip.keys, motionSpans:clip.motionSpans });
    const routed = { duration:clip.duration, keys:layer.keys, motionSpans:layer.motionSpans };
    if(overlap)blockClips.tracks.push({layerId:target.id,clip:routed});
    else placeMotionFrameClip(next, target, duration, at, routed, copying);
    for (const binding of channelsBySource.get(layerId) ?? []) {
      const shapeId = ids.get(binding.shapeId);
      if (!shapeId) throw new Error('The transferred opacity target is missing.');
      const offset = at - start;
      transferredBindings.push({
        layerId: target.id, shapeId,
        start: binding.start + offset, end: binding.end + offset,
        keys: binding.keys.map(key => ({ ...clone(key), frame: key.frame + offset })),
      });
    }
  }
  if(overlap)pasteLayerFrames(next,at,blockClips);
  if (transferredBindings.length) next.opacityBindings = [...(next.opacityBindings ?? []), ...transferredBindings];
  validateProject(next);
  const changed = new Set(copying ? targets : [...sources,...targets]);
  for (const layer of project.layers) {
    if (!changed.has(layer.id)) continue;
    const replacement = byId.get(layer.id)!;
    layer.keys = replacement.keys;
    if (replacement.motionSpans !== undefined) layer.motionSpans = replacement.motionSpans;
    else delete layer.motionSpans;
  }
  if (transferredBindings.length) project.opacityBindings = next.opacityBindings;
  project.duration = next.duration;
}

/** Materialize holds without changing artwork identities or following key times. */
export function keyEveryFrame(layer: Layer, start: number, end: number): Layer['keys'] {
  const keys = clone(layer.keys),
    added: Layer['keys'] = [];
  let index = 0;
  for (let frame = start; frame <= end; frame++) {
    while (index + 1 < layer.keys.length && layer.keys[index + 1].frame <= frame) index++;
    const held = layer.keys[index];
    if (held.frame !== frame) added.push({ frame, shapes: clone(held.shapes) });
  }
  return [...keys, ...added].sort((a, b) => a.frame - b.frame);
}
