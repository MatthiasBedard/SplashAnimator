import { clone, id, validateProject, type Project, type Layer } from '@splash/document';
export function folderPath(project: Project, folderId?: string): string[] {
  const result: string[] = [];
  let current = folderId;
  while (current && result.length < 8) {
    const f = project.folders?.find((f) => f.id === current);
    if (!f) break;
    result.unshift(f.id);
    current = f.parentId;
  }
  return result;
}
export function folderLabel(project: Project, folderId?: string): string {
  return folderPath(project, folderId)
    .map((id) => project.folders!.find((f) => f.id === id)!.name)
    .join(' / ');
}
export function folderEdit(project: Project, fn: (next: Project) => void) {
  const next = clone(project);
  fn(next);
  validateProject(next);
  project.folders = next.folders;
  project.layers = next.layers;
}
export function createFolder(project: Project, name: string, parentId?: string): string {
  const folderId = id();
  folderEdit(project, (next) => {
    next.folders ??= [];
    next.folders.push({ id: folderId, name, parentId });
  });
  return folderId;
}
export function updateFolder(project: Project, folderId: string, name: string, parentId?: string) {
  folderEdit(project, (next) => {
    const f = next.folders?.find((f) => f.id === folderId);
    if (!f) throw new Error('Folder missing.');
    f.name = name;
    f.parentId = parentId;
  });
}
export function assignFolder(project: Project, layerId: string, folderId?: string) {
  folderEdit(project, (next) => {
    const l = next.layers.find((l) => l.id === layerId);
    if (!l) throw new Error('Layer missing.');
    l.folderId = folderId;
  });
}
export function removeFolder(project: Project, folderId: string) {
  folderEdit(project, (next) => {
    const f = next.folders?.find((f) => f.id === folderId);
    if (!f) throw new Error('Folder missing.');
    for (const l of next.layers) if (l.folderId === folderId) l.folderId = f.parentId;
    for (const child of next.folders!) if (child.parentId === folderId) child.parentId = f.parentId;
    next.folders = next.folders!.filter((f) => f.id !== folderId);
  });
}
export function folderMembers(project: Project, folderId: string) {
  return project.layers.filter((l) => folderPath(project, l.folderId).includes(folderId));
}

export type FolderRow = Layer & { folderRowId?: string };
/** Tree presentation only. Rendering continues to use the unmodified layer stack. */
export function folderRows(project: Project, collapsed: readonly string[] = []): FolderRow[] {
  const rows: FolderRow[] = [];
  const visit = (parentId?: string) => {
    for (const f of project.folders ?? []) {
      if (f.parentId !== parentId) continue;
      rows.push({
        id: 'folder:' + f.id,
        folderRowId: f.id,
        name: f.name,
        visible: true,
        locked: false,
        keys: [],
      });
      if (!collapsed.includes(f.id)) visit(f.id);
    }
    rows.push(...[...project.layers].reverse().filter((l) => l.folderId === parentId));
  };
  visit();
  return rows;
}

/** Reorder sibling folder headers without changing global paint order. */
export function orderFolder(project: Project, folderId: string, direction: -1 | 1) {
  const folders = project.folders ?? [],
    index = folders.findIndex((f) => f.id === folderId);
  if (index < 0) throw new Error('Folder missing.');
  const siblings = folders.filter((f) => f.parentId === folders[index].parentId);
  const adjacent = siblings[siblings.findIndex((f) => f.id === folderId) + direction];
  if (!adjacent) return;
  const other = folders.findIndex((f) => f.id === adjacent.id);
  [folders[index], folders[other]] = [folders[other], folders[index]];
}
/** Move all descendant layers as a stable block in the actual paint stack. */
export function positionFolder(project: Project, folderId: string, edge: 'top' | 'bottom') {
  if (!project.folders?.some((f) => f.id === folderId)) throw new Error('Folder missing.');
  const members = folderMembers(project, folderId);
  if (members.some((l) => l.locked))
    throw new Error('Unlock all folder layers before changing their stack order.');
  const ids = new Set(members.map((l) => l.id));
  const rest = project.layers.filter((l) => !ids.has(l.id));
  project.layers = edge === 'top' ? [...rest, ...members] : [...members, ...rest];
}
