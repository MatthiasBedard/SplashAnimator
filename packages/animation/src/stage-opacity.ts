import { keyAt, type Project } from '../../document/src';
import { prepareRootOpacityBindings } from '../../document/src/opacity-bindings';
import { sampleCapturedOpacity } from './opacity-track';

/** Frame-local, read-only view for painting authored artwork. The caller owns
 * invalidation when source bindings or exposures change. No artwork keys are inserted.
 */
export function createStageOpacityView(project: Project) {
  const plans = prepareRootOpacityBindings(project, project.opacityBindings ?? []);
  return (frame: number): Project => {
    if (!Number.isSafeInteger(frame) || frame < 0 || frame >= project.duration)
      throw new Error('Invalid stage opacity frame.');
    if (!plans.size) return project;
    let changed = false;
    const layers = project.layers.map((layer) => {
      const byShape = plans.get(layer.id);
      if (!layer.visible || !byShape) return layer;
      const key = keyAt(layer, frame);
      let different = false;
      const shapes = key.shapes.map((shape) => {
        const list = byShape.get(shape.id);
        if (!list) return shape;
        let lo = 0,
          hi = list.length;
        while (lo < hi) {
          const m = Math.floor((lo + hi) / 2);
          if (list[m].start <= frame) lo = m + 1;
          else hi = m;
        }
        const binding = list[lo - 1];
        if (!binding || binding.end < frame) return shape;
        const opacity = sampleCapturedOpacity(binding.keys, project.duration, frame);
        if (opacity === (shape.opacity ?? 1)) return shape;
        different = true;
        return { ...shape, opacity };
      });
      if (!different) return layer;
      changed = true;
      return { ...layer, keys: layer.keys.map((k) => (k === key ? { ...key, shapes } : k)) };
    });
    return changed ? { ...project, layers } : project;
  };
}
