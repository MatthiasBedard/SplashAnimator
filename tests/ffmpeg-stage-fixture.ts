import { crc32, deflateSync } from 'node:zlib';
export const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
export function joinBytes(...parts: Uint8Array[]) {
  return new Uint8Array(Buffer.concat(parts));
}
/** Independent native zlib CRC oracle; real compressed RGBA pixels. */
export function pngChunk(type: string, body = new Uint8Array()) {
  const out = new Uint8Array(body.length + 12),
    view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(Buffer.from(type), 4);
  out.set(body, 8);
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}
export function pngHeader(width = 2, height = 2, color = 6, depth = 8, interlace = 0) {
  const bytes = new Uint8Array(13),
    view = new DataView(bytes.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  bytes[8] = depth;
  bytes[9] = color;
  bytes[12] = interlace;
  return pngChunk('IHDR', bytes);
}
export function png() {
  return joinBytes(
    pngSignature,
    pngHeader(),
    pngChunk(
      'IDAT',
      deflateSync(
        new Uint8Array([0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255]),
      ),
    ),
    pngChunk('IEND'),
  );
}
