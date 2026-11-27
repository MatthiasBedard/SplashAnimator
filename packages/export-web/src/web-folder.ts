export type WebFolderFiles = Map<string, string | Uint8Array>;
export type WebCanvasSizing = 'fit' | 'shrink' | 'actual';

export function webCanvasLayout(sizing: WebCanvasSizing, width: number, height: number, audio: boolean) {
  const fit = `100cqw, calc(100cqh * ${width / height})`;
  const canvasWidth = sizing === 'fit' ? `min(${fit})`
    : sizing === 'actual' ? `${width}px` : `min(${width}px, ${fit})`;
  return `body{height:100vh;height:100dvh;grid-template: ${audio ? 'minmax(0,1fr) auto' : 'minmax(0,1fr)'} / minmax(0,1fr)}
main.web-stage{box-sizing:border-box;width:100%;height:100%;min-height:0;overflow:auto;container-type:size;display:grid;align-items:safe center;justify-items:safe center}
main.web-stage canvas{display:block;width:${canvasWidth};height:auto;max-width:none;max-height:none}`;
}

export function addWebMedia(files: WebFolderFiles, path: string, dataUrl: string): string {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  files.set(path, Uint8Array.from(atob(payload), character => character.charCodeAt(0)));
  return path;
}

/** Classic scripts can load from disk. Keep JSON data escaped inside the script. */
export function webDataScript(variable: 'animation' | 'localMedia', data: unknown): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `globalThis.${variable} = ${json};\n`;
}

export function webPlayerScript(player: string, hasLocalMedia: boolean): string {
  return `(async () => {
  const animation = globalThis.animation;
  delete globalThis.animation;
  if (!animation) throw Error('Animation data could not be loaded.');
  ${hasLocalMedia ? `if (location.protocol === 'file:') {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'data/local-media.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  }` : ''}
  const localMedia = globalThis.localMedia;
  delete globalThis.localMedia;
  ${player}
})().catch(() => {
  const message = document.createElement('p');
  message.className = 'asset-error';
  message.setAttribute('role', 'alert');
  message.textContent = 'The animation could not be loaded. Open index.html from the complete export folder.';
  document.querySelector('canvas')?.replaceWith(message);
});\n`;
}
