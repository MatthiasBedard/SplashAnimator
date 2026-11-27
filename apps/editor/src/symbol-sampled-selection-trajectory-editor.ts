import { hit } from '../../../packages/geometry/src';
import { symbolLayers, type Point, type SymbolDefinition } from '../../../packages/document/src';
import type { MotionPath } from '../../../packages/document/src/motion-path';
import { snapshotTrajectoryPath } from '../../../packages/animation/src/trajectory-input';
import {
  admitSelectionTrajectory,
  selectionTrajectoryStamp,
} from '../../../packages/animation/src/selection-trajectory';
import {
  captureSymbolRememberedSelectionAuthoringFrame,
  type SymbolSampledSelectionOwner as SampledSelectionOwner,
} from '../../../packages/animation/src/symbol-selection-motion-owner';
import type { SampledUnitRequest } from '../../../packages/animation/src/selection-motion-owner';
import {
  createSymbolSampledSelectionContext,
  type SymbolSampledSelectionContext,
  type SymbolSampledSelectionPose as SampledSelectionPose,
  type SymbolSampledSelectionState as SampledSelectionState,
} from './symbol-sampled-selection-editor';
import type { SymbolSelectionAuthoringSource } from '../../../packages/animation/src/symbol-selection-motion-owner';
type SampledSelectionContext = SymbolSampledSelectionContext<SampledSelectionPose>;

declare const trajectoryContextBrand: unique symbol;
/** Runtime authority lives in contexts; this type prevents accidental legacy wiring. */
export type SymbolSampledSelectionTrajectoryContext = SampledSelectionContext & {
  readonly [trajectoryContextBrand]: true;
};

export interface SymbolSampledSelectionCubicControls {
  layerId: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}
export interface SymbolSampledSelectionCubicRoute {
  layerId: string;
  shapeId: string;
  spanId: string;
  start: number;
  end: number;
  path: MotionPath;
}
export interface SymbolSampledSelectionTrajectoryEdit {
  kind: 'symbol-selection-trajectories';
  snapshot: SymbolDefinition;
  candidate: SymbolDefinition;
  owner: SampledSelectionOwner;
  trajectories: SymbolSampledSelectionCubicRoute[];
  validate(): void;
}
const contexts = new WeakMap<
  SampledSelectionContext,
  {
    validate(strong?: boolean): void;
    snapshot(): SymbolDefinition;
    sample(candidate: SymbolDefinition): SampledSelectionPose;
    source(): SymbolSelectionAuthoringSource;
    validateCandidate(candidate: SymbolDefinition): void;
    enter(): () => void;
  }
>();
const edits = new WeakMap<
  SymbolSampledSelectionTrajectoryEdit,
  { admit(): void; sample(): SampledSelectionPose }
>();
function synchronous<T>(run: () => T): T {
  const value = run();
  if (value && typeof (value as unknown as PromiseLike<unknown>).then === 'function') {
    void Promise.resolve(value).catch(() => {});
    throw Error('Isolated trajectory operations must be synchronous.');
  }
  return value;
}
function fields(value: object, expected: Record<string, unknown>) {
  if (Reflect.ownKeys(value).length !== Reflect.ownKeys(expected).length)
    throw Error('The trajectory operation fields changed.');
  for (const [key, original] of Object.entries(expected)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !Object.hasOwn(field, 'value') || field.value !== original)
      throw Error('The original trajectory context or edit ownership changed.');
  }
}
/** Separate opt-in context. Legacy transform contexts keep their existing cost
 * and contract; whole-route publication also owns raw optional source metadata. */
