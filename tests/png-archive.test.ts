import { expect, it, vi } from 'vitest';
import { crc32 } from 'node:zlib';
import { PNGArchive } from '../apps/editor/src/png-archive';

it('writes stored ZIP entries with standard CRC32 and matching central offsets', async () => {
  const archive = new PNGArchive();
  await archive.add('sequence.json', new Blob(['123456789']));
  await archive.add('frame-000001.png', new Blob([new Uint8Array([0, 255, 128])]));
  const bytes = new Uint8Array(await archive.finish().arrayBuffer()), view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 10, true)).toBe(2);
  let central = view.getUint32(end + 16, true);
  expect(central + view.getUint32(end + 12, true)).toBe(end);
  for (const [name, data, crc] of [['sequence.json', [...new TextEncoder().encode('123456789')], 0xcbf43926], ['frame-000001.png', [0, 255, 128], undefined]] as const) {
    expect(view.getUint32(central, true)).toBe(0x02014b50);
    const local = view.getUint32(central + 42, true), length = view.getUint16(central + 28, true);
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint16(local + 8, true)).toBe(0);
    expect(view.getUint32(local + 18, true)).toBe(data.length);
    expect(view.getUint32(central + 20, true)).toBe(data.length);
    expect(view.getUint32(local + 14, true)).toBe(view.getUint32(central + 16, true));
    if (crc !== undefined) expect(view.getUint32(local + 14, true)).toBe(crc);
    expect(new TextDecoder().decode(bytes.slice(central + 46, central + 46 + length))).toBe(name);
    expect(new TextDecoder().decode(bytes.slice(local + 30, local + 30 + length))).toBe(name);
    expect([...bytes.slice(local + 30 + length, local + 30 + length + data.length)]).toEqual(data);
    central += 46 + length;
  }
});

it('rejects size overflow, duplicate names and cancellation without adding partial entries', async () => {
  const archive = new PNGArchive(150);
  await archive.add('one', new Blob(['123456789']));
  const before = await archive.finish().arrayBuffer();
  await expect(archive.add('two', new Blob(['x'.repeat(100)]))).rejects.toThrow('size limit');
  await expect(archive.add('one', new Blob([]))).rejects.toThrow('duplicate');
  await expect(archive.add('../escape', new Blob([]))).rejects.toThrow('filename');
  const controller = new AbortController(); controller.abort();
  await expect(archive.add('two', new Blob([]), controller.signal)).rejects.toThrow();
  expect(await archive.finish().arrayBuffer()).toEqual(before);
});

it('writes safe Android file trees without enabling paths for PNG archives', async () => {
  const paths = PNGArchive.forFileTree();
  const file = new Blob(['source']);
  await paths.add('src/main/player.js', file);
  const before = await paths.finish().arrayBuffer();
  for (const name of ['src', 'src/MAIN', 'src/main/PLAYER.JS', 'src/main/player.js/item',
    '/absolute', '../escape', 'src/../escape', 'src//main', 'src\\file', 'src/aux.txt'])
    await expect(paths.add(name, file)).rejects.toThrow('filename');
  await expect(new PNGArchive().add('src/main/player.js', file)).rejects.toThrow('filename');
  const bytes = new DataView(await paths.finish().arrayBuffer());
  expect(bytes.buffer).toEqual(before);
  const directory = bytes.getUint32(bytes.byteLength - 6, true);
  for (const offset of [30, directory + 46])
    expect(new TextDecoder().decode(new Uint8Array(bytes.buffer, offset, 18))).toBe('src/main/player.js');
});

it('matches native CRC32 across word tails and more than one bounded chunk', async () => {
  const data = Uint8Array.from({ length: 2 * 1024 * 1024 + 7 },
    (_, index) => ((index >>> 9) ^ Math.imul(index, 97)) & 255);
  for (const size of [data.length - 3, data.length - 2, data.length - 1, data.length]) {
    const archive = new PNGArchive();
    const input = data.subarray(0, size);
    await archive.add('frame.png', new Blob([input]));
    const bytes = new DataView(await archive.finish().arrayBuffer());
    const directory = bytes.getUint32(bytes.byteLength - 6, true);
    expect(bytes.getUint32(14, true)).toBe(crc32(input));
    expect(bytes.getUint32(directory + 16, true)).toBe(crc32(input));
  }
});

