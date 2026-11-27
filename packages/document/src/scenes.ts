import type { Project } from './index';

const sceneFields = [
  'layers', 'duration', 'folders', 'layerMasks', 'guides', 'frameLabels', 'frameComments',
  'frameScripts', 'audioClips', 'opacityBindings', 'multiFramePivot',
] as const;

export type SceneData = Pick<Project, (typeof sceneFields)[number]>;
/** The active scene lives on Project itself. Only inactive scenes carry data in the catalog. */
export type SceneCatalog = { activeId: string; entries: { id: string; name: string; data?: SceneData }[] };
export type SceneCommand =
  | { kind: 'add'; id: string; data: SceneData }
  | { kind: 'open'; id: string }
  | { kind: 'delete'; id: string }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'move'; id: string; direction: -1 | 1 };

export function projectScenes(project: Project): SceneCatalog {
  return project.scenes ?? { activeId: 'main', entries: [{ id: 'main', name: 'Scene 1' }] };
}

function sceneData(project: Project): SceneData {
  return Object.fromEntries(sceneFields.filter(field => project[field] !== undefined)
    .map(field => [field, project[field]])) as SceneData;
}

export function projectWithSceneData(project: Project, data: SceneData): Project {
  const next = { ...project };
  // Clear optional scene fields too, so a scene cannot inherit another scene's masks or audio.
  for (const field of sceneFields) Reflect.deleteProperty(next, field);
  return Object.assign(next, data);
}

export function* projectSceneData(project: Project): Iterable<SceneData> {
  yield project;
  for (const scene of project.scenes?.entries ?? []) if (scene.data) yield scene.data;
}

/** Check identities and original scene data before projecting it onto the document validator. */
export function validateSceneCatalog(project: Project): void {
  const descriptor = Object.getOwnPropertyDescriptor(project, 'scenes');
  if (!descriptor && !('scenes' in project)) return;
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || project.schemaVersion !== 61)
    throw Error('Scene catalogs require schema 61.');
  const catalog = plainRecord(descriptor.value, ['activeId', 'entries']);
  if (typeof catalog.activeId !== 'string' || !Array.isArray(catalog.entries) || catalog.entries.length === 0)
    throw Error('Invalid scene catalog.');
  const ids = new Set<string>();
  for (let i = 0; i < catalog.entries.length; i++) {
    const item = Object.getOwnPropertyDescriptor(catalog.entries, String(i));
    const entry = plainRecord(item && 'value' in item ? item.value : undefined, ['id', 'name', 'data']);
    const { id, name, data } = entry;
    if (typeof id !== 'string' || !id || id.length > 200 || ids.has(id) ||
        typeof name !== 'string' || !name.trim() || name.length > 200)
      throw Error('Invalid scene identity or name.');
    ids.add(id);
    if (id === catalog.activeId) {
      if ('data' in entry) throw Error('The open scene already owns the project timeline.');
    } else {
      plainRecord(data, sceneFields);
    }
  }
  if (!ids.has(catalog.activeId)) throw Error('The open scene is missing.');
}

function plainRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![null, Object.prototype].includes(Object.getPrototypeOf(value)))
    throw Error('Invalid scene data.');
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== 'string' || !allowed.includes(key) || !field.enumerable || !('value' in field))
      throw Error('Invalid scene field.');
  }
  return value as Record<string, unknown>;
}

export function changeProjectScenes(project: Project, command: SceneCommand): Project {
  const { activeId, entries } = projectScenes(project);
  const next = entries.slice();
  const at = next.findIndex(scene => scene.id === command.id);
  let active = activeId, result = project;

  if (command.kind === 'add') {
    if (at >= 0) throw Error('Scene ID already exists.');
    const names = new Set(entries.map(scene => scene.name));
    let number = entries.length + 1;
    while (names.has(`Scene ${number}`)) number++;
    next.push({ id: command.id, name: `Scene ${number}`, data: command.data });
    active = command.id;
  } else {
    if (at < 0) throw Error('Scene no longer exists.');
    if (command.kind === 'open') {
      if (active === command.id) return project;
      active = command.id;
    } else if (command.kind === 'delete') {
      if (next.length === 1) throw Error('Keep at least one scene.');
      next.splice(at, 1);
      if (active === command.id) active = next[Math.min(at, next.length - 1)].id;
    } else if (command.kind === 'rename') {
      const name = command.name.trim();
      if (!name || name.length > 200) throw Error('Enter a scene name from 1 to 200 characters.');
      if (name === next[at].name) return project;
      next[at] = { ...next[at], name };
    } else {
      const to = at + command.direction;
      if (to < 0 || to >= next.length) return project;
      [next[at], next[to]] = [next[to], next[at]];
    }
  }

  if (active !== activeId) {
    const previous = next.findIndex(scene => scene.id === activeId);
    if (previous !== -1) next[previous] = { ...next[previous], data: sceneData(project) };
    const incoming = next.findIndex(scene => scene.id === active);
    const { data, ...entry } = next[incoming];
    if (!data) throw Error('The selected scene has no timeline.');
    result = projectWithSceneData(project, data);
    next[incoming] = entry;
  }

  return { ...result, schemaVersion: 61, scenes: { activeId: active, entries: next } };
}
