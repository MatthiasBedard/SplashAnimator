type Pixels = Pick<ImageData, 'width' | 'height' | 'data'>;

/** Windows 24-bit BMP. Rows are stored bottom-up in BGR order and padded to four bytes. */
export function encodeBmp({ width, height, data }: Pixels) {
  const pixelOffset = 54;
  const stride = Math.ceil((width * 3) / 4) * 4;
  const bytes = new Uint8Array(pixelOffset + stride * height);
  const header = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d]);
  header.setUint32(2, bytes.length, true);
  header.setUint32(10, pixelOffset, true);
  header.setUint32(14, 40, true);
  header.setInt32(18, width, true);
  header.setInt32(22, height, true);
  header.setUint16(26, 1, true);
  header.setUint16(28, 24, true);
  header.setUint32(34, stride * height, true);
  for (let row = 0; row < height; row++) {
    const source = (height - 1 - row) * width * 4;
    const destination = pixelOffset + row * stride;
    for (let x = 0; x < width; x++) {
      bytes[destination + x * 3] = data[source + x * 4 + 2];
      bytes[destination + x * 3 + 1] = data[source + x * 4 + 1];
      bytes[destination + x * 3 + 2] = data[source + x * 4];
    }
  }
  return bytes;
}

/** TIFF 6.0 with one uncompressed, chunky RGB or straight-alpha RGBA strip. */
export function encodeTiff({ width, height, data }: Pixels, transparent: boolean) {
  const short = 3,
    long = 4,
    rational = 5;
  const samples = transparent ? 4 : 3;
  const count = transparent ? 14 : 13;
  const directoryOffset = 8;
  const bitsOffset = directoryOffset + 2 + count * 12 + 4;
  const resolutionOffset = bitsOffset + samples * 2;
  const pixelOffset = resolutionOffset + 8;
  const pixelBytes = width * height * samples;
  const bytes = new Uint8Array(pixelOffset + pixelBytes);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49]);
  view.setUint16(2, 42, true);
  view.setUint32(4, directoryOffset, true);
  view.setUint16(directoryOffset, count, true);
  let entry = directoryOffset + 2;
  function field(tag: number, type: number, values: number, value: number) {
    view.setUint16(entry, tag, true);
    view.setUint16(entry + 2, type, true);
    view.setUint32(entry + 4, values, true);
    view.setUint32(entry + 8, value, true);
    entry += 12;
  }
  field(256, long, 1, width);
  field(257, long, 1, height);
  field(258, short, samples, bitsOffset);
  field(259, short, 1, 1); // Compression: none
  field(262, short, 1, 2); // Photometric interpretation: RGB
  field(273, long, 1, pixelOffset);
  field(277, short, 1, samples);
  field(278, long, 1, height);
  field(279, long, 1, pixelBytes);
  field(282, rational, 1, resolutionOffset);
  field(283, rational, 1, resolutionOffset);
  field(284, short, 1, 1); // Planar configuration: interleaved
  field(296, short, 1, 2); // Resolution unit: inch
  if (transparent) field(338, short, 1, 2); // Extra sample: unassociated alpha
  for (let channel = 0; channel < samples; channel++)
    view.setUint16(bitsOffset + channel * 2, 8, true);
  view.setUint32(resolutionOffset, 96, true);
  view.setUint32(resolutionOffset + 4, 1, true);
  if (transparent) {
    bytes.set(data, pixelOffset);
  } else {
    for (
      let source = 0, destination = pixelOffset;
      source < data.length;
      source += 4, destination += 3
    ) {
      bytes[destination] = data[source];
      bytes[destination + 1] = data[source + 1];
      bytes[destination + 2] = data[source + 2];
    }
  }
  return bytes;
}
