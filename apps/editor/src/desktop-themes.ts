import { invoke } from '@tauri-apps/api/core';
import { showThemeStylesheet } from './theme-stylesheet';

type ThemePreference = { folder: string | null; name: string | null };
type ThemeCatalog = { folder: string; themes: string[] };

const preferenceKey = 'splash-desktop-theme-v1';
const stylesheetKey = 'splash-desktop-theme-stylesheet';

export function themePreference(): ThemePreference {
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? 'null');
    return {
      folder: typeof saved?.folder === 'string' ? saved.folder : null,
      name: typeof saved?.name === 'string' ? saved.name : null,
    };
  } catch {
    return { folder: null, name: null };
  }
}

export function listThemes(folder: string | null) {
  return invoke<ThemeCatalog>('desktop_theme_catalog', { folder });
}

export function chooseThemesFolder() {
  return invoke<string | null>('desktop_theme_choose_folder');
}

export async function setDesktopTheme(folder: string | null, name: string | null) {
  const url = await invoke<string | null>('desktop_theme_select', { folder, name });
  try {
    await showThemeStylesheet(url);
  } catch (error) {
    localStorage.removeItem(stylesheetKey);
    throw error;
  }
  localStorage.setItem(preferenceKey, JSON.stringify({ folder, name }));
  if (url === null) localStorage.removeItem(stylesheetKey);
  else localStorage.setItem(stylesheetKey, url);
}

export async function initializeDesktopTheme() {
  localStorage.removeItem(stylesheetKey);
  const { folder, name } = themePreference();
  const catalog = await listThemes(folder);
  if (name !== null && catalog.themes.includes(name)) await setDesktopTheme(folder, name);
}

export function followDesktopTheme() {
  function refresh() {
    void showThemeStylesheet(localStorage.getItem(stylesheetKey)).catch(console.warn);
  }
  refresh();
  window.addEventListener('storage', event => {
    if (event.key === stylesheetKey) refresh();
  });
}
