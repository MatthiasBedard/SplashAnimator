import type { Project } from '../../document/src';
import { parseDynamicTextTarget } from '../../document/src/dynamic-text';

/** Resolve names against original scene placements before expanding any descendants. */
export function captureDynamicTextOwners(
  project: Project,
  values: Record<string, string> | undefined,
  replayKeys: Iterable<string> = [],
) {
  const requested = new Set<string>();
  for (const keys of [Object.keys(values ?? {}), replayKeys])
    for (const key of keys) {
      const target = parseDynamicTextTarget(key);
      if (target) requested.add(target[0]);
    }
  if (!requested.size) return;
  const identities = new Map<string, string>();
  const tagged = new Map<string, string>();
  const exposure = (layer: string, frame: number, id: string) => JSON.stringify([layer, frame, id]);
  for (const layer of project.layers)
    for (const key of layer.keys)
      for (const shape of key.shapes) {
        const name = shape.instanceName;
        if (shape.kind !== 'symbol' || name === undefined || !requested.has(name)) continue;
        const identity = JSON.stringify([layer.id, shape.id, shape.symbolId]);
        const previous = identities.get(name);
        if (previous !== undefined && previous !== identity)
          throw Error(`Dynamic text instance name is ambiguous: ${name}`);
        identities.set(name, identity);
        tagged.set(exposure(layer.id, key.frame, shape.id), name);
      }
  for (const name of requested)
    if (!identities.has(name)) throw Error(`Dynamic text instance name is missing: ${name}`);
  return (layer: string, frame: number, id: string) => tagged.get(exposure(layer, frame, id));
}
