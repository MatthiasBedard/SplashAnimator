import {
  validateProject,
  type Project,
  type Point,
  type Vector,
} from '../../../packages/document/src';
import {
  captureRememberedSelectionAuthoringFrame,
  type SampledSelectionOwner,
  type SampledSelectionRotationOwner,
  type SampledSelectionScaleOwner,
  type SampledSelectionSkewOwner,
  type SampledUnitRequest,
} from '../../../packages/animation/src/selection-motion-owner';

export type SampledSelectionPose = {
  scene: ReturnType<typeof captureRememberedSelectionAuthoringFrame>['scene'];
  rendered: Vector[];
};
export interface SampledSelectionContext {
  frame: number;
  revision: number;
  stamp: string;
  snapshot(): Project;
  validate(): void;
  sample(candidate: Project): SampledSelectionPose;
}
export interface SampledSelectionEdit {
  /** Whole-route edits have a separate discriminator and publisher. */
  kind?: 'selection-transform';
  snapshot: Project;
  candidate: Project;
  owner: SampledSelectionOwner;
  rotation?: { degrees: number; pivot: Point };
  scaling?: { x: number; y: number; pivot: Point };
  shearing?: { axis: 'x' | 'y'; degrees: number; pivot: Point };
  validate(): void;
}

export interface SampledSelectionRotationEdit extends SampledSelectionEdit {
  owner: SampledSelectionRotationOwner;
  rotation: { degrees: number; pivot: Point };
}
export interface SampledSelectionScaleEdit extends SampledSelectionEdit {
  owner: SampledSelectionScaleOwner;
  scaling: { x: number; y: number; pivot: Point };
}
export interface SampledSelectionSkewEdit extends SampledSelectionEdit {
  owner: SampledSelectionSkewOwner;
  shearing: { axis: 'x' | 'y'; degrees: number; pivot: Point };
}
export interface SampledSelectionPreview {
  context: SampledSelectionContext;
  owner: SampledSelectionOwner;
  pose: SampledSelectionPose;
  validate(): void;
  discard(): void;
}

export interface SampledSelectionState {
  project: Project;
  signature: string;
  frame: number;
  revision: number;
  policy: number;
  groups: boolean;
  pick: unknown;
  children: boolean;
  prepared: unknown;
  stamp: string;
  blocked: boolean;
}

export function createSampledSelectionContext(
  read: () => SampledSelectionState,
  snapshot: (source: Project) => Project,
  sample: (candidate: Project, frame: number) => SampledSelectionPose,
): SampledSelectionContext | null {
  const snapshotState = () => ({ ...read() });
  const initial = snapshotState();
  if (initial.blocked) return null;
  const assert = (live: SampledSelectionState) => {
    if (
      live.blocked ||
      live.project !== initial.project ||
      live.frame !== initial.frame ||
      live.revision !== initial.revision ||
      live.policy !== initial.policy ||
      live.groups !== initial.groups ||
      live.pick !== initial.pick ||
      live.children !== initial.children ||
      live.prepared !== initial.prepared ||
      live.signature !== initial.signature
    )
      throw Error('The original sampled selection context changed. Select it again.');
  };
  return {
    frame: initial.frame,
    revision: initial.revision,
    stamp: initial.stamp + ':' + initial.policy,
    snapshot: () => snapshot(initial.project),
    sample: (candidate) => sample(candidate, initial.frame),
    validate: () => {
      const live = snapshotState();
      assert(live);
      if (JSON.stringify(live.project) !== initial.signature)
        throw Error('The sampled selection source changed.');
      assert(snapshotState());
    },
  };
}

export function captureSampledSelectionContext(
  context: SampledSelectionContext,
  input: () => void = () => {},
) {
  const active = () => {
    context.validate();
    input();
    context.validate();
    input();
  };
  active();
  const snapshot = context.snapshot();
  active();
  const capture = captureRememberedSelectionAuthoringFrame(() => {
    active();
    return { project: snapshot, revision: context.revision, frame: context.frame };
  });
  return { capture, snapshot, active };
}

/** Every command starts from original ownership; a preview is never publication input. */
export function prepareSampledSelectionTranslation(
  context: SampledSelectionContext,
  requests: readonly SampledUnitRequest[],
  offset: Point,
  input: () => void,
): SampledSelectionEdit {
  const { capture, snapshot, active } = captureSampledSelectionContext(context, input);
  try {
    if (!Array.isArray(requests)) throw Error('Choose actual original sampled unit requests.');
    const length = requests.length;
    if (!length || length > capture.choices.length)
      throw Error('Choose units within the original sampled selection.');
    const selected: SampledUnitRequest[] = [];
    for (let i = 0; i < length; i++) {
      const request = requests[i];
      selected.push({ layerId: request?.layerId, shapeId: request?.shapeId });
    }
    const x = offset?.x,
      y = offset?.y;
    if (requests.length !== length)
      throw Error('The original sampled selection changed while being read.');
    active();
    const owner = capture.resolveSelection(selected, { validate: active });
    const candidate = capture.prepareTranslation(selected, { x, y }, { validate: active });
    validateProject(candidate);
    active();
    return { snapshot, candidate, owner, validate: active };
  } finally {
    capture.dispose();
  }
}

