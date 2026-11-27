import type { Project } from '../../document/src';
import { exportHTML } from '../../export-web/src';
import png from '../../../apps/editor/src-tauri/icons/icon.png?inline';

export const playerPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data: blob:',
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export function decodePlayerIcon(data = png): Blob {
  return new Blob([Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), c => c.charCodeAt(0))]);
}

export async function preparePlayerAssets(project: Project) {
  const title = Array.from(project.name.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim())
    .slice(0, 100).join('') || 'Splash animation';
  const filename = title.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'splash-animation';
  const identity = new TextEncoder().encode(project.id);
  const html = exportHTML(project);
  const start = html.indexOf('<script>');
  const end = html.lastIndexOf('</script>');
  if (start < 0 || end < start) throw new Error('The standalone player script could not be packaged.');
  const index = html.slice(0, start) + '<script src="./player.js"></script>' + html.slice(end + 9);
  const identifier = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', identity))
    .subarray(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
  return { title, filename, identifier, index, script: html.slice(start + 8, end) };
}
