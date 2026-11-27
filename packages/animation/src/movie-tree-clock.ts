import type { Project } from '../../document/src';
import { createMovieClock } from './movie-clock';
import { compileMovieClockPlan, type MovieClockPlan, type ClockTimeline } from './movie-clock-plan';

/** Self-contained runtime; factory injection also permits use in standalone HTML exports. */
export function createMovieTreeRuntime(plan: MovieClockPlan, makeClock: typeof createMovieClock) {
  const root = makeClock();
  type Scope = { born: number; clock: ReturnType<typeof createMovieClock> };
  // A nested clock belongs to one parent lifetime. Reentering an exposure
  // creates a new scope even when the placement has the same instance ID.
  const scopes = new Map<string, Scope>();
  let origins: Record<string, number> = {};
  let previous = -1,
    previousPosition: number | undefined;
  function reset() {
    root.reset();
    scopes.clear();
    origins = {};
    previous = -1;
    previousPosition = undefined;
  }
  return {
    reset,
    /** Lifetime origins keyed exactly like rendered movie frames, from the last successful sample. */
    origins() {
      return { ...origins };
    },
    sample(frame: number, seconds: number, rootPosition?: number): Record<string, number> {
      const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
      const position = Number.isFinite(rootPosition)
        ? Math.max(0, Math.floor(rootPosition!))
        : undefined;
      if (
        time < previous ||
        (position !== undefined && previousPosition !== undefined && position < previousPosition)
      )
        reset();
      previous = time;
      previousPosition = position;
      const clocks = root.sample(plan, frame, time, position);
      const result: Record<string, number> = {};
      const sampledOrigins: Record<string, number> = {};
      const active = new Set<string>();
      let visited = 0;
      function descend(
        container: ClockTimeline,
        currentFrame: number,
        frames: Record<string, number>,
        clock: ReturnType<typeof createMovieClock>,
        namespace: string[],
        prefix: string,
        ancestry: string[],
      ) {
        for (const layer of container.layers) {
          if (!layer.visible) continue;
          let low = 0,
            high = layer.keys.length - 1;
          while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (layer.keys[middle].frame <= currentFrame) low = middle;
            else high = middle - 1;
          }
          const key = layer.keys[low];
          if (!key || key.frame > currentFrame) continue;
          for (const shape of key.shapes) {
            if (++visited > 100000) throw new Error('Nested movie clock budget exceeded.');
            const definition = plan.definitions[shape.symbolId!];
            if (!definition) throw new Error('Missing movie definition.');
            if (ancestry.includes(shape.symbolId!) || ancestry.length >= 8)
              throw new Error('Nested movie cycle or depth limit.');
            const localId = layer.id + '/' + shape.id + '/' + shape.symbolId;
            const elapsed = frames[localId] ?? 0;
            const outputId =
              prefix + (prefix && layer.id === '@base' ? '' : layer.id + '/') + shape.instancePath;
            result[outputId + '/' + shape.symbolId] = elapsed;
            const path = [...namespace, layer.id, shape.id, shape.symbolId!];
            const scopeId = JSON.stringify(path);
            const born = clock.origin(localId) ?? time;
            sampledOrigins[outputId + '/' + shape.symbolId] = born;
            let scope = scopes.get(scopeId);
            const first = Math.min(shape.symbolPlayback?.firstFrame ?? 0, definition.duration - 1);
            const child = { ...definition, id: scopeId, fps: plan.fps };
            if (!scope || Math.abs(scope.born - born) > 1e-7) {
              scope = { born, clock: makeClock() };
              scopes.set(scopeId, scope);
              scope.clock.sample(child, first, born, first);
            }
            active.add(scopeId);
            const childPosition = first + elapsed,
              childFrame = childPosition % definition.duration;
            const children = scope.clock.sample(
              child,
              childFrame,
              born + elapsed / plan.fps,
              childPosition,
            );
            descend(child, childFrame, children, scope.clock, path, outputId + '/', [
              ...ancestry,
              shape.symbolId!,
            ]);
          }
        }
      }
      descend(plan, frame, clocks, root, [], '', []);
      for (const id of scopes.keys()) if (!active.has(id)) scopes.delete(id);
      origins = sampledOrigins;
      return result;
    },
  };
}

/** Reset after artwork/history edits. Topology compilation happens once per playback session. */
export function createMovieTreeClock() {
  let source: Project | undefined, plan: MovieClockPlan | undefined;
  let runtime: ReturnType<typeof createMovieTreeRuntime> | undefined;
  return {
    reset() {
      source = undefined;
      plan = undefined;
      runtime = undefined;
    },
    origins() {
      return runtime?.origins() ?? {};
    },
    sample(project: Project, frame: number, seconds: number, rootPosition?: number) {
      if (source !== project || plan?.id !== project.id || !runtime) {
        plan = compileMovieClockPlan(project);
        runtime = createMovieTreeRuntime(plan, createMovieClock);
        source = project;
      }
      // Visibility is session state; allow root hide/show without recompiling artwork.
      const visibility = new Map(project.layers.map((l) => [l.id, l.visible]));
      for (const layer of plan!.layers) layer.visible = visibility.get(layer.id) ?? false;
      return runtime.sample(frame, seconds, rootPosition);
    },
  };
}
