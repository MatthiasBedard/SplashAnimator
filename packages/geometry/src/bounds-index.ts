export type Bounds = { left: number; right: number; top: number; bottom: number };
type Entry = Bounds & { index: number };
type Node = Bounds & { children?: [Node, Node]; entries?: Entry[] };
export const overlaps = (a: Bounds, b: Bounds, padding: number) =>
  a.right + padding >= b.left &&
  b.right + padding >= a.left &&
  a.bottom + padding >= b.top &&
  b.bottom + padding >= a.top;

/** Immutable broad phase. Empty bounds are omitted; candidates still need exact paint tests. */
export function boundsIndex(bounds: Bounds[]): (query: Bounds, padding?: number) => number[] {
  const entries = bounds.flatMap((b, index) => {
    if (b.left > b.right || b.top > b.bottom) return [];
    if (![b.left, b.right, b.top, b.bottom].every(Number.isFinite))
      throw new Error('Paint connectivity requires finite bounds.');
    return [{ ...b, index }];
  });
  function build(entries: Entry[]): Node {
    const node: Node = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    for (const b of entries) {
      node.left = Math.min(node.left, b.left);
      node.right = Math.max(node.right, b.right);
      node.top = Math.min(node.top, b.top);
      node.bottom = Math.max(node.bottom, b.bottom);
    }
    if (entries.length <= 8) node.entries = entries;
    else {
      const horizontal = node.right - node.left >= node.bottom - node.top;
      const center = (b: Bounds) =>
        horizontal ? b.left / 2 + b.right / 2 : b.top / 2 + b.bottom / 2;
      entries.sort((a, b) => center(a) - center(b) || a.index - b.index);
      const middle = entries.length >>> 1;
      node.children = [build(entries.slice(0, middle)), build(entries.slice(middle))];
    }
    return node;
  }
  const root = build(entries);
  return (query, padding = 0) => {
    const result: number[] = [];
    const pending = [root];
    while (pending.length) {
      const node = pending.pop()!;
      if (!overlaps(node, query, padding)) continue;
      if (node.children) pending.push(...node.children);
      else
        for (const entry of node.entries!)
          if (overlaps(entry, query, padding)) result.push(entry.index);
    }
    return result;
  };
}
