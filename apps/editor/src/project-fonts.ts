import type { Asset } from '../../../packages/document/src';
import {
  decodeEmbeddedFont, embeddedFamilyName, EMBEDDED_FONT_MAX_BYTES,
  encodeEmbeddedFont, type EmbeddedFont,
} from '../../../packages/document/src/embedded-font';

export async function loadProjectFont(font: EmbeddedFont): Promise<FontFace> {
  if (!font.dataUrl) throw Error(`Missing bytes for ${font.family}.`);
  const face = new FontFace(font.family, decodeEmbeddedFont(font.dataUrl));
  return face.load();
}

export function projectFontSignature(assets: readonly Asset[]) {
  return JSON.stringify(assets.flatMap(asset => asset.font?.dataUrl ? [asset.font] : []));
}

/** Closing a preview cancels its wait, while the editor can finish loading the same fonts. */
export async function waitForProjectFonts(ready: Promise<void>, signal: AbortSignal) {
  signal.throwIfAborted();
  let stop!: () => void, timer: ReturnType<typeof setTimeout> | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    timer = setTimeout(() => reject(Error('Project fonts took too long to load.')), 60000);
  });
  try {
    await Promise.race([ready, interrupted]);
    signal.throwIfAborted();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}

export async function prepareFontImport(file: File, projectFamily: string, id: string): Promise<Asset> {
  if (!/\.ttf$/i.test(file.name)) throw Error('Import a single TrueType (.ttf) font.');
  if (file.size < 28 || file.size > EMBEDDED_FONT_MAX_BYTES)
    throw Error('A TrueType font must be no larger than 1 MiB.');
  const family = 'Splash Font ' + projectFamily;
  if (!embeddedFamilyName(family)) throw Error('Use letters, digits, spaces, hyphens or underscores for the project family.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size) throw Error('The selected font file changed during import.');
  const font = { name: file.name.slice(0, 200), family, bytes: bytes.length, dataUrl: encodeEmbeddedFont(bytes) };
  await loadProjectFont(font);
  return { id, path: `assets/fonts/${id}.json`, font };
}
