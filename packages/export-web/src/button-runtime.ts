import type { PresentationButtonState } from './index';
import type { RenderVector } from '../../stage/src/render-data';

import type { LayerMask } from '../../document/src/layer-masks';
import type { compositeLayerMasks } from '../../stage/src/layer-mask-compositor';

export type ExportHitItem = RenderVector | {
  maskLayers: { id: string; visible: boolean; shapes: ExportHitItem[] }[];
  masks: LayerMask[];
  opacity: number;
};

/** Sample the rendered mask at the pointer using the same paint and compositor as playback. */
export function createMaskCoverage(paint: (ctx: CanvasRenderingContext2D, shape: RenderVector) => void,
  composite: typeof compositeLayerMasks, decodedPixels: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  function draw(target: CanvasRenderingContext2D, shapes: ExportHitItem[], reserved: number) {
    for (const shape of shapes) {
      if ('maskLayers' in shape) {
        composite(target, shape.maskLayers, shape.masks, (dest, id) =>
          draw(dest, shape.maskLayers.find(l => l.id === id)!.shapes, reserved + 3), reserved, 1, shape.opacity);
      } else paint(target, shape);
    }
  }
  return (items: ExportHitItem[], x: number, y: number) => {
    ctx.resetTransform();
    ctx.clearRect(0, 0, 1, 1);
    ctx.translate(0.5 - x, 0.5 - y);
    draw(ctx, items, decodedPixels);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  };
}

