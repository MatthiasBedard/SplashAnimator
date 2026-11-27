import runtimeAsset from './standalone-script-runtime.ts?worker&url';
import workerAsset from '../../../packages/scripting/src/quickjs-frame-worker.ts?worker&url';
import { compileScriptProgram } from '../../../packages/scripting/src/compile-program';
import { exportInteractiveArtworkHTML } from '../../../packages/export-web/src';
import type { Project } from '@splash/document';

async function readBundledRuntime(path: string, signal: AbortSignal) {
  const url = new URL(path, location.href);
  if (url.origin !== location.origin) throw Error('The standalone runtime must come from this editor build.');
  const response = await fetch(url, { signal, redirect: 'error' });
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.ok || !response.body || !['text/javascript', 'application/javascript', 'application/x-javascript'].includes(mime ?? ''))
    throw Error('The standalone runtime could not be loaded as JavaScript.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '', size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2 * 1024 * 1024) throw Error('The standalone runtime exceeds its byte budget.');
      text += decoder.decode(chunk.value, { stream: true });
    }
    if (!size) throw Error('The standalone runtime is empty.');
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {});reader.releaseLock(); }
}

const policy = `default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; worker-src blob:; img-src data: blob:; font-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
const transport = `<style>
body{grid-template-rows:minmax(0,1fr) auto;color:#f4f5f8;font:16px system-ui}
canvas{max-height:100%}.script-controls{padding:12px;display:grid;gap:8px;justify-items:center}
.script-controls p{margin:0;text-align:center}.script-controls input,.script-controls button{font:inherit}
</style><section class="script-controls" aria-label="Script playback">
<div><button id="script-play" disabled>Play scripts</button> <button id="script-step" disabled>Step script</button></div>
<form id="script-input"><label>Script input JSON <input maxlength="65536" value="{}"></label> <button disabled>Send JSON</button></form>
<p id="script-status" role="status">Preparing script playback…</p></section>`;

export async function buildInteractiveScriptHTML(project: Project, signal: AbortSignal, validate: () => void) {
  const active = () => { signal.throwIfAborted();validate();signal.throwIfAborted(); };
  active();
  if (import.meta.env.DEV) throw Error('Interactive HTML requires a built editor.');
  const sources = project.frameScripts ?? [];
  if (!sources.length) throw Error('Attach at least one main-timeline script before exporting.');
  const { program, diagnostics } = await compileScriptProgram({
    duration: project.duration, fps: project.fps, seed: 0,
    ...(project.frameLabels ? { frameLabels: project.frameLabels } : {}),
  }, sources, { signal, standalone: true });
  active();
  if (!program) {
    const first = diagnostics[0];
    throw Error(first ? `Frame ${first.frame + 1}, line ${first.line}: ${first.message}` : 'No standalone script program was produced.');
  }
  const [runtime, worker] = await Promise.all([
    readBundledRuntime(runtimeAsset, signal), readBundledRuntime(workerAsset, signal),
  ]);
  active();
  const data = JSON.stringify({ config: program.config, frames: program.frames, worker }).replace(/</g, '\\u003c');
  const html = exportInteractiveArtworkHTML(project)
    .replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`)
    .replace(/<\/html>$/, () => `${transport}<script id="script-program" type="application/json">${data}</script><script>${runtime.replace(/<\/script/gi, '<\\/script')}</script></html>`);
  if (new TextEncoder().encode(html).length > 64 * 1024 * 1024) throw Error('Interactive HTML exceeds 64 MiB.');
  active();
  return html;
}
