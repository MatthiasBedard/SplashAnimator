import { migrateProject } from '../../../packages/document/src';
import type { EditorRecovery } from './editor-state-types';

export const DOCUMENT_RECOVERY_KEY = 'splash-recovery-v1';
const DISCARDED_AUTOSAVES_KEY = 'splash-discarded-autosaves-v1';

function discardedAutosaves(storage: Pick<Storage, 'getItem'>) {
  let saved: unknown;
  try { saved = JSON.parse(storage.getItem(DISCARDED_AUTOSAVES_KEY) ?? '[]'); }
  catch { saved = []; }
  return new Map<string, string>(Array.isArray(saved)
    ? saved.filter(entry => Array.isArray(entry) && entry.length === 2 &&
        entry.every(value => typeof value === 'string')) : []);
}

function autosaveRevision(manifest: string) {
  const revision: unknown = JSON.parse(manifest).revision;
  if (typeof revision !== 'string') throw Error('Invalid autosave revision.');
  return revision;
}

export function rememberDiscardedAutosave(storage: Pick<Storage, 'getItem' | 'setItem'>, folder: string, manifest: string) {
  const discarded = discardedAutosaves(storage);
  discarded.set(folder, autosaveRevision(manifest));
  storage.setItem(DISCARDED_AUTOSAVES_KEY, JSON.stringify([...discarded]));
}

export function isDiscardedAutosave(storage: Pick<Storage, 'getItem'>, folder: string, manifest: string) {
  return discardedAutosaves(storage).get(folder) === autosaveRevision(manifest);
}

/** Add recovery metadata to the editor's already serialized project. */
export function encodeDocumentRecovery(projectJson: string, folder: string | null, manifest: string | null) {
  return `{"project":${projectJson},"folder":${JSON.stringify(folder)},"manifest":${JSON.stringify(manifest)}}`;
}

/** Keep the old single-document cache readable by the first recovery action. */
export function packDocumentRecovery(active: string | null, pending: readonly EditorRecovery[]) {
  const primary = active ?? (pending[0] ? JSON.stringify(pending[0]) : null);
  const rest = active ? pending : pending.slice(1);
  if (!primary || rest.length === 0) return primary;
  if (!primary.endsWith('}')) throw Error('Invalid document recovery record.');
  return primary.slice(0, -1) + ',"documents":' + JSON.stringify(rest) + '}';
}

export function readDocumentRecovery(raw: string): EditorRecovery[] {
  const data = JSON.parse(raw);
  const read = (entry: unknown): EditorRecovery => {
    if (!entry || typeof entry !== 'object') throw Error('Invalid document recovery record.');
    const { project, folder, manifest } = entry as EditorRecovery;
    if ((folder !== null && typeof folder !== 'string') || (manifest !== null && typeof manifest !== 'string'))
      throw Error('Invalid document recovery location.');
    return { project: migrateProject(project), folder, manifest };
  };
  if (data?.documents !== undefined && !Array.isArray(data.documents)) throw Error('Invalid document recovery list.');
  return [read(data), ...(data.documents ?? []).map(read)];
}
