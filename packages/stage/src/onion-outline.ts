/** One-device-pixel inner boundary of rendered alpha; RGB stays unchanged.
 * Minimum subtraction removes translucent interiors without multiplying their alpha.
 * One row stores the original alpha above each pixel during the in-place scan.
 */
export function outlineAlpha(data: Uint8ClampedArray, width: number, height: number): void {
  const above = new Uint8Array(width);
  for (let y = 0; y < height; y++) {
    let left = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4 + 3;
      const alpha = data[i];
      const inside =
        x > 0 && y > 0 && x < width - 1 && y < height - 1
          ? Math.min(left, data[i + 4], above[x], data[i + width * 4])
          : 0;
      data[i] = Math.max(0, alpha - inside);
      above[x] = left = alpha;
    }
  }
}
