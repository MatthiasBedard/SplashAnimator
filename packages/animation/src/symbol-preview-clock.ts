import { newProject, type SymbolDefinition } from '../../document/src';
import { symbolInstance } from '../../geometry/src/symbols';
import { compileMovieClockPlan } from './movie-clock-plan';
import { createMovieClock } from './movie-clock';
import { createMovieTreeRuntime } from './movie-tree-clock';

/** Compile once per preview session. Clip topology after resolving graphic exposure ages. */
export function compileSymbolPreviewClockPlan(
  definition: SymbolDefinition,
  symbols: SymbolDefinition[],
  fps: number,
  first: number,
  last: number,
  budget?: { remaining: number },
) {
  const duration = definition.timeline?.duration ?? 1;
  if (
    !Number.isInteger(first) ||
    !Number.isInteger(last) ||
    first < 0 ||
    last < first ||
    last >= duration
  )
    throw new Error('Invalid symbol preview range.');
  const project = newProject();
  project.id = 'symbol-preview-clock';
  project.fps = fps;
  project.duration = duration;
  project.symbols = symbols.map((d) => (d.id === definition.id ? definition : d));
  const instance = symbolInstance(definition, 0, 0);
  instance.id = 'preview';
  // A definition preview drives this synthetic root by its local playhead,
  // even when placed instances of the definition have independent movie clocks.
  delete instance.symbolPlayback;
  project.layers[0].id = 'root';
  project.layers[0].keys = [{ frame: 0, shapes: [instance] }];
  const plan = compileMovieClockPlan(project, budget);
  plan.duration = last - first + 1;
  for (const layer of plan.layers) {
    const held = [...layer.keys].reverse().find((key) => key.frame <= first);
    layer.keys = [
      { frame: 0, shapes: held?.shapes ?? [] },
      ...layer.keys
        .filter((key) => key.frame > first && key.frame <= last)
        .map((key) => ({ ...key, frame: key.frame - first })),
    ];
  }
  return plan;
}

/** A single authored Movie placement driven by its age, with normal nested origins. */
export function compilePlacedMovieClockPlan(
  definition: SymbolDefinition, symbols: SymbolDefinition[], fps: number, firstFrame: number,
  budget?: { remaining: number },
) {
  const project = newProject();
  project.id = 'placed-movie-clock';
  project.fps = fps;
  project.symbols = symbols;
  const instance = symbolInstance(definition, 0, 0);
  instance.id = 'preview';
  instance.symbolPlayback = { mode: 'movie', firstFrame };
  project.layers[0].id = 'root';
  project.layers[0].keys = [{ frame: 0, shapes: [instance] }];
  return compileMovieClockPlan(project, budget);
}

export function createSymbolPreviewClock(
  definition: SymbolDefinition,
  symbols: SymbolDefinition[],
  fps: number,
  first: number,
  last: number,
) {
  const plan = compileSymbolPreviewClockPlan(definition, symbols, fps, first, last);
  const clock = createMovieTreeRuntime(plan, createMovieClock);
  return {
    reset: () => clock.reset(),
    sample(frame: number, seconds: number, position: number) {
      return clock.sample(frame - first, seconds, position - first);
    },
  };
}
