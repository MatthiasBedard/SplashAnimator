export const PANEL_CATALOG = [
  ['symbol-instance', 'Symbol instance'],
  ['effects', 'Effects'],
  ['keyframe', 'Keyframe'],
  ['frames', 'Frame range'],
  ['live', 'Tween controls'],
  ['transform', 'Transform'],
  ['group', 'Group selection'],
  ['hierarchy', 'Group hierarchy'],
  ['opacity', 'Opacity channel'],
  ['junction', 'Shared motion endpoint'],
  ['eyedropper', 'Eyedropper'],
  ['brush', 'Brush'],
  ['anchors', 'Anchors'],
  ['lasso', 'Lasso'],
  ['pen', 'Bézier pen'],
  ['bucket', 'Paint bucket'],
  ['eraser', 'Eraser'],
  ['rounded', 'Rounded rectangle'],
  ['star', 'Polystar'],
  ['pencil', 'Pencil'],
  ['align', 'Align and distribute'],
  ['position', 'Position and size'],
  ['paint', 'Fill and stroke'],
  ['color', 'Color'],
  ['pressure', 'Pressure profile'],
  ['text', 'Static text'],
  ['bitmap', 'Bitmap paint'],
  ['path', 'Editable path'],
  ['document', 'Document settings'],
  ['layer', 'Layer'],
  ['defaults', 'Drawing defaults'],
  ['library', 'Library'],
] as const;
export type PanelId = (typeof PANEL_CATALOG)[number][0];
export interface PanelGroup {
  id: string;
  panels: PanelId[];
  active: PanelId;
}
export interface PanelLayout {
  sizes?: Partial<import('./workspace-sizes').WorkspaceSizes>;
  version: 1;
  sidebarVisible: boolean;
  sidebarCollapsed?: boolean;
  sidebarDock?: 'left' | 'right';
  hidden: PanelId[];
  collapsed: PanelId[];
  groups: PanelGroup[];
}
export const PANEL_LAYOUT_KEY = 'splash-panel-layout-v1';
export const defaultPanelLayout = (): PanelLayout => ({
  version: 1,
  sidebarVisible: true,
  hidden: [],
  collapsed: [],
  groups: [],
});
const known = (id: unknown): id is PanelId =>
  PANEL_CATALOG.some(([key]) => key === id) || id === 'symbols' || id === 'bitmaps';
