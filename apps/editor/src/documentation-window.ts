import { desktop } from './storage';

export async function openDocumentation() {
  if (desktop) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('documentation_window');
    return;
  }

  const url = new URL('./docs/index.html', window.location.href);
  const opened = window.open('about:blank', '_blank', 'popup,width=1000,height=760,resizable=yes');
  if (!opened) throw new Error('Allow popups for Splash Animator to open Documentation.');
  opened.opener = null;
  opened.location.replace(url.href);
}
