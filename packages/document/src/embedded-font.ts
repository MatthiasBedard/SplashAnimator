export const EMBEDDED_FONT_MAX_BYTES = 1024 * 1024;
export const EMBEDDED_FONT_PROJECT_BYTES = 2 * 1024 * 1024;
const prefix = 'data:font/ttf;base64,';
export const EMBEDDED_FONT_PAYLOAD_LIMIT = prefix.length + Math.ceil(EMBEDDED_FONT_MAX_BYTES / 3) * 4;

export type EmbeddedFont = { name: string; family: string; bytes: number; dataUrl?: string };

export function embeddedFamilyName(family: string) {
  return /^Splash Font [A-Za-z0-9][A-Za-z0-9 _-]{0,69}$/.test(family) && family === family.trim();
}

/** Validate the sfnt directory before allowing a whole TrueType face to be shared. */
export function checkEmbeddableFont(bytes: Uint8Array) {
  if (bytes.length < 28 || bytes.length > EMBEDDED_FONT_MAX_BYTES)
    throw Error('A TrueType font must be no larger than 1 MiB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x00010000) throw Error('Import a single TrueType (.ttf) font.');
  const count = view.getUint16(4), end = 12 + count * 16;
  if (!count || end > bytes.length) throw Error('Invalid TrueType table directory.');
  const tables = new Map<string, { offset: number; length: number }>();
  const spans: { offset: number; length: number }[] = [];
  for (let entry = 12; entry < end; entry += 16) {
    const tag = String.fromCharCode(...bytes.subarray(entry, entry + 4));
    const offset = view.getUint32(entry + 8), length = view.getUint32(entry + 12);
    if (tables.has(tag) || offset < end || offset % 4 || offset + length > bytes.length)
      throw Error('Invalid TrueType table directory.');
    const span = { offset, length };
    tables.set(tag, span);
    if (length) spans.push(span);
  }
  spans.sort((a, b) => a.offset - b.offset);
  if (spans.some((span, index) => index > 0 &&
    span.offset < spans[index - 1].offset + spans[index - 1].length))
    throw Error('TrueType tables overlap.');
  for (const tag of ['head', 'maxp', 'cmap', 'loca', 'glyf', 'name', 'hhea', 'hmtx'])
    if (!tables.get(tag)?.length) throw Error('The font lacks a required TrueType table.');
  const os = tables.get('OS/2');
  if (!os || os.length < 10) throw Error('The font does not declare embedding permissions.');
  const rights = view.getUint16(os.offset + 8);
  if (rights !== 0 && rights !== 8 && rights !== 0x100 && rights !== 0x108)
    throw Error('Font permissions must allow installable or editable embedding of outlines.');
  return tables;
}

export function encodeEmbeddedFont(bytes: Uint8Array): string {
  checkEmbeddableFont(bytes);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192)
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return prefix + btoa(binary);
}

export function decodeEmbeddedFont(dataUrl: string): Uint8Array<ArrayBuffer> {
  if (typeof dataUrl !== 'string' || dataUrl.length > EMBEDDED_FONT_PAYLOAD_LIMIT ||
      !dataUrl.startsWith(prefix) || !/^[A-Za-z0-9+/]+={0,2}$/.test(dataUrl.slice(prefix.length)))
    throw Error('Invalid embedded TrueType payload.');
  const encoded = dataUrl.slice(prefix.length);
  const binary = atob(encoded);
  if (btoa(binary) !== encoded) throw Error('Invalid embedded TrueType payload.');
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

// A bounded cache of exact immutable payloads avoids decoding again on every authoring edit.
const validated = new Map<string, number>();
export function validateEmbeddedFont(font: EmbeddedFont) {
  if (!font || typeof font.family !== 'string' || !embeddedFamilyName(font.family) ||
      typeof font.name !== 'string' || font.name.length < 1 || font.name.length > 200 ||
      !Number.isSafeInteger(font.bytes) || font.bytes < 28 || font.bytes > EMBEDDED_FONT_MAX_BYTES)
    throw Error('Invalid embedded font metadata.');
  if (font.dataUrl === undefined) return;
  let length = validated.get(font.dataUrl);
  if (length === undefined) {
    const payload = decodeEmbeddedFont(font.dataUrl);
    checkEmbeddableFont(payload);
    length = payload.length;
    if (validated.size >= 4) validated.delete(validated.keys().next().value!);
    validated.set(font.dataUrl, length);
  }
  if (font.bytes !== length) throw Error('Embedded font length does not match its bytes.');
}
