import type { Asset } from '@splash/document';
const cache = new Map<
  string,
  { image: HTMLImageElement; ready: boolean; listeners: Set<() => void> }
>();
/** Decoded images are shared; project validation bounds referenced pixels. */
export function bitmapImage(
  assets: Asset[],
  assetId: string,
  onReady?: () => void,
): HTMLImageElement | undefined {
  const active = new Set(assets.map((a) => a.bitmap?.dataUrl));
  for (const key of cache.keys()) if (!active.has(key)) cache.delete(key);
  const data = assets.find((a) => a.id === assetId)?.bitmap?.dataUrl;
  if (!data) return;
  let entry = cache.get(data);
  if (!entry) {
    entry = { image: new Image(), ready: false, listeners: new Set() };
    const created = entry;
    created.image.onload = () => {
      created.ready = true;
      for (const callback of created.listeners) callback();
      created.listeners.clear();
    };
    created.image.onerror = () => {
      created.listeners.clear();
    };
    cache.set(data, created);

    created.image.src = data;
  } else {
    cache.delete(data);
    cache.set(data, entry);
  }
  if (entry.ready) return entry.image;
  if (onReady) entry.listeners.add(onReady);
}
