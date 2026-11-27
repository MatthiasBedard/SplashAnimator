import type { Asset, Vector } from '@splash/document';

/** Resolve paint dependencies from admitted export artwork. Preserve
 * library order so the serialized browser asset table remains stable. */
export function resolveExportPaintAssets(
  assets: readonly Asset[],
  artwork: Iterable<Vector>,
  additionalBitmaps: Iterable<string> = [],
) {
  const referencedBitmaps = new Set(additionalBitmaps);
  const embeddedFonts = assets.flatMap(asset => asset.font ? [asset.font] : []);
  const fontFamilies = new Set(embeddedFonts.map(font => font.family.toLowerCase()));
  const usedFonts = new Set<string>();
  for (const shape of artwork) {
    if (shape.bitmap) referencedBitmaps.add(shape.bitmap.assetId);
    const { text } = shape;
    if (!text || !fontFamilies.size) continue;
    for (const stack of [text.font, ...(text.runs ?? []).map(run => run.style.font)]) {
      for (const family of stack?.split(',') ?? []) {
        const key = family.trim().toLowerCase();
        if (fontFamilies.has(key)) usedFonts.add(key);
      }
    }
  }
  const bitmapAssets = assets.filter(asset => referencedBitmaps.has(asset.id));
  if (bitmapAssets.length !== referencedBitmaps.size || bitmapAssets.some(asset => !asset.bitmap?.dataUrl))
    throw Error('Cannot export: a referenced bitmap asset is missing.');
  const fonts = embeddedFonts.filter(font => usedFonts.has(font.family.toLowerCase()));
  if (fonts.some(font => !font.dataUrl))
    throw Error('Cannot export: a referenced embedded font file is missing.');
  return { bitmapAssets, fonts };
}
