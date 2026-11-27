import lightStylesheet from '../src-tauri/resources/themes/Light/theme.css?url';
import { showThemeStylesheet } from './theme-stylesheet';

const bundledThemes = new Map([['Light', lightStylesheet]]);
const preferenceKey = 'splash-web-theme-v1';
export const webThemes = [...bundledThemes.keys()];

export function webThemePreference() {
  const name = localStorage.getItem(preferenceKey);
  return name !== null && bundledThemes.has(name) ? name : null;
}

export async function setWebTheme(name: string | null) {
  await showThemeStylesheet(name !== null ? bundledThemes.get(name) ?? null : null);
  if (name === null) localStorage.removeItem(preferenceKey);
  else localStorage.setItem(preferenceKey, name);
}

export function initializeWebTheme() {
  const name = webThemePreference();
  return showThemeStylesheet(name === null ? null : bundledThemes.get(name) ?? null);
}

export function followWebTheme() {
  function refresh() {
    void initializeWebTheme().catch(console.warn);
  }
  refresh();
  window.addEventListener('storage', event => {
    if (event.key === preferenceKey || event.key === null) refresh();
  });
}
