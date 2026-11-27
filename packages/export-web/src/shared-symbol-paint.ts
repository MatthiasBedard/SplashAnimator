import {
  symbolArtworks,
  type Project,
  type SymbolDefinition,
  type Vector,
} from '../../document/src';
import { matrix, multiply } from '../../geometry/src/affine';
import { symbolExposures, symbolLocalFrame } from '../../geometry/src/symbols';
import { renderData } from '../../stage/src/render-data';

type SymbolPaint = {
  /** Maps every local frame to an index in poses. Held frames share an index. */
  frames: number[];
  poses: ReturnType<typeof renderData>[][];
};

function canShareArtwork(definition: SymbolDefinition) {
  // The existing exporter handles interactions and effects that depend on placement.
  if (
    (definition.timeline?.duration ?? 1) <= 0 ||
    definition.buttonStates ||
    definition.timeline?.layerMasks?.length
  ) {
    return false;
  }
  return symbolArtworks(definition).every((shapes) =>
    shapes.every((shape) => shape.kind !== 'symbol' && !shape.groupBlur),
  );
}

function compileSymbolPaint(
  definition: SymbolDefinition,
  countShapes: (count: number) => void,
): SymbolPaint {
  const exposures = new Map<Vector[], number>();
  const poseIds = new Map<string, number>();
  const poses: SymbolPaint['poses'] = [];
  const duration = definition.timeline?.duration ?? 1;
  const frames = Array.from({ length: duration }, (_, frame) => {
    const tracks = symbolExposures(definition, frame).map((exposure) => exposure.shapes);
    // Held exposures reuse their original artwork arrays. Use their identities
    // to find a pose without serializing or comparing all the vector geometry.
    const key = tracks
      .map((shapes) => {
        if (!exposures.has(shapes)) exposures.set(shapes, exposures.size);
        return exposures.get(shapes);
      })
      .join(',');
    const existing = poseIds.get(key);
    if (existing !== undefined) return existing;

    const pose = poses.length;
    countShapes(tracks.reduce((count, shapes) => count + shapes.length, 0));
    poses.push(tracks.flatMap((shapes) => shapes.map(renderData)));
    poseIds.set(key, pose);
    return pose;
  });
  return { frames, poses };
}

/** Compile artwork in symbol coordinates, leaving transforms and clocks to each instance. */
export function createSharedSymbolPaint(project: Project, countShapes: (count: number) => void) {
  const definitions = new Map(project.symbols?.map((definition) => [definition.id, definition]));
  const shareable = new Set(
    Array.from(definitions.values())
      .filter(canShareArtwork)
      .map((definition) => definition.id),
  );
  const compiled = new Map<string, number>();
  const artwork: SymbolPaint[] = [];

  function place(shape: Vector, age: number) {
    const definition = shape.symbolId && definitions.get(shape.symbolId);
    if (
      !definition ||
      !shareable.has(definition.id) ||
      shape.groupBlur ||
      shape.instanceBlur ||
      shape.instanceBlend ||
      shape.instanceTint?.amount
    )
      return;
    let symbol = compiled.get(definition.id);
    const duration = definition.timeline?.duration ?? 1;
    if (symbol === undefined) {
      symbol = artwork.length;
      artwork.push(compileSymbolPaint(definition, countShapes));
      compiled.set(definition.id, symbol);
    }
    const movie = shape.symbolPlayback?.mode === 'movie';
    return {
      sharedSymbol: symbol,
      placement: multiply(matrix(shape), [
        definition.width ? shape.width / definition.width : 1,
        0,
        0,
        definition.height ? shape.height / definition.height : 1,
        0,
        0,
      ]),
      opacity: shape.opacity ?? 1,
      ...(movie
        ? {
            movieId: shape.id,
            symbolId: definition.id,
            firstFrame: Math.min(shape.symbolPlayback?.firstFrame ?? 0, duration - 1),
          }
        : { localFrame: symbolLocalFrame(duration, age, shape.symbolPlayback) }),
    };
  }

  return { artwork, place };
}
