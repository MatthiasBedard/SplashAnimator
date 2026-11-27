import type { MovieClockPlan } from '../../animation/src/movie-clock-plan';
import type { createMovieTreeRuntime } from '../../animation/src/movie-tree-clock';
import type { createMovieClock } from '../../animation/src/movie-clock';

/** Serializable state lifetimes; every active exposure owns its movie clocks. */
export function createExportButtonMovieRuntime(
  buttons: {
    states: { up: number; over: number; down: number };
    plans: number;
  }[],
  makeTree: typeof createMovieTreeRuntime,
  makeClock: typeof createMovieClock,
  plans: Record<number, MovieClockPlan>[],
) {
  const sessions = new Map<
    number | string,
    { frame: number; born: number; clocks: Map<number, ReturnType<typeof makeTree>> }
  >();
  // Compiled placement entries may change while the logical exposure stays alive.
  // Input still uses entry indices; movie sessions follow the caller's lifetime identity.
  let identities = new Map<number, string>();
  const keyFor = (index: number) =>
    identities.has(index) ? JSON.stringify([identities.get(index), buttons[index].plans]) : index;
  return {
    entrySeconds: (index: number) => sessions.get(keyFor(index))?.born,
    prepare(index: number, identity: string | undefined, expired = false) {
      if (identity === undefined) identities.delete(index);
      else identities.set(index, identity);
      if (expired) sessions.delete(keyFor(index));
    },
    origins(index: number): Record<string, number> {
      const session = sessions.get(keyFor(index));
      if (!session) return {};
      return Object.fromEntries(
        Object.entries(session.clocks.get(session.frame)!.origins()).map(([path, origin]) => [
          path,
          session.born + origin,
        ]),
      );
    },
    update(active: number[], expired = new Set<number>(), continuity = new Map<number, string>()) {
      identities = new Map(continuity);
      const visible = new Set(active.map(keyFor));
      for (const key of sessions.keys()) if (!visible.has(key)) sessions.delete(key);
      for (const index of active) if (expired.has(index)) sessions.delete(keyFor(index));
    },
    sample(index: number, state: 'up' | 'over' | 'down', seconds: number, entrySeconds?: number) {
      const button = buttons[index];
      const frame = button.states[state];
      const key = keyFor(index);
      let session = sessions.get(key);
      if (!session) {
        session = {
          frame,
          born: seconds,
          clocks: new Map(
            Object.entries(plans[button.plans]).map(([f, plan]) => [
              Number(f),
              makeTree(plan, makeClock),
            ]),
          ),
        };
        sessions.set(key, session);
        if (state === 'up' && entrySeconds !== undefined) {
          session.born = entrySeconds;
          session.clocks.get(frame)!.sample(0, 0, 0);
        }
      }
      const clock = session.clocks.get(frame)!;
      if (session.frame !== frame || seconds < session.born) {
        session.frame = frame;
        session.born = seconds;
        clock.reset();
      }
      return clock.sample(0, Math.max(0, seconds - session.born), 0);
    },
  };
}
