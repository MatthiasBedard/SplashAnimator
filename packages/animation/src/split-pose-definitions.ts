import { symbolArtworks, type Project, type Vector, type SymbolDefinition } from '../../document/src';

/** The full project and both halves have already passed library admission.
 * Validate individual sampled placements against their original definition
 * dimensions and duration without traversing the whole graph on every frame. */
export function splitPoseDefinitions(project: Project, first: readonly Vector[]): SymbolDefinition[] {
  if (!first.some(shape=>shape.kind === 'symbol')) return [];
  let leaf: Vector | undefined;
  for (const definition of project.symbols ?? []) {
    for (const artwork of symbolArtworks(definition)) {
      leaf = artwork.find((shape) => shape.kind !== 'symbol');
      if (leaf) break;
    }
    if (leaf) break;
  }
  if (!leaf) throw Error('Graphic split numeric admission needs existing leaf artwork.');
  const rootDefinitionIds = new Set(
    first.filter((shape) => shape.kind === 'symbol').map((shape) => shape.symbolId),
  );
  return (project.symbols ?? [])
      .filter((definition) => rootDefinitionIds.has(definition.id))
      .map((definition) => ({
        id: definition.id,
        name: definition.name,
        width: definition.width,
        height: definition.height,
        shapes: [leaf!],
        ...(definition.timeline
          ? { timeline: { duration: definition.timeline.duration, keys: [] } }
          : {}),
      }));
}
