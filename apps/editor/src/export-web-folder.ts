import type { WebFolderFiles } from '../../../packages/export-web/src/web-folder';
import { PNGArchive } from './png-archive';
import { desktop, request } from './storage';

function encodeBinaryEntry(bytes: Uint8Array) {
  // Use chunks below the argument limit and divisible by three so only the
  // last chunk can introduce Base64 padding.
  const chunkSize = 24_576;
  let encoded = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    encoded += btoa(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return encoded;
}

/** Publish a complete compiled folder through the OS chooser or a browser download. */
export async function publishWebFolder(
  name: string,
  files: WebFolderFiles,
  check: () => void,
  signal: AbortSignal,
) {
  const folder = `${name.trim().replace(/ +/g, '-').slice(0, 70) || 'animation'}-web`;
  if (desktop) {
    const entries = Array.from(files, ([path, content]) =>
      typeof content === 'string'
        ? { path, text: content }
        : { path, base64: encodeBinaryEntry(content) },
    );
    check();
    return !!(await request<string | null>('export-web-folder', {
      project: folder,
      files: entries,
    }));
  }
  const zip = PNGArchive.forFileTree();
  for (const [path, content] of files) {
    check();
    await zip.add(
      `${folder}/${path}`,
      new Blob([typeof content === 'string' ? content : new Uint8Array(content)]),
      signal,
    );
  }
  check();
  const url = URL.createObjectURL(zip.finish());
  try {
    // The ZIP is complete, but a canceled or superseded job must not download it.
    check();
    const link = document.createElement('a');
    link.href = url;
    link.download = `${folder}.zip`;
    link.click();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
