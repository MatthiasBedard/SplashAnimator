import type { Vector } from '../../document/src';
import { createRememberedTimelineSampler } from './motion-timeline';
import type { MotionRevisionSource } from './motion-revision';
import { sampleCapturedOpacity } from './opacity-track';
import {
  prepareRootOpacityBindings,
  type RootOpacityBinding,
} from '../../document/src/opacity-bindings';
export type { RootOpacityBinding } from '../../document/src/opacity-bindings';

/** Apply absolute opacity to detached root poses, after remembered motion.
 * A binding cannot span an absent exposure or a replacement kind/symbol definition.
 * The caller must advance its revision on all in-place edits; recreate after a change.
 */
export function createBoundOpacitySampler(
  readSource: () => MotionRevisionSource,
  bindings?: readonly RootOpacityBinding[],
) {
  const first = readSource();
  let pinned: MotionRevisionSource | undefined = {
    project: first.project,
    revision: first.revision,
  };
  let reader: (() => MotionRevisionSource) | undefined = readSource;
  let reading = false;
  function current() {
    if (!pinned || !reader) throw new Error('Opacity binding sampler is disposed.');
    if (reading) throw new Error('Opacity source reading cannot reenter.');
    let source: MotionRevisionSource;
    reading = true;
    try {
      source = reader();
    } finally {
      reading = false;
    }
    if (
      !pinned ||
      !source ||
      source.project !== pinned.project ||
      source.revision !== pinned.revision
    )
      throw new Error('Opacity binding source changed; prepare bindings again.');
    return pinned;
  }
  const { project, revision } = current();
  if (
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !Number.isSafeInteger(project.duration) ||
    project.duration < 1 ||
    project.duration > 100000
  )
    throw new Error('Invalid opacity binding source.');
  const plans = prepareRootOpacityBindings(
    project,
    bindings === undefined
      ? project.opacityBindings === undefined
        ? []
        : project.opacityBindings
      : bindings,
  );
  current();
  const timeline = createRememberedTimelineSampler(current);
  return {
    sample(frame: number) {
      current();
      const scene = timeline.sample(frame);
      for (const track of scene) {
        const byShape = plans.get(track.layerId);
        if (!byShape) continue;
        const artwork = new Map<string, Vector | null>();
        for (const shape of track.key.shapes)
          if (byShape.has(shape.id)) artwork.set(shape.id, artwork.has(shape.id) ? null : shape);
        for (const [id, list] of byShape) {
          let lo = 0,
            hi = list.length;
          while (lo < hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (list[mid].start <= frame) lo = mid + 1;
            else hi = mid;
          }
          const plan = list[lo - 1];
          if (!plan || frame > plan.end) continue;
          const target = artwork.get(id);
          if (!target || target.kind !== plan.kind || target.symbolId !== plan.symbolId)
            throw new Error('Sampled opacity target no longer matches its binding.');
          target.opacity = sampleCapturedOpacity(plan.keys, project.duration, frame);
        }
      }
      current();
      return scene;
    },
    dispose() {
      pinned = undefined;
      reader = undefined;
      plans.clear();
      timeline.dispose();
    },
  };
}
