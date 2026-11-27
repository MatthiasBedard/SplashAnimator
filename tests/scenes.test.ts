import { expect, it } from 'vitest';
import { newLayer, newProject, validateProject } from '../packages/document/src';
import { changeProjectScenes, projectScenes } from '../packages/document/src/scenes';
import { loadProject, saveProject, type DirectoryStore } from '../packages/document/src/storage';
import { symbolUsed } from '../packages/geometry/src/symbols';
import { exportHTML } from '../packages/export-web/src';

function fixture() {
  const project = newProject();
  project.layers[0].name = 'Opening artwork';
  project.layers[0].keys[0].shapes.push({
    id: 'title', kind: 'rectangle', x: 12, y: 30, width: 40, height: 20,
    rotation: 0, points: [], fill: '#ff0000', stroke: '#000000', strokeWidth: 0,
  });
  project.frameLabels = [{ frame: 4, name: 'Start' }];
  project.frameScripts = [{ frame: 4, source: '// Opening scene' }];
  project.multiFramePivot = { x: 10, y: 20 };
  return project;
}

function add(project: ReturnType<typeof newProject>) {
  return changeProjectScenes(project, {
    kind: 'add', id: 'second', data: { duration: 8, layers: [newLayer('Credits artwork')] },
  });
}

it('keeps timelines separate and restores the exact authored scene data', () => {
  const project = fixture();
  const second = validateProject(add(project));
  expect(projectScenes(project).activeId).toBe('main');
  expect(project.scenes).toBeUndefined();
  expect(second).toMatchObject({ id: project.id, schemaVersion: 61, duration: 8, width: project.width, fps: project.fps });
  expect(second.frameLabels).toBeUndefined();
  expect(second.frameScripts).toBeUndefined();
  expect(second.multiFramePivot).toBeUndefined();
  second.frameLabels = [{ frame: 4, name: 'Credits' }];
  second.frameScripts = [{ frame: 4, source: '// Credits scene' }];
  const opened = validateProject(changeProjectScenes(second, { kind: 'open', id: 'main' }));
  expect(opened.layers).toEqual(project.layers);
  expect(opened.frameLabels).toEqual(project.frameLabels);
  expect(opened.frameScripts).toEqual(project.frameScripts);
  expect(opened.multiFramePivot).toEqual(project.multiFramePivot);
  expect(validateProject(changeProjectScenes(opened, { kind: 'open', id: 'second' }))).toEqual(second);
});

it('renames, reorders, and deletes by stable identity without losing the remaining timeline', () => {
  let project = add(fixture());
  project = changeProjectScenes(project, { kind: 'rename', id: 'second', name: ' Credits ' });
  project = changeProjectScenes(project, { kind: 'move', id: 'second', direction: -1 });
  expect(project.scenes!.entries.map(({ id, name }) => [id, name])).toEqual([
    ['second', 'Credits'], ['main', 'Scene 1'],
  ]);
  const remaining = changeProjectScenes(project, { kind: 'delete', id: 'second' });
  expect(remaining.scenes!.activeId).toBe('main');
  expect(remaining.layers[0].name).toBe('Opening artwork');
  expect(() => changeProjectScenes(remaining, { kind: 'delete', id: 'main' })).toThrow('Keep at least one scene');
  expect(project.scenes!.activeId).toBe('second');
});

it('checks inactive scene ownership and artwork before admitting projects', () => {
  const project = fixture();
  const next = add(project);
  const inactive = next.scenes!.entries[0].data!;
  inactive.layers[0].keys[0].shapes[0].width = NaN;
  expect(() => validateProject(next)).toThrow();
  inactive.layers[0].keys[0].shapes[0].width = 40;
  Object.defineProperty(inactive, 'duration', { get() { throw Error('accessed'); } });
  expect(() => validateProject(next)).toThrow('Invalid scene field');
  const duplicate = add(fixture());
  duplicate.scenes!.entries[0].id = 'second';
  expect(() => validateProject(duplicate)).toThrow();
});

it('finds library symbols used only in an inactive scene', () => {
  const project = fixture();
  project.layers[0].keys[0].shapes[0] = {
    ...project.layers[0].keys[0].shapes[0], kind: 'symbol', symbolId: 'title-symbol',
  };
  expect(symbolUsed(add(project), 'title-symbol')).toBe(true);
});

it('exports just the open scene, with the same output as its standalone timeline', () => {
  const opening = fixture();
  const next = validateProject(add(opening));
  const standalone = { ...next };
  delete standalone.scenes;
  expect(exportHTML(next)).toBe(exportHTML(standalone));
  const returned = changeProjectScenes(next, { kind: 'open', id: 'main' });
  const returnedHTML = exportHTML(returned);
  expect(returnedHTML).toContain('Opening artwork');
  expect(returnedHTML).not.toContain('Credits artwork');
  expect(returnedHTML).not.toContain('// Opening scene');
});

it('round-trips the catalog through directory storage and keeps legacy saves catalog-free', async () => {
  const files = new Map<string, string>();
  const store: DirectoryStore = {
    async read(path) {
      if (!files.has(path)) throw Error('Missing ' + path);
      return files.get(path)!;
    },
    async exists(path) { return files.has(path); },
    async writeNew(path, data) { files.set(path, data); },
    async commit(path, data, expected) {
      expect(files.get(path) ?? null).toBe(expected);
      files.set(path, data);
    },
  };
  const before = fixture();
  const legacy = await saveProject(store, before, null);
  expect(JSON.parse(legacy)).not.toHaveProperty('sceneCatalog');
  expect((await loadProject(store)).project).toEqual(before);
  const next = changeProjectScenes(add(before), { kind: 'rename', id: 'second', name: 'Credits' });
  const saved = JSON.parse(await saveProject(store, next, legacy));
  expect(saved).toMatchObject({ schemaVersion: 61, sceneCatalog: expect.stringMatching(/^scenes\/catalog-/) });
  expect(JSON.parse(files.get(saved.scene)!)).toMatchObject({ id: 'second', name: 'Credits' });
  expect((await loadProject(store)).project).toEqual(next);
  files.set(saved.scene, JSON.stringify({ id: 'main', name: 'Scene 1', timeline: saved.timeline }));
  await expect(loadProject(store)).rejects.toThrow('Open scene does not match its catalog');
});
