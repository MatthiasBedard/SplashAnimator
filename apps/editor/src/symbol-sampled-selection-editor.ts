import type { Point, SymbolDefinition } from '../../../packages/document/src';
import {
  captureSymbolRememberedSelectionAuthoringFrame,
  type SymbolSelectionAuthoringSource,
  type SymbolSampledSelectionOwner,
  type SymbolSampledSelectionRotationOwner,
  type SymbolSampledSelectionScaleOwner,
  type SymbolSampledSelectionSkewOwner,
} from '../../../packages/animation/src/symbol-selection-motion-owner';
import type { SampledUnitRequest } from '../../../packages/animation/src/selection-motion-owner';

/** A keyed isolated editor must supply its actual library/assets and preserve
 * the original enclosing validator, rather than swapping it during a remount. */
export interface SymbolSampledSelectionState extends SymbolSelectionAuthoringSource {
  policy: number;
  groups: boolean;
  pick: unknown;
  prepared: unknown;
  blocked: boolean;
}
export interface SymbolSampledSelectionEdit {
  kind?: 'symbol-selection-transform';
  snapshot: SymbolDefinition;
  candidate: SymbolDefinition;
  owner: SymbolSampledSelectionOwner;
  rotation?: { degrees: number; pivot: Point };
  scaling?: { x: number; y: number; pivot: Point };
  shearing?: { axis: 'x' | 'y'; degrees: number; pivot: Point };
  validate(): void;
}
export interface SymbolSampledSelectionRotationEdit extends SymbolSampledSelectionEdit {
  owner: SymbolSampledSelectionRotationOwner;
  rotation: { degrees: number; pivot: Point };
}
export interface SymbolSampledSelectionScaleEdit extends SymbolSampledSelectionEdit {
  owner: SymbolSampledSelectionScaleOwner;
  scaling: { x: number; y: number; pivot: Point };
}
export interface SymbolSampledSelectionSkewEdit extends SymbolSampledSelectionEdit {
  owner: SymbolSampledSelectionSkewOwner;
  shearing: { axis: 'x' | 'y'; degrees: number; pivot: Point };
}
export interface SymbolSampledSelectionPose {
  scene: ReturnType<typeof captureSymbolRememberedSelectionAuthoringFrame>['scene'];
  symbols: SymbolDefinition[];
}
export interface SymbolSampledSelectionPreview {
  context: SymbolSampledSelectionContext<SymbolSampledSelectionPose>;
  owner: SymbolSampledSelectionOwner;
  pose: SymbolSampledSelectionPose;
  validate(): void;
  discard(): void;
}
export interface SymbolSampledSelectionContext<Pose> {
  frame: number;
  revision: number;
  validate(): void;
  operation<T>(run: () => T): T;
  source(): SymbolSelectionAuthoringSource;
  validateCandidate(candidate: SymbolDefinition): void;
  sample(candidate: SymbolDefinition): Pose;
}

function synchronous(callback: () => unknown) {
  const result = callback();
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    void Promise.resolve(result).catch(() => {});
    throw Error('Isolated selection admission must be synchronous.');
  }
}
function content(source: SymbolSelectionAuthoringSource) {
  return JSON.stringify([source.definition, source.symbols, source.assets]);
}

export function createSymbolSampledSelectionContext<Pose>(
  read: () => SymbolSampledSelectionState,
  validateEnclosing: () => void,
  validateCandidate: (candidate: SymbolDefinition) => void,
  sample: (candidate: SymbolDefinition, frame: number) => Pose,
): SymbolSampledSelectionContext<Pose> | null {
  const state = () => ({ ...read() });
  const initial = state();
  if (initial.blocked) return null;
  const stamp = content(initial);
  let validating = false,
    working = false,
    invalidated = false;
  function operation<T>(run: () => T): T {
    if (working || validating) invalidated = true;
    if (invalidated)
      throw Error('Isolated selection preparation cannot reenter or reuse an invalidated context.');
    working = true;
    try {
      return run();
    } finally {
      working = false;
    }
  }
  const assert = (live: SymbolSampledSelectionState) => {
    if (
      live.blocked ||
      live.definition !== initial.definition ||
      live.symbols !== initial.symbols ||
      live.assets !== initial.assets ||
      live.frame !== initial.frame ||
      live.revision !== initial.revision ||
      live.policy !== initial.policy ||
      live.groups !== initial.groups ||
      live.pick !== initial.pick ||
      live.prepared !== initial.prepared
    )
      throw Error('The original isolated selection context changed. Select it again.');
  };
  const validate = () => {
    if (validating) invalidated = true;
    if (invalidated)
      throw Error('Isolated selection admission cannot reenter or reuse an invalidated context.');
    validating = true;
    try {
      assert(state());
      synchronous(validateEnclosing);
      const live = state();
      assert(live);
      if (content(live) !== stamp) throw Error('The original isolated selection source changed.');
      assert(state());
      if (invalidated) throw Error('Isolated selection admission reentered.');
    } finally {
      validating = false;
    }
  };
  validate();
  return {
    frame: initial.frame,
    revision: initial.revision,
    validate,
    operation,
    source: () => {
      validate();
      return {
        definition: initial.definition,
        symbols: initial.symbols,
        assets: initial.assets,
        revision: initial.revision,
        frame: initial.frame,
      };
    },
    validateCandidate: (candidate) => {
      synchronous(() => validateCandidate(candidate));
    },
    sample: (candidate) =>
      operation(() => {
        validate();
        const pose = sample(candidate, initial.frame);
        validate();
        return pose;
      }),
  };
}

