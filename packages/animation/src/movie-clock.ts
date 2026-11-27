import type { Project, Vector } from '../../document/src';

export type MovieClockDocument = Pick<Project, 'id' | 'fps' | 'duration'> & {
  layers: {
    id: string;
    visible: boolean;
    keys: {
      frame: number;
      shapes: Pick<Vector, 'id' | 'kind' | 'symbolId' | 'symbolPlayback'>[];
    }[];
  }[];
};

/** Playback-session clock: instance identity survives parent keys and root loops. */
export function createMovieClock() {
  let documentId = '',
    previous = -1,
    previousPosition: number | undefined;
  const starts = new Map<string, number>();
  let visible = new Set<string>();
  return {
    /** Session-local birth time, used to isolate descendant clocks after parent reentry. */
    origin(identity: string): number | undefined {
      return starts.get(identity);
    },
    sample(
      project: MovieClockDocument,
      frame: number,
      seconds: number,
      rootPosition?: number,
    ): Record<string, number> {
      const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
      const position = Number.isFinite(rootPosition)
        ? Math.max(0, Math.floor(rootPosition!))
        : undefined;
      if (
        documentId !== project.id ||
        time < previous ||
        (position !== undefined && previousPosition !== undefined && position < previousPosition)
      ) {
        starts.clear();
        documentId = project.id;
        previousPosition = undefined;
        visible.clear();
      }
      previous = time;
      const active = new Set<string>(),
        result: Record<string, number> = {};
      for (const layer of project.layers) {
        if (!layer.visible) continue;
        let low = 0,
          high = layer.keys.length - 1;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (layer.keys[middle].frame <= frame) low = middle;
          else high = middle - 1;
        }
        const key = layer.keys[low];
        if (!key || key.frame > frame) continue;
        const movies = key.shapes.filter(
          (s) => s.kind === 'symbol' && s.symbolPlayback?.mode === 'movie',
        );
        if (!movies.length) continue;
        // Index each exposure once, rather than searching every key for every active movie.
        const entries = new Map<string, number>();
        const identity = (s: (typeof key.shapes)[number]) => s.id + '/' + s.symbolId;
        if (
          visible.has(layer.id) &&
          position !== undefined &&
          previousPosition !== undefined &&
          position > previousPosition
        ) {
          // Read artwork only for crossed boundaries and their immediate predecessors.
          // A per-sample cache also avoids reparsing adjacent crossed exposures.
          const indexed = new Map<number, Set<string>>();
          const identities = (index: number) => {
            let ids = indexed.get(index);
            if (!ids) {
              ids = new Set(
                layer.keys[index].shapes
                  .filter((s) => s.kind === 'symbol' && s.symbolPlayback?.mode === 'movie')
                  .map(identity),
              );
              indexed.set(index, ids);
            }
            return ids;
          };
          for (let index = 0; index < layer.keys.length; index++) {
            const exposure = layer.keys[index];
            const entry =
              exposure.frame +
              Math.floor((position - exposure.frame) / project.duration) * project.duration;
            if (entry <= previousPosition) continue;
            const present = identities(index);
            const prior = identities((index + layer.keys.length - 1) % layer.keys.length);
            for (const id of present) {
              if (!prior.has(id) && entry > (entries.get(id) ?? -1)) entries.set(id, entry);
            }
          }
        }
        for (const shape of movies) {
          const id = layer.id + '/' + identity(shape);
          active.add(id);
          const entered = entries.get(identity(shape));
          if (entered !== undefined)
            starts.set(id, Math.max(0, time - (position! - entered) / project.fps));
          else if (!starts.has(id)) starts.set(id, time);
          result[id] = Math.floor(Math.max(0, time - starts.get(id)!) * project.fps + 1e-7);
        }
      }
      for (const id of starts.keys()) if (!active.has(id)) starts.delete(id);
      previousPosition = position;
      visible = new Set(project.layers.filter((l) => l.visible).map((l) => l.id));
      return result;
    },
    reset() {
      starts.clear();
      previous = -1;
      previousPosition = undefined;
      documentId = '';
      visible.clear();
    },
  };
}
