import { keyAt, type Point, type Project } from '@splash/document';
import { evaluate } from '../../../packages/animation/src';
import { type SymbolPaintItem } from '../../../packages/geometry/src/symbols';
import { drawShape } from '../../../packages/stage/src';
import { paintSymbolItems } from '../../../packages/stage/src/symbol-mask-painter';
import { hasMaskChain } from '../../../packages/document/src/layer-masks';

export function createMaskedPlacementHit() {
  let probe: CanvasRenderingContext2D | undefined;
  return (project: Project, frame: number, clocks: Record<string, number> | undefined,
    layerId: string, shapeId: string, sources: string[], hasOwner: boolean, checkScene: boolean, point: Point) => {
    const layer = project.layers.find(l => l.id === layerId)!;
    const key = keyAt(layer, frame), placement = key.shapes.find(s => s.id === shapeId);
    if (!placement) return false;
    const items: SymbolPaintItem[] = [];
    evaluate({ ...project, layers: [{ ...layer, keys: [{ ...key, shapes: [placement] }] }] }, frame, clocks, items);
    if (!checkScene && !items.some(item => item.kind === 'masked-symbol' && (hasOwner || hasMaskChain(item.masks)))) return true;
    const layers = [{ id: layerId, visible: true, items }];
    const masks = [];
    let member = layerId;
    for (const id of sources) {
      const source = project.layers.find(l => l.id === id);
      if (!source?.visible) return false;
      const sourceItems: SymbolPaintItem[] = [];
      evaluate({ ...project, layers: [source] }, frame, clocks, sourceItems);
      layers.push({ id, visible: true, items: sourceItems });
      masks.push({ maskLayerId: id, layerIds: [member] });
      member = id;
    }
    if (!probe) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      probe = canvas.getContext('2d', { willReadFrequently: true })!;
    }
    probe.resetTransform();
    probe.clearRect(0, 0, 1, 1);
    probe.translate(0.5 - point.x, 0.5 - point.y);
    const decoded = project.assets.reduce((n, a) => n + (a.bitmap ? a.bitmap.width * a.bitmap.height : 0), 0);
    const painted: SymbolPaintItem[] = masks.length ? [{kind:'masked-symbol', opacity:1, masks, layers}] : items;
    paintSymbolItems(probe, painted, (ctx, shape) => drawShape(ctx, shape, project.assets), decoded);
    return probe.getImageData(0, 0, 1, 1).data[3] > 0;
  };
}
