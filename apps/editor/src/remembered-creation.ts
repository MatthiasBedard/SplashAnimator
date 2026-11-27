import type { Project } from '../../../packages/document/src';
import type { MotionFrameRecipe } from '../../../packages/animation/src/motion-frames';
import {
  requireOwnedMotionInterior,
  checkMotionReconstruction,
} from '../../../packages/animation/src/motion-ownership';

/** Synchronous preparation cannot interleave genuine input. Nested input events
 * still invalidate it, including changed-and-restored controls and close clicks. */
export function watchRememberedCreationInputs(target: EventTarget) {
  let changed = false;
  const mark = () => {
    changed = true;
  };
  const events = ['input', 'change', 'click', 'keydown'];
  const options = { capture: true };
  for (const event of events) target.addEventListener(event, mark, options);
  return {
    validate() {
      if (changed) throw Error('Remembered creation inputs changed. Try again.');
    },
    dispose() {
      for (const event of events) target.removeEventListener(event, mark, options);
    },
  };
}

type Timeline = Pick<Project, 'layers' | 'duration' | 'symbols'>;
export type RememberedCreationRecipe = MotionFrameRecipe & { ids: string[] };
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, data) =>
    data && typeof data === 'object' && !Array.isArray(data)
      ? Object.fromEntries(
          Object.keys(data)
            .sort()
            .map((key) => [key, data[key]]),
        )
      : data,
  );
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
/** Only new interior keys and one admitted recipe per selected track may differ.
 * Canonical JSON comparison retains the document's optional-field semantics. */
export function assertRememberedCreation(
  source: Timeline,
  candidate: Timeline,
  recipe: RememberedCreationRecipe,
) {
  if (
    !recipe.ids.length ||
    new Set(recipe.ids).size !== recipe.ids.length ||
    recipe.ids.some((id) => source.layers.filter((l) => l.id === id).length !== 1)
  )
    throw Error('Choose distinct original remembered tracks.');
  if (candidate.duration !== source.duration || !equal(candidate.symbols, source.symbols))
    throw Error('Prepared remembered creation changed its resources.');
  const expected = source.layers.map((layer) => {
    if (!recipe.ids.includes(layer.id)) return layer;
    const next = candidate.layers.find((l) => l.id === layer.id);
    const added = next?.motionSpans?.filter(
      (s) => !(layer.motionSpans ?? []).some((old) => old.id === s.id),
    );
    if (!next || added?.length !== 1) throw Error('Prepared remembered creation lost its recipe.');
    const span = added[0];
    for (const key of [
      'start',
      'end',
      'ease',
      'options',
      'path',
      'rotation',
      'correspondence',
      'opacityEase',
      'paintEase',
    ] as const)
      if (!equal(span[key], recipe[key]))
        throw Error('Prepared remembered creation changed its requested settings.');
    const generated = requireOwnedMotionInterior(next, span);
    checkMotionReconstruction(
      candidate,
      next,
      span,
      generated,
      'Prepared remembered creation changed its generated artwork.',
    );
    return {
      ...layer,
      keys: [...layer.keys, ...generated].sort((a, b) => a.frame - b.frame),
      motionSpans: [...(layer.motionSpans ?? []), span].sort((a, b) => a.start - b.start),
    };
  });
  if (!equal(candidate.layers, expected))
    throw Error('Prepared remembered creation changed original artwork.');
}
