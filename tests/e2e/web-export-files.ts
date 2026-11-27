import type { Download, Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function readWebExport(bytes: Buffer) {
  const files = new Map<string, Buffer>();
  let root = '';
  for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) {
    if (bytes.readUInt16LE(offset + 8) !== 0) throw Error('Expected a stored ZIP entry.');
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLength + bytes.readUInt16LE(offset + 28);
    const path = bytes.toString('utf8', offset + 30, offset + 30 + nameLength);
    const [folder, ...parts] = path.split('/');
    root ||= folder;
    if (root !== folder || !parts.length || !parts.every(part => /^[\w-]+(?:\.[\w-]+)*$/.test(part)))
      throw Error('Unexpected export ZIP path.');
    files.set(parts.join('/'), bytes.subarray(start, start + size));
    offset = start + size;
  }
  if (!files.has('index.html')) throw Error('Missing export entry point.');
  return files;
}

export async function readWebDownload(download: Download) {
  return readWebExport(await readFile((await download.path())!));
}

export async function extractWebDownload(download: Download, folder: string) {
  for (const [path, bytes] of await readWebDownload(download)) {
    const target = join(folder, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
  }
  return join(folder, 'index.html');
}

export async function openWebExport(page: Page, files: Map<string, Buffer>, manualClock = false) {
  const root = 'http://web-export.test/published/';
  const types: Record<string, string> = {
    html: 'text/html', js: 'text/javascript', png: 'image/png', ttf: 'font/ttf', wav: 'audio/wav', ogg: 'audio/ogg',
  };
  await page.route(root + '**', route => {
    const name = route.request().url().slice(root.length);
    const body = files.get(name);
    const extension = name.split('.').at(-1)!;
    return body ? route.fulfill({ body, contentType: types[extension] }) : route.fulfill({ status: 404 });
  });
  await page.goto(root + 'index.html');
  if (!manualClock) {
    await page.waitForFunction(() => {
      const context = document.querySelector('canvas')?.getContext('2d');
      return context?.getImageData(0, 0, 1, 1).data[3] === 255;
    });
  }
}

export function webExportData(script: string) {
  return JSON.parse(script.trim().replace(/^globalThis\.animation = /, '').replace(/;$/, ''));
}
