import { movieLayerView, validateProject, type Project } from '../../../packages/document/src';
import { validateLiveMotionData } from '../../../packages/document/src/live-motion';
import {
  captureLiveMotionStage,
  type LiveStageFrame,
} from '../../../packages/animation/src/live-motion-stage';
import { createInteractiveButtonView } from '../../../packages/animation/src/movie-button-view';
import {
  captureMoviePoseClock,
  type MoviePose,
} from '../../../packages/animation/src/movie-pose-clock';
import {
  createRootButtonMoviePlayback,
  pickRootButton,
} from '../../../packages/animation/src/button-preview';
import { createButtonExposureRuntime } from '../../../packages/animation/src/button-exposure';
import { selectionTrajectoryStamp } from '../../../packages/animation/src/selection-trajectory';
import {
  detachPresentationData,
  type LayerPresentation,
} from '../../../packages/animation/src/layer-presentation';
import {
  prepareLayerScene,
  withLayerScene,
  disposeLayerScene,
  type PreparedLayerScene,
} from '../../../packages/animation/src/layer-scene';
import { hit } from '../../../packages/geometry/src';

export type LiveMovieInput = Readonly<{ over: string | null; down: string | null }>;
export type LiveMovieFrame = Readonly<{
  tick: number;
  position: number;
  frame: number;
  seconds: number;
  input: LiveMovieInput;
  presentation: LayerPresentation;
}>;
/** Independent script-free preview clocks. Original source identity owns clock
 * lifetimes; sampled root views own placement/interaction only. One successful
 * phase is retained across native retries, without advancing any clock twice. */
