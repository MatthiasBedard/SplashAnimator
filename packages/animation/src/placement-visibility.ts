import { symbolArtworks, type Layer, type Project, type Vector } from '../../document/src';

type VisibilitySource = Pick<Project, 'symbols' | 'layerMasks' | 'opacityBindings'>;

export function graphicVisibilityOwner(project: VisibilitySource, allowDirectButtons = false) {
  const definitions = new Set(project.symbols?.filter(definition =>
    (!definition.buttonStates || allowDirectButtons) && symbolArtworks(definition).every(artwork =>
      artwork.every(child => child.kind !== 'symbol' && child.kind !== 'text'),
    ),
  ).map(definition => definition.id));
  const buttons = new Set(allowDirectButtons ? project.symbols?.filter(definition=>definition.buttonStates).map(definition=>definition.id) : []);
  const maskLayers = new Set(project.layerMasks?.map(mask => mask.maskLayerId));
  const bound = new Set(project.opacityBindings?.map(binding => JSON.stringify([binding.layerId,binding.shapeId])));
  return (layer: Layer, frame: number, shape: Vector) => {
    if (shape.kind !== 'symbol' || !shape.instanceName || !definitions.has(shape.symbolId!) ||
        (['movie','button'].includes(shape.symbolPlayback?.mode ?? '') && !buttons.has(shape.symbolId!)) || layer.guideLayer ||
        layer.liveMotionSpans?.length || layer.motionSpans?.length || maskLayers.has(layer.id) ||
        bound.has(JSON.stringify([layer.id,shape.id]))) return undefined;
    return JSON.stringify([layer.id,frame,shape.id,shape.symbolId,shape.instanceName]);
  };
}

export function captureGraphicVisibilityKeys(project: VisibilitySource & Pick<Project, 'layers'>) {
  const owner = graphicVisibilityOwner(project);
  const keys = new Set<string>();
  for (const layer of project.layers)
    for (const exposure of layer.keys)
      for (const shape of exposure.shapes) {
        const key = owner(layer, exposure.frame, shape);
        if (key !== undefined) keys.add(key);
      }
  return keys;
}
