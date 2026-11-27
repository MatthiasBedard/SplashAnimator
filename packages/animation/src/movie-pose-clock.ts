import { validateProject, type Project } from '../../document/src';
import { validateLiveMotionData } from '../../document/src/live-motion';
import { selectionTrajectoryStamp } from './selection-trajectory';
import { compileMovieClockPlan } from './movie-clock-plan';
import { createMovieClock } from './movie-clock';
import { createMovieTreeRuntime } from './movie-tree-clock';

export type MoviePose = Readonly<{ project: Project }>;
export type MoviePoseTime = Readonly<{
  frames: Readonly<Record<string, number>>;
  origins: Readonly<Record<string, number>>;
}>;
const reading = new WeakMap<() => unknown, { invalid: boolean }>();

/** Original topology owns independent clocks. Detached geometry may insert keys,
 * but must retain every original movie identity, setting and exposure lifetime.
 * This does not admit movie instances into sparse authoring recipes. */
export function captureMoviePoseClock(reader: () => { project: Project; revision: number }) {
  let dead = false,
    busy = false,
    invalid = false,
    phased = false;
  const poses = new WeakMap<MoviePose, string>();
  function read() {
    if (typeof reader !== 'function') throw Error('Choose an original movie source reader.');
    const previous = reading.get(reader);
    if (previous) {
      previous.invalid = true;
      throw Error('Original movie source cannot reenter.');
    }
    const guard = { invalid: false };
    reading.set(reader, guard);
    let value: ReturnType<typeof reader>;
    try {
      value = reader();
      if (guard.invalid) throw Error('Original movie source reentered.');
    } finally {
      reading.delete(reader);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw Error('Choose original movie source data.');
    const project = Object.getOwnPropertyDescriptor(value, 'project'),
      revision = Object.getOwnPropertyDescriptor(value, 'revision');
    if (
      !project?.enumerable ||
      !('value' in project) ||
      !revision?.enumerable ||
      !('value' in revision) ||
      !Number.isSafeInteger(revision.value) ||
      revision.value < 0
    )
      throw Error('Choose original movie source fields and revision.');
    validateLiveMotionData(project.value);
    return { project: project.value as Project, revision: revision.value as number };
  }
  const source = read(),
    stamp = selectionTrajectoryStamp(source.project);
  validateProject(source.project);
  function active() {
    if (dead || invalid) throw Error('Movie pose clock closed. Capture again.');
    const current = read();
    if (
      dead ||
      invalid ||
      current.project !== source.project ||
      current.revision !== source.revision ||
      selectionTrajectoryStamp(current.project) !== stamp
    )
      throw Error('Original movie source changed. Capture again.');
  }
  active();
  const snapshot = structuredClone(source.project);
  active();
  if (selectionTrajectoryStamp(snapshot) !== stamp) throw Error('Original movie clone changed.');
  const plan = compileMovieClockPlan(snapshot),
    topology = selectionTrajectoryStamp(plan),
    library = selectionTrajectoryStamp(snapshot.symbols);
  active();
  const runtime = createMovieTreeRuntime(plan, createMovieClock);
  function operation<T>(run: () => T, admit?: (value: T) => void): T {
    if (busy) {
      invalid = true;
      throw Error('Movie pose preparation cannot reenter.');
    }
    busy = true;
    try {
      active();
      const value = run();
      active();
      admit?.(value);
      return value;
    } catch (cause) {
      if (phased) invalid = true;
      throw cause;
    } finally {
      busy = false;
      phased = false;
    }
  }
  function assertPose(pose: MoviePose) {
    const expected = poses.get(pose);
    if (!expected || selectionTrajectoryStamp(pose.project) !== expected)
      throw Error('Choose unchanged privately captured movie artwork.');
  }
  function timing(frame: number, seconds: number, position: number) {
    if (
      !Number.isSafeInteger(frame) ||
      frame < 0 ||
      frame >= snapshot.duration ||
      !Number.isFinite(seconds) ||
      seconds < 0 ||
      !Number.isSafeInteger(Math.floor(seconds * snapshot.fps + 1e-7)) ||
      !Number.isSafeInteger(position) ||
      position < 0 ||
      position % snapshot.duration !== frame
    )
      throw Error('Choose exact movie frame, time and root position.');
  }
  function result(clock: typeof runtime, frame: number, seconds: number, position: number) {
    const frames = clock.sample(frame, seconds, position);
    return Object.freeze({
      frames: Object.freeze(frames),
      origins: Object.freeze(clock.origins()),
    });
  }
  return {
    capture(project: Project): MoviePose {
      let expected = '';
      return operation(
        () => {
          validateLiveMotionData(project);
          expected = selectionTrajectoryStamp(project);
          validateProject(project);
          const detached = structuredClone(project);
          active();
          if (
            selectionTrajectoryStamp(project) !== expected ||
            selectionTrajectoryStamp(detached) !== expected
          )
            throw Error('Movie pose clone changed.');
          if (
            detached.id !== snapshot.id ||
            detached.fps !== snapshot.fps ||
            detached.duration !== snapshot.duration ||
            selectionTrajectoryStamp(detached.symbols) !== library ||
            selectionTrajectoryStamp(compileMovieClockPlan(detached)) !== topology
          )
            throw Error(
              'Movie pose must preserve original clocks, library and exposure lifetimes.',
            );
          active();
          if (
            selectionTrajectoryStamp(project) !== expected ||
            selectionTrajectoryStamp(detached) !== expected
          )
            throw Error('Movie pose changed during topology admission.');
          const pose = Object.freeze({ project: detached });
          poses.set(pose, expected);
          return pose;
        },
        (pose) => {
          if (selectionTrajectoryStamp(project) !== expected)
            throw Error('Movie pose input changed after source admission.');
          assertPose(pose);
        },
      );
    },
    sample(pose: MoviePose, frame: number, seconds: number, position: number): MoviePoseTime {
      return operation(
        () => {
          assertPose(pose);
          timing(frame, seconds, position);
          // A failure after advancement cannot leave a reusable partially phased clock.
          try {
            phased = true;
            const value = result(runtime, frame, seconds, position);
            active();
            assertPose(pose);
            return value;
          } catch (cause) {
            invalid = true;
            throw cause;
          }
        },
        () => assertPose(pose),
      );
    },
    /** Exact integer export replay starts at document zero, independent of preview time. */
    replay(pose: MoviePose, frame: number): MoviePoseTime {
      return operation(
        () => {
          assertPose(pose);
          timing(frame, frame / snapshot.fps, frame);
          const replay = createMovieTreeRuntime(plan, createMovieClock);
          let value: MoviePoseTime | undefined;
          for (let i = 0; i <= frame; i++) value = result(replay, i, i / snapshot.fps, i);
          active();
          assertPose(pose);
          return value!;
        },
        () => assertPose(pose),
      );
    },
    reset() {
      if (busy) {
        invalid = true;
        throw Error('Movie pose preparation cannot reenter.');
      }
      invalid = false;
      operation(() => runtime.reset());
    },
    dispose() {
      dead = true;
      runtime.reset();
    },
  };
}
