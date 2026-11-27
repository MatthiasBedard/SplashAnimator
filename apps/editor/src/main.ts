import { showSplashScreenEvent, showStartup } from './SplashScreen/display';
import { writable, type Readable } from 'svelte/store';
import { license } from './license.svelte';
import { desktop } from './storage';
import { checkDesktopUpdate, desktopUpdate } from './desktop-update';
import { followDesktopTheme, initializeDesktopTheme } from './desktop-themes';
import { followWebTheme, initializeWebTheme } from './web-themes';

const app = document.getElementById('app')!;
const startup = document.getElementById('startup-screen')!;
const splashShell = startup.cloneNode(false) as HTMLElement;

function presentDesktopSplashMenu(host: HTMLElement, updateReady: Readable<boolean>, openUpdate: () => void) {
  host.classList.add('desktop-startup-screen');
  // The editor is inert, but the window controls are available beside the dialog.
  host.removeAttribute('aria-modal');
  const menu = document.createElement('div');
  menu.className = 'desktop-splash-menu';
  host.before(menu);
  let dispose: (() => void) | undefined;
  void Promise.all([import('svelte'), import('./SplashScreen/DesktopSplashMenu.svelte')])
    .then(([{ mount, unmount }, { default: Menu }]) => {
      if (!menu.isConnected) return;
      const instance = mount(Menu, { target: menu, props: { updateReady, openUpdate } });
      dispose = () => void unmount(instance);
    })
    .catch((error) => console.error('Unable to show desktop window controls', error));
  return () => {
    dispose?.();
    menu.remove();
  };
}

/** Keep editor shortcuts suspended until the splash closes and restores focus. */
function presentSplash(host: HTMLElement, returnFocus: string) {
  app.inert = true;
  app.setAttribute('aria-hidden', 'true');
  const updateReady = writable(false);
  let dismiss: (() => void) | undefined;
  const closeMenu = desktop ? presentDesktopSplashMenu(host, updateReady, () => {
    dismiss?.();
    app.querySelector<HTMLButtonElement>('[data-update-available]')?.click();
  }) : undefined;
  const splash = showStartup(host);
  const unsubscribeUpdate = desktop ? desktopUpdate.subscribe(({ installed, release }) => {
    splash.updateVersion(installed, release?.ticket ? release.latest ?? undefined : undefined);
  }) : undefined;
  if (desktop) void checkDesktopUpdate();
  const events = new AbortController();
  const capture = { capture: true, signal: events.signal };
  const containShortcut = (event: Event) => event.stopImmediatePropagation();
  window.addEventListener('keyup', containShortcut, capture);
  window.addEventListener('paste', containShortcut, capture);
  window.addEventListener(
    'keydown',
    (event) => {
      containShortcut(event);
      if (event.key !== 'Escape' || !dismiss) return;
      event.preventDefault();
      dismiss();
    },
    capture,
  );
  return {
    ready() {
      dismiss = () => {
        events.abort();
        unsubscribeUpdate?.();
        closeMenu?.();
        host.remove();
        app.inert = false;
        app.removeAttribute('aria-hidden');
        app.querySelector<HTMLElement>(returnFocus)?.focus({ preventScroll: true });
      };
      splash.ready(dismiss, license.claims);
      updateReady.set(true);
    },
    failed() {
      unsubscribeUpdate?.();
      splash.failed();
    },
  };
}

async function boot() {
  const launchSplash = presentSplash(startup, '#drawing-stage');
  try {
    const [{ startEditor }] = await Promise.all([import('./start-editor'), license.initialize()]);
    await startEditor(app);
    await (desktop ? initializeDesktopTheme() : initializeWebTheme()).catch(console.warn);
    launchSplash.ready();
    window.addEventListener(showSplashScreenEvent, () => {
      if (document.getElementById(splashShell.id)) return;
      const host = splashShell.cloneNode(false) as HTMLElement;
      app.before(host);
      license.refresh();
      presentSplash(host, '[data-help-menu]').ready();
    });
    window.addEventListener('focus', license.refresh);
  } catch (error) {
    console.error('Unable to start Splash Animator', error);
    launchSplash.failed();
  }
}

const panelSession = location.hash.match(/^#script-panel=([a-f0-9-]{36})$/)?.[1];
if (panelSession) {
  startup.remove();
  app.inert = false;
  app.removeAttribute('aria-hidden');
  document.title = 'Script Editor · Splash Animator';
  void Promise.all([
    import('svelte'),
    import('./FloatingScriptPanel.svelte'),
    import('./style.css'),
  ]).then(([{ mount }, { default: Panel }]) => {
    mount(Panel, { target: app, props: { session: panelSession } });
    if (desktop) followDesktopTheme();
    else followWebTheme();
  });
} else void boot();
