import type { SymbolDefinition } from '../../document/src';
import { compileSymbolPreviewClockPlan } from './symbol-preview-clock';
import { createMovieClock } from './movie-clock';
import { createMovieTreeRuntime } from './movie-tree-clock';

/** Immutable state topology may be shared; playback clocks must remain instance-local. */
export function compileButtonStatePlans(
  definition: SymbolDefinition,
  symbols: SymbolDefinition[],
  fps: number,
) {
  const mapping = definition.buttonStates ?? { up: 0, over: 1, down: 2, hit: 3 };
  return new Map(
    [...new Set([mapping.up, mapping.over, mapping.down])].map((frame) => [
      frame,
      compileSymbolPreviewClockPlan(definition, symbols, fps, frame, frame),
    ]),
  );
}

/** A changed mapped frame begins a fresh movie lifetime. */
export function createButtonStateClock(
  definition: SymbolDefinition,
  symbols: SymbolDefinition[],
  fps: number,
  plans = compileButtonStatePlans(definition, symbols, fps),
) {
  const clocks = new Map(
    [...plans].map(([frame, plan]) => [frame, createMovieTreeRuntime(plan, createMovieClock)]),
  );
  let active: number | undefined,
    born = 0;
  return {
    entrySeconds: () => active === undefined ? undefined : born,
    origins(): Record<string, number> {
      if (active === undefined) return {};
      return Object.fromEntries(
        Object.entries(clocks.get(active)!.origins()).map(([path, origin]) => [
          path,
          born + origin,
        ]),
      );
    },
    sample(frame: number, seconds: number) {
      const clock = clocks.get(frame);
      if (!clock) throw new Error('Unknown button display frame.');
      if (active !== frame || seconds < born) {
        active = frame;
        born = seconds;
        clock.reset();
      }
      return clock.sample(0, Math.max(0, seconds - born), 0);
    },
  };
}
