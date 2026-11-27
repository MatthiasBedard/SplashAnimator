import { expect, it } from 'vitest';
import { newProject } from '../packages/document/src';
import { encodeDocumentRecovery, isDiscardedAutosave, packDocumentRecovery, readDocumentRecovery, rememberDiscardedAutosave } from '../apps/editor/src/document-recovery';

const record = (name: string) => ({ project: newProject(name), folder: null, manifest: null });

it('encodes an existing project snapshot with byte-identical recovery metadata', () => {
  const active = {
    project: newProject('Quoted "art"'),
    folder: 'Drawings/Alpha β.spl',
    manifest: JSON.stringify({ revision: 'contains "quotes" and a \\ slash' }),
  };
  const pending = record('Parked');
  const encoded = encodeDocumentRecovery(JSON.stringify(active.project), active.folder, active.manifest);
  expect(encoded).toBe(JSON.stringify(active));
  expect(readDocumentRecovery(packDocumentRecovery(encoded, [pending])!)).toEqual([active, pending]);
});

it('keeps the existing single-document bytes and preserves inactive records', () => {
  const alpha = record('Alpha'), beta = record('Beta'), gamma = record('Gamma');
  const primary = JSON.stringify(alpha);
  expect(packDocumentRecovery(primary, [])).toBe(primary);
  expect(readDocumentRecovery(primary)).toEqual([alpha]);
  expect(readDocumentRecovery(packDocumentRecovery(primary, [beta, gamma])!)).toEqual([alpha, beta, gamma]);
  expect(readDocumentRecovery(packDocumentRecovery(null, [beta, alpha])!)).toEqual([beta, alpha]);
  expect(packDocumentRecovery(null, [])).toBeNull();
});

it('suppresses only the discarded autosave revision for its original folder', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
  const old = JSON.stringify({ revision: 'old' }), newer = JSON.stringify({ revision: 'newer' });
  rememberDiscardedAutosave(storage, 'Alpha.spl', old);
  expect(isDiscardedAutosave(storage, 'Alpha.spl', old)).toBe(true);
  expect(isDiscardedAutosave(storage, 'Alpha.spl', newer)).toBe(false);
  expect(isDiscardedAutosave(storage, 'Beta.spl', old)).toBe(false);
});
