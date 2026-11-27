// Stored ZIP records follow PKWARE APPNOTE 6.3.10. PNG data is already compressed.
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crcByte2 = Uint32Array.from(crcTable, value => crcTable[value & 255] ^ (value >>> 8));
const crcByte3 = Uint32Array.from(crcByte2, value => crcTable[value & 255] ^ (value >>> 8));
const crcByte4 = Uint32Array.from(crcByte3, value => crcTable[value & 255] ^ (value >>> 8));

function updateCRC(crc: number, bytes: Uint8Array) {
  const words = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const wordEnd = bytes.length - (bytes.length % 4);
  // Reflect the four input bytes in file order, independent of host endianness.
  for (let offset = 0; offset < wordEnd; offset += 4) {
    const word = crc ^ words.getUint32(offset, true);
    crc = crcByte4[word & 255] ^ crcByte3[(word >>> 8) & 255] ^
      crcByte2[(word >>> 16) & 255] ^ crcTable[word >>> 24];
  }
  for (let offset = wordEnd; offset < bytes.length; offset++)
    crc = crcTable[(crc ^ bytes[offset]) & 255] ^ (crc >>> 8);
  return crc;
}

/** Sequential stored ZIP writer; optional sink retains only directory metadata. */
export class PNGArchive {
  private parts: BlobPart[] = [];
  private directory: Uint8Array<ArrayBuffer>[] = [];
  private names = new Set<string>();
  private directories = new Set<string>();
  private heldCRC?: { blob: WeakRef<Blob>; crc: number };
  private offset = 0;
  private directorySize = 0;
  private failed = false;
  private ended = false;
  constructor(private limit = 512 * 1024 * 1024, private sink?: (part: Blob) => Promise<void>, private zip64 = false, private fileTree = false) {}

  static forFileTree() {
    return new PNGArchive(undefined, undefined, false, true);
  }

  private ready() {
    if (this.failed || this.ended) throw new Error('PNG archive is closed or failed.');
  }

