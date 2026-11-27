import {
  symbolArtworks,
  MAX_SYMBOL_ARTWORK,
  type SymbolDefinition,
  type Vector,
} from '../../document/src';

export function graphicFrameAtAge(
  duration: number, mode: 'single' | 'once' | 'loop', firstFrame: number, age: number,
): number {
  const first = Math.min(firstFrame, duration - 1);
  if (mode === 'single') return first;
  if (mode === 'once') return Math.min(first + age, duration - 1);
  return (first + age) % duration;
}

/** Graphic playback is driven by exposure age. Baked keys must carry that age forward. */
export function motionSymbolPlayback(symbols: SymbolDefinition[]) {
  const definitions = new Map(symbols.map((s) => [s.id, s]));
  const heights = new Map<string, number>();
  let visits = 0;
  function playback(shape: Vector) {
    const p = shape.symbolPlayback;
    if (
      p !== undefined &&
      (!p ||
        !['loop', 'once', 'single', 'movie'].includes(p.mode) ||
        !Number.isInteger(p.firstFrame) ||
        p.firstFrame < 0 ||
        p.firstFrame >= 10000)
    )
      throw new Error('Motion requires valid playback settings.');
  }
  function inspect(id: string, ancestry: string[], behindMovie: boolean): number {
    if (ancestry.includes(id) || ancestry.length >= 8)
      throw new Error('Motion symbol cycle or depth limit.');
    // A cached descendant button must never authorize a later direct button or graphic root.
    const cacheKey = JSON.stringify([id, behindMovie, ancestry.length === 0]);
    const cached = heights.get(cacheKey);
    if (cached !== undefined) {
      if (ancestry.length + cached > 8) throw new Error('Motion symbol depth limit.');
      return cached;
    }
    const definition = definitions.get(id);
    if (!definition) throw new Error('Motion symbol definition is missing.');
    if (definition.buttonStates && (!behindMovie || ancestry.length === 0))
      throw new Error('Motion buttons require a containing movie boundary.');
    const duration = definition.timeline?.duration ?? 1;
    if (!Number.isInteger(duration) || duration < 1 || duration > 10000)
      throw new Error('Motion symbol duration is invalid.');
    if (
      definition.buttonStates &&
      ['up', 'over', 'down', 'hit'].some((state) => {
        const frame = definition.buttonStates![state as keyof typeof definition.buttonStates];
        return !Number.isInteger(frame) || frame < 0 || frame >= duration;
      })
    )
      throw new Error('Motion button state mapping is invalid.');
    let height = 1;
    for (const artwork of symbolArtworks(definition))
      for (const child of artwork) {
        if (++visits > MAX_SYMBOL_ARTWORK)
          throw new Error('Motion symbol inspection exceeds the existing artwork budget.');
        if (child.kind !== 'symbol') continue;
        playback(child);
        // A button itself is an interactive boundary, even if its instance says movie.
        const childMovie =
          child.symbolPlayback?.mode === 'movie' && !definitions.get(child.symbolId!)?.buttonStates;
        height = Math.max(
          height,
          1 + inspect(child.symbolId!, [...ancestry, id], behindMovie || childMovie),
        );
      }
    heights.set(cacheKey, height);
    return height;
  }
  return (shape: Vector): ((age: number) => Vector['symbolPlayback']) | undefined => {
    if (shape.kind !== 'symbol') return undefined;
    playback(shape);
    // Graphic offsets preserve the resolved exposure; descendant movie identities
    // and their referenced clock plans therefore remain unchanged.
    inspect(shape.symbolId!, [], shape.symbolPlayback?.mode === 'movie');
    const duration = definitions.get(shape.symbolId!)!.timeline?.duration ?? 1;
    const mode = shape.symbolPlayback?.mode ?? 'loop';
    const authoredFirst = shape.symbolPlayback?.firstFrame ?? 0;
    // Independent movie clocks are keyed by stable instance identity, not key age.
    // Keep their authored offset unchanged on every generated key.
    if (mode === 'movie') return () => ({ mode: 'movie', firstFrame: authoredFirst });
    return (age) => ({
      mode,
      firstFrame: graphicFrameAtAge(duration, mode, authoredFirst, age),
    });
  };
}