export function captureSymbolSampledSelectionContext<Pose>(
  context: SymbolSampledSelectionContext<Pose>,
  input: () => void = () => {},
) {
  const active = () => {
    context.validate();
    synchronous(input);
    context.validate();
    synchronous(input);
  };
  active();
  const capture = captureSymbolRememberedSelectionAuthoringFrame(() => {
    active();
    return context.source();
  });
  return { capture, active };
}

/** No local draft/history writes. Publication must use the freshly prepared
 * candidate and repeat final admission immediately before the parent edit. */
export function prepareSymbolSampledSelectionTranslation<Pose>(
  context: SymbolSampledSelectionContext<Pose>,
  requests: readonly SampledUnitRequest[],
  offset: Point,
  input: () => void,
): SymbolSampledSelectionEdit {
  return context.operation(() => prepare(context, requests, offset, input));
}

function prepare<Pose>(
  context: SymbolSampledSelectionContext<Pose>,
  requests: readonly SampledUnitRequest[],
  offset: Point,
  input: () => void,
): SymbolSampledSelectionEdit {
  const { capture, active } = captureSymbolSampledSelectionContext(context, input);
  try {
    if (!Array.isArray(requests)) throw Error('Choose actual original isolated unit requests.');
    const count = requests.length;
    if (!count || count > capture.choices.length)
      throw Error('Choose original isolated sampled units.');
    const selected: SampledUnitRequest[] = [];
    for (let i = 0; i < count; i++) {
      const request = requests[i];
      selected.push({ layerId: request?.layerId, shapeId: request?.shapeId });
    }
    const x = offset?.x,
      y = offset?.y;
    if (requests.length !== count) throw Error('The isolated selection changed while being read.');
    active();
    const owner = capture.resolveSelection(selected, { validate: active });
    const ownerStamp = JSON.stringify(owner);
    const snapshot = structuredClone(context.source().definition);
    active();
    const candidate = capture.prepareTranslation(selected, { x, y }, { validate: active });
    const candidateStamp = JSON.stringify(candidate);
    const candidateUnchanged = () => {
      if (JSON.stringify(candidate) !== candidateStamp)
        throw Error('The prepared isolated selection candidate changed. Prepare it again.');
      if (JSON.stringify(owner) !== ownerStamp)
        throw Error('The prepared isolated selection owner changed. Select it again.');
    };
    context.validateCandidate(candidate);
    candidateUnchanged();
    active();
    return {
      snapshot,
      candidate,
      owner,
      validate: () =>
        context.operation(() => {
          active();
          candidateUnchanged();
          context.validateCandidate(candidate);
          candidateUnchanged();
          active();
        }),
    };
  } finally {
    capture.dispose();
  }
}

export function admitSymbolSampledSelectionPublication(edit: SymbolSampledSelectionEdit) {
  const kind = Object.getOwnPropertyDescriptor(edit, 'kind');
  if (kind && (!Object.hasOwn(kind, 'value') || kind.value === 'symbol-selection-trajectories'))
    throw Error('Use the dedicated isolated trajectory publisher.');
  edit.validate();
}

/** Uses the actual resource-aware isolated capture and the original enclosing admission. */
export function prepareSymbolSampledSelectionRotation<Pose>(
  context: SymbolSampledSelectionContext<Pose>,
  requests: readonly SampledUnitRequest[],
  degrees: number,
  input: () => void,
): SymbolSampledSelectionRotationEdit {
  return context.operation(() => {
    const { capture, active } = captureSymbolSampledSelectionContext(context, input);
    try {
      if (!Array.isArray(requests)) throw Error('Choose actual original isolated unit requests.');
      const count = requests.length;
      if (!count || count > capture.choices.length)
        throw Error('Choose original isolated sampled units.');
      const selected: SampledUnitRequest[] = [];
      for (let i = 0; i < count; i++) {
        const request = requests[i];
        selected.push({ layerId: request?.layerId, shapeId: request?.shapeId });
      }
      if (requests.length !== count)
        throw Error('The isolated selection changed while being read.');
      active();
      const owner = capture.resolveRotation(selected, { validate: active });
      const snapshot = structuredClone(context.source().definition);
      active();
      const candidate = capture.prepareRotation(selected, degrees, { validate: active });
      const rotation = { degrees, pivot: { ...owner.pivot } };
      const stamp = JSON.stringify([candidate, owner, rotation]);
      const unchanged = () => {
        if (JSON.stringify([candidate, owner, rotation]) !== stamp)
          throw Error(
            'The prepared isolated rotation candidate or owner changed. Prepare it again.',
          );
      };
      context.validateCandidate(candidate);
      unchanged();
      active();
      return {
        snapshot,
        candidate,
        owner,
        rotation,
        validate: () =>
          context.operation(() => {
            active();
            unchanged();
            context.validateCandidate(candidate);
            unchanged();
            active();
          }),
      };
    } finally {
      capture.dispose();
    }
  });
}