export function readPanelLayout(value: string | null, strict = false): PanelLayout {
  try {
    const data = JSON.parse(value ?? '') as PanelLayout;
    if (
      data.sizes !== undefined &&
      (!data.sizes ||
        typeof data.sizes !== 'object' ||
        Array.isArray(data.sizes) ||
        Object.entries(data.sizes).some(
          ([key, value]) =>
            !['tools', 'inspector', 'timeline'].includes(key) ||
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value < 1 ||
            value > 10000,
        ))
    )
      throw Error('Invalid workspace sizes.');
    const validList = (list: unknown): list is PanelId[] =>
      Array.isArray(list) && list.every(known) && new Set(list).size === list.length;
    if (
      data.version !== 1 ||
      typeof data.sidebarVisible !== 'boolean' ||
      (data.sidebarCollapsed !== undefined && typeof data.sidebarCollapsed !== 'boolean') ||
      (data.sidebarDock !== undefined && data.sidebarDock !== 'left' && data.sidebarDock !== 'right') ||
      !validList(data.hidden) ||
      !validList(data.collapsed) ||
      !Array.isArray(data.groups)
    )
      throw Error();
    const members = new Set<PanelId>(),
      ids = new Set<string>();
    for (const group of data.groups) {
      if (
        !group ||
        typeof group.id !== 'string' ||
        !/^g\d+$/.test(group.id) ||
        ids.has(group.id) ||
        !validList(group.panels) ||
        group.panels.length < 2 ||
        !group.panels.includes(group.active)
      )
        throw Error();
      ids.add(group.id);
      for (const id of group.panels) {
        if (members.has(id)) throw Error();
        members.add(id);
      }
    }
    // Older workspaces had two library panels. Preserve unrelated preferences
    // and coalesce both old IDs into one reachable Library tab.
    const canonical = (id: PanelId): PanelId =>
      ['symbols', 'bitmaps'].includes(id) ? 'library' : id;
    const unique = (list: PanelId[]) => [...new Set(list.map(canonical))];
    const used = new Set<PanelId>();
    const groups = data.groups
      .map((group) => {
        const panels = unique(group.panels).filter((id) => !used.has(id));
        panels.forEach((id) => used.add(id));
        const active = canonical(group.active);
        return { ...group, panels, active: panels.includes(active) ? active : panels[0] };
      })
      .filter((group) => group.panels.length >= 2);
    const mergedVisibility = (list: PanelId[]) =>
      unique(list).filter(
        (id) =>
          id !== 'library' ||
          list.some((p) => p === 'library') ||
          ['symbols', 'bitmaps'].every((legacy) => list.some((p) => String(p) === legacy)),
      );
    return {
      ...data,
      hidden: mergedVisibility(data.hidden),
      collapsed: mergedVisibility(data.collapsed),
      groups,
    };
  } catch (cause) {
    if (strict) throw cause;
    return defaultPanelLayout();
  }
}
export function loadPanelLayout(): PanelLayout {
  try {
    return readPanelLayout(localStorage.getItem(PANEL_LAYOUT_KEY));
  } catch {
    return defaultPanelLayout();
  }
}
export function togglePanel(
  layout: PanelLayout,
  id: PanelId,
  field: 'hidden' | 'collapsed',
): PanelLayout {
  return {
    ...layout,
    [field]: layout[field].includes(id)
      ? layout[field].filter((p) => p !== id)
      : [...layout[field], id],
  };
}
export function separatePanel(layout: PanelLayout, id: PanelId): PanelLayout {
  return {
    ...layout,
    groups: layout.groups
      .map((group) => {
        const panels = group.panels.filter((p) => p !== id);
        return {
          ...group,
          panels,
          active: panels.includes(group.active) ? group.active : panels[0],
        };
      })
      .filter((group) => group.panels.length >= 2),
  };
}
export function tabPanelWith(layout: PanelLayout, id: PanelId, target: PanelId): PanelLayout {
  if (id === target) return layout;
  const next = separatePanel(layout, id),
    existing = next.groups.find((g) => g.panels.includes(target));
  let groupId = 1;
  while (next.groups.some((g) => g.id === `g${groupId}`)) groupId++;
  return {
    ...next,
    sidebarVisible: true,
    hidden: next.hidden.filter((p) => p !== id && p !== target),
    collapsed: next.collapsed.filter((p) => p !== id),
    groups: existing
      ? next.groups.map((g) =>
          g === existing ? { ...g, panels: [...g.panels, id], active: id } : g,
        )
      : [...next.groups, { id: `g${groupId}`, panels: [target, id], active: id }],
  };
}
export function activatePanel(layout: PanelLayout, id: PanelId): PanelLayout {
  return {
    ...layout,
    collapsed: layout.collapsed.filter((p) => p !== id),
    groups: layout.groups.map((g) => (g.panels.includes(id) ? { ...g, active: id } : g)),
  };
}
export function visiblePanelGroups(layout: PanelLayout, available: PanelId[]): PanelGroup[] {
  const visible = available.filter((id) => !layout.hidden.includes(id));
  const groups = layout.groups
    .map((g) => ({ ...g, panels: g.panels.filter((id) => visible.includes(id)) }))
    .filter((g) => g.panels.length);
  for (const id of visible)
    if (!layout.groups.some((g) => g.panels.includes(id)))
      groups.push({ id: `single-${id}`, panels: [id], active: id });
  return groups
    .map((g) => ({ ...g, active: g.panels.includes(g.active) ? g.active : g.panels[0] }))
    .sort((a, b) => panelOrder(a.panels) - panelOrder(b.panels));
}
export const panelOrder = (ids: PanelId[]): number =>
  Math.min(...ids.map((id) => PANEL_CATALOG.findIndex(([key]) => key === id)));
