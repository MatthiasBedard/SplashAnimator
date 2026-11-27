import { validateProject, type Project, type Vector } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import type { MotionFrameRecipe } from './motion-frames';
import { qualifyReadOnlyMovieTreeMotion } from './read-only-movie-trees';
import { selectionTrajectoryStamp } from './selection-trajectory';
import { compileMovieClockPlan } from './movie-clock-plan';

/** A separate persisted opt-in. Existing movies remains pure-graphic and
 * no authoring UI or previously captured ownership is broadened here. */
export function qualifyLiveMovieTreeMotion(
  project: Project,
  layerId: string,
  recipe: MotionFrameRecipe,
) {
  validateLiveGraphicData(project);
  validateLiveGraphicData(recipe);
  const stamp = selectionTrajectoryStamp({ project, layerId, recipe });
  if (recipe.symbolContinuity !== 'movie-trees')
    throw Error('Choose explicit nested movie continuity.');
  validateProject(project);
  qualifyReadOnlyMovieTreeMotion(project, layerId, recipe);
  if (selectionTrajectoryStamp({ project, layerId, recipe }) !== stamp)
    throw Error('Original nested movie source changed during qualification.');
}

const working = new WeakMap<Project, { invalid: boolean }>();
function guarded<T>(project: Project, run: () => T): T {
  const prior = working.get(project);
  if (prior) {
    prior.invalid = true;
    throw Error('Nested movie topology cannot reenter.');
  }
  const entry = { invalid: false };
  working.set(project, entry);
  try {
    const value = run();
    if (entry.invalid) throw Error('Nested movie topology reentered.');
    return value;
  } finally {
    working.delete(project);
  }
}

/** Private original clock proof for a sampler's detached poses. No clocks advance
 * and no library/endpoint data are rewritten. The shared sampler still owns
 * all interpolation and original numeric/option admission. */
export function captureLiveMovieTreeTopology(
  project: Project,
  layerId: string,
  recipe: MotionFrameRecipe,
) {
  return guarded(project, () => {
    qualifyLiveMovieTreeMotion(project, layerId, recipe);
    const sourceStamp = selectionTrajectoryStamp(project),
      requestStamp = selectionTrajectoryStamp(recipe);
    let snapshot: Project | undefined = structuredClone(project),
      source: Project | undefined = project;
    if (
      selectionTrajectoryStamp(project) !== sourceStamp ||
      selectionTrajectoryStamp(snapshot) !== sourceStamp ||
      selectionTrajectoryStamp(recipe) !== requestStamp
    )
      throw Error('Nested movie topology capture changed.');
    const topology = selectionTrajectoryStamp(compileMovieClockPlan(snapshot));
    let dead = false;
    const active = () => {
      if (snapshot) validateLiveGraphicData(snapshot);
      if (dead || !snapshot || selectionTrajectoryStamp(snapshot) !== sourceStamp)
        throw Error('Private nested movie topology changed or closed.');
      return snapshot;
    };
    active();
    validateLiveGraphicData(project);
    validateLiveGraphicData(recipe);
    if (
      selectionTrajectoryStamp(project) !== sourceStamp ||
      selectionTrajectoryStamp(recipe) !== requestStamp
    )
      throw Error('Original nested movie topology source changed.');
    return {
      admit(frame: number, shapes: Vector[]) {
        if (!source) throw Error('Private nested movie topology closed.');
        guarded(source, () => {
          const original = active();
          validateLiveGraphicData(shapes);
          const expected = selectionTrajectoryStamp(shapes),
            candidate = structuredClone(original);
          active();
          if (selectionTrajectoryStamp(candidate) !== sourceStamp)
            throw Error('Nested movie topology clone changed.');
          for (const layer of candidate.layers) delete layer.liveMotionSpans;
          const layer = candidate.layers.find((l) => l.id === layerId)!;
          layer.keys = [
            ...layer.keys.filter((k) => k.frame !== frame),
            { frame, shapes: structuredClone(shapes) },
          ].sort((a, b) => a.frame - b.frame);
          const output = selectionTrajectoryStamp(candidate);
          validateLiveGraphicData(candidate);
          validateProject(candidate);
          if (selectionTrajectoryStamp(compileMovieClockPlan(candidate)) !== topology)
            throw Error('Nested movie pose changed original clock lifetimes.');
          active();
          validateLiveGraphicData(candidate);
          validateLiveGraphicData(shapes);
          if (
            selectionTrajectoryStamp(candidate) !== output ||
            selectionTrajectoryStamp(shapes) !== expected
          )
            throw Error('Nested movie pose changed during topology admission.');
        });
      },
      dispose() {
        dead = true;
        snapshot = undefined;
        source = undefined;
      },
    };
  });
}
