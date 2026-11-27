import { onThemeChange } from './theme-stylesheet';

export function monacoTheme() {
  const scheme = getComputedStyle(document.documentElement).colorScheme.split(/\s+/);
  const light = scheme.find(value => value === 'light' || value === 'dark') === 'light';
  if (window.matchMedia('(forced-colors: active)').matches) return light ? 'hc-light' : 'hc-black';
  return light ? 'vs' : 'vs-dark';
}

export function followMonacoTheme(setTheme: (theme: string) => void) {
  return onThemeChange(() => setTheme(monacoTheme()));
}
