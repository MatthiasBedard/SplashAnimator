import { desktop } from './storage';
import { licenseIsCurrent, MAX_LICENSE_LENGTH, verifyLicense, type LicenseClaims } from './license-token';

const storageKey = 'splash-license-v1';
const filename = 'SplashAnimator.splashlicense';
export const licenseRequired = 'A valid license with save permission is required to save or export.';
const pinnedPublicKey = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEzC72VU1nxHzUC/gyGwbyMWHzfZcR
3r2y1q/UqNB1rNbk1+f26h04yCGGk67Y3URrTKkoJnvVcPMEmsJnQxKJ+g==
-----END PUBLIC KEY-----`;
const publicKeys: string | Readonly<Record<string, string>> = (() => {
  const configured = import.meta.env.VITE_SPLASH_LICENSE_PUBLIC_KEYS;
  if (configured === undefined) return pinnedPublicKey;
  try {
    const keys: unknown = JSON.parse(configured);
    if (keys && typeof keys === 'object' && !Array.isArray(keys) &&
      Object.values(keys).every(key => typeof key === 'string')) return Object.freeze(keys) as Record<string, string>;
  } catch { /* A malformed configuration grants no permissions. */ }
  return Object.freeze({});
})();

let claims = $state.raw<LicenseClaims | undefined>();
let available = $state(false);
let expiration: ReturnType<typeof setTimeout> | undefined;
let checking: Promise<void> | undefined;
let registering = false;

function refresh() {
  clearTimeout(expiration);
  available = !!claims && licenseIsCurrent(claims);
  if (available && claims?.exp !== undefined) {
    const delay = Math.max(1, claims.exp * 1000 - Date.now());
    expiration = setTimeout(refresh, Math.min(delay, 2147483647));
  }
}

function verify(code: string) {
  if (!Object.keys(publicKeys).length) throw Error('This build has no configured license verification key.');
  return verifyLicense(code, publicKeys);
}

async function load() {
  try {
    const code = desktop
      ? await (await import('@tauri-apps/api/core')).invoke<string | null>('read_license')
      : localStorage.getItem(storageKey);
    if (code) claims = await verify(code.trim());
  } catch { claims = undefined; }
  refresh();
}

export const license = {
  get claims() { return available ? claims : undefined; },
  get savingAllowed() { return available && !!claims?.can_save; },
  canSaveNow() { return !!claims?.can_save && licenseIsCurrent(claims); },
  assertOutputAllowed() { if (!this.canSaveNow()) throw Error(licenseRequired); },
  initialize() { return checking ??= load(); },
  refresh,
  async register(input: string) {
    if (registering) throw Error('Registration is already in progress.');
    registering = true;
    try {
      await this.initialize();
      if (input.length > MAX_LICENSE_LENGTH) throw Error('The license code is too long.');
      const token = input.trim();
      const verified = await verify(token);
      if (desktop) await (await import('@tauri-apps/api/core')).invoke('write_license', { token });
      else {
        localStorage.setItem(storageKey, token);
        const url = URL.createObjectURL(new Blob([token], { type: 'application/octet-stream' }));
        const download = document.createElement('a');
        download.download = filename;
        download.href = url;
        download.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      claims = verified;
      refresh();
    } finally { registering = false; }
  },
};
