/** Shared explicit working-raster planning guard, not a browser heap limit. */
export const MASK_WORKING_PIXELS = 64 * 1024 * 1024;
export function admitMaskRaster(width: number, height: number, decodedPixels = 0) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384 ||
    !Number.isSafeInteger(decodedPixels) ||
    decodedPixels < 0 ||
    4 * width * height + decodedPixels > MASK_WORKING_PIXELS
  )
    throw Error('Mask working rasters exceed the shared 64-megapixel budget.');
}
