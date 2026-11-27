import { keyAt, symbolLayers, validateProject, type Project, type Vector } from '../../../packages/document/src';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import { selectionTrajectoryStamp as stamp } from '../../../packages/animation/src/selection-trajectory';
import {
  nestedSymbolEditContext,
  symbolEditContext,
  type SymbolEditContext,
} from '../../../packages/geometry/src/symbol-context';
import {
  snapshotSymbolSimplifyLocation,
  type SymbolSimplifyLocation,
} from '../../../packages/geometry/src/symbol-simplify-artwork';

export type SymbolStagePath = {
  layerId: string;
  instanceId: string;
  frame: number;
  groups?: string[];
  children: { instanceId: string; location?: SymbolSimplifyLocation; groups?: string[] }[];
};
function fields(value: object, keys: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw Error('Choose an original symbol stage path.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== keys.length ||
    keys.some((key) => !descriptors[key]?.enumerable || !('value' in descriptors[key]))
  )
    throw Error('Symbol stage path requires original data fields.');
  return descriptors;
}
function groupPath(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const length = Object.getOwnPropertyDescriptor(value, 'length')!.value;
  return Array.from({ length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index))?.value);
}
export function admitSymbolGroup(instance: Vector | undefined, captured: unknown) {
  const groups = groupPath(captured);
  const original = groupPath(instance && Object.getOwnPropertyDescriptor(instance, 'groups')?.value);
  if (!groups.length || groups.length !== original.length ||
      groups.some((group, i) => typeof group !== 'string' || group !== original[i]))
    throw Error('The original symbol is outside the captured group.');
}
/** Reconstruct only original root-instance/ancestor ownership. Rendered context
 * and proposed artwork never select a definition or nested instance. */
export function admitSymbolStageContext(
  project: Project,
  path: SymbolStagePath,
  symbolId: string,
  context: SymbolEditContext,
): void {
  validateLiveGraphicData({ project, path, context });
  const source = stamp([project, path, context]);
  validateProject(project);
  const root = fields(path, ['layerId', 'instanceId', 'frame', 'children', ...(Object.hasOwn(path, 'groups') ? ['groups'] : [])]),
    layerId = root.layerId.value,
    instanceId = root.instanceId.value,
    frame = root.frame.value,
    children = root.children.value;
  if (
    typeof layerId !== 'string' ||
    !layerId ||
    typeof instanceId !== 'string' ||
    !instanceId ||
    typeof frame !== 'number' ||
    !Number.isSafeInteger(frame) ||
    frame < 0 ||
    frame >= project.duration ||
    !Array.isArray(children)
  )
    throw Error('Choose an original stage instance and integer frame.');
  const layer = project.layers.find((l) => l.id === layerId),
    instance = layer && keyAt(layer, frame).shapes.find((s) => s.id === instanceId);
  if (root.groups) admitSymbolGroup(instance, root.groups.value);
  let definition = project.symbols?.find((s) => s.id === instance?.symbolId),
    resolved = symbolEditContext(project, layerId, instanceId, frame);
  for (const child of children) {
    if (!definition) throw Error('Original enclosing definition disappeared.');
    const keys = Object.hasOwn(child, 'location') ? ['instanceId', 'location'] : ['instanceId'],
      own = fields(child, Object.hasOwn(child, 'groups') ? [...keys, 'groups'] : keys),
      id = own.instanceId.value,
      location =
        own.location?.value === undefined
          ? undefined
          : snapshotSymbolSimplifyLocation(own.location.value);
    if (typeof id !== 'string' || !id) throw Error('Choose an original nested instance.');
    const track = location
      ? symbolLayers(definition).find((l) => l.id === location.layerId)
      : undefined;
    const artwork = location && track ? keyAt(track, location.frame).shapes : definition.shapes;
    const nested = artwork.find((s) => s.id === id);
    if (own.groups) admitSymbolGroup(nested, own.groups.value);
    resolved = nestedSymbolEditContext(resolved, definition, id, project.symbols ?? [], location);
    definition = project.symbols?.find((s) => s.id === nested?.symbolId);
  }
  if (
    !definition ||
    definition.id !== symbolId ||
    stamp(resolved) !== stamp(context) ||
    stamp([project, path, context]) !== source
  )
    throw Error(
      'Original stage ancestry or captured context changed. Cancel and reopen symbol editing.',
    );
}
