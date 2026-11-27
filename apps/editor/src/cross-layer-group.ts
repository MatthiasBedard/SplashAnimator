import {
  id,
  keyAt,
  newLayer,
  symbolArtworks,
  validateProject,
  type Project,
  type Vector,
} from '../../../packages/document/src';
import { inScope, ungroupVectors, expandSelection } from '../../../packages/document/src/groups';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import { selectionTrajectoryStamp as stamp } from '../../../packages/animation/src/selection-trajectory';
import { multiFrameId } from '../../../packages/animation/src/multi-frame';
import { graphicFrameAtAge } from '../../../packages/animation/src/motion-symbols';
import { compileMovieClockPlan, type MovieClockPlan } from '../../../packages/animation/src/movie-clock-plan';
import { compileGraphicButtonLifetimes, compileGraphicButtonPlan } from '../../../packages/animation/src/graphic-button-plan';
import { copyCurrentLayers } from './cross-layer-clipboard';
import { crossLayerMaskTracks } from './cross-layer-selection';

export type CrossLayerGroupCommand =
  { kind: 'group'; layer: string | null; groups: string[] } | { kind: 'ungroup' };

function intersectsPaths(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  const reaches = (path: string, paths: ReadonlySet<string>) => {
    if (paths.has(path)) return true;
    for (let slash = path.indexOf('/'); slash >= 0; slash = path.indexOf('/', slash + 1))
      if (paths.has(path.slice(0, slash))) return true;
    return false;
  };
  return [...a].some(path => reaches(path, b)) || [...b].some(path => reaches(path, a));
}

function movieGroupClockParts(plan: MovieClockPlan, layerId: string, roots: ReadonlySet<string>) {
  const layer = plan.layers.find(layer => layer.id === layerId)!;
  const keys: typeof layer.keys = [], moved: typeof layer.keys = [];
  const append = (list: typeof keys, frame: number, shapes: (typeof keys)[number]['shapes']) => {
    if (stamp(list.at(-1)?.shapes) !== stamp(shapes)) list.push({ frame, shapes });
  };
  const movedPaths = new Set<string>(), otherPaths = new Set<string>();
  for (const track of plan.layers) for (const key of track.keys) {
    const remaining: (typeof keys)[number]['shapes'] = [], transferred: typeof remaining = [];
    for (const shape of key.shapes) {
      // Compiled descendant IDs store the original root as the first ancestry
      // element. Render paths alone can share a prefix with another raw ID.
      const root = track.id === layerId && (shape.id === shape.instancePath
        ? shape.id
        : (JSON.parse(shape.id) as string[])[0]);
      const transfer = root !== false && roots.has(root);
      (transfer ? transferred : remaining).push(shape);
      const paths = transfer ? movedPaths : otherPaths;
      paths.add(track.id + '/' + shape.instancePath);
      paths.add(track.id + '/' + shape.id);
    }
    if (track === layer) {
      append(keys, key.frame, remaining);
      append(moved, key.frame, transferred);
    }
  }
  // A root path owns all its descendant render paths as well as its clock.
  if (intersectsPaths(movedPaths, otherPaths))
    throw Error('Grouping would collide with an existing movie clock namespace.');
  return { keys, moved };
}

function checkButtonGroupTransfer(
  original: Project, candidate: Project, from: string, to: string, buttons: ReadonlySet<string>,
) {
  const lifetimes = (project: Project, owner: string) => {
    const moved = new Set([...buttons].map(id => owner + '/' + id));
    const others = new Set<string>();
    for (const layer of project.layers) for (const key of layer.keys) for (const shape of key.shapes) {
      if (layer.id !== owner || !buttons.has(shape.id)) others.add(layer.id + '/' + shape.id);
    }
    if (intersectsPaths(moved, others))
      throw Error('Grouping would collide with an existing button namespace.');
    return compileGraphicButtonLifetimes(compileGraphicButtonPlan(project)).map(span => {
      if (span.layerId !== owner || !buttons.has(span.path)) return stamp(span);
      // The compiled token includes the owning layer in both the root field
      // and the first exposure path. The remaining identity stays exact.
      const [, path, symbol, exposures] = JSON.parse(span.id) as
        [string, string, string, [string, number, number][]];
      if (exposures.length !== 1)
        throw Error('Grouping would collide with an existing button exposure.');
      const [, start, end] = exposures[0];
      return stamp({ ...span, layerId: from, id: JSON.stringify([from, path, symbol, [['/' + from, start, end]]]) });
    }).sort();
  };
  if (stamp(lifetimes(original, from)) !== stamp(lifetimes(candidate, to)))
    throw Error('Keep the original interaction lifetime of grouped buttons.');
}

