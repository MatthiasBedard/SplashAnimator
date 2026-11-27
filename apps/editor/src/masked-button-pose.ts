import { keyAt, type Point, type Project, type Vector } from '@splash/document';
import { hit } from '../../../packages/geometry/src';
import { expandSymbols, type SymbolPaintItem } from '../../../packages/geometry/src/symbols';
import type { RootButton } from '../../../packages/animation/src/button-preview';
import { drawShape } from '../../../packages/stage/src';
import { paintSymbolItems } from '../../../packages/stage/src/symbol-mask-painter';
import { maskAncestors } from '../../../packages/document/src/layer-masks';

type Track = { art: Vector[]; items: SymbolPaintItem[] };
type Clip = { source: SymbolPaintItem[]; parent?: Clip };
type PaintLayer = { id: string; visible: boolean; items: SymbolPaintItem[] };

function visitLayers(layers: PaintLayer[], masks: NonNullable<Project['layerMasks']>, parent: Clip | undefined,
  visit: (items: SymbolPaintItem[], clip?: Clip) => void) {
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  const sources = new Set(masks.map(mask => mask.maskLayerId));
  for (const layer of layers) if (layer.visible && !sources.has(layer.id)) {
    let clip = parent;
    for (const id of maskAncestors(masks, layer.id)) {
      const source = byId.get(id);
      clip = { source: source?.visible ? source.items : [], parent: clip };
    }
    visit(layer.items, clip);
  }
}

/** Keep the original layer tree while consuming the already sampled movie and button clocks. */
export function maskedButtonPose(project: Project, frame: number, frames: Record<string, number>,
  buttons: RootButton[], states: Map<string, Record<string, number>>, over: string | null, down: string | null) {
  const definitions = new Map(project.symbols?.map(d => [d.id, d]));
  const tracks = new Map<string, Track>();
  const containers = new Map<string, SymbolPaintItem[]>();
  const byLayer = new Map<string, Map<string, RootButton>>();
  for (const button of buttons) {
    let byId = byLayer.get(button.layerId);
    if (!byId) byLayer.set(button.layerId, byId = new Map());
    byId.set(button.shape.id, button);
  }
  for (const layer of project.layers) {
    if (!layer.visible) continue;
    const byId = byLayer.get(layer.id);
    const items: SymbolPaintItem[] = [];
    const key = keyAt(layer, frame);
    const art = expandSymbols(project, key.shapes, frame - key.frame, (shape, owner) => {
      if (owner === undefined) return frames[layer.id + '/' + shape.id + '/' + shape.symbolId] ?? 0;
      const parent = byId?.get(owner);
      return parent ? states.get(parent.token)?.['root/preview' + shape.id.slice(owner.length) + '/' + shape.symbolId] ?? 0 : 0;
    }, undefined, undefined, items, (shape, container) => {
      const b = byId?.get(shape.id);
      if (b && container) containers.set(b.token, container);
      return definitions.get(shape.symbolId!)!.buttonStates![b && b.token === down ? 'down' : b && b.token === over ? 'over' : 'up'];
    });
    tracks.set(layer.id, { art, items });
  }

  // Index clipping only when testing input; authoring playback only needs paint.
  let eligible: Map<SymbolPaintItem[], Clip | undefined> | undefined;
  let probe: CanvasRenderingContext2D | undefined;
  const frozen = new Map<string, SymbolPaintItem[]>();
  function covered(items: SymbolPaintItem[], point: Point) {
    if (!probe) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      probe = canvas.getContext('2d', { willReadFrequently: true })!;
    }
    probe.resetTransform();
    probe.clearRect(0, 0, 1, 1);
    probe.translate(0.5 - point.x, 0.5 - point.y);
    const decoded = project.assets.reduce((n, a) => n + (a.bitmap ? a.bitmap.width * a.bitmap.height : 0), 0);
    paintSymbolItems(probe, items, (ctx, shape) => drawShape(ctx, shape, project.assets), decoded);
    return probe.getImageData(0, 0, 1, 1).data[3];
  }
  function clipAlpha(clip: Clip | undefined, point: Point, alpha = 255) {
    for (; alpha && clip; clip = clip.parent) alpha = Math.round(alpha * covered(clip.source, point) / 255);
    return alpha;
  }
  function hits(items: SymbolPaintItem[], point: Point, alpha: number): boolean {
    return items.some(item => {
      if (item.kind !== 'masked-symbol') return hit(item, point, 0);
      let found = false;
      visitLayers(item.layers, item.masks, undefined, (children, clip) => {
        const clipped = clipAlpha(clip, point, alpha);
        if (!found && clipped) found = hits(children, point, clipped);
      });
      return found;
    });
  }
  function visibleContainers() {
    if (!eligible) {
      const index = new Map<SymbolPaintItem[], Clip | undefined>();
      function visit(items: SymbolPaintItem[], clip?: Clip) {
        index.set(items, clip);
        for (const item of items) if (item.kind === 'masked-symbol') visitLayers(item.layers, item.masks, clip, visit);
      }
      visitLayers(project.layers.map(l => ({ id: l.id, visible: l.visible, items: tracks.get(l.id)?.items ?? [] })),
        project.layerMasks ?? [], undefined, visit);
      eligible = index;
    }
    return eligible;
  }
  function keyboardButtons() {
    const visible = visibleContainers();
    return buttons.filter(b => {
      const container = containers.get(b.token);
      if (!container || !visible.has(container)) return false;
      for (let clip = visible.get(container); clip; clip = clip.parent) if (!clip.source.length) return false;
      return true;
    });
  }
  function pick(point: Point) {
    const visible = visibleContainers();
    for (let i = buttons.length - 1; i >= 0; i--) {
      const b = buttons[i], container = containers.get(b.token);
      if (!container || !visible.has(container)) continue;
      const alpha = clipAlpha(visible.get(container), point);
      if (!alpha) continue;
      let geometry = frozen.get(b.token);
      if (!geometry) {
        geometry = [];
        const firstFrame = definitions.get(b.shape.symbolId!)!.buttonStates!.hit;
        expandSymbols(project, [{ ...b.shape, symbolPlayback: { mode: 'single', firstFrame } }], 0, undefined, undefined, undefined, geometry);
        frozen.set(b.token, geometry);
      }
      if (hits(geometry, point, alpha)) return b;
    }
  }
  return { tracks, pick, keyboardButtons };
}
