import { encodeOpus } from './opus';

const encoder = new TextEncoder();
const vendor = encoder.encode('Splash Animator');
const tags = new Uint8Array(16 + vendor.length);
tags.set(encoder.encode('OpusTags'));
new DataView(tags.buffer).setUint32(8, vendor.length, true);
tags.set(vendor, 12);

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index << 24;
  for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ (crc < 0 ? 0x04c11db7 : 0);
  return crc;
});

/** Mux the bounded 48 kHz encoder output into a single Ogg Opus logical stream. */
export async function encodeOggOpus(
  channels: readonly Float32Array[],
  options: { signal: AbortSignal; timeoutMs: number; maxBytes: number },
): Promise<Uint8Array> {
  const started = performance.now();
  const { packets, track, description } = await encodeOpus(channels, 128_000, options);
  const pages: Uint8Array[] = [];
  let total = 0;
  const active = () => {
    options.signal.throwIfAborted();
    if (performance.now() - started >= options.timeoutMs) throw Error('Ogg Opus encoding timed out.');
  };

  function page(payloads: readonly Uint8Array[], flags: number, granule: number) {
    active();
    const segments = payloads.reduce((sum, bytes) => sum + Math.floor(bytes.length / 255) + 1, 0);
    const size = payloads.reduce((sum, bytes) => sum + bytes.length, 27 + segments);
    if (segments > 255 || total + size > options.maxBytes) throw Error('Ogg Opus exceeds the output byte limit.');
    const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
    bytes.set([79, 103, 103, 83]); // OggS
    bytes[5] = flags;
    view.setBigUint64(6, BigInt(granule), true);
    view.setUint32(14, 1, true);
    view.setUint32(18, pages.length, true);
    bytes[26] = segments;
    let lace = 27, offset = 27 + segments;
    for (const payload of payloads) {
      let left = payload.length;
      while (left >= 255) { bytes[lace++] = 255; left -= 255; }
      bytes[lace++] = left;
      bytes.set(payload, offset);
      offset += payload.length;
    }
    let crc = 0;
    for (const byte of bytes) crc = (crc << 8) ^ crcTable[(crc >>> 24) ^ byte];
    view.setUint32(22, crc, true);
    pages.push(bytes);
    total += size;
  }

  page([description], 2, 0);
  page([tags], 0, 0);
  // Twenty 20 ms packets fit within the segment table even at maximum Opus packet size.
  for (let start = 0; start < packets.length; start += 20) {
    const end = Math.min(start + 20, packets.length), last = end === packets.length;
    page(packets.slice(start, end).map(packet => packet.bytes), last ? 4 : 0,
      end * 960 - (last ? track.endTrim : 0));
  }
  const output = new Uint8Array(total);
  let position = 0;
  for (const bytes of pages) {
    active();
    output.set(bytes, position);
    position += bytes.length;
  }
  return output;
}
