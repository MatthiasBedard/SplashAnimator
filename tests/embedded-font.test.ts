import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { newProject, validateProject } from '../packages/document/src';
import { decodeEmbeddedFont, encodeEmbeddedFont } from '../packages/document/src/embedded-font';
import { loadProject, saveProject, type DirectoryStore } from '../packages/document/src/storage';

const sample = () => readFile('node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf');
function table(bytes: Buffer, tag: string) {
  for (let offset = 12; offset < 12 + bytes.readUInt16BE(4) * 16; offset += 16)
    if (bytes.toString('ascii', offset, offset + 4) === tag) return bytes.readUInt32BE(offset + 8);
  throw Error('Missing fixture table.');
}

describe('editable TrueType project fonts', () => {
  test('round trips the complete authorized face and rejects restricted and malformed faces', async () => {
    const bytes = await sample();
    expect(Buffer.from(decodeEmbeddedFont(encodeEmbeddedFont(bytes)))).toEqual(bytes);
    const restricted = Buffer.from(bytes);
    restricted.writeUInt16BE(2, table(restricted, 'OS/2') + 8);
    expect(() => encodeEmbeddedFont(restricted)).toThrow(/permissions/);
    const previewOnly = Buffer.from(bytes);
    previewOnly.writeUInt16BE(4, table(previewOnly, 'OS/2') + 8);
    expect(() => encodeEmbeddedFont(previewOnly)).toThrow(/permissions/);
    expect(() => encodeEmbeddedFont(bytes.subarray(0, 1000))).toThrow(/table directory/);
  });

  test('writes bytes outside the manifest, restores exact metadata and protects a conflicting file', async () => {
    const bytes = await sample();
    const font = { name: 'codicon.ttf', family: 'Splash Font Test', bytes: bytes.length, dataUrl: encodeEmbeddedFont(bytes) };
    const asset = { id: 'font', path: 'assets/fonts/font.json', font };
    const p = newProject();
    p.assets.push(asset);
    const files = new Map<string, string>();
    const store: DirectoryStore = {
      async read(path) { return files.get(path)!; },
      async exists(path) { return files.has(path); },
      async writeNew(path, content) {
        if (files.has(path)) throw Error('Already exists.');
        files.set(path, content);
      },
      async commit(path, content, expected) {
        if ((files.get(path) ?? null) !== expected) throw Error('Conflict.');
        files.set(path, content);
      },
    };
    const manifest = await saveProject(store, p, null);
    expect(JSON.parse(manifest).document.assets[0].font).not.toHaveProperty('dataUrl');
    expect((await loadProject(store)).project).toEqual(p);
    const badLength = structuredClone(p);
    badLength.assets[0].font!.bytes++;
    expect(() => validateProject(badLength)).toThrow(/does not match/);
    files.set(asset.path, '{}');
    await expect(saveProject(store, p, manifest)).rejects.toThrow(/Font asset conflict/);
    expect(files.get('project.json')).toBe(manifest);
    expect(files.get(asset.path)).toBe('{}');
    files.delete(asset.path);
    expect((await loadProject(store)).missingAssets).toEqual([asset.path]);
  });
});