export function createSymbolSampledSelectionTrajectoryContext(
  read: () => SampledSelectionState,
  validateEnclosing: () => void,
  validateCandidate: (candidate: SymbolDefinition) => void,
  sample: (candidate: SymbolDefinition, frame: number) => SampledSelectionPose,
): SymbolSampledSelectionTrajectoryContext | null {
  const first = { ...read() };
  if (first.blocked) return null;
  const sourceStamp = selectionTrajectoryStamp([first.definition, first.symbols, first.assets]);
  const base = createSymbolSampledSelectionContext(
    read,
    validateEnclosing,
    validateCandidate,
    (candidate, at) => synchronous(() => sample(candidate, at)),
  );
  if (!base) return null;
  const context: SampledSelectionContext = {
    ...base,
    source: () => {
      const done = enter();
      try {
        validate();
        const out = base.source();
        validate();
        return out;
      } finally {
        done();
      }
    },
    sample: (candidate) => {
      const done = enter();
      try {
        validate();
        const out = base.sample(candidate);
        validate();
        return out;
      } finally {
        done();
      }
    },
    validateCandidate: (candidate) => {
      const done = enter();
      try {
        validate();
        base.validateCandidate(candidate);
        validate();
      } finally {
        done();
      }
    },
    operation: (run) => {
      const done = enter();
      try {
        return synchronous(run);
      } finally {
        done();
      }
    },
    validate,
  };
  const identity = { ...context };
  let reading = false,
    snapshotting = false,
    working = false,
    dead = false;
  function enter() {
    if (dead || working) {
      dead = true;
      throw Error('Trajectory context cannot reenter.');
    }
    working = true;
    return () => {
      working = false;
    };
  }
  function validate(strong = true) {
    if (dead || reading) {
      dead = true;
      throw Error('Trajectory source cannot reenter.');
    }
    reading = true;
    try {
      fields(context, identity);
      base!.validate();
      if (!strong) {
        fields(context, identity);
        if (dead) throw Error('Trajectory context is invalidated.');
        return;
      }
      const live = { ...read() };
      base!.validate();
      fields(context, identity);
      if (
        live.definition !== first.definition ||
        live.symbols !== first.symbols ||
        live.assets !== first.assets ||
        selectionTrajectoryStamp([live.definition, live.symbols, live.assets]) !== sourceStamp
      )
        throw Error('The complete original trajectory source changed.');
      if (dead) throw Error('Trajectory context is invalidated.');
    } finally {
      reading = false;
    }
  }
  function takeSnapshot() {
    if (dead || snapshotting || reading) {
      dead = true;
      throw Error('Trajectory snapshot cannot reenter.');
    }
    snapshotting = true;
    try {
      validate();
      const out = structuredClone(base!.source().definition);
      validate();
      if (selectionTrajectoryStamp(out) !== selectionTrajectoryStamp(first.definition))
        throw Error('The original trajectory snapshot changed during cloning.');
      return out;
    } finally {
      snapshotting = false;
    }
  }
  validate();
  contexts.set(context, {
    validate,
    snapshot: takeSnapshot,
    sample: base.sample,
    source: base.source,
    validateCandidate: base.validateCandidate,
    enter,
  });
  return context as SymbolSampledSelectionTrajectoryContext;
}
function requests(input: readonly SampledUnitRequest[], maximum: number): SampledUnitRequest[] {
  if (!Array.isArray(input)) throw Error('Choose actual original trajectory units.');
  const length = input.length;
  if (!Number.isSafeInteger(length) || !length || length > maximum)
    throw Error('Choose complete original trajectory units.');
  const out: SampledUnitRequest[] = [];
  for (let i = 0; i < length; i++) {
    const item = input[i],
      layerId = item?.layerId,
      shapeId = item?.shapeId;
    if (typeof layerId !== 'string' || !layerId || typeof shapeId !== 'string' || !shapeId)
      throw Error('Choose original trajectory identities.');
    out.push({ layerId, shapeId });
  }
  if (input.length !== length) throw Error('Trajectory selection changed while being read.');
  return out;
}
function capture(context: SampledSelectionContext, input: () => void) {
  const binding = contexts.get(context);
  if (!binding) throw Error('Choose a live complete trajectory context.');
  if (typeof input !== 'function') throw Error('Trajectory input admission must be callable.');
  const release = binding.enter();
  const checkInput = () => {
    const result = input() as unknown;
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result).catch(() => {});
      throw Error('Trajectory input admission must be synchronous.');
    }
  };
  const active = () => {
    binding.validate(false);
    checkInput();
    binding.validate(false);
    checkInput();
  };
  try {
    active();
    const snapshot = binding.snapshot();
    active();
    const owned = captureSymbolRememberedSelectionAuthoringFrame(() => {
      active();
      return binding.source();
    });
    return { binding, active, snapshot, owned, release };
  } catch (error) {
    release();
    throw error;
  }
}
function originalRoutes(
  snapshot: SymbolDefinition,
  owner: SampledSelectionOwner,
): SymbolSampledSelectionCubicRoute[] {
  return owner.tracks.map((track) => {
    const layer = symbolLayers(snapshot).find((layer) => layer.id === track.layerId)!;
    admitSelectionTrajectory(layer, track);
    const span = layer.motionSpans!.find((span) => span.id === track.spanId)!;
    const path = snapshotTrajectoryPath(
      span.path ?? { startX: 0, startY: 0, endX: 0, endY: 0 },
      'selection',
    );
    if (
      path.waypoints !== undefined ||
      path.waypointTangents !== undefined ||
      path.waypointIncoming !== undefined ||
      path.curvedWaypoints !== undefined
    )
      throw Error(
        'Use a waypoint editor for this saved trajectory; cubic controls cannot replace waypoint data.',
      );
    return {
      layerId: track.layerId,
      shapeId: track.shapeIds[0],
      spanId: track.spanId,
      start: track.start,
      end: track.end,
      path,
    };
  });
}
/** Detached initialization hints; later commands resolve original paths again. */
export function resolveSymbolSampledSelectionTrajectories(
  context: SymbolSampledSelectionTrajectoryContext,
  selection: readonly SampledUnitRequest[],
  input: () => void,
) {
  const { owned, snapshot, active, release, binding } = capture(context, input);
  try {
    const selected = requests(selection, owned.choices.length);
    active();
    const owner = owned.resolveSelection(selected, { validate: active }),
      routes = originalRoutes(snapshot, owner);
    const stamp = selectionTrajectoryStamp([owner, routes]),
      output = structuredClone({ owner, routes });
    active();
    binding.validate();
    if (selectionTrajectoryStamp([output.owner, output.routes]) !== stamp)
      throw Error('Original trajectory hints changed during cloning.');
    return output;
  } finally {
    owned.dispose();
    release();
  }
}
/** Fresh whole-route preparation. Public hints/previous previews never supply
 * saved paths, leader identities, replacement artwork or publication authority. */
