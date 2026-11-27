import { clone, symbolLayers, type Project, type Vector, type Layer } from '../../document/src';
import { matrix, type Matrix } from '../../geometry/src/affine';

export type GraphicButtonNode = {
  shape: Vector;
  placement: Matrix;
  definition?: number;
  button: boolean;
};
type Timeline = {
  duration: number;
  layers: { id: string; keys: { frame: number; nodes: GraphicButtonNode[] }[] }[];
};
export type GraphicButtonPlan = { root: Timeline; definitions: Timeline[] };

/** Shared, serializable graphic topology. Movie and button instances remain leaves. */
export function compileGraphicButtonPlan(project: Pick<Project, 'layers' | 'symbols' | 'duration'>,
  budget?: { remaining: number }): GraphicButtonPlan {
  const sources = new Map(project.symbols?.map((d) => [d.id, d]));
  const indices = new Map<string, number>(),
    depths = new Map<string, number>();
  const definitions: Timeline[] = [];
  let work = 0;
  function timeline(layers: Layer[], duration: number, ancestry: string[]): Timeline {
    return {
      duration,
      layers: layers
        .filter((l) => l.visible)
        .map((layer) => ({
          id: layer.id,
          keys: layer.keys.map((key) => ({
            frame: key.frame,
            nodes: key.shapes.map((shape) => {
              if (++work > 2000000 || (budget && --budget.remaining < 0))
                throw new Error('Graphic button plan exceeds its compilation budget.');
              const node: GraphicButtonNode = {
                shape: clone(shape),
                placement: matrix(shape),
                button: false,
              };
              if (shape.kind !== 'symbol') return node;
              const source = sources.get(shape.symbolId!);
              if (!source) throw new Error('Missing symbol definition.');
              node.button = !!source.buttonStates;
              if (node.button || shape.symbolPlayback?.mode === 'movie') return node;
              if (ancestry.includes(source.id) || ancestry.length >= 8)
                throw new Error('Nested graphic cycle or depth limit.');
              if (!indices.has(source.id)) {
                const index = definitions.length;
                indices.set(source.id, index);
                definitions.push({ duration: 1, layers: [] });
                definitions[index] = timeline(
                  symbolLayers(source),
                  source.timeline?.duration ?? 1,
                  [...ancestry, source.id],
                );
                let depth = 1;
                for (const layer of definitions[index].layers)
                  for (const key of layer.keys)
                    for (const child of key.nodes)
                      if (child.definition !== undefined)
                        depth = Math.max(depth, 1 + depths.get(child.shape.symbolId!)!);
                depths.set(source.id, depth);
              }
              if (ancestry.length + depths.get(source.id)! > 8)
                throw new Error('Nested graphic cycle or depth limit.');
              node.definition = indices.get(source.id)!;
              const sx = source.width ? shape.width / source.width : 1,
                sy = source.height ? shape.height / source.height : 1;
              node.placement = [
                node.placement[0] * sx,
                node.placement[1] * sx,
                node.placement[2] * sy,
                node.placement[3] * sy,
                node.placement[4],
                node.placement[5],
              ];
              return node;
            }),
          })),
        })),
    };
  }
  return { root: timeline(project.layers, project.duration, []), definitions };
}

/** Pose discovery only: caller must resolve unwrapped lifetimes before enabling interaction. */
export function sampleGraphicButtonPlan(
  plan: GraphicButtonPlan,
  frame: number,
  budget?: { remaining: number },
  rootOwner?: (shape:Vector,layerId:string,rootId:string,start:number)=>void,
) {
  type Exposure = { path: string; start: number; end: number; duration: number; frame: number };
  const result: { shape: Vector; button: boolean; layerId: string; exposures: Exposure[] }[] = [];
  let work = 0;
  function product(a: Matrix, b: Matrix): Matrix {
    return [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5],
    ];
  }
  function visit(
    t: Timeline,
    f: number,
    prefix: string,
    parent: Matrix,
    opacity: number,
    groups: string[],
    exposures: Exposure[],
    rootLayer: string,
    rootId?:string,
  ) {
    if (exposures.length > 8) throw new Error('Nested graphic depth limit.');
    for (const layer of t.layers) {
      let low = 0,
        high = layer.keys.length - 1;
      if (high < 0) continue;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (layer.keys[middle].frame <= f) low = middle;
        else high = middle - 1;
      }
      const key = layer.keys[low],
        path = prefix + (prefix && layer.id !== '@base' ? '/' + layer.id : '');
      const chain = [
        ...exposures,
        {
          path: prefix + '/' + layer.id,
          start: key.frame,
          end: layer.keys[low + 1]?.frame ?? t.duration,
          duration: t.duration,
          frame: f,
        },
      ];
      for (const node of key.nodes) {
        if (++work > 100000 || (budget && --budget.remaining < 0))
          throw new Error('Graphic button sample exceeds its frame budget.');
        const source = node.shape,
          id = path ? path + '/' + source.id : source.id;
        const transform = product(parent, node.placement),
          alpha = opacity * (source.opacity ?? 1);
        const nestedGroups = [
          ...groups,
          ...(source.groups ?? []).map((g) => (path ? path + '/' + g : g)),
        ];
        if (node.definition !== undefined) {
          const next = plan.definitions[node.definition],
            first = Math.min(source.symbolPlayback?.firstFrame ?? 0, next.duration - 1),
            age = Math.max(0, Math.floor(f - key.frame));
          const nextFrame =
            source.symbolPlayback?.mode === 'single'
              ? first
              : source.symbolPlayback?.mode === 'once'
                ? Math.min(first + age, next.duration - 1)
                : (first + age) % next.duration;
          visit(next, nextFrame, id, transform, alpha, nestedGroups, chain, rootLayer || layer.id,rootId ?? source.id);
        } else {
          result.push({
            shape: {
              ...source,
              id,
              x: transform[4],
              y: transform[5],
              rotation: 0,
              transform: [transform[0], transform[1], transform[2], transform[3]],
              opacity: alpha,
              groups: nestedGroups,
            },
            button: node.button,
            layerId: rootLayer || layer.id,
            exposures: chain,
          });
          rootOwner?.(result[result.length-1].shape,rootLayer || layer.id,rootId ?? source.id,chain[0].start);
        }
      }
    }
  }
  visit(plan.root, frame, '', [1, 0, 0, 1, 0, 0], 1, [], [], '');
  return result;
}