  async add(name: string, blob: Blob, signal?: AbortSignal, reuseChecksum = false): Promise<void> {
    this.ready();
    signal?.throwIfAborted();
    const key = this.fileTree ? name.toLowerCase() : name;
    const validName = this.fileTree
      ? name.split('/').every(segment => /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(segment) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))
      : /^[a-zA-Z0-9_.-]+$/.test(name);
    const parents: string[] = [];
    if (this.fileTree) {
      for (let slash = key.indexOf('/'); slash !== -1; slash = key.indexOf('/', slash + 1))
        parents.push(key.slice(0, slash));
    }
    if (!validName || this.names.has(key) || this.directories.has(key) ||
        parents.some(parent => this.names.has(parent)))
      throw new Error('Invalid or duplicate archive filename.');
    const filename = new TextEncoder().encode(name);
    const total = this.offset + 30 + filename.length + blob.size + this.directorySize + 46 + filename.length + 22 + (this.zip64 ? 124 : 0);
    if (filename.length > 65535 || this.names.size >= 65534 || !Number.isSafeInteger(total) || total > Math.min(this.limit, this.zip64 ? Number.MAX_SAFE_INTEGER : 0xffffffff))
      throw new Error('PNG sequence exceeds the archive size limit or ZIP entry limit.');
    let crc = reuseChecksum && this.heldCRC?.blob.deref() === blob
      ? this.heldCRC.crc
      : undefined;
    if (crc === undefined) {
      crc = 0xffffffff;
      for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + 1024 * 1024).arrayBuffer());
        signal?.throwIfAborted();
        crc = updateCRC(crc, bytes);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      crc = (crc ^ 0xffffffff) >>> 0;
    }
    signal?.throwIfAborted();
    // The caller vouches for immutable, native encoder output. Other sinks
    // always checksum their input, including after a different entry.
    this.heldCRC = reuseChecksum ? { blob: new WeakRef(blob), crc } : undefined;
    const local = new Uint8Array(30 + filename.length + (this.zip64 ? 20 : 0)), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true);
    l.setUint16(12, 33, true); // 1980-01-01, deterministic DOS date
    l.setUint32(14, crc, true); l.setUint32(18, blob.size, true); l.setUint32(22, blob.size, true);
    l.setUint16(26, filename.length, true); local.set(filename, 30);
    const central = new Uint8Array(46 + filename.length + (this.zip64 ? 28 : 0)), c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint16(14, 33, true); c.setUint32(16, crc, true);
    c.setUint32(20, blob.size, true); c.setUint32(24, blob.size, true);
    c.setUint16(28, filename.length, true); c.setUint32(42, this.offset, true); central.set(filename, 46);
    if (this.zip64) {
      l.setUint16(4,45,true); l.setUint32(18,0xffffffff,true); l.setUint32(22,0xffffffff,true); l.setUint16(28,20,true);
      const extra=30+filename.length;
      l.setUint16(extra,1,true); l.setUint16(extra+2,16,true);
      l.setBigUint64(extra+4,BigInt(blob.size),true); l.setBigUint64(extra+12,BigInt(blob.size),true);
      c.setUint16(4,45,true); c.setUint16(6,45,true); c.setUint32(20,0xffffffff,true); c.setUint32(24,0xffffffff,true); c.setUint32(42,0xffffffff,true); c.setUint16(30,28,true);
      const directoryExtra=46+filename.length;
      c.setUint16(directoryExtra,1,true); c.setUint16(directoryExtra+2,24,true);
      c.setBigUint64(directoryExtra+4,BigInt(blob.size),true); c.setBigUint64(directoryExtra+12,BigInt(blob.size),true); c.setBigUint64(directoryExtra+20,BigInt(this.offset),true);
    }
    if (this.sink) {
      try {
        await this.sink(new Blob([local]));
        signal?.throwIfAborted();
        await this.sink(blob);
        signal?.throwIfAborted();
      } catch (error) { this.failed = true; throw error; }
    } else this.parts.push(local, blob);
    this.directory.push(central); this.names.add(key);
    for (const parent of parents) this.directories.add(parent);
    this.offset += local.length + blob.size; this.directorySize += central.length;
  }

  async finishToSink(signal?: AbortSignal): Promise<void> {
    this.ready();
    if (!this.sink) throw new Error('PNG archive has no output stream.');
    try {
      signal?.throwIfAborted();
      await this.sink(this.trailer());
      signal?.throwIfAborted();
      this.ended = true;
      this.directory = [];
    } catch (error) { this.failed = true; throw error; }
  }

  finish(): Blob {
    this.ready();
    if (this.sink) throw new Error('Use streaming archive completion.');
    return this.trailer();
  }

  private trailer(): Blob {
    const end = new Uint8Array(22), view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, this.names.size, true); view.setUint16(10, this.names.size, true);
    view.setUint32(12, this.directorySize, true); view.setUint32(16, this.offset, true);
    const extensions: BlobPart[] = [];
    if (this.zip64) {
      const record=new Uint8Array(56),r=new DataView(record.buffer);
      r.setUint32(0,0x06064b50,true);r.setBigUint64(4,44n,true);r.setUint16(12,45,true);r.setUint16(14,45,true);
      r.setBigUint64(24,BigInt(this.names.size),true);r.setBigUint64(32,BigInt(this.names.size),true);
      r.setBigUint64(40,BigInt(this.directorySize),true);r.setBigUint64(48,BigInt(this.offset),true);
      const locator=new Uint8Array(20),l=new DataView(locator.buffer);
      l.setUint32(0,0x07064b50,true);l.setBigUint64(8,BigInt(this.offset+this.directorySize),true);l.setUint32(16,1,true);
      view.setUint32(12,0xffffffff,true);view.setUint32(16,0xffffffff,true);
      extensions.push(record,locator);
    }
    return new Blob([...this.parts, ...this.directory, ...extensions, end], { type: 'application/zip' });
  }
}
