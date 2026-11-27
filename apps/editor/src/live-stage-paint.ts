import { compositeLayerMasks } from '../../../packages/stage/src/layer-mask-compositor';
import { authoringLayerMasks, DEFAULT_LAYER_OUTLINE, drawLayerOutline } from './layer-outline';
import { keyAt, type Point, type Project, type Vector } from '../../../packages/document/src';
import { maskAncestors } from '../../../packages/document/src/layer-masks';
import { freezeSnapshot, isImmutableSnapshot } from '../../../packages/document/src/immutable-snapshot';
import { captureLiveMotionStage } from '../../../packages/animation/src/live-motion-stage';
import { evaluate, evaluateLayers } from '../../../packages/animation/src';
import { hasInstanceBlur, type SymbolPaintItem } from '../../../packages/geometry/src/symbols';
import { paintSymbolItems } from '../../../packages/stage/src/symbol-mask-painter';
import {
  prepareLayerScene,
  withLayerScene,
  disposeLayerScene,
  type PreparedLayerScene,
} from '../../../packages/animation/src/layer-scene';
import {
  createMaskResourceBank,
  acquireMaskResourceLease,
  type MaskResourceLease,
} from '../../../packages/stage/src/mask-resources';
import { renderData, paintCommands, canvasPath } from '../../../packages/stage/src/render-data';
import { paintStyledText } from '../../../packages/stage/src/rich-text';
import { wrapText } from '../../../packages/geometry/src/text-layout';
import { hit } from '../../../packages/geometry/src';
import { createMaskedPlacementHit } from './masked-placement-hit';

export type LiveStageTranslation = { layerId: string; ids: ReadonlySet<string>; offset: Point };

function artworkRoots(project: Project, layerId: string, frame: number) {
  const layer = project.layers.find(layer => layer.id === layerId)!;
  const roots = keyAt(layer, frame).shapes;
  const byId = new Map(roots.map(shape => [shape.id, shape]));
  return {
    roots,
    find(id: string) {
      let root = byId.get(id);
      // Expanded symbol children use the authored root ID as their namespace.
      for (let end = id.lastIndexOf('/'); end > 0; end = id.lastIndexOf('/', end - 1)) {
        const owner = byId.get(id.slice(0, end));
        if (owner?.kind !== 'symbol') continue;
        if (root) return; // A name collision cannot authorize a document edit.
        root = owner;
      }
      return root;
    },
  };
}

function needsBlendBackdrop(items: SymbolPaintItem[]): boolean {
  return items.some(item => item.kind === 'masked-symbol'
    ? !!item.blendMode || item.layers.some(layer => needsBlendBackdrop(layer.items))
    : !!item.blendMode || !!item.groupBlur?.blendMode);
}

/** Source-owned native readiness and frame-local paint ownership. Root pose
 * compilation/resource caches outlive individual cancelled frame jobs. */
