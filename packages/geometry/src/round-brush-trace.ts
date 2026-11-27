import type { Point } from '@splash/document';

const MAX_GRID_SAMPLES = 4_000_000;
const MAX_SWEEP_VISITS = 32_000_000;
const MAX_BOUNDARY_POINTS = 200_000;
const MAX_COORDINATE = 1e12;
const TILE_SIZE = 32;

type Crossing = { point: Point; neighbors: number[] };
const ambiguous = Symbol('ambiguous Brush lattice cell');

/** Trace the zero set of the distance to a constant-radius capsule sweep.
 * Returned rings are open lists of vertices with implicit closure. Grid
 * resolution alone does not prove that all source holes are represented.
 * Callers must qualify the result before using it as editable artwork. */
export function traceRoundBrush(
  points: readonly Point[], radius: number, spacing: number, retryAmbiguous = false,
): Point[][] | undefined {
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(spacing) || spacing <= 0)
    throw Error('Invalid round Brush trace dimensions.');
  if (!points.length || spacing > radius / 6) return;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const point of points) {
    const { x, y } = point;
    if (!Number.isFinite(x) || !Number.isFinite(y) ||
        Math.max(Math.abs(x), Math.abs(y)) + radius > MAX_COORDINATE)
      throw Error('Round Brush trace coordinates exceed the supported range.');
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  // Use a local lattice with a positive border around the entire sweep.
  const padding = radius + 2 * spacing;
  const columns = Math.ceil((right - left + 2 * padding) / spacing) + 1;
  const rows = Math.ceil((bottom - top + 2 * padding) / spacing) + 1;
  if (!Number.isSafeInteger(columns * rows) || columns * rows > MAX_GRID_SAMPLES) return;
  const epsilon = 64 * Number.EPSILON * Math.max(1, radius, Math.abs(left), Math.abs(top), Math.abs(right), Math.abs(bottom));
  if (epsilon >= spacing / 16) return;

  const field = new Float64Array(columns * rows);
  // Only the narrow band around the zero set needs finite distances. Positive
  // samples adjacent to a crossing are within one grid edge of the sweep.
  const band = radius + 2 * spacing;
  const tileColumns = Math.ceil((columns - 1) / TILE_SIZE);
  const touched = new Uint8Array(tileColumns * Math.ceil((rows - 1) / TILE_SIZE));
  let remaining = MAX_SWEEP_VISITS;
  const budget = {cells: MAX_GRID_SAMPLES, crossings: MAX_BOUNDARY_POINTS};
  const stamp = (a: Point, b: Point) => {
    const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - band) / spacing));
    const x1 = Math.min(columns - 1, Math.ceil((Math.max(a.x, b.x) + band) / spacing));
    const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - band) / spacing));
    const y1 = Math.min(rows - 1, Math.ceil((Math.max(a.y, b.y) + band) / spacing));
    remaining -= (x1 - x0 + 1) * (y1 - y0 + 1);
    if (remaining < 0) return false;
    // A written sample can affect cells immediately above and to its left.
    const firstTile = Math.floor(Math.max(0,x0-1)/TILE_SIZE);
    const lastTile = Math.floor(Math.min(columns-2,x1)/TILE_SIZE);
    for (let tileY=Math.floor(Math.max(0,y0-1)/TILE_SIZE);
      tileY<=Math.floor(Math.min(rows-2,y1)/TILE_SIZE);tileY++) {
      const offset = tileY*tileColumns;
      touched.fill(1,offset+firstTile,offset+lastTile+1);
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x * spacing - a.x, py = y * spacing - a.y;
      const u = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
      const index = y * columns + x;
      const distance = (px - u * dx) ** 2 + (py - u * dy) ** 2;
      if (distance < field[index]) field[index] = distance;
    }
    return true;
  };
  const trace = (offsetX: number, offsetY: number) => {
    // Start off the bounding-box lattice so ordinary axis-aligned tangencies
    // are less likely to land directly on a row or column.
    const origin = {
      x: left - padding + spacing / 3 + offsetX,
      y: top - padding + spacing / 5 + offsetY,
    };
    field.fill(band * band);
    touched.fill(0);
    // Split long spans for indexing only. Their joined capsule coverage equals
    // the original segment's sweep and no pointer point is discarded.
    for (let i = points.length === 1 ? 0 : 1; i < points.length; i++) {
      const a = points[Math.max(0, i - 1)], b = points[i];
      const ax = a.x - origin.x, ay = a.y - origin.y, dx = b.x - a.x, dy = b.y - a.y;
      const count = Math.max(1, Math.ceil(Math.hypot(dx, dy) / radius));
      if (count > remaining) return;
      let start = { x: ax, y: ay };
      for (let j = 1; j <= count; j++) {
        const end = { x: ax + dx * (j / count), y: ay + dy * (j / count) };
        if (!stamp(start, end)) return;
        start = end;
      }
    }
    return traceField(field, rows, columns, origin, spacing, radius, epsilon, touched, tileColumns, budget);
  };
  const first = trace(0, 0);
  if (first !== ambiguous) return first;
  // A shifted lattice can avoid an unresolved sample without guessing its
  // ownership. The retry shares the sweep and trace budgets and the caller
  // still needs to certify all resulting rings against the sweep witness.
  if (!retryAmbiguous) return;
  const second = trace(spacing * .6, spacing * .5);
  if (second !== ambiguous) return second;
}

