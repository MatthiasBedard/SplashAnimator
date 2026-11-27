import type { BlendMode } from '../../document/src/blend-modes';

type PixelBlend = (source: Uint8ClampedArray, backdrop: Uint8ClampedArray) => void;

/** Canvas has no native operators for these modes. Kept self-contained for HTML playback. */
export function softwareBlend(mode: BlendMode | undefined): PixelBlend | undefined {
  const clamp = (value: number) => Math.max(0, Math.min(255, value));
  const burn = (base: number, source: number) =>
    base === 255 ? 255 : source === 0 ? 0 : Math.max(0, 255 - (255 - base) * 255 / source);
  const dodge = (base: number, source: number) =>
    base === 0 ? 0 : source === 255 ? 255 : Math.min(255, base * 255 / (255 - source));

  // Interpolate with the original source where the backdrop is only partly opaque.
  // Canvas then handles source-over, object opacity and the destination clip.
  function channels(blend: (base: number, source: number) => number): PixelBlend {
    return (source, backdrop) => {
      for (let i = 0; i < source.length; i += 4) {
        if (!source[i + 3] || !backdrop[i + 3]) continue;
        const coverage = backdrop[i + 3] / 255;
        for (let channel = i; channel < i + 3; channel++)
          source[channel] += coverage * (blend(backdrop[channel], source[channel]) - source[channel]);
      }
    };
  }

  function wholeColor(lighter: boolean): PixelBlend {
    return (source, backdrop) => {
      for (let i = 0; i < source.length; i += 4) {
        if (!source[i + 3] || !backdrop[i + 3]) continue;
        const baseTotal = backdrop[i] + backdrop[i + 1] + backdrop[i + 2];
        const sourceTotal = source[i] + source[i + 1] + source[i + 2];
        if (lighter ? sourceTotal > baseTotal : sourceTotal < baseTotal) continue;
        const coverage = backdrop[i + 3] / 255;
        for (let channel = i; channel < i + 3; channel++)
          source[channel] += coverage * (backdrop[channel] - source[channel]);
      }
    };
  }

  switch (mode) {
    case 'linear-burn': return channels((base, source) => Math.max(0, base + source - 255));
    case 'darker-color': return wholeColor(false);
    case 'linear-dodge': return channels((base, source) => Math.min(255, base + source));
    case 'lighter-color': return wholeColor(true);
    case 'vivid-light': return channels((base, source) =>
      source < 127.5 ? burn(base, 2 * source) : dodge(base, 2 * source - 255));
    case 'linear-light': return channels((base, source) => clamp(base + 2 * source - 255));
    case 'pin-light': return channels((base, source) =>
      source < 127.5 ? Math.min(base, 2 * source) : Math.max(base, 2 * source - 255));
    case 'hard-mix': return channels((base, source) => base + source >= 255 ? 255 : 0);
    case 'subtract': return channels((base, source) => Math.max(0, base - source));
    case 'divide': return channels((base, source) => source === 0 ? 255 : Math.min(255, 255 * base / source));
    default: return undefined;
  }
}
