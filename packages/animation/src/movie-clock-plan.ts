import { symbolLayers, type Project, type Vector, type Layer } from '../../document/src';
import type { MovieClockDocument } from './movie-clock';

export type ClockInstance = Pick<Vector, 'id' | 'kind' | 'symbolId' | 'symbolPlayback'> & {
  instancePath: string;
};
export type ClockTimeline = {
  duration: number;
  layers: { id: string; visible: boolean; keys: { frame: number; shapes: ClockInstance[] }[] }[];
};
export type MovieClockPlan = ClockTimeline &
  Pick<MovieClockDocument, 'id' | 'fps'> & {
    definitions: Record<string, ClockTimeline>;
  };

/** Immutable playback topology. Graphic exposures are flattened only down to movie boundaries. */
export function compileMovieClockPlan(project: Project, budget?: { remaining: number }): MovieClockPlan {
  const definitions = new Map((project.symbols ?? []).map((d) => [d.id, d]));
  const needed = new Set<string>();
  const contains = new Map<string, boolean>();
  const depths = new Map<string, number>();
  let work = 0;
  const count = () => {
    if (++work > 2000000 || (budget && --budget.remaining < 0))
      throw new Error('Movie clock plan exceeds its compilation budget.');
  };
  function hasMovies(id: string, ancestry: string[] = []): boolean {
    if (ancestry.includes(id) || ancestry.length >= 8)
      throw new Error('Nested movie cycle or depth limit.');
    if (contains.has(id)) {
      if (ancestry.length + depths.get(id)! > 8)
        throw new Error('Nested movie cycle or depth limit.');
      return contains.get(id)!;
    }
    const d = definitions.get(id);
    if (!d) throw new Error('Missing movie definition.');
    let found = false,
      depth = 1;
    for (const layer of symbolLayers(d))
      for (const key of layer.keys)
        for (const shape of key.shapes) {
          count();
          if (shape.kind !== 'symbol') continue;
          const nested = hasMovies(shape.symbolId!, [...ancestry, id]);
          depth = Math.max(depth, 1 + depths.get(shape.symbolId!)!);
          found = found || shape.symbolPlayback?.mode === 'movie' || nested;
        }
    contains.set(id, found);
    depths.set(id, depth);
    return found;
  }
  function held(layer: Layer, frame: number) {
    let low = 0,
      high = layer.keys.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (layer.keys[middle].frame <= frame) low = middle;
      else high = middle - 1;
    }
    return { key: layer.keys[low], end: layer.keys[low + 1]?.frame ?? Infinity };
  }
  function flatten(
    shapes: Vector[],
    age: number,
    prefix = '',
    ancestry: string[] = [],
  ): { shapes: ClockInstance[]; next: number } {
    const result: ClockInstance[] = [];
    let next = Infinity;
    for (const shape of shapes) {
      count();
      if (shape.kind !== 'symbol') continue;
      if (!definitions.has(shape.symbolId!)) throw new Error('Missing movie definition.');
      const instancePath = prefix + shape.id;
      if (shape.symbolPlayback?.mode === 'movie') {
        needed.add(shape.symbolId!);
        result.push({
          id: prefix ? JSON.stringify([...ancestry, shape.id, shape.symbolId]) : shape.id,
          instancePath,
          kind: 'symbol',
          symbolId: shape.symbolId,
          symbolPlayback: { ...shape.symbolPlayback },
        });
        continue;
      }
      if (!hasMovies(shape.symbolId!)) continue;
      const d = definitions.get(shape.symbolId!)!;
      const duration = d.timeline?.duration ?? 1;
      const first = Math.min(shape.symbolPlayback?.firstFrame ?? 0, duration - 1);
      const frame =
        shape.symbolPlayback?.mode === 'single'
          ? first
          : shape.symbolPlayback?.mode === 'once'
            ? Math.min(first + age, duration - 1)
            : (first + age) % duration;
      const advancing = duration > 1 && shape.symbolPlayback?.mode !== 'single' &&
        !(shape.symbolPlayback?.mode === 'once' && frame === duration - 1);
      // A wrap resets graphic exposure ages even if the held artwork is unchanged.
      // Once playback stops, all graphic descendants freeze at that sampled pose.
      let change = shape.symbolPlayback?.mode === 'once' ? duration - 1 - frame : duration - frame;
      for (const layer of symbolLayers(d)) {
        if (!layer.visible) continue;
        const { key, end } = held(layer, frame);
        const child = flatten(
          key.shapes,
          frame - key.frame,
          instancePath + (layer.id === '@base' ? '' : '/' + layer.id) + '/',
          [...ancestry, shape.id, d.id, layer.id],
        );
        result.push(...child.shapes);
        change = Math.min(change, end - frame, child.next);
      }
      if (advancing) next = Math.min(next, change);
    }
    return { shapes: result, next };
  }

  function timeline(layers: Layer[], duration: number): ClockTimeline {
    return {
      duration,
      layers: layers.map((layer) => {
        const keys: ClockTimeline['layers'][number]['keys'] = [];
        let signature = '';
        const append = (frame: number, shapes: ClockInstance[]) => {
          const next = JSON.stringify(shapes);
          if (next !== signature) keys.push({ frame, shapes });
          signature = next;
        };
        for (let index = 0; index < layer.keys.length; index++) {
          const key = layer.keys[index];
          const end = Math.min(duration, layer.keys[index + 1]?.frame ?? duration);
          for (let frame = key.frame; frame < end;) {
            count();
            const sample = flatten(key.shapes, frame - key.frame);
            append(frame, sample.shapes);
            // Every nested key, wrap and once-clamp remains a sampling boundary.
            // Movie leaves have independent clocks and do not advance this topology.
            frame = Math.min(end, frame + sample.next);
          }
        }
        return { id: layer.id, visible: layer.visible, keys };
      }),
    };
  }
  for (const id of definitions.keys()) hasMovies(id);
  const root = timeline(project.layers, project.duration);
  const compiled: Record<string, ClockTimeline> = Object.create(null);
  for (const id of needed) {
    const d = definitions.get(id)!;
    compiled[id] = timeline(symbolLayers(d), d.timeline?.duration ?? 1);
  }
  return { ...root, id: project.id, fps: project.fps, definitions: compiled };
}