export function prepareSymbolSampledSelectionTrajectories(
  context: SymbolSampledSelectionTrajectoryContext,
  selection: readonly SampledUnitRequest[],
  controls: readonly SymbolSampledSelectionCubicControls[],
  input: () => void,
): SymbolSampledSelectionTrajectoryEdit {
  const { owned, snapshot, active, binding, release } = capture(context, input);
  try {
    const selected = requests(selection, owned.choices.length);
    if (!Array.isArray(controls)) throw Error('Choose actual per-track cubic controls.');
    const length = controls.length;
    if (!Number.isSafeInteger(length) || !length || length > symbolLayers(snapshot).length)
      throw Error('Choose one cubic path per original track.');
    const numeric: SymbolSampledSelectionCubicControls[] = [],
      seen = new Set<string>();
    for (let i = 0; i < length; i++) {
      const raw = controls[i];
      if (
        !raw ||
        typeof raw !== 'object' ||
        Reflect.ownKeys(raw).some(
          (key) => !['layerId', 'startX', 'startY', 'endX', 'endY'].includes(key as string),
        )
      )
        throw Error('Choose only explicit numeric cubic controls.');
      const layerId = raw.layerId,
        startX = raw.startX,
        startY = raw.startY,
        endX = raw.endX,
        endY = raw.endY;
      if (
        typeof layerId !== 'string' ||
        !layerId ||
        seen.has(layerId) ||
        ![startX, startY, endX, endY].every(Number.isFinite)
      )
        throw Error('Enter one finite cubic path per original track.');
      seen.add(layerId);
      numeric.push({ layerId, startX, startY, endX, endY });
    }
    if (controls.length !== length) throw Error('Cubic controls changed while being read.');
    active();
    const owner = owned.resolveSelection(selected, { validate: active }),
      routes = originalRoutes(snapshot, owner);
    if (numeric.length !== routes.length || routes.some((route) => !seen.has(route.layerId)))
      throw Error('Enter cubic controls for every original selected track.');
    const trajectories = routes.map((route) => {
      const { layerId, ...values } = numeric.find((value) => value.layerId === route.layerId)!;
      void layerId;
      const path = { ...route.path, ...values };
      if (selectionTrajectoryStamp(path) === selectionTrajectoryStamp(route.path))
        throw Error('Enter changed cubic controls for every selected track.');
      return { ...route, path };
    });
    const candidate = owned.prepareTrajectories(selected, trajectories, { validate: active });
    const stamp = selectionTrajectoryStamp([snapshot, candidate, owner, trajectories]);
    const edit: SymbolSampledSelectionTrajectoryEdit = {
      kind: 'symbol-selection-trajectories',
      snapshot,
      candidate,
      owner,
      trajectories,
      validate,
    };
    const identity = { ...edit };
    function assertOutput() {
      fields(edit, identity);
      if (selectionTrajectoryStamp([snapshot, candidate, owner, trajectories]) !== stamp)
        throw Error('Prepared trajectory data changed.');
    }
    function check() {
      assertOutput();
      active();
      binding.validate();
      assertOutput();
    }
    function validate() {
      const done = binding.enter();
      try {
        check();
      } finally {
        done();
      }
    }
    function sample() {
      const done = binding.enter();
      try {
        check();
        const pose = binding.sample(candidate);
        check();
        return pose;
      } finally {
        done();
      }
    }
    function admit() {
      const done = binding.enter();
      try {
        check();
        binding.validateCandidate(candidate);
        check();
      } finally {
        done();
      }
    }
    binding.validateCandidate(candidate);
    check();
    edits.set(edit, { admit, sample });
    return edit;
  } finally {
    owned.dispose();
    release();
  }
}
export function sampleSymbolSampledSelectionTrajectories(
  edit: SymbolSampledSelectionTrajectoryEdit,
): SampledSelectionPose {
  const binding = edits.get(edit);
  if (!binding) throw Error('Choose an original prepared trajectory edit.');
  return binding.sample();
}
/** Dedicated admission for a later whole-route publisher. Never mark its sampled
 * frame authored, promote a junction or reuse a transform publication label. */
