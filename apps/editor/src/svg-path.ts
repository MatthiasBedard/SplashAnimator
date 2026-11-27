import { MAX_SYMBOL_ARTWORK, type BezierNode, type Point } from '../../../packages/document/src';

export const svgNumber = /[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/.source;

/** Read SVG numbers without splitting implicit signs, decimals or adjacent arc flags. */
export class SvgNumbers {
  index = 0;
  private readonly numeric = new RegExp(svgNumber, 'y');
  constructor(readonly text: string) {}
  peek() {
    while (/\s/.test(this.text[this.index] ?? '')) this.index++;
    if (this.text[this.index] === ',') {
      let previous = this.index - 1;
      while (/\s/.test(this.text[previous] ?? '')) previous--;
      this.index++;
      while (/\s/.test(this.text[this.index] ?? '')) this.index++;
      if (!/[\d.]/.test(this.text[previous] ?? '') || !/[\d.+-]/.test(this.text[this.index] ?? ''))
        throw Error('Invalid SVG numeric separator.');
    }
    return this.text[this.index] ?? '';
  }
  read(flag = false) {
    this.peek();
    this.numeric.lastIndex = this.index;
    const token = flag ? /^[01]$/.test(this.text[this.index] ?? '') && this.text[this.index]
      : this.numeric.exec(this.text)?.[0];
    if (!token || !Number.isFinite(Number(token))) throw Error('Invalid SVG path or numeric attribute.');
    this.index += token.length;
    return Number(token);
  }
  list() {
    const values: number[] = [];
    while (this.peek()) values.push(this.read());
    return values;
  }
}

export type SvgSubpath = { nodes: BezierNode[]; closed: boolean };
const reflect = (a: Point, b: Point): Point => ({ x: 2 * a.x - b.x, y: 2 * a.y - b.y });
const toward = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

function appendArc(nodes: BezierNode[], end: Point, rx: number, ry: number, degrees: number, large: number, sweep: number) {
  const start = nodes.at(-1)!;
  if (samePoint(start, end)) return;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) { nodes.push(end); return; }
  const radians = (degrees % 360) * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const dx = (start.x - end.x) / 2, dy = (start.y - end.y) / 2;
  const x = cos * dx + sin * dy, y = -sin * dx + cos * dy;
  const scale = Math.max(1, Math.hypot(x / rx, y / ry));
  rx *= scale;
  ry *= scale;
  const u = x / rx, v = y / ry, distance = Math.hypot(u, v);
  const sign = large === sweep ? -1 : 1;
  const factor = sign * Math.sqrt(Math.max(0, 1 - distance ** 2)) / distance;
  const cx = factor * v, cy = -factor * u;
  const center = {
    x: cos * rx * cx - sin * ry * cy + (start.x + end.x) / 2,
    y: sin * rx * cx + cos * ry * cy + (start.y + end.y) / 2,
  };
  const first = Math.atan2(v - cy, u - cx);
  let turn = Math.atan2(-v - cy, -u - cx) - first;
  if (sweep && turn < 0) turn += 2 * Math.PI;
  if (!sweep && turn > 0) turn -= 2 * Math.PI;
  if (!Number.isFinite(turn) || !turn) throw Error('SVG arc exceeds supported geometry limits.');
  const count = Math.ceil(Math.abs(turn) / (Math.PI / 2));
  const step = turn / count, handle = 4 / 3 * Math.tan(step / 4);
  const ellipse = (a: number, tangent: number): Point => {
    const sx = rx * (Math.cos(a) - tangent * Math.sin(a));
    const sy = ry * (Math.sin(a) + tangent * Math.cos(a));
    return { x: center.x + cos * sx - sin * sy, y: center.y + sin * sx + cos * sy };
  };
  for (let i = 0; i < count; i++) {
    const a = first + i * step, b = a + step;
    nodes.at(-1)!.out = ellipse(a, handle);
    nodes.push({ ...(i === count - 1 ? end : ellipse(b, 0)), in: ellipse(b, -handle) });
  }
}

export function parseSvgPath(data: string): SvgSubpath[] {
  const reader = new SvgNumbers(data);
  const paths: SvgSubpath[] = [];
  let command = '', path: SvgSubpath | undefined, point: Point = { x: 0, y: 0 };
  let control: Point | undefined, previous = '';
  let anchors = 0;
  while (reader.peek()) {
    if (/[a-z]/i.test(reader.peek())) command = data[reader.index++];
    const type = command.toUpperCase(), relative = command !== type;
    const coord = (x = true) => reader.read() + (relative ? x ? point.x : point.y : 0);
    const pair = (): Point => ({ x: coord(), y: coord(false) });
    if (type === 'M') {
      point = pair();
      path = { nodes: [{ ...point }], closed: false };
      paths.push(path);
      anchors++;
      command = relative ? 'l' : 'L';
    } else {
      if (!path) throw Error('An SVG path must begin with a move command.');
      if (type === 'Z') {
        path.closed = true;
        const first = path.nodes[0], last = path.nodes.at(-1)!;
        if (path.nodes.length > 2 && samePoint(first, last)) {
          path.nodes.pop();
          if (last.in) first.in = last.in;
        }
        point = { x: first.x, y: first.y };
        command = '';
      } else {
        if (path.closed) {
          path = { nodes: [{ ...point }], closed: false };
          paths.push(path);
          anchors++;
        }
        const nodes = path.nodes;
        const before = nodes.length;
        let end: Point;
        if (type === 'C' || type === 'S') {
          const out = type === 'C' ? pair() : control && /[CS]/.test(previous) ? reflect(point, control) : point;
          control = pair();
          end = pair();
          nodes.at(-1)!.out = { ...out };
          nodes.push({ ...end, in: control });
        } else if (type === 'Q' || type === 'T') {
          control = type === 'Q' ? pair() : control && /[QT]/.test(previous) ? reflect(point, control) : point;
          end = pair();
          nodes.at(-1)!.out = toward(point, control, 2 / 3);
          nodes.push({ ...end, in: toward(end, control, 2 / 3) });
        } else if (type === 'A') {
          const rx = reader.read(), ry = reader.read(), angle = reader.read();
          const large = reader.read(true), sweep = reader.read(true);
          end = pair();
          appendArc(nodes, end, rx, ry, angle, large, sweep);
        } else {
          if (type === 'L') end = pair();
          else if (type === 'H') end = { x: coord(), y: point.y };
          else if (type === 'V') end = { x: point.x, y: coord(false) };
          else throw Error('Unsupported or malformed SVG path command.');
          nodes.push({ ...end });
        }
        point = end;
        anchors += nodes.length - before;
      }
    }
    if (anchors > MAX_SYMBOL_ARTWORK) throw Error('SVG path exceeds the symbol artwork budget.');
    previous = type;
  }
  return paths.filter(item => item.nodes.length > 1);
}
