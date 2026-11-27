export type MotionGradientStops =
  boolean | 'ordered' | { pairs: 'auto' | readonly (readonly [number, number])[] };
export function validateGradientPairs(
  pairs: 'auto' | readonly (readonly [number, number])[],
): void {
  if (pairs === 'auto') return;
  if (
    !Array.isArray(pairs) ||
    !pairs.length ||
    pairs.length > 32 ||
    Array.from(pairs).some(
      (pair, i) =>
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        Array.from(pair).some((v) => !Number.isSafeInteger(v) || v < 0) ||
        (i === 0
          ? pair[0] !== 0 || pair[1] !== 0
          : pair.some((v, side) => v < pairs[i - 1][side] || v > pairs[i - 1][side] + 1) ||
            pair.every((v, side) => v === pairs[i - 1][side])),
    )
  )
    throw new Error(
      'Gradient group pairs must cover both ordered group lists from zero without skips, reversals or duplicate pairs (maximum 32).',
    );
}
export function validateMotionGradientStops(value: unknown): asserts value is MotionGradientStops {
  if (typeof value === 'boolean' || value === 'ordered') return;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('pairs' in value)
  )
    throw new Error('Invalid gradient stop matching recipe.');
  validateGradientPairs(value.pairs as 'auto' | readonly (readonly [number, number])[]);
}
