import { promises as fs } from 'node:fs';
import { isScriptPath } from './script-path';
import path from 'node:path';
import { id, safePath } from './index';
import type { DirectoryStore, AudioAssetStore } from './storage';
export class NodeDirectoryStore implements DirectoryStore, AudioAssetStore {
  constructor(readonly root: string) {
    if (!root.endsWith('.spl')) throw new Error('Project must be a .spl directory');
  }
  async resolve(relative: string): Promise<string> {
    safePath(relative);
    const root = path.resolve(this.root);
    // Reject symlinks/reparse points at every existing component, including root ancestors.
    const parsed = path.parse(root);
    let current = parsed.root;
    for (const part of [
      ...root.slice(parsed.root.length).split(path.sep),
      ...relative.split('/'),
    ]) {
      current = path.join(current, part);
      try {
        if ((await fs.lstat(current)).isSymbolicLink())
          throw new Error('Symbolic links are not allowed in projects');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    return path.join(root, relative);
  }
  async read(relative: string) {
    const file = await this.resolve(relative);
    if ((await fs.stat(file)).size > 32 * 1024 * 1024)
      throw new Error('Project JSON exceeds 32 MiB limit');
    return fs.readFile(file, 'utf8');
  }
  async exists(relative: string) {
    try {
      await fs.access(await this.resolve(relative));
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw e;
    }
  }
  async writeNew(relative: string, content: string) {
    const file = await this.resolve(relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const handle = await fs.open(file, 'wx');
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  private audioPath(relative:string){
    safePath(relative);
    if(!relative.startsWith('assets/audio/')||!relative.endsWith('.wav'))throw new Error('Invalid audio asset path');
  }
  async readAudio(relative:string,signal?:AbortSignal):Promise<Uint8Array>{
    this.audioPath(relative);signal?.throwIfAborted();
    const file=await this.resolve(relative),handle=await fs.open(file,'r');
    try{
      const stat=await handle.stat();
      if(!stat.isFile()||stat.size<12||stat.size>64*1024*1024)throw new Error('Audio asset exceeds WAV byte limits');
      // One sentinel byte detects growth without an unbounded readFile allocation.
      const bytes=new Uint8Array(stat.size+1);let read=0;
      while(read<bytes.length){signal?.throwIfAborted();const chunk=await handle.read(bytes,read,bytes.length-read,null);if(!chunk.bytesRead)break;read+=chunk.bytesRead;}
      signal?.throwIfAborted();
      if(read!==stat.size)throw new Error('Audio asset size changed while reading');
      return bytes.slice(0,read);
    }finally{await handle.close();}
  }
  async writeNewAudio(relative:string,bytes:Uint8Array,signal?:AbortSignal):Promise<void>{
    this.audioPath(relative);signal?.throwIfAborted();
    const tag=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),Symbol.toStringTag)!.get!;
    const length=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!;
    if(tag.call(bytes)!=='Uint8Array'||bytes.byteLength<12||bytes.byteLength>64*1024*1024)throw new Error('Invalid audio asset bytes');
    try{length.call(bytes.buffer);}catch{throw new Error('Audio asset requires nonshared bytes');}
    const snapshot=new Uint8Array(bytes.length);snapshot.set(bytes);
    const file=await this.resolve(relative);await fs.mkdir(path.dirname(file),{recursive:true});
    const temp=`${file}.${id()}.tmp`;let created=false;
    try{
      signal?.throwIfAborted();const handle=await fs.open(temp,'wx');created=true;
      try{await handle.writeFile(snapshot);await handle.sync();}finally{await handle.close();}
      signal?.throwIfAborted();
      // Atomic no-replace publication on the same filesystem. Never rename over artwork.
      // Cancellation after this boundary cannot revoke the successful write.
      await fs.link(temp,file);
    }finally{if(created)await fs.unlink(temp);}
  }
  async listScripts(): Promise<string[]> {
    const files: string[] = [], folders = ['scripts'];
    if (!(await this.exists('scripts'))) return files;
    while (folders.length) {
      const folder = folders.pop()!;
      for (const entry of await fs.readdir(await this.resolve(folder), { withFileTypes: true })) {
        const name = folder + '/' + entry.name;
        if (entry.isDirectory() && isScriptPath(name + '/file.ts')) folders.push(name);
        else if (entry.isFile() && isScriptPath(name)) files.push(name);
      }
    }
    return files.sort();
  }
  async commit(relative: string, content: string, expected: string | null) {
    if (isScriptPath(relative) && Buffer.byteLength(content, 'utf8') > 32 * 1024 * 1024)
      throw new Error('Script exceeds 32 MiB limit');
    if (!isScriptPath(relative) && !['project.json', '.splash/autosaves/latest.json'].includes(relative))
      throw new Error('Invalid commit target');
    const file = await this.resolve(relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const lock = await fs.open(`${file}.lock`, 'wx').catch(() => {
      throw new Error(
        'Project is busy or has a stale lock; close other editors before removing the .lock file',
      );
    });
    const temp = `${file}.${id()}.tmp`;
    try {
      const current = (await this.exists(relative)) ? await this.read(relative) : null;
      if (current !== expected)
        throw new Error('Project changed on disk. Reopen or Save As to avoid overwriting changes.');
      if (current !== null && !isScriptPath(relative)) await this.writeNew(`.splash/autosaves/previous-${id()}.json`, current);
      const h = await fs.open(temp, 'wx');
      try {
        await h.writeFile(content);
        await h.sync();
      } finally {
        await h.close();
      }
      await fs.rename(temp, file);
    } finally {
      await lock.close();
      await fs.unlink(`${file}.lock`);
      await fs.unlink(temp).catch(() => {});
    }
  }
}
export async function createDirectory(root: string): Promise<void> {
  if (!root.endsWith('.spl')) throw new Error('Expected .spl directory');
  await fs.mkdir(root); // Exclusive: never re-use a destination silently.
  for (const dir of [
    'scenes',
    'timelines',
    'symbols',
    'vectors',
    'scripts',
    'assets/images',
    'assets/audio',
    'assets/video',
    'assets/fonts',
    'assets/imported',
    'settings',
    '.splash/autosaves',
    '.splash/cache',
  ])
    await fs.mkdir(path.join(root, dir), { recursive: true });
  await fs.writeFile(
    path.join(root, 'scripts/main.ts'),
    '// TypeScript runtime is planned for M5. This source is preserved, not executed.\n',
  );
  await fs.writeFile(path.join(root, 'settings/export.json'), '{"format":"html"}\n');
}
export async function duplicateDirectory(source: string, target: string): Promise<void> {
  await fs.mkdir(target);
  async function copy(from: string, to: string): Promise<void> {
    for (const e of await fs.readdir(from, { withFileTypes: true })) {
      if (e.isSymbolicLink())
        throw new Error('Cannot duplicate a project containing symbolic links');
      const src = path.join(from, e.name),
        dest = path.join(to, e.name);
      if (e.isDirectory()) {
        await fs.mkdir(dest);
        await copy(src, dest);
      } else if (e.isFile()) await fs.copyFile(src, dest, 1);
    }
  }
  await copy(source, target);
}
