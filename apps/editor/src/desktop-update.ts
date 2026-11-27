import { writable } from 'svelte/store';
import { version } from '../src-tauri/tauri.conf.json';

type ReleaseCheck = {
  installed: string;
  latest: string | null;
  ticket: string | null;
  unavailable: string | null;
};

type UpdateStatus = {
  installed: string;
  release?: ReleaseCheck;
  checking: boolean;
  error?: string;
};

export type DownloadProgress = { received: number; total: number | null };

const status = writable<UpdateStatus>({ installed: version, checking: false });
export const desktopUpdate = { subscribe: status.subscribe };
let pendingCheck: Promise<void> | undefined;

export function checkDesktopUpdate() {
  if (pendingCheck) return pendingCheck;
  status.update(previous => ({ installed: previous.installed, release: previous.release, checking: true }));
  pendingCheck = import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke<ReleaseCheck>('desktop_update_check'))
    .then(release => status.set({ installed: release.installed, release, checking: false }))
    .catch(cause => status.update(({ installed }) => ({
      installed, checking: false, error: updateError(cause),
    })))
    .finally(() => { pendingCheck = undefined; });
  return pendingCheck;
}

export async function downloadDesktopUpdate(ticket: string, onprogress: (value: DownloadProgress) => void) {
  const { Channel, invoke } = await import('@tauri-apps/api/core');
  await invoke('desktop_update_download', { ticket, progress: new Channel(onprogress) });
}

export async function installDesktopUpdate(ticket: string) {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('desktop_update_install', { ticket });
}

export function updateError(cause: unknown) {
  if (typeof cause === 'string') return cause;
  return 'An update operation failed. Try again.';
}