export function createLiveStagePainter(
  snapshot: Project,
  validate: () => void,
  invalidate: () => void = () => {},
) {
  const makeSession = () =>
    captureLiveMotionStage(() => {
      validate();
      return { project: snapshot, revision: 0 };
    });
  let session = makeSession();
  const authoringMasks = authoringLayerMasks(snapshot.layers, snapshot.layerMasks);
  const outlineColors = new Map(
    snapshot.layers
      .filter((layer) => layer.outline)
      .map((layer) => [layer.id, layer.outlineColor ?? DEFAULT_LAYER_OUTLINE]),
  );
  // Paint and resource readiness must agree, even if an outlined source has no artwork.
  const sceneSource =
    authoringMasks.length === (snapshot.layerMasks?.length ?? 0)
      ? snapshot
      : {
          ...snapshot,
          layerMasks: authoringMasks.map(({ maskLayerId, layerIds }) => ({
            maskLayerId,
            layerIds: [...layerIds],
          })),
        };
  if (sceneSource !== snapshot && isImmutableSnapshot(snapshot)) freezeSnapshot(sceneSource);
  const bank = createMaskResourceBank(sceneSource, { validate });
  const hasEffects = hasInstanceBlur(snapshot);
  const hasSymbolMasks = snapshot.symbols?.some(definition => definition.timeline?.layerMasks?.length);
  const maskedHit = createMaskedPlacementHit();
  let alive = true,
    epoch = 0,
    job: AbortController | undefined;
  let ready:
    | {
        frame: ReturnType<typeof session.sample>;
        scene: PreparedLayerScene;
        lease: MaskResourceLease;
        active: () => void;
        items?: Map<string, SymbolPaintItem[]>;
        movieFrames?: Readonly<Record<string, number>>;
        blendBackdrop: boolean;
      }
    | undefined;
  function clear() {
    epoch++;
    job?.abort();
    job = undefined;
    ready?.lease.release();
    if (ready) disposeLayerScene(ready.scene);
    ready = undefined;
  }
  return {
    async prepare(at: number, current: () => void, movieFrames?: Readonly<Record<string, number>>) {
      clear();
      const controller = new AbortController(),
        owned = epoch;
      job = controller;
      const timer = setTimeout(
        () => controller.abort(Error('Live stage readiness timed out.')),
        60000,
      );
      const active = () => {
        controller.signal.throwIfAborted();
        validate();
        current();
        if (!alive || job !== controller || owned !== epoch)
          throw Error('Live stage frame changed.');
      };
      let scene: PreparedLayerScene | undefined, lease: MaskResourceLease | undefined;
      try {
        active();
        const frame = session.sample(at);
        freezeSnapshot(frame.project);
        scene = prepareLayerScene(sceneSource, at, [], () => evaluateLayers(frame.project, at, movieFrames), {
          validate: () => {
            active();
            session.assertFrame(frame, at);
          },
        });
        // Hit testing and resource discovery retain the admitted flat geometry.
        // Paint also needs the original compositing boundaries of effected symbols.
        const items = hasEffects ? new Map<string, SymbolPaintItem[]>() : undefined;
        let blendBackdrop = false;
        if (items) for (const layer of frame.project.layers) {
          if (!layer.visible) continue;
          const paint: SymbolPaintItem[] = [];
          evaluate({ ...frame.project, layers: [layer] }, at, movieFrames, paint);
          if (paint.some(item => item.kind === 'masked-symbol' || item.groupBlur)) {
            items.set(layer.id, freezeSnapshot(paint));
            blendBackdrop ||= needsBlendBackdrop(paint);
          }
        }
        active();
        session.assertFrame(frame, at);
        lease = await acquireMaskResourceLease(bank, scene, controller.signal);
        active();
        session.assertFrame(frame, at);
        lease.check();
        ready = { frame, scene, lease, active, items, blendBackdrop, movieFrames };
        const admitted = lease;
        lease.listen(() => {
          if (ready?.lease === admitted) {
            clear();
            invalidate();
          }
        });
        active();
        lease.check();
        scene = undefined;
        lease = undefined;
      } catch (cause) {
        if (alive && job === controller) {
          session.dispose();
          session = makeSession();
        }
        throw cause;
      } finally {
        clearTimeout(timer);
        lease?.release();
        if (scene) disposeLayerScene(scene);
      }
    },
    check(at: number) {
      if (!ready || ready.frame.frame !== at) throw Error('Live stage resources are not ready.');
      ready.active();
      ready.lease.check();
      session.assertFrame(ready.frame, at);
    },
    authored(at: number, ids: readonly string[]) {
      this.check(at);
      session.assertAuthored(ready!.frame, at, ids);
    },
    foregroundSampled(at: number, p: { x: number; y: number }, tolerance: number) {
      this.check(at);
      const r = ready!;
      return withLayerScene(r.scene, (data) => {
        for (const layer of [...data.layers].reverse()) {
          if (!layer.visible) continue;
          const shape = [...layer.shapes]
            .reverse()
            .find((s) => s.opacity !== 0 && hit(s, p, tolerance));
          if (shape) return r.frame.sampledLayerIds.includes(layer.layerId);
        }
        return false;
      });
    },
    foregroundIdentity(at: number, p: { x: number; y: number }, tolerance: number) {
      this.check(at);
      return withLayerScene(ready!.scene, (data) => {
        for (const layer of [...data.layers].reverse()) {
          if (!layer.visible) continue;
          const shape = [...layer.shapes]
            .reverse()
            .find((s) => s.opacity !== 0 && hit(s, p, tolerance));
          if (shape) return { layerId: layer.layerId, shapeId: shape.id };
        }
        return null;
      });
    },
    foregroundTweenRoot(at: number, point: Point, tolerance: number) {
      this.check(at);
      const r = ready!;
      return withLayerScene(r.scene, data => {
        for (const layer of [...data.layers].reverse()) {
          if (!layer.visible || data.masks.some(mask => mask.maskLayerId === layer.layerId)) continue;
          const owners = maskAncestors(data.masks, layer.layerId);
          let index: ReturnType<typeof artworkRoots> | undefined;
          for (const leaf of [...layer.shapes].reverse()) {
            if (leaf.opacity === 0 || !hit(leaf, point, tolerance)) continue;
            index ??= artworkRoots(r.frame.project, layer.layerId, at);
            const root = index.find(leaf.id);
            if (!root) return null;
            if ((owners.length || hasSymbolMasks && root.kind === 'symbol') &&
                !maskedHit(r.frame.project, at, r.movieFrames, layer.layerId, root.id, owners,
                  owners.length > 0, owners.length > 0, point)) continue;
            if (!r.frame.sampledLayerIds.includes(layer.layerId)) return null;
            return { layerId: layer.layerId, shapeId: root.id, roots: index.roots };
          }
        }
        return null;
      });
    },
    paint(target: CanvasRenderingContext2D, at: number, outlineWidth: number, translation?: LiveStageTranslation) {
      this.check(at);
      const r = ready!,
        c = document.createElement('canvas');
      r.lease.admit(target.canvas.width, target.canvas.height);
      c.width = target.canvas.width;
      c.height = target.canvas.height;
      const ctx = c.getContext('2d')!;
      if (r.blendBackdrop) ctx.drawImage(target.canvas, 0, 0);
      ctx.setTransform(target.getTransform());
      try {
        withLayerScene(r.scene, (data) => {
          const masks = data.masks;
          const reservedPixels = r.lease.pixels + c.width * c.height;
          const paintShape = (surface: CanvasRenderingContext2D, shape: Vector) => {
            const drawing = renderData(shape);
            paintCommands(
              surface,
              drawing,
              wrapText,
              shape.bitmap ? r.lease.images.get(shape.bitmap.assetId) : undefined,
              paintStyledText,
              canvasPath(drawing),
              undefined,
              undefined,
              reservedPixels,
            );
          };
          const paintLayer = (target: CanvasRenderingContext2D, id: string) => {
            const layer = data.layers.find((track) => track.layerId === id);
            if (!layer?.visible) return;
            const placement = translation?.layerId === id ? translation : undefined;
            const roots = placement ? artworkRoots(r.frame.project, id, at) : undefined;
            const move = (shape: Vector): Vector => {
              const root = roots?.find(shape.id);
              if (!placement || !root || !placement.ids.has(root.id)) return shape;
              const { x, y } = placement.offset;
              return { ...shape, x: shape.x + x, y: shape.y + y };
            };
            const color = masks.some(mask => mask.maskLayerId === id) ? undefined : outlineColors.get(id);
            if (color) {
              for (const shape of layer.shapes) drawLayerOutline(target, move(shape), color, outlineWidth, snapshot.assets);
              return;
            }
            const items = r.items?.get(id);
            if (items) {
              const place = (item: SymbolPaintItem): SymbolPaintItem => item.kind === 'masked-symbol'
                ? { ...item, layers: item.layers.map(l => ({ ...l, items: l.items.map(place) })) }
                : move(item);
              paintSymbolItems(target, roots ? items.map(place) : items, paintShape, reservedPixels);
            } else for (const shape of layer.shapes) paintShape(target, move(shape));
          };
          if (masks.length)
            compositeLayerMasks(
              ctx,
              snapshot.layers,
              masks,
              paintLayer,
              reservedPixels,
            );
          else for (const layer of data.layers) paintLayer(ctx, layer.layerId);
        });
        this.check(at);
        target.save();
        try {
          target.setTransform(1, 0, 0, 1, 0, 0);
          if (r.blendBackdrop) target.globalCompositeOperation = 'copy';
          target.drawImage(c, 0, 0);
        } finally {
          target.restore();
        }
      } finally {
        c.width = c.height = 0;
      }
    },
    cancel: clear,
    dispose() {
      if (!alive) return;
      alive = false;
      clear();
      session.dispose();
      bank.dispose();
    },
  };
}
