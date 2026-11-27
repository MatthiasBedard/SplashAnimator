import { validateProject, type Project } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import {
  createMotionFrameSampler,
  type MotionFrameRecipe,
  type MotionFrameSampler,
} from './motion-frames';
import { qualifyReadOnlyMovieTreeMotion } from './read-only-movie-trees';
import { selectionTrajectoryStamp } from './selection-trajectory';
import { compileMovieClockPlan } from './movie-clock-plan';

export type ReadOnlyMovieTreeRequest = {
  layerId: string;
  recipe: Omit<MotionFrameRecipe, 'symbolContinuity'>;
};
const working = new WeakMap<Project, { invalid: boolean }>();
function operation<T>(project: Project, run: () => T): T {
  const prior = working.get(project);
  if (prior) {
    prior.invalid = true;
    throw Error('Read-only movie tree preparation cannot reenter.');
  }
  const entry = { invalid: false };
  working.set(project, entry);
  try {
    const result = run();
    if (entry.invalid) throw Error('Read-only movie tree preparation reentered.');
    return result;
  } finally {
    working.delete(project);
  }
}

/** Temporary render projects only. No persisted marker, authoring ownership,
 * clock advancement, scripts, metadata refresh or history publication.
 * Recapture after any original source or request edit. All requested tracks
 * prepare before any output is returned; each pose keeps the whole clock plan. */
export function createReadOnlyMovieTreeFrameSampler(
  project: Project,
  requests: readonly ReadOnlyMovieTreeRequest[],
) {
  return operation(project, () => {
    validateLiveGraphicData(project);
    validateLiveGraphicData(requests);
    validateProject(project);
    if (!Array.isArray(requests) || !requests.length)
      throw Error('Choose original movie tree tracks.');
    const ids = new Set<string>();
    for (const request of requests) {
      if (
        !request ||
        Object.keys(request).some((k) => !['layerId', 'recipe'].includes(k)) ||
        typeof request.layerId !== 'string' ||
        !request.layerId ||
        ids.has(request.layerId) ||
        !request.recipe ||
        Object.keys(request.recipe).some(
          (k) =>
            ![
              'start',
              'end',
              'ease',
              'options',
              'path',
              'rotation',
              'correspondence',
              'opacityEase',
              'paintEase',
            ].includes(k),
        )
      )
        throw Error('Choose distinct read-only movie tree requests without persisted markers.');
      ids.add(request.layerId);
      const layer = project.layers.find((l) => l.id === request.layerId);
      if (!layer || layer.liveMotionSpans?.length || layer.motionSpans?.length)
        throw Error('Read-only movie tree tracks must not own existing recipes.');
      qualifyReadOnlyMovieTreeMotion(project, request.layerId, request.recipe);
    }
    const sourceStamp = selectionTrajectoryStamp(project),
      inputStamp = selectionTrajectoryStamp(requests);
    let dead = false;
    function active() {
      if (
        dead ||
        selectionTrajectoryStamp(project) !== sourceStamp ||
        selectionTrajectoryStamp(requests) !== inputStamp ||
        selectionTrajectoryStamp(snapshot) !== sourceStamp ||
        selectionTrajectoryStamp(inputs) !== inputStamp
      )
        throw Error('Original read-only movie tree source or requests changed.');
    }
    const snapshot = structuredClone(project),
      inputs = structuredClone(requests);
    active();
    if (
      selectionTrajectoryStamp(snapshot) !== sourceStamp ||
      selectionTrajectoryStamp(inputs) !== inputStamp
    )
      throw Error('Read-only movie tree capture clone changed.');
    const topology = selectionTrajectoryStamp(compileMovieClockPlan(snapshot));
    const samplers: { request: ReadOnlyMovieTreeRequest; sampler: MotionFrameSampler }[] = [];
    try {
      for (const request of inputs)
        samplers.push({
          request,
          sampler: createMotionFrameSampler(snapshot, request.layerId, request.recipe),
        });
      active();
      return {
        sample(frame: number): Project {
          return operation(project, () => {
            active();
            if (
              !Number.isSafeInteger(frame) ||
              inputs.some((r) => frame < r.recipe.start || frame > r.recipe.end)
            )
              throw Error('Choose an integer frame within every original movie tree range.');
            const poses = samplers.map(({ request, sampler }) => ({
              request,
              shapes: sampler.sample(frame),
            }));
            const candidate = structuredClone(snapshot);
            if (selectionTrajectoryStamp(candidate) !== sourceStamp)
              throw Error('Read-only movie tree output clone changed.');
            for (const { request, shapes } of poses) {
              if (frame === request.recipe.start || frame === request.recipe.end) continue;
              const layer = candidate.layers.find((l) => l.id === request.layerId)!;
              layer.keys = layer.keys.filter((k) => k.frame !== frame);
              layer.keys.push({ frame, shapes });
              layer.keys.sort((a, b) => a.frame - b.frame);
            }
            const output = selectionTrajectoryStamp(candidate);
            validateProject(candidate);
            if (selectionTrajectoryStamp(compileMovieClockPlan(candidate)) !== topology)
              throw Error('Read-only movie tree pose changed original exposure lifetimes.');
            active();
            if (selectionTrajectoryStamp(candidate) !== output)
              throw Error('Read-only movie tree pose changed during admission.');
            return candidate;
          });
        },
        dispose() {
          dead = true;
          for (const { sampler } of samplers) sampler.dispose();
          samplers.length = 0;
        },
      };
    } catch (cause) {
      for (const { sampler } of samplers) sampler.dispose();
      throw cause;
    }
  });
}