/** Self-contained root interaction runtime, embedded without executing document scripts. */
export function createExportButtonRuntime<Paint>(
  canvas: HTMLCanvasElement,
  buttons: {
    token: string;
    instanceId: string;
    symbolId: string;
    name: string;
    poses: Record<'up' | 'over' | 'down', Paint[]> & { hit: ExportHitItem[] };
  }[],
  width: number,
  height: number,
  interactive = true,
  coverage?: (items: ExportHitItem[], x: number, y: number) => number,
  ancestors?: (masks: readonly LayerMask[], id: string) => string[],
) {
  let ancestorClips: ReadonlyMap<number, (x: number, y: number) => number> | undefined;
  let active: number[] = [],
    over: number | null = null,
    pressed: number | null = null,
    focused: number | null = null;
  let pointer: number | null = null,
    key: string | null = null,
    activations = 0;
  const hitContext = document.createElement('canvas').getContext('2d')!;
  let targetEpoch=0;
  let presentation:PresentationButtonState|undefined;
  const presentationStates=new Map<number,'over'|'down'>();
  let previousTargets=new Map<string,number>(),targetLifetimes=new Map<number,number>();
  const paths = new WeakMap<RenderVector, Path2D>();
  function hit(shape: ExportHitItem, x: number, y: number, alpha: number): boolean {
    if (!alpha) return false;
    if ('maskLayers' in shape) {
      // Source tracks clip their assigned targets and never become their own target.
      for (const layer of shape.maskLayers) {
        if (!layer.visible || shape.masks.some(mask => mask.maskLayerId === layer.id)) continue;
        let clipped = alpha;
        for (const id of ancestors!(shape.masks, layer.id)) {
          const source = shape.maskLayers.find(l => l.id === id);
          clipped = source?.visible ? Math.round(clipped * coverage!(source.shapes,x,y) / 255) : 0;
          if (!clipped) break;
        }
        if (clipped && layer.shapes.some(child => hit(child, x, y, clipped))) return true;
      }
      return false;
    }
    let path = paths.get(shape);
    if (!path) {
      path = new Path2D();
      if (shape.kind === 'text') path.rect(0, 0, shape.width, shape.height);
      else
        for (const command of shape.commands) {
          if (command[0] === 'M') path.moveTo(command[1], command[2]);
          else if (command[0] === 'L') path.lineTo(command[1], command[2]);
          else if (command[0] === 'C')
            path.bezierCurveTo(
              command[1],
              command[2],
              command[3],
              command[4],
              command[5],
              command[6],
            );
          else path.closePath();
        }
      paths.set(shape, path);
    }
    hitContext.setTransform(1, 0, 0, 1, 0, 0);
    hitContext.translate(shape.x, shape.y);
    hitContext.rotate((shape.rotation * Math.PI) / 180);
    if (shape.transform) hitContext.transform(...shape.transform, 0, 0);
    const fill =
      shape.kind === 'text' ||
      (shape.fillEnabled !== false &&
        (['rectangle', 'ellipse', 'polygon', 'brush'].includes(shape.kind) || shape.closed));
    if (fill && hitContext.isPointInPath(path, x, y, 'evenodd')) return true;
    hitContext.lineWidth = shape.strokeWidth;
    hitContext.lineCap = 'round';
    hitContext.lineJoin = 'round';
    return shape.strokeWidth > 0 && hitContext.isPointInStroke(path, x, y);
  }
  function pick(e: PointerEvent) {
    const bounds = canvas.getBoundingClientRect();
    const x = ((e.clientX - bounds.left) * width) / bounds.width,
      y = ((e.clientY - bounds.top) * height) / bounds.height;
    return pickAt(x,y);
  }
  function pickAt(x:number,y:number){
    if(!Number.isFinite(x)||!Number.isFinite(y))return null;
    return [...active].reverse().find(index=>{
      const alpha = ancestorClips?.get(index)?.(x,y) ?? 255;
      return alpha && buttons[index].poses.hit.some(shape=>hit(shape,x,y,alpha));
    })??null;
  }
  function reset() {
    const captured = pointer;
    pointer = null;
    key = null;
    pressed = null;
    over = null;
    if (captured !== null && canvas.hasPointerCapture(captured))
      canvas.releasePointerCapture(captured);
  }
  function activate(index: number) {
    activations++;
    canvas.dataset.activations = String(activations);
    const { token, instanceId, symbolId } = buttons[index];
    canvas.dispatchEvent(
      new CustomEvent('splash-button-activate', {
        bubbles: true,
        detail: { token, instanceId, symbolId },
      }),
    );
  }
  if (interactive && buttons.length) {
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'button');
    canvas.dataset.activations = '0';
    canvas.title = 'Left/Right selects a button. Space/Enter activates. Escape cancels a press.';
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || pointer !== null || key) return;
      const index = pick(e);
      if (index === null) return;
      e.preventDefault();
      canvas.focus();
      over = focused = pressed = index;
      pointer = e.pointerId;
      canvas.setPointerCapture(pointer);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (pointer === null || pointer === e.pointerId) over = pick(e);
    });
    canvas.addEventListener('pointerup', (e) => {
      if (pointer !== e.pointerId) return;
      const index = pick(e);
      if (index !== null && index === pressed) activate(index);
      over = index;
      pointer = null;
      pressed = null;
      canvas.releasePointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerleave', () => {
      over = null;
    });
    canvas.addEventListener('pointercancel', reset);
    canvas.addEventListener('lostpointercapture', () => {
      if (pointer !== null) reset();
    });
    canvas.addEventListener('blur', reset);
    canvas.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && (pointer !== null || key !== null)) {
        e.preventDefault();
        reset();
        return;
      }
      if (!active.length || ![' ', 'Enter', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      if (e.repeat || pointer !== null || key) return;
      if (e.key.startsWith('Arrow')) {
        const index = Math.max(0, active.indexOf(focused!));
        focused =
          active[(index + (e.key === 'ArrowLeft' ? -1 : 1) + active.length) % active.length];
      } else {
        focused ??= active[0];
        pressed = focused;
        key = e.key;
      }
    });
    canvas.addEventListener('keyup', (e) => {
      if (key !== e.key) return;
      e.preventDefault();
      if (pressed !== null && active.includes(pressed)) activate(pressed);
      key = null;
      pressed = null;
    });
  }
  return {
    /** A visual override lasts one pose and cannot create or revive a target lifetime. */
    beginPresentation(state?:PresentationButtonState){
      presentation=interactive?undefined:state;
      presentationStates.clear();
    },
    resolvePresentation(index:number,identity:string|undefined,expired:boolean){
      const button=buttons[index];
      if(presentation&&!expired&&button.instanceId===presentation.instanceId&&button.symbolId===presentation.symbolId&&
        previousTargets.get(identity??button.token)===presentation.lifetime)
        presentationStates.set(index,presentation.state);
    },
    /** Commit once after discovery, never from its temporary union of visible candidates. */
    commitTargetLifetimes(indices:number[],expired:Set<number>,continuity:Map<number,string>){
      const next=new Map<string,number>(),lifetimes=new Map<number,number>();
      for(const index of indices){
        const identity=continuity.get(index)??buttons[index].token;
        let epoch=expired.has(index)?undefined:previousTargets.get(identity);
        if(epoch===undefined){
          if(targetEpoch===Number.MAX_SAFE_INTEGER)throw new Error('Button lifetime exceeds numeric limits.');
          epoch=++targetEpoch;
        }
        next.set(identity,epoch);lifetimes.set(index,epoch);
      }
      previousTargets=next;targetLifetimes=lifetimes;
    },
    /** Read-only document-coordinate query over the final visible set. */
    setAncestorClips(clips: typeof ancestorClips) { ancestorClips = clips; },
    targetAt(x:number,y:number){
      const index=pickAt(x,y);
      if(index===null)return null;
      const {token,instanceId,symbolId,name}=buttons[index];
      return {token,instanceId,symbolId,name,lifetime:targetLifetimes.get(index)};
    },
    update(indices: number[], expired = new Set<number>()) {
      active = indices;
      if (pressed !== null && (!active.includes(pressed) || expired.has(pressed))) reset();
      if (over !== null && (!active.includes(over) || expired.has(over))) over = null;
      if (focused === null || !active.includes(focused)) focused = active[0] ?? null;
      if (interactive && buttons.length)
        canvas.setAttribute(
          'aria-label',
          focused === null ? 'Animation' : 'Animation button: ' + buttons[focused].name,
        );
    },
    state(index: number): 'up' | 'over' | 'down' {
      return presentationStates.get(index) ?? (pressed === index && (key || over === index) ? 'down' : over === index ? 'over' : 'up');
    },
    pose(index: number) {
      return buttons[index].poses[
        presentationStates.get(index) ?? (pressed === index && (key || over === index) ? 'down' : over === index ? 'over' : 'up')
      ];
    },
  };
}