export function admitSampledSelectionPublication(edit: SampledSelectionEdit) {
  const operation = Object.getOwnPropertyDescriptor(edit, 'kind');
  if (
    operation &&
    (!Object.hasOwn(operation, 'value') || operation.value === 'selection-trajectories')
  )
    throw Error('Whole trajectories require their dedicated publication path.');
  edit.validate();
  validateProject(edit.candidate);
  // Force final complete-candidate/metadata reads before the last source/input check.
  JSON.stringify(edit.candidate);
  edit.validate();
}

/** Rotation keeps its own numeric ownership; translation drafts never supply an angle or pivot. */
export function prepareSampledSelectionRotation(
  context: SampledSelectionContext,
  requests: readonly SampledUnitRequest[],
  degrees: number,
  input: () => void,
): SampledSelectionRotationEdit {
  const { capture, snapshot, active } = captureSampledSelectionContext(context, input);
  try {
    if (!Array.isArray(requests)) throw Error('Choose actual original sampled unit requests.');
    const length = requests.length;
    if (!length || length > capture.choices.length)
      throw Error('Choose units within the original sampled selection.');
    const selected: SampledUnitRequest[] = [];
    for (let i = 0; i < length; i++) {
      const request = requests[i];
      selected.push({ layerId: request?.layerId, shapeId: request?.shapeId });
    }
    if (requests.length !== length)
      throw Error('The original sampled selection changed while being read.');
    active();
    const owner = capture.resolveRotation(selected, { validate: active });
    const candidate = capture.prepareRotation(selected, degrees, { validate: active });
    validateProject(candidate);
    const rotation = { degrees, pivot: { ...owner.pivot } };
    active();
    return { snapshot, candidate, owner, rotation, validate: active };
  } finally {
    capture.dispose();
  }
}

/** Numeric scaling captures original membership/pivot independently of other drafts. */
export function prepareSampledSelectionScale(
  context: SampledSelectionContext,
  requests: readonly SampledUnitRequest[],
  scaleX: number,
  scaleY: number,
  input: () => void,
): SampledSelectionScaleEdit {
  const { capture, snapshot, active } = captureSampledSelectionContext(context, input);
  try {
    if (!Array.isArray(requests)) throw Error('Choose actual original sampled unit requests.');
    const length = requests.length;
    if (!length || length > capture.choices.length)
      throw Error('Choose units within the original sampled selection.');
    const selected: SampledUnitRequest[] = [];
    for (let i = 0; i < length; i++) {
      const request = requests[i];
      selected.push({ layerId: request?.layerId, shapeId: request?.shapeId });
    }
    if (requests.length !== length)
      throw Error('The original sampled selection changed while being read.');
    active();
    const owner = capture.resolveScale(selected, { validate: active });
    const candidate = capture.prepareScale(selected, scaleX, scaleY, { validate: active });
    validateProject(candidate);
    const scaling = { x: scaleX, y: scaleY, pivot: { ...owner.pivot } };
    active();
    return { snapshot, candidate, owner, scaling, validate: active };
  } finally {
    capture.dispose();
  }
}

/** Numeric shearing captures original membership/pivot independently of other drafts. */
export function prepareSampledSelectionSkew(
  context: SampledSelectionContext,
  requests: readonly SampledUnitRequest[],
  axis: 'x' | 'y',
  degrees: number,
  input: () => void,
): SampledSelectionSkewEdit {
  const { capture, snapshot, active } = captureSampledSelectionContext(context, input);
  try {
    if (!Array.isArray(requests)) throw Error('Choose actual original sampled unit requests.');
    const length = requests.length;
    if (!length || length > capture.choices.length)
      throw Error('Choose units within the original sampled selection.');
    const selected: SampledUnitRequest[] = [];
    for (let i = 0; i < length; i++) {
      const request = requests[i];
      selected.push({ layerId: request?.layerId, shapeId: request?.shapeId });
    }
    if (requests.length !== length)
      throw Error('The original sampled selection changed while being read.');
    active();
    const owner = capture.resolveSkew(selected, { validate: active });
    const candidate = capture.prepareSkew(selected, axis, degrees, { validate: active });
    validateProject(candidate);
    const shearing = { axis, degrees, pivot: { ...owner.pivot } };
    active();
    return { snapshot, candidate, owner, shearing, validate: active };
  } finally {
    capture.dispose();
  }
}
