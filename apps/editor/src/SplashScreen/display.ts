import prototype from './index.html?raw';
import beach from './beach.jpg';
import logo from './logo.png';
import { version } from '../../src-tauri/tauri.conf.json';
import type { LicenseClaims } from '../license-token';

const integrationStyles = `
  :host { color-scheme: light; align-items: safe center; }
  :host(.desktop-startup-screen) { min-height: 0; }
  :host([data-ready]) .splash {
    display: grid;
    grid-template-columns: 40% minmax(0, 1fr);
    aspect-ratio: auto;
    min-height: 0;
  }
  /* Keep the original card proportions where they fit, and include the footer in its height. */
  :host([data-ready]) .splash::before {
    content: '';
    grid-area: 1 / 1 / 2 / -1;
    align-self: start;
    aspect-ratio: 16 / 9;
    min-height: min(460px, 100vh);
    max-height: 100vh;
    pointer-events: none;
  }
  :host([data-ready]) .content {
    grid-area: 1 / 2;
    position: relative;
    inset: auto;
    min-width: 0;
  }
  :host([data-ready]) .grow { min-height: 12px; }
  :host([data-ready]) .footer { max-width: 100%; overflow-wrap: anywhere; }
  @media (max-width: 700px) {
    :host([data-ready]) .splash::before { min-height: min(390px, 100vh); }
  }
  @media (max-height: 500px) {
    :host([data-ready]) .content { padding-block: 12px; }
    :host([data-ready]) .footer { margin-top: 12px; padding-top: 8px; }
  }
  .status button {
    margin-inline-start: 8px;
    padding: 3px 9px;
    border: 1px solid #bfdcf4;
    border-radius: 40px;
    background: #ffffffb8;
    color: #0757ad;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .status button:focus-visible { outline: 2px solid #0069ef; outline-offset: 2px; }
  .footer .splash-update { display: inline; color: #0757ad; }
  .footer .splash-update[hidden] { display: none; }
  .splash-close {
    position: absolute;
    inset-block-start: 7px;
    inset-inline-end: 8px;
    z-index: 1;
    width: 32px;
    height: 32px;
    padding: 0 0 6px;
    border: 0;
    background: transparent;
    color: #0757ad;
    font: 24px/1 system-ui, sans-serif;
    cursor: pointer;
  }
  .splash-close:hover { color: #003877; }
  .splash-close:focus-visible { outline: 2px solid #0069ef; outline-offset: 2px; }
  @media (max-width: 700px) { :host([data-ready]) .license { margin-inline-end: 24px; } }
  @media (prefers-reduced-motion: reduce) { .fill { transition: none; } }
`;

export const showSplashScreenEvent = 'splash:show';

export function showStartup(host: HTMLElement) {
  const template = document.createElement('template');
  template.innerHTML = prototype;
  const card = template.content.querySelector('main.splash')!;
  const skin = template.content.querySelector('style')!;
  // Reuse the supplied presentation in isolation. Its standalone demo script stays in the source page.
  skin.textContent = skin.textContent!
    .replace(/:root(?=\s*\{)/, ':host')
    .replace(/\bbody(?=\s*\{)/, ':host')
    .replace("url('beach.jpg')", `url(${JSON.stringify(beach)})`) + integrationStyles;
  card.querySelector('img.logo')!.setAttribute('src', logo);
  const versionLabel = card.querySelector('#version')!;
  const installedVersion = document.createTextNode(`v${version}`);
  versionLabel.replaceChildren(installedVersion);
  card.querySelector('#licenseLabel')!.textContent = 'Checking license…';
  card.querySelector('#edition')!.textContent = 'Licensing';
  card.querySelector('#owner')!.textContent = '';
  card.querySelector('#expiry')!.textContent = '';
  card.removeAttribute('role');
  const status = card.querySelector('#status')!;
  status.setAttribute('role', 'status');
  const button = document.createElement('button');
  button.type = 'button';
  button.hidden = true;
  status.after(button);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'splash-close';
  close.setAttribute('aria-label', 'Close splash screen');
  close.textContent = '×';
  close.hidden = true;
  card.append(close);
  host.attachShadow({ mode: 'open' }).append(skin, card);

  return {
    updateVersion(installed: string, latest?: string) {
      installedVersion.data = `v${installed}`;
      let notice = versionLabel.querySelector<HTMLSpanElement>('.splash-update');
      if (!notice) {
        notice = document.createElement('span');
        notice.className = 'splash-update';
        notice.setAttribute('aria-live', 'polite');
        versionLabel.append(notice);
      }
      notice.textContent = latest ? ` · Latest v${latest}` : '';
      notice.hidden = !latest;
    },
    ready(dismiss: () => void, license?: LicenseClaims) {
      status.remove();
      card.querySelector('#licenseLabel')!.textContent = license ? `${license.edition} license` : 'No valid license';
      card.querySelector('#licenseBadge')!.classList.toggle('paid', license?.can_save === true);
      card.querySelector('#edition')!.textContent = license?.can_save
        ? 'Saving and exporting enabled' : 'Saving and exporting disabled';
      card.querySelector('#owner')!.textContent = license ? `Licensed to: ${license.name ?? license.email}` : 'Register from the Help menu';
      card.querySelector('#expiry')!.textContent = license
        ? license.exp ? `Expires: ${new Date(license.exp * 1000).toLocaleDateString()}` : 'Perpetual license'
        : '';
      card.querySelector('#progressBar')?.remove();
      card.querySelector('#percent')?.remove();
      button.id = 'startup-open';
      button.textContent = 'Open editor';
      button.addEventListener('click', dismiss, { once: true });
      close.addEventListener('click', dismiss, { once: true });
      button.hidden = false;
      close.hidden = false;
      button.focus({ preventScroll: true });
      host.dataset.ready = '';
    },
    failed() {
      status.setAttribute('role', 'alert');
      status.textContent = 'Splash Animator could not start.';
      button.textContent = 'Reload editor';
      button.addEventListener('click', () => location.reload());
      button.hidden = false;
      button.focus({ preventScroll: true });
    },
  };
}