export type GraphicButtonLifetime = {
  id: string;
  layerId: string;
  path: string;
  start: number;
  end: number;
};

/** Compile routed exposure intervals once, including continuity across root wrap.
 * Positions for these intervals use the existing unwrapped root clock; wrapped
 * nested frame numbers never enter the lifetime guard. Button/movie boundaries
 * and ancestor key identities are retained independently of paint equality.
 */
export function compileGraphicButtonLifetimes(plan: GraphicButtonPlan,
  select?: (pose: ReturnType<typeof sampleGraphicButtonPlan>[number]) => boolean,
  budget = { remaining: 2000000 }): GraphicButtonLifetime[] {
  const tracks = new Map<string, GraphicButtonLifetime[]>();
  // Return a delay in this timeline's advancing clock. Ancestor key identities,
  // wraps and once clamps are boundaries even when rendered paint is identical.
  function nextChange(timeline: Timeline, frame: number): number {
    let delay = timeline.duration - frame;
    for (const layer of timeline.layers) {
      let low = 0, high = layer.keys.length - 1;
      if (high < 0) continue;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (layer.keys[middle].frame <= frame) low = middle;
        else high = middle - 1;
      }
      const key = layer.keys[low];
      delay = Math.min(delay, (layer.keys[low + 1]?.frame ?? timeline.duration) - frame);
      for (const node of key.nodes) {
        if (--budget.remaining < 0)
          throw new Error('Graphic button lifetimes exceed their compilation budget.');
        if (node.definition === undefined || node.shape.symbolPlayback?.mode === 'single') continue;
        const child = plan.definitions[node.definition];
        if (child.duration <= 1) continue;
        const first = Math.min(node.shape.symbolPlayback?.firstFrame ?? 0, child.duration - 1);
        const age = frame - key.frame, once = node.shape.symbolPlayback?.mode === 'once';
        const childFrame = once ? Math.min(first + age, child.duration - 1) : (first + age) % child.duration;
        if (once && childFrame === child.duration - 1) continue;
        delay = Math.min(delay, once ? child.duration - 1 - childFrame : child.duration - childFrame,
          nextChange(child, childFrame));
      }
    }
    return delay;
  }
  for (let frame = 0; frame < plan.root.duration;) {
    const end = Math.min(plan.root.duration, frame + nextChange(plan.root, frame));
    // Retain the root-duration charge even when unchanged poses are skipped.
    budget.remaining -= end - frame;
    if (budget.remaining < 0)
      throw new Error('Graphic button lifetimes exceed their compilation budget.');
    for (const pose of sampleGraphicButtonPlan(plan, frame, budget)) {
      if (select ? !select(pose) : !pose.button) continue;
      const id = JSON.stringify([
        pose.layerId,
        pose.shape.id,
        pose.shape.symbolId,
        pose.exposures.map((e) => [e.path, e.start, e.end]),
      ]);
      let spans = tracks.get(id);
      if (!spans) tracks.set(id, (spans = []));
      const previous = spans.at(-1);
      if (previous?.end === frame) previous.end = end;
      else
        spans.push({
          id,
          layerId: pose.layerId,
          path: pose.shape.id,
          start: frame,
          end,
        });
    }
    frame = end;
  }
  const result: GraphicButtonLifetime[] = [];
  for (const spans of tracks.values()) {
    const first = spans[0],
      last = spans.at(-1)!;
    if (spans.length > 1 && first.start === 0 && last.end === plan.root.duration) {
      // A wrapped span has one stable start for both sides of the root seam.
      last.end += first.end;
      spans.shift();
    }
    result.push(...spans);
  }
  return result;
}

/** Match poses to compiled spans; the returned start/end feed the root guard. */
export function graphicButtonLifetimesAt(
  spans: GraphicButtonLifetime[],
  duration: number,
  frame: number,
) {
  return spans.filter(
    (s) => (frame >= s.start && frame < s.end) || (s.end > duration && frame < s.end - duration),
  );
}