it('reuses an admitted immutable frame checksum while keeping separate named entries', async () => {
  const chunks: Blob[] = [];
  const archive = new PNGArchive(0xffffffff, async part => { chunks.push(part); });
  const first = new Blob(['first exposure']);
  const read = vi.spyOn(first, 'slice');
  await archive.add('frame-000001.png', first, undefined, true);
  await archive.add('frame-000002.png', first, undefined, true);
  expect(read).toHaveBeenCalledOnce();
  await archive.add('frame-000003.png', new Blob(['changed exposure']), undefined, true);
  await archive.finishToSink();
  const bytes = await new Blob(chunks).arrayBuffer();
  const view = new DataView(bytes);
  let record = view.getUint32(view.byteLength - 6, true);
  for (const [index, source] of ['first exposure', 'first exposure', 'changed exposure'].entries()) {
    expect(view.getUint32(record + 16, true)).toBe(crc32(Buffer.from(source)));
    const length = view.getUint16(record + 28, true);
    expect(new TextDecoder().decode(new Uint8Array(bytes, record + 46, length))).toBe(`frame-00000${index + 1}.png`);
    record += 46 + length;
  }
});

it('cancels while checksumming a large entry without retaining a partial record', async () => {
  const archive = new PNGArchive(), controller = new AbortController();
  const adding = archive.add('frame.png', new Blob([new Uint8Array(3 * 1024 * 1024)]), controller.signal);
  setTimeout(() => controller.abort(), 0);
  await expect(adding).rejects.toThrow();
  expect(archive.finish().size).toBe(22);
});


it('streams the same ZIP bytes while releasing entry output between writes', async()=>{
  const chunks:Blob[]=[],stream=new PNGArchive(0xffffffff,async part=>{chunks.push(part);}),memory=new PNGArchive();
  for(const [name,data] of [['sequence.json','metadata'],['frame.png','123456789']]){await stream.add(name,new Blob([data]));await memory.add(name,new Blob([data]));}
  expect(chunks.length).toBe(4);expect(()=>stream.finish()).toThrow(/streaming/);
  await stream.finishToSink();expect(await new Blob(chunks).arrayBuffer()).toEqual(await memory.finish().arrayBuffer());
  await expect(stream.add('later',new Blob([]))).rejects.toThrow(/closed/);
  await expect(stream.finishToSink()).rejects.toThrow(/closed/);
});

it('poisons a streaming archive after write failure or cancellation between records',async()=>{
  for(const cancel of [false,true]){
    const controller=new AbortController();let calls=0;
    const archive=new PNGArchive(0xffffffff,async()=>{calls++;if(cancel)controller.abort();else throw new Error('disk full');});
    await expect(archive.add('frame.png',new Blob(['data']),controller.signal)).rejects.toThrow();expect(calls).toBe(1);
    await expect(archive.finishToSink()).rejects.toThrow(/failed/);await expect(archive.add('later',new Blob([]))).rejects.toThrow(/failed/);
  }
});


it('writes ZIP64 sizes, offsets, directory and locator without changing entry bytes',async()=>{
  const archive=new PNGArchive(Number.MAX_SAFE_INTEGER,undefined,true);
  await archive.add('frame.png',new Blob(['123456789']));
  const bytes=await archive.finish().arrayBuffer(),v=new DataView(bytes),nameLength=9;
  expect(v.getUint16(4,true)).toBe(45);expect(v.getUint32(18,true)).toBe(0xffffffff);expect(v.getUint16(28,true)).toBe(20);
  expect(v.getBigUint64(30+nameLength+4,true)).toBe(9n);
  const end=bytes.byteLength-22,locator=end-20,record=locator-56;
  expect(v.getUint32(locator,true)).toBe(0x07064b50);expect(v.getBigUint64(locator+8,true)).toBe(BigInt(record));
  expect(v.getUint32(record,true)).toBe(0x06064b50);expect(v.getBigUint64(record+32,true)).toBe(1n);
  const central=Number(v.getBigUint64(record+48,true));expect(v.getUint32(central,true)).toBe(0x02014b50);
  expect(v.getBigUint64(central+46+nameLength+20,true)).toBe(0n);
  expect(new TextDecoder().decode(new Uint8Array(bytes,30+nameLength+20,9))).toBe('123456789');
});


it('retains offsets above 4 GiB in streaming ZIP64 metadata',async()=>{
  const chunks:Blob[]=[],archive=new PNGArchive(Number.MAX_SAFE_INTEGER,async part=>{chunks.push(part);},true);
  // Simulate already-written data without allocating a multi-gigabyte fixture.
  (archive as unknown as {offset:number}).offset=0x100000000;
  await archive.add('empty',new Blob([]));await archive.finishToSink();
  const v=new DataView(await chunks[2].arrayBuffer());
  expect(v.getBigUint64(46+5+20,true)).toBe(0x100000000n);
  const record=v.byteLength-22-20-56;
  expect(v.getBigUint64(record+48,true)).toBe(0x100000000n+55n);
});