export function createLiveMovieSession(
  project: Project,
  start: number,
  options: { validate?: () => void } = {},
) {
  validateLiveMotionData(project);
  const stamp = selectionTrajectoryStamp(project);
  validateProject(project);
  if (!Number.isSafeInteger(start) || start < 0 || start >= project.duration)
    throw Error('Choose an exact live movie starting frame.');
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Reflect.ownKeys(options).some((k) => k !== 'validate')
  )
    throw Error('Invalid live movie admission.');
  let external = options.validate;
  if (external !== undefined && typeof external !== 'function')
    throw Error('Invalid live movie validator.');
  const runtimeStamp = project.layers.some(layer => layer.guideLayer && layer.visible)
    ? selectionTrajectoryStamp(movieLayerView(project)) : stamp;
  let original: Project | undefined = project,
    runtime: Project | undefined,
    dead = false,
    busy = false,
    invalid = false,
    checking = false,
    generation = 0,
    tick = 0,
    position = start;
  let roots: ReturnType<typeof captureLiveMotionStage> | undefined,
    root: LiveStageFrame | undefined,
    moviePose: MoviePose | undefined,
    movies: ReturnType<typeof captureMoviePoseClock> | undefined,
    view: ReturnType<typeof createInteractiveButtonView> | undefined;
  const buttons = createRootButtonMoviePlayback(),
    exposures = createButtonExposureRuntime<string>(),
    epochs = new Map<string, number>();
  let cached: LiveMovieFrame | undefined,
    cachedKey = '',
    scene: PreparedLayerScene | undefined;
  const owned = new WeakMap<
    LiveMovieFrame,
    { generation: number; foreground: readonly string[] }
  >();
  function clear() {
    generation++;
    if (scene) disposeLayerScene(scene);
    scene = undefined;
    cached = undefined;
    cachedKey = '';
  }
  function dispose() {
    dead = true;
    clear();
    roots?.dispose();
    roots = undefined;
    root = undefined;
    view = undefined;
    movies?.dispose();
    movies = undefined;
    moviePose = undefined;
    buttons.reset();
    exposures.reset();
    epochs.clear();
    original = undefined;
    runtime = undefined;
    external = undefined;
  }
  function check() {
    if (dead || !original) throw Error('Live movie session closed.');
    if (checking) {
      invalid = true;
      throw Error('Live movie admission cannot reenter.');
    }
    checking = true;
    try {
      const result = external?.() as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('Live movie admission must be synchronous.');
      }
      if (
        dead ||
        selectionTrajectoryStamp(original) !== stamp ||
        (runtime && selectionTrajectoryStamp(runtime) !== runtimeStamp)
      ) {
        dispose();
        throw Error('Live movie source changed. Reopen the preview.');
      }
      if (invalid) throw Error('Live movie clock phase failed. Restart the session.');
    } catch (cause) {
      if (!invalid) dispose();
      throw cause;
    } finally {
      checking = false;
    }
  }
  function makeRoots() {
    return captureLiveMotionStage(() => {
      check();
      return { project: runtime!, revision: 0 };
    });
  }
  try {
    check();
    const captured = structuredClone(project);
    check();
    if (selectionTrajectoryStamp(captured) !== stamp)
      throw Error('Live movie original clone changed.');
    runtime = movieLayerView(captured);
    movies = captureMoviePoseClock(() => {
      check();
      return { project: runtime!, revision: 0 };
    });
    roots = makeRoots();
  } catch (cause) {
    dispose();
    throw cause;
  }
  function assertCurrent(frame: LiveMovieFrame) {
    check();
    if (
      !owned.has(frame) ||
      cached !== frame ||
      owned.get(frame)!.generation !== generation ||
      !scene
    )
      throw Error('Choose the current privately owned movie phase.');
    roots!.assertFrame(root!, frame.frame);
    withLayerScene(scene, () => {});
    check();
  }
  function input(value: LiveMovieInput) {
    validateLiveMotionData(value);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Reflect.ownKeys(value).some((k) => k !== 'over' && k !== 'down') ||
      ![value.over, value.down].every((v) => v === null || typeof v === 'string')
    )
      throw Error('Invalid live movie input.');
    const result = { over: value.over, down: value.down };
    for (const token of [result.over, result.down])
      if (token !== null && !cached?.presentation.buttons.some((b) => b.token === token))
        throw Error('Choose a button from the original visible movie phase.');
    return result;
  }
  function operate(
    action: 'current' | 'advance' | 'restart',
    requested: LiveMovieInput,
    moveRoot: boolean,
  ) {
    if (busy) {
      invalid = true;
      throw Error('Live movie phase cannot reenter.');
    }
    const desired = input(requested);
    if (typeof moveRoot !== 'boolean') throw Error('Choose an explicit root playback policy.');
    const requestedStamp = selectionTrajectoryStamp(requested);
    busy = true;
    let phased = false;
    try {
      if (action === 'restart') {
        invalid = false;
        check();
        clear();
        movies!.reset();
        buttons.reset();
        exposures.reset();
        epochs.clear();
        roots?.dispose();
        roots = makeRoots();
        root = undefined;
        moviePose = undefined;
        view = undefined;
        tick = 0;
        position = start;
        desired.over = desired.down = null;
      }
      check();
      if (selectionTrajectoryStamp(requested) !== requestedStamp)
        throw Error('Live movie input changed.');
      const next = action === 'advance' ? tick + 1 : tick,
        nextPosition = action === 'advance' && moveRoot ? position + 1 : position,
        seconds = next / runtime!.fps;
      if (
        !Number.isSafeInteger(next) ||
        !Number.isSafeInteger(nextPosition) ||
        !Number.isFinite(seconds)
      )
        throw Error('Live movie clock exceeds its exact range.');
      const key = JSON.stringify([next, nextPosition, desired]);
      if (cached && cachedKey === key) {
        assertCurrent(cached);
        if (selectionTrajectoryStamp(requested) !== requestedStamp)
          throw Error('Live movie input changed.');
        return cached;
      }
      const previousPoses = new Map(
        cached?.presentation.buttons.map((b) => [b.token, JSON.stringify(b.shape)]),
      );
      phased = true;
      clear();
      const phase = generation,
        frame = nextPosition % runtime!.duration;
      if (!root || root.frame !== frame) {
        root = roots!.sample(frame);
        moviePose = movies!.capture(root.project);
        view = createInteractiveButtonView(root.project, { layerPresentation: true });
      }
      roots!.assertFrame(root, frame);
      const { frames, origins } = movies!.sample(moviePose!, frame, seconds, nextPosition);
      const discover = () =>
        view!.sample(frame, frames, origins, desired.over, desired.down, (button) => {
          const epoch =
            button.start === 0 && button.end === runtime!.duration
              ? 0
              : Math.floor((nextPosition - button.start) / runtime!.duration);
          if (epochs.has(button.token) && epochs.get(button.token) !== epoch)
            buttons.invalidate(new Set([button.token]));
          epochs.set(button.token, epoch);
          const state = buttons.sample(
            runtime!,
            [button],
            desired.over,
            desired.down,
            seconds,
            false,
          );
          return {
            frames: state.stateFrames.get(button.token)!,
            origins: state.stateOrigins.get(button.token)!,
          };
        });
      let discovered = discover();
      const changed = (token: string | null) => {
        if (token === null) return false;
        const button = discovered.buttons.find((b) => b.token === token);
        return (
          !button ||
          (previousPoses.has(token) && previousPoses.get(token) !== JSON.stringify(button.shape))
        );
      };
      if (changed(desired.over) || changed(desired.down)) {
        if (changed(desired.over)) desired.over = null;
        if (changed(desired.down)) desired.down = null;
        discovered = discover();
      }
      const finalTokens = new Set(discovered.buttons.map((b) => b.token));
      for (const token of epochs.keys()) if (!finalTokens.has(token)) epochs.delete(token);
      buttons.invalidate(
        exposures.sample(
          discovered.buttons.map((b) => ({ id: b.token, start: b.start, end: b.end })),
          runtime!.duration,
          nextPosition,
        ),
      );
      const bank = buttons.sample(
          runtime!,
          discovered.buttons,
          desired.over,
          desired.down,
          seconds,
        ),
        presentation = discovered.presentation(bank.artwork, bank.stateFrames);
      check();
      if (selectionTrajectoryStamp(requested) !== requestedStamp)
        throw Error('Live movie input changed.');
      const current = () => {
        check();
        if (generation !== phase) throw Error('Live movie phase changed.');
        roots!.assertFrame(root!, frame);
        if (selectionTrajectoryStamp(requested) !== requestedStamp)
          throw Error('Live movie input changed.');
      };
      scene = prepareLayerScene(
        runtime!,
        frame,
        [],
        () =>
          presentation.layers.map((layer) => ({
            layerId: layer.layerId,
            shapes: [...layer.shapes],
          })),
        { validate: current },
      );
      current();
      const result: LiveMovieFrame = Object.freeze({
        tick: next,
        position: nextPosition,
        frame,
        seconds,
        input: Object.freeze({ ...desired }),
        presentation,
      });
      // Original live tracks also own their endpoint/hold foreground. The legacy
      // interaction policy for unrelated authored tracks stays unchanged.
      owned.set(result, {
        generation,
        foreground: runtime!.layers.filter((l) => l.liveMotionSpans?.length).map((l) => l.id),
      });
      cached = result;
      cachedKey = JSON.stringify([next, nextPosition, desired]);
      tick = next;
      position = nextPosition;
      assertCurrent(result);
      if (selectionTrajectoryStamp(requested) !== requestedStamp)
        throw Error('Live movie input changed.');
      return result;
    } catch (cause) {
      if (phased) invalid = true;
      throw cause;
    } finally {
      busy = false;
    }
  }
  return {
    current(value: LiveMovieInput = { over: null, down: null }) {
      return operate('current', value, false);
    },
    advance(moveRoot: boolean, value: LiveMovieInput = { over: null, down: null }) {
      return operate('advance', value, moveRoot);
    },
    restart() {
      return operate('restart', { over: null, down: null }, false);
    },
    assertCurrent,
    scene(frame: LiveMovieFrame) {
      assertCurrent(frame);
      return scene!;
    },
    pick(frame: LiveMovieFrame, point: { x: number; y: number }) {
      validateLiveMotionData(point);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
        throw Error('Choose a finite movie pointer.');
      const target = { x: point.x, y: point.y },
        pointStamp = selectionTrajectoryStamp(point);
      const admit = () => {
        assertCurrent(frame);
        if (selectionTrajectoryStamp(point) !== pointStamp)
          throw Error('Live movie pointer changed.');
      };
      admit();
      const candidate = pickRootButton([...frame.presentation.buttons], target);
      if (!candidate) {
        admit();
        return;
      }
      const layers = frame.presentation.layers,
        order = layers.findIndex((l) => l.layerId === candidate.layerId),
        foreground = owned.get(frame)!.foreground;
      if (
        layers.some(
          (layer, index) =>
            index > order &&
            foreground.includes(layer.layerId) &&
            layer.shapes.some((shape) => shape.opacity !== 0 && hit(shape, target, 0)),
        )
      ) {
        admit();
        return;
      }
      const output = detachPresentationData(candidate);
      admit();
      return output;
    },
    dispose,
  };
}
