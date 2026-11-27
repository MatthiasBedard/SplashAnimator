export type PluginCatalog = {
  folder: string;
  plugins: { id: string; name: string; version: string; description: string }[];
  issues: string[];
};

const folderKey = 'splash-plugin-folder-v1';

export function pluginFolder() {
  return localStorage.getItem(folderKey);
}

export function setPluginFolder(folder: string | null) {
  if (folder === null) localStorage.removeItem(folderKey);
  else localStorage.setItem(folderKey, folder);
}

export async function choosePluginFolder() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('desktop_plugins_choose_folder');
}

export async function discoverPlugins() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<PluginCatalog>('desktop_plugins_discover', { folder: pluginFolder() });
}

function enabledKey(folder: string) {
  return 'splash-enabled-plugins-v1:' + folder;
}

export function enabledPlugins(folder: string): string[] {
  const raw = localStorage.getItem(enabledKey(folder));
  if (raw === null) return [];
  try {
    const ids: unknown = JSON.parse(raw);
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function setPluginEnabled(folder: string, id: string, enabled: boolean) {
  const ids = new Set(enabledPlugins(folder));
  if (enabled) ids.add(id);
  else ids.delete(id);
  if (ids.size) localStorage.setItem(enabledKey(folder), JSON.stringify([...ids]));
  else localStorage.removeItem(enabledKey(folder));
  return [...ids];
}
