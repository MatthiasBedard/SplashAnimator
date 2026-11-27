/** The containing movie starts at its saved offset; full-length exposures survive its loops. */
export function movieButtonEntrySeconds(start: number, end: number, duration: number,
  firstFrame: number, elapsed: number, origin: number, fps: number) {
  if (start === 0 && end === duration) return origin;
  const entry = start + Math.floor((firstFrame + elapsed - start) / duration) * duration;
  return origin + Math.max(0, entry - firstFrame) / fps;
}

/** Birth time for a root exposure crossed since the previous playback sample. */
export function crossedButtonEntry(start: number, end: number, duration: number,
  previous: number | undefined, position: number, frameStartSeconds: number, fps: number) {
  if (previous === undefined || previous >= position || (start === 0 && end === duration)) return;
  const entry = start + Math.floor((position - start) / duration) * duration;
  if (entry > previous) return Math.max(0, frameStartSeconds - (position - entry) / fps);
}

/** Shared standalone lifetime guard; work is bounded by active buttons and ancestry, not skipped frames. */
export function createButtonExposureRuntime<Id extends string | number>() {
  let previousPosition = -1;
  type Lifetime = { signature: string; positions: number[] };
  let epochs = new Map<Id, Lifetime>();
  return {
    reset() {
      previousPosition = -1;
      epochs.clear();
    },
    sample(
      active: {
        id: Id;
        start: number;
        end: number;
        /** Unwrapped parent positions from the playback resolver, outermost first. */
        ancestors?: {
          id: string;
          start: number;
          end: number;
          duration: number;
          position: number;
        }[];
      }[],
      duration: number,
      position: number,
    ): Set<Id> {
      const next = new Map<Id, Lifetime>();
      const expired = new Set<Id>();
      for (const { id, start, end, ancestors = [] } of active) {
        if (ancestors.length > 8) throw new Error('Button ancestry exceeds the depth limit.');
        // Whole-timeline holds are continuous across loops at every level.
        const spans = [{ id: '', start, end, duration, position }, ...ancestors];
        const signature = JSON.stringify(
          spans.map((span) => [
            span.id,
            span.start,
            span.end,
            span.duration,
            span.start === 0 && span.end === span.duration
              ? 0
              : Math.floor((span.position - span.start) / span.duration),
          ]),
        );
        const positions = spans.map((span) => span.position);
        const previous = epochs.get(id);
        next.set(id, { signature, positions });
        if (
          previous &&
          (previous.signature !== signature ||
            position < previousPosition ||
            positions.some((value, i) => value < previous.positions[i]))
        )
          expired.add(id);
      }
      for (const id of epochs.keys()) if (!next.has(id)) expired.add(id);
      epochs = next;
      previousPosition = position;
      return expired;
    },
  };
}
