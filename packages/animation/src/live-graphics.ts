import {
  symbolArtworks,
  MAX_SYMBOL_ARTWORK,
  type Project,
  type SymbolDefinition,
  type Vector,
} from '../../document/src';
import { requireGroupMovieMember, validateGraphicGroupMotion, validateLiveGraphicData as validateLiveMotionData } from '../../document/src/live-motion';
import { prepareRigidGroups } from './motion-rigid';
import { graphicFrameAtAge } from './motion-symbols';
import type { MotionFrameRecipe } from './motion-frames';

/** Check original graphic identities, clocks and reachable library artwork. */
export function qualifyLiveGraphicMotion(
  project: Pick<Project, 'layers' | 'duration' | 'symbols'>,
  layerId: string,
  recipe: MotionFrameRecipe,
): void {
  validateLiveMotionData(project);
  validateLiveMotionData(recipe);
  const layer = project.layers.find((l) => l.id === layerId);
  if (!layer) throw Error('Live graphic layer is missing.');
  const first = layer.keys.find((k) => k.frame === recipe.start),
    last = layer.keys.find((k) => k.frame === recipe.end);
  if (!first || !last || first.shapes.length !== last.shapes.length)
    throw Error('Live graphics require matching authored endpoints.');
  const grouped = recipe.rotation?.rigidGroups === true;
  validateGraphicGroupMotion(first.shapes, last.shapes, recipe);
  if (recipe.rotation?.savedGroupPivots && grouped)
    prepareRigidGroups(first.shapes, last.shapes, recipe.rotation);
  const symbols = project.symbols ?? [],
    definitions = new Map<string, SymbolDefinition>();
  for (const definition of symbols) {
    if (definitions.has(definition.id))
      throw Error('Live graphic symbol identities must be distinct.');
    definitions.set(definition.id, definition);
  }
  let total = 0;
  for (const definition of symbols)
    for (const artwork of symbolArtworks(definition)) {
      total += artwork.length;
      if (total > MAX_SYMBOL_ARTWORK)
        throw Error('Live graphic library exceeds the existing artwork budget.');
    }
  let work = 0;
  const heights = new Map<string, number>();
  const playback = (shape: Vector) => {
    const p = shape.symbolPlayback;
    if (
      p !== undefined &&
      (!p ||
        !['loop', 'once', 'single'].includes(p.mode) ||
        !Number.isSafeInteger(p.firstFrame) ||
        p.firstFrame < 0 ||
        p.firstFrame >= 10000 ||
        ('keyframeCut' in p && p.keyframeCut !== true))
    )
      throw Error('Live graphics exclude movie playback.');
    return { mode: p?.mode ?? 'loop', firstFrame: p?.firstFrame ?? 0 } as {
      mode: 'loop' | 'once' | 'single';
      firstFrame: number;
    };
  };
  function inspect(id: string, ancestry: string[]): number {
    if (ancestry.includes(id) || ancestry.length >= 8)
      throw Error('Live graphic graph cycle or depth limit.');
    const cached = heights.get(id);
    if (cached !== undefined) {
      if (ancestry.length + cached > 8) throw Error('Live graphic graph depth limit.');
      return cached;
    }
    const definition = definitions.get(id);
    if (!definition || definition.buttonStates)
      throw Error('Live graphics require existing non-button definitions.');
    const duration = definition.timeline?.duration ?? 1;
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > 10000)
      throw Error('Invalid live graphic duration.');
    let height = 1;
    for (const artwork of symbolArtworks(definition))
      for (const child of artwork) {
        if (++work > MAX_SYMBOL_ARTWORK)
          throw Error('Live graphic graph exceeds the existing artwork budget.');
        if (child.kind === 'symbol') {
          if (recipe.nestedGraphicMovies && child.symbolPlayback?.mode === 'movie') {
            const offset = child.symbolPlayback.firstFrame;
            if (!Number.isSafeInteger(offset) || offset < 0 || offset >= 10000)
              throw Error('Invalid nested movie frame offset.');
          } else playback(child);
          height = Math.max(height, 1 + inspect(child.symbolId!, [...ancestry, id]));
        }
      }
    heights.set(id, height);
    return height;
  }
  let count = 0;
  for (let i = 0; i < first.shapes.length; i++) {
    const a = first.shapes[i],
      b = last.shapes[i];
    if (a.id !== b.id || a.kind !== b.kind || (grouped
      ? JSON.stringify(a.groups) !== JSON.stringify(b.groups)
      : a.groups?.length || b.groups?.length))
      throw Error('Live graphic endpoint identities changed.');
    if (a.kind !== 'symbol') continue;
    count++;
    if (a.symbolId !== b.symbolId) throw Error('Live graphic definition identity changed.');
    inspect(a.symbolId!, []);
    if (recipe.nestedGraphicMovies === 'members-and-descendants' &&
        (a.symbolPlayback?.mode === 'movie' || b.symbolPlayback?.mode === 'movie')) {
      requireGroupMovieMember(a,b);
      continue;
    }
    const from = playback(a),
      to = playback(b),
      duration = definitions.get(a.symbolId!)!.timeline?.duration ?? 1;
    // The renderer samples the starting clock until it reaches the exact end
    // key. Owning the cut at the end also preserves it when splitting the span.
    if (b.symbolPlayback?.keyframeCut) continue;
    if (
      from.mode !== to.mode ||
      graphicFrameAtAge(duration, from.mode, from.firstFrame, recipe.end - recipe.start) !==
        Math.min(to.firstFrame, duration - 1)
    )
      throw Error('Authored live graphic endpoint clock is discontinuous.');
  }
  if (!count) throw Error('Explicit live graphics require a symbol endpoint.');
}
