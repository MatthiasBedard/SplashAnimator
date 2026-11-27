/** Sample validated, sorted, nonempty keys without scanning or copying artwork. */
export function createHeldKeySampler<T extends { frame: number }>(keys: readonly T[]) {
  let current = keys[0];
  let end = keys[1]?.frame ?? Infinity;
  return (frame: number): T => {
    if (frame >= current.frame && frame < end) return current;
    let low = 0, high = keys.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (keys[middle].frame <= frame) low = middle + 1;
      else high = middle;
    }
    const index = Math.max(0, low - 1);
    current = keys[index];
    end = keys[index + 1]?.frame ?? Infinity;
    return current;
  };
}
