import { decodeBitmap } from './bitmap';
import { exportPNGFrame } from './export-png';
import { newProject, validateProject, type Project, type Vector } from '../../../packages/document/src';

const rasterTypes = ['image/png', 'image/jpeg', 'image/webp'];
export type CanvasClipboardContent = { image: Blob } | { text: string };

export function canvasClipboardContent(data: DataTransfer): CanvasClipboardContent | undefined {
  const items = Array.from(data.items);
  const image = Array.from(data.files).find(file => rasterTypes.includes(file.type)) ??
    items.find(item => item.kind === 'file' && rasterTypes.includes(item.type))?.getAsFile();
  if (image) return { image };
  const text = data.getData('text/plain');
  if (text) return { text };
}

export async function readCanvasClipboard(clipboard: Clipboard): Promise<CanvasClipboardContent> {
  if (clipboard.read) {
    const items = await clipboard.read();
    for (const item of items) {
      const type = rasterTypes.find(type => item.types.includes(type));
      if (type) return { image: await item.getType(type) };
    }
    for (const item of items) {
      if (!item.types.includes('text/plain')) continue;
      const blob = await item.getType('text/plain');
      if (blob.size > 40000) throw Error('Text is limited to 10,000 characters.');
      return { text: await blob.text() };
    }
  } else if (clipboard.readText) return { text: await clipboard.readText() };
  throw Error('Copy a PNG, JPEG, WebP or plain text to the clipboard first.');
}

export function decodeClipboardImage(image: Blob) {
  const extension = image.type === 'image/jpeg' ? 'jpg' : image.type === 'image/webp' ? 'webp' : 'png';
  return decodeBitmap(new File([image], `Clipboard image.${extension}`, { type: image.type }));
}

/** Read a single native PNG representation. HTML, URLs and vector markup are never interpreted. */
export async function readClipboardPng(clipboard: Pick<Clipboard, 'read'>) {
  const items = await clipboard.read();
  const images = items.filter(item => item.types.includes('image/png'));
  if (images.length !== 1) throw new Error('Copy one PNG image to the system clipboard, then try again.');
  const blob = await images[0].getType('image/png');
  return decodeBitmap(new File([blob], 'Clipboard PNG.png', { type: 'image/png' }), 'png');
}

/** Keep document coordinates. The detached renderer supplies bitmap and font readiness. */
export function prepareClipboardPng(project: Project, artwork: Vector[]) {
  if (!artwork.length || artwork.some(shape => shape.kind === 'symbol'))
    throw new Error('Select static artwork to copy as PNG. Symbol instances are not supported.');
  const bitmapIds = new Set(artwork.flatMap(shape => shape.bitmap ? [shape.bitmap.assetId] : []));
  const hasText = artwork.some(shape => shape.kind === 'text');
  const scene = newProject();
  Object.assign(scene, { width: project.width, height: project.height, duration: 1 });
  scene.layers[0].drawingMode = 'object';
  scene.layers[0].keys[0].shapes = structuredClone(artwork);
  scene.assets = structuredClone(project.assets.filter(asset =>
    bitmapIds.has(asset.id) || (hasText && asset.font)));
  return validateProject(scene);
}

export async function writeClipboardPng(
  clipboard: Pick<Clipboard, 'write'>, scene: Project, admit: () => void,
) {
  const controller = new AbortController();
  const png = Promise.resolve().then(async () => {
    controller.signal.throwIfAborted();
    const output = await exportPNGFrame(scene, 0, controller.signal, true);
    admit();
    return output;
  });
  // Dispatch the write while the click still owns browser user activation.
  void png.catch(() => {}); // The clipboard can reject synchronously before it consumes the promise.
  try {
    await Promise.all([clipboard.write([new ClipboardItem({ 'image/png': png })]), png]);
  } finally {
    controller.abort();
  }
}