export function admitSymbolSampledSelectionTrajectoryPublication(
  edit: SymbolSampledSelectionTrajectoryEdit,
): void {
  const binding = edits.get(edit);
  if (!binding) throw Error('Choose an original prepared trajectory edit.');
  binding.admit();
}

/** Fresh private original leader/control geometry. Display hints are detached;
 * pointer admission independently repeats original membership/source resolution. */
export function resolveSymbolSampledSelectionCubicControl(
  context: SymbolSampledSelectionTrajectoryContext,
  selection: readonly SampledUnitRequest[],
  layerId: string,
  role: 'start' | 'end',
  input: () => void,
  pointer?: Point,
) {
  const { owned, snapshot, active, binding, release } = capture(context, input);
  try {
    const selected = requests(selection, owned.choices.length),
      id = layerId,
      part = role;
    const position = pointer ? { x: pointer.x, y: pointer.y } : undefined;
    if (
      typeof id !== 'string' ||
      !id ||
      !['start', 'end'].includes(part) ||
      (position && ![position.x, position.y].every(Number.isFinite))
    )
      throw Error('Choose an original cubic track and control.');
    active();
    const owner = owned.resolveSelection(selected, { validate: active }),
      routes = originalRoutes(snapshot, owner),
      route = routes.find((r) => r.layerId === id);
    if (!route) throw Error('Choose an original selected trajectory track.');
    const layer = symbolLayers(snapshot).find((l) => l.id === id)!,
      shape = layer.keys
        .find((k) => k.frame === (part === 'start' ? route.start : route.end))!
        .shapes.find((s) => s.id === route.shapeId)!;
    const anchor = { x: shape.x, y: shape.y },
      offset = {
        x: route.path[part === 'start' ? 'startX' : 'endX'],
        y: route.path[part === 'start' ? 'startY' : 'endY'],
      },
      point = { x: anchor.x + offset.x, y: anchor.y + offset.y };
    if (![anchor.x, anchor.y, point.x, point.y].every(Number.isFinite))
      throw Error('The original cubic control exceeds finite coordinates.');
    let available = true;
    if (position) {
      let foreground: { layerId: string; shapeId: string } | undefined;
      const scene = owned.scene;
      outer: for (let i = scene.length - 1; i >= 0; i--)
        for (let j = scene[i].key.shapes.length - 1; j >= 0; j--) {
          const s = scene[i].key.shapes[j];
          if (s.opacity !== 0 && hit(s, position, 0)) {
            foreground = { layerId: scene[i].layerId, shapeId: s.id };
            break outer;
          }
        }
      if (
        foreground &&
        (foreground.layerId !== id ||
          !owner.tracks.find((t) => t.layerId === id)!.shapeIds.includes(foreground.shapeId))
      )
        available = false;
    }
    active();
    const data = {
        layerId: id,
        role: part,
        shapeId: route.shapeId,
        anchor,
        offset,
        point,
        available,
        requests: selected,
        trackIds: owner.tracks.map((t) => t.layerId),
      },
      stamp = selectionTrajectoryStamp(data),
      out = structuredClone(data);
    active();
    binding.validate();
    if (selectionTrajectoryStamp(out) !== stamp)
      throw Error('Original cubic geometry changed during cloning.');
    return out;
  } finally {
    owned.dispose();
    release();
  }
}
