import { defaultPanelLayout, readPanelLayout, tabPanelWith, type PanelLayout } from './panel-layout';

export type SavedWorkspace = { name: string; layout: PanelLayout };
export const WORKSPACES_KEY = 'splash-workspaces-v1';
export const BUILTIN_WORKSPACES = ['Standard', 'Animation'] as const;
export type BuiltinWorkspace = (typeof BUILTIN_WORKSPACES)[number];

export function builtinWorkspace(name: BuiltinWorkspace): PanelLayout {
  const base = defaultPanelLayout();
  if (name === 'Standard') return base;
  const layout = tabPanelWith(base, 'frames', 'layer');
  return { ...layout, sizes: { tools: 72, inspector: 280, timeline: 340 } };
}

function workspaceName(input: string) {
  const name = input.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(name))
    throw Error('Enter a workspace name of 1–80 printable characters.');
  if (BUILTIN_WORKSPACES.some(builtin => builtin.toLowerCase() === name.toLowerCase()))
    throw Error('Choose a name different from the built-in workspaces.');
  return name;
}

export function workspaceSnapshot(layout: PanelLayout) {
  return readPanelLayout(JSON.stringify(layout), true);
}

export function addWorkspace(saved: readonly SavedWorkspace[], input: string, layout: PanelLayout) {
  const name = workspaceName(input);
  if (saved.some(workspace => workspace.name.toLowerCase() === name.toLowerCase()))
    throw Error('That workspace is already saved. Select it to replace its layout.');
  return [...saved, { name, layout: workspaceSnapshot(layout) }];
}

export function readSavedWorkspaces(raw: string | null): SavedWorkspace[] {
  let entries: unknown;
  try { entries = JSON.parse(raw ?? '[]'); } catch { return []; }
  if (!Array.isArray(entries)) return [];
  let result: SavedWorkspace[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string') continue;
    try { result = addWorkspace(result, entry.name, entry.layout); }
    catch { /* Keep other valid saved layouts when one entry is damaged. */ }
  }
  return result;
}

export function loadSavedWorkspaces() {
  try { return readSavedWorkspaces(localStorage.getItem(WORKSPACES_KEY)); }
  catch { return []; }
}
