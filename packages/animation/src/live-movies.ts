import {
  symbolArtworks,
  MAX_SYMBOL_ARTWORK,
  type Project,
  type SymbolDefinition,
  type Vector,
} from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import type { MotionFrameRecipe } from './motion-frames';

/** A movie boundary keeps its independent clock. This explicit sparse subset
 * admits only stable direct movies containing pure graphics, never buttons or
 * independent descendants. Baked motion's broader endpoint rules stay separate. */
export function qualifyLiveMovieMotion(
  project: Pick<Project, 'layers' | 'duration' | 'symbols'>,
  layerId: string,
  recipe: MotionFrameRecipe,
): void {
  validateLiveGraphicData(project);
  validateLiveGraphicData(recipe);
  const layer = project.layers.find((l) => l.id === layerId),
    first = layer?.keys.find((k) => k.frame === recipe.start),
    last = layer?.keys.find((k) => k.frame === recipe.end);
  if (!first || !last || first.shapes.length !== last.shapes.length || recipe.rotation?.rigidGroups)
    throw Error('Live movies require original ungrouped endpoints.');
  const definitions = new Map<string, SymbolDefinition>();
  let total = 0;
  for (const definition of project.symbols ?? []) {
    if (definitions.has(definition.id)) throw Error('Live movie definitions must be distinct.');
    definitions.set(definition.id, definition);
    for (const artwork of symbolArtworks(definition)) {
      total += artwork.length;
      if (total > MAX_SYMBOL_ARTWORK) throw Error('Live movie library exceeds the artwork budget.');
    }
  }
  function playback(shape: Vector, root: boolean) {
    const p = shape.symbolPlayback;
    if (
      (root && p?.mode !== 'movie') ||
      (p !== undefined &&
        (!p ||
          !(root ? ['movie'] : ['loop', 'once', 'single']).includes(p.mode) ||
          !Number.isSafeInteger(p.firstFrame) ||
          p.firstFrame < 0 ||
          p.firstFrame >= 10000))
    )
      throw Error('Live movie roots require fixed movie playback and pure graphic descendants.');
    return p;
  }
  let work = 0;
  const heights = new Map<string, number>();
  function inspect(id: string, ancestry: string[]): number {
    if (ancestry.includes(id) || ancestry.length >= 8)
      throw Error('Live movie graph cycle or depth limit.');
    const cached = heights.get(id);
    if (cached !== undefined) {
      if (ancestry.length + cached > 8) throw Error('Live movie graph depth limit.');
      return cached;
    }
    const definition = definitions.get(id);
    if (!definition || definition.buttonStates)
      throw Error('Live movies exclude button/missing definitions.');
    const duration = definition.timeline?.duration ?? 1;
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > 10000)
      throw Error('Invalid live movie definition duration.');
    let height = 1;
    for (const artwork of symbolArtworks(definition))
      for (const child of artwork) {
        if (++work > MAX_SYMBOL_ARTWORK)
          throw Error('Live movie graph exceeds the artwork budget.');
        if (child.kind === 'symbol') {
          playback(child, false);
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
    if (a.id !== b.id || a.kind !== b.kind || a.groups?.length || b.groups?.length)
      throw Error('Live movie endpoint identities changed.');
    if (a.kind !== 'symbol') continue;
    count++;
    if (a.symbolId !== b.symbolId) throw Error('Live movie definition identity changed.');
    const from = playback(a, true),
      to = playback(b, true);
    if (from!.firstFrame !== to!.firstFrame)
      throw Error('Live movie endpoint offsets must remain authored and equal.');
    inspect(a.symbolId!, []);
  }
  if (!count) throw Error('Explicit live movies require a movie endpoint.');
}
