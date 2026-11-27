import { type Project, keyAt, validateProject } from '../../../packages/document/src';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import { selectionTrajectoryStamp } from '../../../packages/animation/src/selection-trajectory';
import { prepareTimelineTween, timelineTweenRange, type TweenKind } from './timeline-tween';

const preparing = new WeakMap<Project, { invalid: boolean }>();
/** Immediate context conversion, separate from optional detailed settings. */
export function prepareAutomaticTimelineTween(
  project: Project,
  layerId: string,
  at: number,
  kind: TweenKind,
  selected?: { start: number; end: number },
  validate: () => void = () => {},
  symbolId?: string,
) {
  const prior = preparing.get(project);
  if (prior) {
    prior.invalid = true;
    throw Error('Automatic tween conversion cannot reenter.');
  }
  const entry = { invalid: false };
  preparing.set(project, entry);
  try {
    validateLiveGraphicData(project);
    validateLiveGraphicData({ layerId, at, kind, selected });
    validateProject(project);
    if (
      typeof layerId !== 'string' ||
      !Number.isSafeInteger(at) ||
      at < 0 ||
      at >= project.duration ||
      !['motion', 'shape'].includes(kind)
    )
      throw Error('Choose an original timeline frame and tween type.');
    if (
      selected &&
      (!Number.isSafeInteger(selected.start) ||
        !Number.isSafeInteger(selected.end) ||
        selected.start < 0 ||
        selected.end < selected.start ||
        selected.end >= project.duration)
    )
      throw Error('Choose a valid timeline selection.');
    const stamp = selectionTrajectoryStamp(project),
      input = selectionTrajectoryStamp({ layerId, at, kind, selected });
    const current = () => {
      const result = validate() as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('Tween admission must be synchronous.');
      }
      if (
        entry.invalid ||
        selectionTrajectoryStamp(project) !== stamp ||
        selectionTrajectoryStamp({ layerId, at, kind, selected }) !== input
      )
        throw Error('Original tween source or selection changed.');
    };
    const candidate = structuredClone(project);
    current();
    if (selectionTrajectoryStamp(candidate) !== stamp)
      throw Error('Original tween snapshot changed.');
    const layer = candidate.layers.find((l) => l.id === layerId);
    if (!layer || layer.locked || !layer.visible) throw Error('Choose a visible, unlocked layer.');
    let range = timelineTweenRange(candidate, layerId, at, selected);
    const existing = [...(layer.liveMotionSpans ?? []), ...(layer.motionSpans ?? [])].find(
      (s) => s.start === range.start && s.end === range.end,
    );
    if (!existing && (!selected || selected.end - selected.start < 2)) {
      const held = keyAt(layer, at),
        next = layer.keys.find((k) => k.frame > at);
      range = {
        start: held.frame,
        end: next ? (next.shapes.length ? next.frame : next.frame - 1) : candidate.duration - 1,
      };
      if (kind === 'shape' && !next && range.end - range.start < 2) {
        range.end = range.start + Math.max(2, Math.round(candidate.fps) - 1);
        candidate.duration = range.end + 1;
      }
    }
    if (kind === 'motion' && !existing && !layer.keys.find(key => key.frame === range.end)?.shapes.length) {
      // A held exposure owns the open tween. Its artwork and timing stay held
      // until the user authors another key.
      range = { ...range, start: keyAt(layer, range.start).frame };
    }
    if (
      existing &&
      kind === (existing.options?.nodes || existing.options?.primitives ? 'shape' : 'motion') &&
      (symbolId !== undefined || (kind === 'shape' &&
        typeof existing.correspondence?.nodes === 'object' &&
        existing.correspondence.nodes.shapes === true) ||
        (keyAt(layer, range.start).shapes.length === 1 &&
          keyAt(layer, range.start).shapes[0].kind === 'symbol'))
    ) {
      current();
      return candidate;
    }
    const open = kind === 'motion' ? keyAt(layer, range.start).openMotionTween : undefined;
    const result = prepareTimelineTween(
      candidate,
      layerId,
      {
        ...range,
        kind,
        affine: existing ? (existing.options?.affine ?? false) : (open?.affine ?? true),
        createEndpoints: kind === 'shape',
        ease: structuredClone(existing?.ease ?? open?.ease ?? 'linear'),
        ...(kind === 'motion' && symbolId === undefined ? { symbolize: true } : {}),
      },
      current,
      symbolId,
    );
    const output = selectionTrajectoryStamp(result);
    validateLiveGraphicData(result);
    validateProject(result);
    current();
    if (selectionTrajectoryStamp(result) !== output)
      throw Error('Prepared tween candidate changed.');
    return result;
  } finally {
    preparing.delete(project);
  }
}
