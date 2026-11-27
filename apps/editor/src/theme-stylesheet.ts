import { refreshCanvasTheme } from './canvas-theme';

let stylesheet: HTMLLinkElement | undefined;
const themeChanged = 'splash-theme-change';

export function onThemeChange(listener: () => void) {
  document.addEventListener(themeChanged, listener);
  return () => document.removeEventListener(themeChanged, listener);
}

function updateTheme() {
  refreshCanvasTheme();
  document.dispatchEvent(new Event(themeChanged));
}

export function showThemeStylesheet(url: string | null) {
  stylesheet?.remove();
  stylesheet = undefined;
  if (url === null) {
    updateTheme();
    return Promise.resolve();
  }
  const link = document.createElement('link');
  stylesheet = link;
  link.rel = 'stylesheet';
  link.href = url;
  return new Promise<void>((resolve, reject) => {
    link.addEventListener('load', () => {
      if (stylesheet === link) updateTheme();
      resolve();
    }, { once: true });
    link.addEventListener('error', () => {
      link.remove();
      if (stylesheet === link) updateTheme();
      reject(new Error('Could not load the theme stylesheet.'));
    }, { once: true });
    document.head.append(link);
  });
}