function checkMovieGroupTransfer(
  original: MovieClockPlan, candidate: MovieClockPlan, from: string, to: string,
  roots: ReadonlySet<string>,
) {
  const before = movieGroupClockParts(original, from, roots);
  const after = movieGroupClockParts(candidate, to, roots);
  const without = (plan: MovieClockPlan, layerId: string, keys: typeof before.keys) => ({
    ...plan, layers: plan.layers.map(layer => layer.id === layerId ? { ...layer, keys } : layer),
  });
  if (stamp(before.moved) !== stamp(after.moved) ||
      stamp(without(original, from, before.keys)) !== stamp(without(candidate, to, after.keys)))
    throw Error('Keep the original exposure of independently clocked artwork.');
}

/** Move whole original units into an explicit object destination. Geometry is
 * neither tessellated nor merged: only ownership and the chosen stack change. */
export function prepareCurrentLayerGroup(
  project: Project,
  frame: number,
  selection: string[],
  request: CrossLayerGroupCommand,
  admit?: () => void,
) {
  validateLiveGraphicData([project, selection, request]);
  validateProject(project);
  const source = stamp(project),
    input = stamp([frame, selection, request]);
  const current = () => {
    validateLiveGraphicData([project, selection, request]);
    if (stamp(project) !== source || stamp([frame, selection, request]) !== input)
      throw Error('Original group source or inputs changed.');
    admit?.();
    if (stamp(project) !== source || stamp([frame, selection, request]) !== input)
      throw Error('Original group source changed during admission.');
  };
  current();
  const candidate = structuredClone(project),
    command = structuredClone(request),
    ids = [...selection];
  current();
  if (stamp(candidate) !== source || stamp([frame, ids, command]) !== input)
    throw Error('Group snapshot changed while cloning.');
  const clip = copyCurrentLayers(candidate, frame, ids);
  current();
  const plans = clip.tracks.map((track) => {
    const layer = candidate.layers.find((l) => l.id === track.layer)!,
      original = keyAt(layer, frame),
      key = { ...original, shapes: structuredClone(original.shapes) },
      members = new Set(track.shapes.map((s) => s.id));
    layer.keys = layer.keys.map((k) => (k === original ? key : k));
    return {
      layer,
      key,
      members,
      masked: track.maskLayer !== undefined,
      end: layer.keys.find((k) => k.frame > key.frame)?.frame ?? candidate.duration,
    };
  });
  current();
  if (stamp(candidate) !== source) throw Error('Original group key snapshot changed.');
  const maskedPlans = plans.filter(plan => plan.masked);
  if (maskedPlans.some(plan => plan.layer.drawingMode === 'merge'))
    throw Error('Group masked artwork on its original Object Drawing layer.');
  if (command.kind === 'group' && maskedPlans.length &&
      (plans.length !== 1 || command.layer !== plans[0].layer.id ||
        !Array.isArray(command.groups) || command.groups.length))
    throw Error('Group masked artwork at the root of its original layer.');
  const definitions = new Map(candidate.symbols?.map((d) => [d.id, d])),
    clocked = new Map<string, boolean>();
  const independent = (shapes: Vector[]): boolean =>
    shapes.some((shape) => {
      if (shape.kind !== 'symbol') return false;
      const definition = definitions.get(shape.symbolId!);
      if (!definition) return false;
      if (shape.symbolPlayback?.mode === 'movie' || definition.buttonStates) return true;
      let value = clocked.get(definition.id);
      if (value === undefined) {
        value = independent(symbolArtworks(definition).flat());
        clocked.set(definition.id, value);
      }
      return value;
    });
  const buttons = new Map<string, boolean>();
  const containsButton = (id: string): boolean => {
    const known = buttons.get(id);
    if (known !== undefined) return known;
    const definition = definitions.get(id);
    const found = !!definition && (!!definition.buttonStates || symbolArtworks(definition).some(
      shapes => shapes.some(shape => shape.kind === 'symbol' && containsButton(shape.symbolId!)),
    ));
    buttons.set(id, found);
    return found;
  };
  const phase = (shapes: Vector[], age: number) => {
    for (const shape of shapes) {
      if (shape.kind !== 'symbol') continue;
      const definition = definitions.get(shape.symbolId!),
        mode = shape.symbolPlayback?.mode ?? 'loop';
      if (!definition?.timeline || definition.buttonStates || mode === 'movie' || mode === 'single')
        continue;
      const first = shape.symbolPlayback?.firstFrame ?? 0,
        next = graphicFrameAtAge(definition.timeline.duration, mode, first, age);
      if (first !== next) shape.symbolPlayback = { mode, firstFrame: next };
    }
    return shapes;
  };
  const selectedClockedArtwork = plans.some(plan =>
    independent(plan.key.shapes.filter(shape => plan.members.has(shape.id))));
  const movingSources = command.kind === 'group' && selectedClockedArtwork
    ? plans.filter(plan => plan.layer.id !== command.layer) : [];
  const movingSource = movingSources[0];
  const transferring = movingSource?.key.shapes.filter(shape => movingSource.members.has(shape.id)) ?? [];
  const transferredRoots = transferring.filter(shape => independent([shape]));
  if (movingSources.length && (movingSources.length !== 1 || command.kind !== 'group' ||
      !command.layer || !transferredRoots.length ||
      transferredRoots.some(shape => shape.id.includes('/') ||
        (shape.symbolPlayback?.mode !== 'movie' &&
          !definitions.get(shape.symbolId!)?.buttonStates && containsButton(shape.symbolId!)))))
    throw Error('Grouping these independently clocked clips requires their original layer.');
  const artworkOrder = (shapes: Vector[]) => stamp(shapes.map(shape => shape.id));
  const originalClock = selectedClockedArtwork ? compileMovieClockPlan(candidate) : undefined;
  const originalOrder = plans.map(plan =>
    selectedClockedArtwork || plan.masked ? artworkOrder(plan.key.shapes) : undefined);
  let selected: string[] = [];
  let clockTransfer: { from: string; to: string; stack: string } | undefined;
  const transferIds = new Set(transferring.map(shape => shape.id));
  const stageOrder = (at: number, destination?: string) => stamp(candidate.layers
    .filter(layer => layer.visible)
    .flatMap(layer => keyAt(layer, at).shapes.map(shape => [
      layer.id === destination && transferIds.has(shape.id) ? movingSource.layer.id : layer.id,
      shape.id,
    ])));
  if (command.kind === 'ungroup') {
    for (const plan of plans) {
      const chosen = ungroupVectors(plan.key.shapes, [...plan.members], []);
      selected.push(...chosen.map((s) => multiFrameId(plan.layer.id, plan.key.frame, s)));
    }
  } else if (command.kind === 'group') {
    if (
      (command.layer !== null && (typeof command.layer !== 'string' || !command.layer)) ||
      !Array.isArray(command.groups) ||
      command.groups.some((g) => typeof g !== 'string' || !g) ||
      command.groups.length >= 32
    )
      throw Error('Choose an original group destination.');
    const units = plans.reduce(
      (n, p) =>
        n +
        new Set(p.key.shapes.filter((s) => p.members.has(s.id)).map((s) => s.groups?.[0] ?? s.id))
          .size,
      0,
    );
    if (units < 2) throw Error('Select at least two complete artwork units to group.');
    let start = Math.max(...plans.map((p) => p.key.frame)),
      end = Math.min(...plans.map((p) => p.end));
    let destination =
      command.layer === null ? null : candidate.layers.find((l) => l.id === command.layer);
    if (
      command.layer !== null &&
      (!destination ||
        destination.locked ||
        !destination.visible ||
        destination.drawingMode === 'merge')
    )
      throw Error('Choose a visible unlocked object layer.');
    if (destination) {
      if (!maskedPlans.length && crossLayerMaskTracks(candidate).has(destination.id))
        throw Error('Choose a group destination outside mask groups.');
      const key = keyAt(destination, frame),
        until = destination.keys.find((k) => k.frame > key.frame)?.frame ?? candidate.duration;
      if (movingSource) {
        const from = movingSource.layer, to = destination;
        if (plans.some(plan => plan.key.frame !== key.frame || plan.end !== until) ||
            from.drawingMode === 'merge' || from.outline || to.outline ||
            candidate.opacityBindings?.some(binding => binding.layerId === from.id || binding.layerId === to.id))
          throw Error('Group independently clocked artwork only across matching held exposures.');
        const [low, high] = [candidate.layers.indexOf(from), candidate.layers.indexOf(to)].sort((a, b) => a - b);
        if (candidate.layers.slice(low + 1, high).some(layer => layer.visible &&
            layer.keys.some(k => key.frame < k.frame && k.frame < until)))
          throw Error('Keep the original stack throughout the movie exposure.');
        if (to.keys.some(k => k.shapes.some(shape => transferIds.has(shape.id))))
          throw Error('Grouping would collide with an existing artwork identity.');
        clockTransfer = { from: from.id, to: to.id, stack: stageOrder(frame) };
      }
      start = Math.max(start, key.frame);
      end = Math.min(end, until);
      if (
        [...(destination.motionSpans ?? []), ...(destination.liveMotionSpans ?? [])].some(
          (s) => s.start <= key.frame && key.frame <= s.end,
        )
      )
        throw Error('Choose a destination outside owned tween artwork.');
    } else {
      if (command.groups.length) throw Error('A new layer starts at its root.');
      destination = { ...newLayer('Grouped artwork'), drawingMode: 'object' };
      if (start) destination.keys.push({ frame: start, shapes: [] });
      if (end < candidate.duration) destination.keys.push({ frame: end, shapes: [] });
      const last = Math.max(...plans.map((p) => candidate.layers.indexOf(p.layer)));
      candidate.layers.splice(last + 1, 0, destination);
    }
    // Each track keeps its original artwork before/after the common current
    // exposure. Only necessary boundary keys are added; no frame time ripples.
    const isolate = (layer: (typeof plans)[number]['layer']) => {
      const original = keyAt(layer, frame),
        until = layer.keys.find((k) => k.frame > original.frame)?.frame ?? candidate.duration;
      if ((start > original.frame || end < until) && independent(original.shapes))
        throw Error(
          'Grouping would split an independently clocked exposure. Choose another destination or use its active layer.',
        );
      const expected = stamp(original.shapes),
        shapes = structuredClone(original.shapes);
      if (stamp(original.shapes) !== expected || stamp(shapes) !== expected)
        throw Error('Original exposure snapshot changed.');
      let key = original;
      if (start > original.frame) {
        key = { frame: start, shapes: structuredClone(shapes) };
        if (stamp(key.shapes) !== expected) throw Error('Group start exposure changed.');
        phase(key.shapes, start - original.frame);
        layer.keys = [...layer.keys, key].sort((a, b) => a.frame - b.frame);
      }
      if (end < until && !layer.keys.some((k) => k.frame === end))
        layer.keys = [...layer.keys, { frame: end, shapes: structuredClone(shapes) }].sort(
          (a, b) => a.frame - b.frame,
        );
      if (
        stamp(layer.keys.find((k) => k.frame === end)?.shapes ?? shapes) !== expected &&
        end < until
      )
        throw Error('Group end exposure changed.');
      if (end < until) {
        const restored = layer.keys.find((k) => k.frame === end)!;
        phase(restored.shapes, end - original.frame);
      }
      return key;
    };
    for (const plan of plans) plan.key = isolate(plan.layer);
    if (!plans.some((p) => p.layer.id === destination!.id)) isolate(destination);
    const destinationPlan = plans.find((p) => p.layer.id === destination!.id);
    const original = keyAt(destination, frame),
      target = destinationPlan?.key ?? { ...original, shapes: structuredClone(original.shapes) },
      originalTarget = target.shapes;
    if (!destinationPlan)
      destination.keys = destination.keys.map((k) => (k === original ? target : k));
    const last = destinationPlan
      ? originalTarget.length -
        1 -
        [...originalTarget].reverse().findIndex((s) => destinationPlan.members.has(s.id))
      : -1;
    const rootAt = destinationPlan
      ? originalTarget.slice(0, last + 1).filter((s) => !destinationPlan.members.has(s.id)).length
      : target.shapes.length;
    const moving = plans.flatMap((plan) =>
      plan.key.shapes
        .filter((s) => plan.members.has(s.id))
        .map((s) => ({ shape: s, layer: plan.layer.id })),
    );
    for (const plan of plans)
      plan.key.shapes = plan.key.shapes.filter((s) => !plan.members.has(s.id));
    // A destination group must survive removal of selected complete outer units.
    if (command.groups.length && !target.shapes.some((s) => inScope(s, command.groups)))
      throw Error('Choose an unselected original destination group.');
    const namespace = target.shapes.flatMap((s) => [s.id, ...(s.groups ?? [])]),
      usedIds = new Set(namespace),
      usedGroups = new Set(namespace);
    const fresh = (used: Set<string>) => {
      const value = id();
      if (used.has(value)) throw Error('Generated group identity collided. Try again.');
      used.add(value);
      return value;
    };
    const outer = fresh(usedGroups),
      remaps = new Map<string, Map<string, string>>();
    usedIds.add(outer);
    const members: Vector[] = moving.map(({ shape, layer }) => {
      if (usedIds.has(shape.id)) shape.id = fresh(usedIds);
      else usedIds.add(shape.id);
      usedGroups.add(shape.id);
      let names = remaps.get(layer);
      if (!names) {
        names = new Map();
        remaps.set(layer, names);
      }
      const path = (shape.groups ?? []).map((g) => {
        let name = names!.get(g);
        if (!name) {
          name = usedGroups.has(g) ? fresh(usedGroups) : g;
          usedGroups.add(name);
          names!.set(g, name);
          usedIds.add(name);
        }
        return name;
      });
      if (command.groups.length + 1 + path.length > 32) throw Error('Group nesting exceeds 32.');
      shape.groups = [...command.groups, outer, ...path];
      return shape;
    });
    let at = target.shapes.length;
    if (command.groups.length) {
      for (let i = target.shapes.length - 1; i >= 0; i--)
        if (inScope(target.shapes[i], command.groups)) {
          at = i + 1;
          break;
        }
    } else at = rootAt;
    target.shapes = [...target.shapes.slice(0, at), ...members, ...target.shapes.slice(at)];
    selected = expandSelection(
      target.shapes,
      members.map((s) => s.id),
      [],
    ).map((s) => multiFrameId(destination!.id, target.frame, s));
  } else throw Error('Choose Group or Ungroup.');
  validateProject(candidate);
  if (plans.some((plan, i) => plan.masked && artworkOrder(plan.key.shapes) !== originalOrder[i]))
    throw Error('Choose adjacent artwork to group without changing the masked stack.');
  if (originalClock) {
    const after = compileMovieClockPlan(candidate);
    if (clockTransfer) {
      if (stageOrder(frame, clockTransfer.to) !== clockTransfer.stack)
        throw Error('Keep the original stack throughout the movie exposure.');
      checkMovieGroupTransfer(originalClock, after, clockTransfer.from, clockTransfer.to,
        new Set(transferredRoots.map(shape => shape.id)));
      const movedButtons = new Set(transferredRoots.filter(shape =>
        definitions.get(shape.symbolId!)?.buttonStates).map(shape => shape.id));
      if (movedButtons.size)
        checkButtonGroupTransfer(project, candidate, clockTransfer.from, clockTransfer.to, movedButtons);
    } else if (plans.some((plan, i) => artworkOrder(plan.key.shapes) !== originalOrder[i]) ||
        stamp(after) !== stamp(originalClock)) {
      throw Error('Keep the original stack and exposure of independently clocked artwork.');
    }
  }
  current();
  const output = stamp(candidate),
    result = structuredClone(candidate);
  current();
  if (stamp(candidate) !== output || stamp(result) !== output)
    throw Error('Prepared group candidate changed.');
  return { project: result, selected };
}
