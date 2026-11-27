import { catalogFontFamilies } from './font-catalog';
import { desktop } from './storage';

export const fontCatalog = $state<{
  state: 'idle' | 'loading' | 'ready' | 'denied' | 'unavailable';
  families: string[];
}>({ state: 'idle', families: [] });

export async function discoverLocalFonts() {
  if (fontCatalog.state === 'loading') return;
  const host = window as Window & {
    queryLocalFonts?: () => Promise<readonly { family: unknown }[]>;
  };
  const useWindowsCatalog = desktop && navigator.userAgent.includes('Windows');
  if (!useWindowsCatalog && typeof host.queryLocalFonts !== 'function') {
    fontCatalog.state = 'unavailable';
    fontCatalog.families = [];
    return;
  }
  fontCatalog.state = 'loading';
  try {
    if (useWindowsCatalog) {
      const { invoke } = await import('@tauri-apps/api/core');
      const names = await invoke<unknown[]>('installed_font_families');
      fontCatalog.families = catalogFontFamilies(names.map(family => ({ family })));
    } else {
      // Call directly in the user's click. Inspect names only.
      fontCatalog.families = catalogFontFamilies(await host.queryLocalFonts!());
    }
    fontCatalog.state = 'ready';
  } catch (error) {
    fontCatalog.families = [];
    fontCatalog.state = error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)
      ? 'denied' : 'unavailable';
  }
}
