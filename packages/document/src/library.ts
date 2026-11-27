import type { Project } from './index';
export type LibraryFolder = { id: string; name: string; parentId?: string };
export type LibraryItemKind = 'symbol' | 'bitmap' | 'audio';
export type LibraryLocation = { kind: LibraryItemKind; id: string; folderId: string };
export type LibraryLink = { kind: LibraryItemKind; id: string; name: string };
export function libraryLinkName(project: Project, kind: LibraryItemKind, id: string): string {
  return project.libraryLinks?.find((link) => link.kind === kind && link.id === id)?.name ?? '';
}
export function setLibraryLink(
  project: Project,
  kind: LibraryItemKind,
  id: string,
  name: string,
): void {
  validateLibraryOrganization(project);
  if (!['symbol', 'bitmap', 'audio'].includes(kind) || !id || typeof name !== 'string')
    throw Error('Choose an original library item and link name.');
  const links = (project.libraryLinks ?? []).filter((link) => link.kind !== kind || link.id !== id);
  if (name) links.push({ kind, id, name });
  validateLibraryOrganization({ ...project, libraryLinks: links });
  project.libraryLinks = links;
}
export function suggestLibraryLink(project: Project, name: string): string {
  let base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[^A-Za-z0-9_$]/g, '_');
  if (!/^[A-Za-z_$]/.test(base)) base = 'item_' + base;
  if (['constructor', 'prototype', '__proto__'].includes(base)) base = 'item_' + base;
  base = base.slice(0, 180) || 'item';
  let result = base,
    i = 2;
  while (project.libraryLinks?.some((link) => link.name === result)) result = base + '_' + i++;
  return result;
}
/** Explicit code lookup. Names are aliases, never rendering/asset identities. */
export function resolveLibraryLink(project: Project, name: string) {
  validateLibraryOrganization(project);
  const link = project.libraryLinks?.find((link) => link.name === name);
  if (link?.kind === 'symbol') {
    const symbol = project.symbols?.find((symbol) => symbol.id === link.id);
    if (symbol) return { kind: 'symbol' as const, symbol };
  } else if (link?.kind === 'bitmap') {
    const asset = project.assets.find((asset) => asset.id === link.id && asset.bitmap);
    if (asset) return { kind: 'bitmap' as const, asset };
  } else if (link?.kind === 'audio') {
    const asset = project.assets.find((asset) => asset.id === link.id && asset.audio);
    if (asset) return { kind: 'audio' as const, asset };
  }
  throw Error('No library item has link name ' + name + '.');
}
export function libraryItemFolder(project: Project, kind: LibraryItemKind, id: string): string {
  return project.libraryItems?.find((item) => item.kind === kind && item.id === id)?.folderId ?? '';
}
function own(value: object, key: string): unknown {
  const field = Object.getOwnPropertyDescriptor(value, key);
  if ((!field && key in value) || (field && (!field.enumerable || !('value' in field))))
    throw Error('Library organization requires original own data fields.');
  return field?.value;
}
function title(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name.trim() || name.length > 200)
    throw Error('Enter a library folder name from 1 to 200 characters.');
}
/** Optional authoring organization only; rendering identities and asset paths stay exact. */
export function validateLibraryOrganization(project: Pick<Project, 'libraryLinks' | 'libraryItems' | 'libraryFolders'>): void {
  const rawLinks = own(project, 'libraryLinks');
  if (rawLinks !== undefined) {
    if (
      !Array.isArray(rawLinks) ||
      Object.getPrototypeOf(rawLinks) !== Array.prototype ||
      Reflect.ownKeys(rawLinks).length !== rawLinks.length + 1
    )
      throw Error('Library links require a dense original list.');
    const names = new Set<string>(),
      items = new Set<string>();
    for (let i = 0; i < rawLinks.length; i++) {
      const link = own(rawLinks, String(i)) as LibraryLink;
      if (
        !link ||
        typeof link !== 'object' ||
        Array.isArray(link) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(link)) ||
        Reflect.ownKeys(link).length !== 3
      )
        throw Error('Invalid library link.');
      const kind = own(link, 'kind'),
        id = own(link, 'id'),
        name = own(link, 'name');
      if (
        !['symbol', 'bitmap', 'audio'].includes(kind as string) ||
        typeof id !== 'string' ||
        !id ||
        id.length > 200 ||
        typeof name !== 'string' ||
        name.length > 200 ||
        !/^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(name) ||
        name.split('.').some((part) => ['constructor', 'prototype', '__proto__'].includes(part))
      )
        throw Error('Use a code identifier for the link name, such as Hero or characters.Hero.');
      if (names.has(name) || items.has(kind + ':' + id))
        throw Error('Library link names must be unique.');
      names.add(name);
      items.add(kind + ':' + id);
    }
  }
  const raw = own(project, 'libraryFolders');
  const folders = raw === undefined ? [] : (raw as LibraryFolder[]);
  if (
    !Array.isArray(folders) ||
    Object.getPrototypeOf(folders) !== Array.prototype ||
    folders.length > 10000 ||
    Reflect.ownKeys(folders).some(
      (k) =>
        k !== 'length' &&
        (typeof k !== 'string' || !/^(0|[1-9]\d*)$/.test(k) || Number(k) >= folders.length),
    )
  )
    throw Error('Invalid library folder list.');
  const byId = new Map<string, LibraryFolder>(),
    names = new Set<string>();
  for (let i = 0; i < folders.length; i++) {
    const f = own(folders, String(i)) as LibraryFolder | undefined;
    if (
      !f ||
      typeof f !== 'object' ||
      Array.isArray(f) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(f)) ||
      Reflect.ownKeys(f).some((k) => !['id', 'name', 'parentId'].includes(String(k)))
    )
      throw Error('Invalid library folder.');
    const id = own(f, 'id'),
      name = own(f, 'name'),
      parent = own(f, 'parentId');
    title(name);
    if (
      typeof id !== 'string' ||
      !id ||
      id.length > 200 ||
      byId.has(id) ||
      (parent !== undefined && (typeof parent !== 'string' || !parent))
    )
      throw Error('Invalid library folder identity.');
    const key = JSON.stringify([parent ?? '', name.trim().toLowerCase()]);
    if (names.has(key)) throw Error('A folder with that name already exists here.');
    names.add(key);
    byId.set(id, f);
  }
  const done = new Set<string>();
  for (const f of byId.values()) {
    let current: LibraryFolder | undefined = f;
    const path = new Set<string>();
    while (current && !done.has(current.id)) {
      if (path.has(current.id)) throw Error('Library folders cannot contain themselves.');
      path.add(current.id);
      if (current.parentId !== undefined && !byId.has(current.parentId))
        throw Error('Missing parent library folder.');
      current = current.parentId === undefined ? undefined : byId.get(current.parentId);
    }
    path.forEach((id) => done.add(id));
  }
  const locations = own(project, 'libraryItems');
  if (locations !== undefined) {
    if (
      !Array.isArray(locations) ||
      locations.length > 10000 ||
      Object.getPrototypeOf(locations) !== Array.prototype ||
      Reflect.ownKeys(locations).some(
        (k) =>
          k !== 'length' &&
          (typeof k !== 'string' || !/^(0|[1-9]\d*)$/.test(k) || Number(k) >= locations.length),
      )
    )
      throw Error('Invalid library item list.');
    const seen = new Set<string>();
    for (let i = 0; i < locations.length; i++) {
      const item = own(locations, String(i)) as LibraryLocation;
      if (
        !item ||
        typeof item !== 'object' ||
        Array.isArray(item) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(item)) ||
        Reflect.ownKeys(item).some((k) => !['kind', 'id', 'folderId'].includes(String(k)))
      )
        throw Error('Invalid library item location.');
      const kind = own(item, 'kind'),
        id = own(item, 'id'),
        folder = own(item, 'folderId');
      if (
        (kind !== 'symbol' && kind !== 'bitmap' && kind !== 'audio') ||
        typeof id !== 'string' ||
        !id ||
        id.length > 200 ||
        typeof folder !== 'string' ||
        !byId.has(folder)
      )
        throw Error('Invalid or missing item library folder.');
      const key = JSON.stringify([kind, id]);
      if (seen.has(key)) throw Error('Duplicate library item location.');
      // Organization is not a rendering reference graph. Detached artwork-only
      // validators may omit unused library items; missing IDs simply have no row.
      seen.add(key);
    }
  }
}
export function setLibraryFolder(project: Project, folder: LibraryFolder): void {
  validateLibraryOrganization(project);
  title(folder.name);
  const next = [
    ...(project.libraryFolders ?? []).filter((f) => f.id !== folder.id),
    { ...folder, name: folder.name.trim() },
  ];
  validateLibraryOrganization({ ...project, libraryFolders: next });
  project.libraryFolders = next;
}
export function moveLibraryItem(
  project: Project,
  kind: LibraryItemKind,
  id: string,
  folderId?: string,
): void {
  validateLibraryOrganization(project);
  if (folderId !== undefined && !project.libraryFolders?.some((f) => f.id === folderId))
    throw Error('Missing destination library folder.');
  const item =
    kind === 'symbol'
      ? project.symbols?.find((s) => s.id === id)
      : project.assets.find((a) => a.id === id && (kind === 'audio' ? a.audio : a.bitmap));
  if (!item) throw Error('Library item no longer exists.');
  const locations = (project.libraryItems ?? []).filter(
    (entry) => entry.kind !== kind || entry.id !== id,
  );
  if (folderId !== undefined) locations.push({ kind, id, folderId });
  project.libraryItems = locations;
}
/** Remove the container, never its artwork; children and items move to its parent. */
export function removeLibraryFolder(project: Project, id: string): void {
  validateLibraryOrganization(project);
  const folder = project.libraryFolders?.find((f) => f.id === id);
  if (!folder) throw Error('Library folder no longer exists.');
  const folders = project
    .libraryFolders!.filter((f) => f.id !== id)
    .map((f) => {
      if (f.parentId !== id) return f;
      const next = { ...f };
      delete next.parentId;
      if (folder.parentId !== undefined) next.parentId = folder.parentId;
      return next;
    });
  const next = {
    ...project,
    libraryFolders: folders,
    libraryItems: (project.libraryItems ?? []).flatMap((item) =>
      item.folderId !== id
        ? [item]
        : folder.parentId
          ? [{ ...item, folderId: folder.parentId }]
          : [],
    ),
  };
  validateLibraryOrganization(next);
  project.libraryFolders = next.libraryFolders;
  project.libraryItems = next.libraryItems;
}
export function libraryFolderPaths(project: Project): { id: string; path: string }[] {
  const byId = new Map((project.libraryFolders ?? []).map((f) => [f.id, f]));
  const paths = new Map<string, string>();
  for (const f of byId.values()) {
    const chain: LibraryFolder[] = [],
      seen = new Set<string>();
    let current: LibraryFolder | undefined = f;
    while (current && !paths.has(current.id)) {
      if (seen.has(current.id)) throw Error('Library folder cycle.');
      seen.add(current.id);
      chain.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    let path = current ? paths.get(current.id)! : '';
    for (const folder of chain.reverse()) {
      path = path ? `${path} / ${folder.name}` : folder.name;
      paths.set(folder.id, path);
    }
  }
  return [...paths]
    .map(([id, path]) => ({ id, path }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