function traceField(field: Float64Array, rows: number, columns: number,
  origin: Point, spacing: number, radius: number, epsilon: number,
  touched: Uint8Array, tileColumns: number,
  budget: {cells: number; crossings: number},
): Point[][] | typeof ambiguous | undefined {
  const threshold = radius*radius;
  const low = Math.max(0,radius-2*epsilon)**2, high = (radius+2*epsilon)**2;
  const unresolved = (distance:number) =>
    distance >= low && distance <= high && Math.abs(Math.sqrt(distance)-radius)<=epsilon;
  const crossings = new Map<number, Crossing>();
  const crossing = (index: number, vertical: boolean) => {
    const key = 2 * index + Number(vertical);
    if (!crossings.has(key)) {
      budget.crossings--;
      // Interpolate the same signed distances as the dense implementation.
      // Samples outside crossing edges need no square root.
      const first = Math.sqrt(field[index])-radius;
      const last = Math.sqrt(field[index+(vertical?columns:1)])-radius;
      const t = first / (first - last);
      crossings.set(key, { point: {
        x: origin.x + (index % columns + (vertical ? 0 : t)) * spacing,
        y: origin.y + (Math.floor(index / columns) + (vertical ? t : 0)) * spacing,
      }, neighbors: [] });
    }
    return key;
  };
  for (let y = 0; y < rows - 1; y++) {
    const tileOffset = Math.floor(y/TILE_SIZE)*tileColumns;
    for (let tileX=0;tileX<tileColumns;tileX++) {
      if (!touched[tileOffset+tileX]) continue;
      const startX = tileX*TILE_SIZE;
      const end = Math.min(columns-1,(tileX+1)*TILE_SIZE);
      budget.cells -= end - startX;
      if (budget.cells < 0) return;
      for (let x=startX;x<end;x++) {
        const start = y * columns + x, below = start + columns;
        const a = field[start], b = field[start + 1], c = field[below], d = field[below + 1];
        if (Math.min(a,b,c,d)>high || Math.max(a,b,c,d)<low) continue;
        // Samples on the contour and alternating-sign saddles need
        // subdivision to settle ownership. Decline this sampled trace.
        if (unresolved(a) || unresolved(b) || unresolved(c) || unresolved(d)) return ambiguous;
        const tl = a < threshold, tr = b < threshold, bl = c < threshold, br = d < threshold;
        if (tl === tr && tl === bl && tl === br) continue;
        if (tl === br && tr === bl && tl !== tr) return ambiguous;
        const edges: number[] = [];
        if (tl !== tr) edges.push(crossing(start, false));
        if (tl !== bl) edges.push(crossing(start, true));
        if (tr !== br) edges.push(crossing(start + 1, true));
        if (bl !== br) edges.push(crossing(below, false));
        if (edges.length !== 2 || budget.crossings < 0) return;
        const [from, to] = edges;
        crossings.get(from)!.neighbors.push(to);
        crossings.get(to)!.neighbors.push(from);
      }
    }
  }
  const rings: Point[][] = [], visited = new Set<number>();
  for (const start of crossings.keys()) {
    if (visited.has(start)) continue;
    const ring: Point[] = [];
    let previous = -1, current = start;
    do {
      const node = crossings.get(current);
      if (!node || visited.has(current) || node.neighbors.length !== 2) return;
      visited.add(current);
      ring.push(node.point);
      const [first, second] = node.neighbors;
      const next = first === previous ? second : first;
      previous = current;
      current = next;
    } while (current !== start);
    if (ring.length < 3) return;
    rings.push(ring);
  }
  return rings.length ? rings : undefined;
}
