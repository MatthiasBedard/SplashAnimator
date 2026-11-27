import { symbolLayers, type SymbolDefinition, type Vector } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';

export type SymbolSimplifyLocation = Readonly<{ layerId: string; frame: number }>;

/** Snapshot explicit original storage coordinates, never a sampled display key. */
export function snapshotSymbolSimplifyLocation(
  value: SymbolSimplifyLocation,
): SymbolSimplifyLocation {
  validateLiveGraphicData(value);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw Error('Choose an original symbol layer and stored keyframe.');
  const fields = Object.getOwnPropertyDescriptors(value),
    layer = fields.layerId,
    frame = fields.frame;
  if (
    Reflect.ownKeys(fields).length !== 2 ||
    !layer?.enumerable ||
    !frame?.enumerable ||
    !('value' in layer) ||
    !('value' in frame) ||
    typeof layer.value !== 'string' ||
    !layer.value ||
    typeof frame.value !== 'number' ||
    !Number.isSafeInteger(frame.value) ||
    frame.value < 0
  )
    throw Error('Choose an original symbol layer and stored keyframe.');
  return { layerId: layer.value, frame: frame.value };
}

/** Data lookup only; the private capture supplies editing authority. */
export function symbolSimplifyArtwork(
  definition: SymbolDefinition,
  location?: SymbolSimplifyLocation,
): Vector[] {
  if (location === undefined) return definition.shapes;
  const at = snapshotSymbolSimplifyLocation(location);
  if (
    (!definition.timeline && !definition.buttonStates) ||
    at.frame >= (definition.timeline?.duration ?? 1)
  )
    throw Error('Choose an existing symbol timeline or button stored keyframe.');
  const track = symbolLayers(definition).find((layer) => layer.id === at.layerId);
  if (!track || !track.visible || track.locked)
    throw Error('Choose a visible unlocked original symbol track.');
  const key = track.keys.find((key) => key.frame === at.frame);
  if (!key) throw Error('Insert a keyframe before simplifying a held symbol exposure.');
  if (track.motionSpans?.some((span) => span.start < at.frame && at.frame < span.end))
    throw Error('Generated symbol interiors need separate simplification ownership.');
  return key.shapes;
}

/** Replace just the admitted storage slot. Copy its entire path so aliased
 * original keys/layers/artwork cannot change another exposure as a side effect. */
export function withSymbolSimplifyArtwork(
  definition: SymbolDefinition,
  artwork: Vector[],
  location?: SymbolSimplifyLocation,
): SymbolDefinition {
  symbolSimplifyArtwork(definition, location);
  if (location === undefined || (location.layerId === '@base' && location.frame === 0))
    return { ...definition, shapes: artwork };
  const timeline = definition.timeline!;
  if (location.layerId === '@base')
    return {
      ...definition,
      timeline: {
        ...timeline,
        keys: timeline.keys.map((key) =>
          key.frame === location.frame ? { ...key, shapes: artwork } : key,
        ),
      },
    };
  return {
    ...definition,
    timeline: {
      ...timeline,
      layers: timeline.layers!.map((layer) =>
        layer.id === location.layerId
          ? {
              ...layer,
              keys: layer.keys.map((key) =>
                key.frame === location.frame ? { ...key, shapes: artwork } : key,
              ),
            }
          : layer,
      ),
    },
  };
}