/** Uses the actual resource-aware isolated capture and the original enclosing admission. */
export function prepareSymbolSampledSelectionScale<Pose>(
  context: SymbolSampledSelectionContext<Pose>,
  requests: readonly SampledUnitRequest[],
  scaleX: number,
  scaleY: number,
  input: () => void,
): SymbolSampledSelectionScaleEdit {
  return context.operation(() => {
    const { capture, active } = captureSymbolSampledSelectionContext(context, input);
    try {
      if (!Array.isArray(requests)) throw Error('Choose actual original isolated unit requests.');
      const count = requests.length;
      if (!count || count > capture.choices.length)
        throw Error('Choose original isolated sampled units.');
      const selected: SampledUnitRequest[] = [];
      for (let i = 0; i < count; i++) {
        const request = requests[i];
        selected.push({ layerId: request?.layerId, shapeId: request?.shapeId });
      }
      if (requests.length !== count)
        throw Error('The isolated selection changed while being read.');
      active();
      const owner = capture.resolveScale(selected, { validate: active });
      const snapshot = structuredClone(context.source().definition);
      active();
      const candidate = capture.prepareScale(selected, scaleX, scaleY, { validate: active });
      const scaling = { x: scaleX, y: scaleY, pivot: { ...owner.pivot } };
      const stamp = JSON.stringify([candidate, owner, scaling]);
      const unchanged = () => {
        if (JSON.stringify([candidate, owner, scaling]) !== stamp)
          throw Error('The prepared isolated scale candidate or owner changed. Prepare it again.');
      };
      context.validateCandidate(candidate);
      unchanged();
      active();
      return {
        snapshot,
        candidate,
        owner,
        scaling,
        validate: () =>
          context.operation(() => {
            active();
            unchanged();
            context.validateCandidate(candidate);
            unchanged();
            active();
          }),
      };
    } finally {
      capture.dispose();
    }
  });
}

/** Uses the actual resource-aware isolated capture and the original enclosing admission. */
export function prepareSymbolSampledSelectionSkew<Pose>(
  context: SymbolSampledSelectionContext<Pose>,
  requests: readonly SampledUnitRequest[],
  axis: 'x' | 'y',
  degrees: number,
  input: () => void,
): SymbolSampledSelectionSkewEdit {
  return context.operation(() => {
    const { capture, active: assertActive } = captureSymbolSampledSelectionContext(context, input);
    // JSON fingerprints cannot distinguish an original null from a late NaN.
    // Keep original-value admission through every fresh source callback too.
    const finite = (value: unknown): void => {
      if (typeof value === 'number' && !Number.isFinite(value))
        throw Error('The isolated skew source or candidate contains nonfinite original values.');
      if (value && typeof value === 'object')
        for (const child of Object.values(value)) finite(child);
    };
    const active = () => {
      assertActive();
      finite(context.source());
    };
    try {
      if (!Array.isArray(requests)) throw Error('Choose actual original isolated unit requests.');
      const count = requests.length;
      if (!count || count > capture.choices.length)
        throw Error('Choose original isolated sampled units.');
      const selected: SampledUnitRequest[] = [];
      for (let i = 0; i < count; i++) {
        const request = requests[i];
        selected.push({ layerId: request?.layerId, shapeId: request?.shapeId });
      }
      if (requests.length !== count)
        throw Error('The isolated selection changed while being read.');
      active();
      const owner = capture.resolveSkew(selected, { validate: active });
      const snapshot = structuredClone(context.source().definition);
      active();
      const candidate = capture.prepareSkew(selected, axis, degrees, { validate: active });
      const shearing = { axis, degrees, pivot: { ...owner.pivot } };
      const stamp = JSON.stringify([candidate, owner, shearing]);
      const unchanged = () => {
        finite([candidate, owner, shearing]);
        if (JSON.stringify([candidate, owner, shearing]) !== stamp)
          throw Error('The prepared isolated skew candidate or owner changed. Prepare it again.');
      };
      context.validateCandidate(candidate);
      unchanged();
      active();
      unchanged();
      return {
        snapshot,
        candidate,
        owner,
        shearing,
        validate: () =>
          context.operation(() => {
            active();
            unchanged();
            context.validateCandidate(candidate);
            unchanged();
            active();
            unchanged();
          }),
      };
    } finally {
      capture.dispose();
    }
  });
}
