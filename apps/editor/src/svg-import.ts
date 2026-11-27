import { id, MAX_SYMBOL_ARTWORK, type BezierNode, type SymbolDefinition, type Vector } from '../../../packages/document/src';
import { mapPoint, multiply, type Matrix } from '../../../packages/geometry/src/affine';
import { parseSvgPath, svgNumber, SvgNumbers, type SvgSubpath } from './svg-path';

const svgNamespace = 'http://www.w3.org/2000/svg';
const maxSvgBytes = 4_000_000;
const identity: Matrix = [1, 0, 0, 1, 0, 0];
const styles = new Set(['fill', 'stroke', 'color', 'fill-rule', 'fill-opacity', 'stroke-opacity', 'opacity',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'display', 'visibility']);
const unsupportedEffects = ['clip-path', 'mask', 'filter', 'marker', 'marker-start', 'marker-mid', 'marker-end',
  'stroke-dasharray', 'stroke-dashoffset', 'vector-effect', 'paint-order'];
type Paint = Record<string, string>;

export function isSvgFile(file: File) {
  return /\.svgz?$/i.test(file.name) || /^image\/svg\+xml(?:;|$)/i.test(file.type);
}

async function readSvg(file: File) {
  if (!file.size || file.size > maxSvgBytes) throw Error('Choose an SVG file smaller than 4 MB.');
  if (!/\.svgz$/i.test(file.name)) return file.text();
  const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, text = '';
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return text + decoder.decode();
      bytes += next.value.byteLength;
      if (bytes > maxSvgBytes) throw Error('Uncompressed SVG exceeds 4 MB.');
      text += decoder.decode(next.value, { stream: true });
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

const lengthPattern = new RegExp(`^(${svgNumber})(px|in|cm|mm|pt|pc|q)?$`, 'i');
const units = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16, q: 96 / 101.6 };
function length(value: string | null, fallback = 0) {
  if (value === null) return fallback;
  const match = lengthPattern.exec(value.trim());
  if (!match) throw Error(`Unsupported SVG length "${value}". Use pixels or absolute units.`);
  const n = Number(match[1]) * units[(match[2]?.toLowerCase() ?? 'px') as keyof typeof units];
  if (!Number.isFinite(n)) throw Error('Invalid SVG length.');
  return n;
}

function transform(value: string | null) {
  let result = identity;
  let rest = value?.trim() ?? '';
  while (rest) {
    const match = /^(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^()]*)\)[\s,]*/.exec(rest);
    if (!match) throw Error('Unsupported SVG transform.');
    const args = new SvgNumbers(match[2]).list(), [a, b, c] = args, count = args.length;
    const rad = (a % 360) * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    let next: Matrix;
    if (match[1] === 'matrix' && count === 6) next = args as Matrix;
    else if (match[1] === 'translate' && (count === 1 || count === 2)) next = [1, 0, 0, 1, a, b ?? 0];
    else if (match[1] === 'scale' && (count === 1 || count === 2)) next = [a, 0, 0, b ?? a, 0, 0];
    else if (match[1] === 'rotate' && (count === 1 || count === 3)) {
      const x = b ?? 0, y = c ?? 0;
      next = [cos, sin, -sin, cos, x - cos * x + sin * y, y - sin * x - cos * y];
    } else if (match[1] === 'skewX' && count === 1) next = [1, 0, Math.tan(rad), 1, 0, 0];
    else if (match[1] === 'skewY' && count === 1) next = [1, Math.tan(rad), 0, 1, 0, 0];
    else throw Error('Invalid SVG transform arguments.');
    result = multiply(result, next);
    rest = rest.slice(match[0].length);
  }
  return result;
}

function viewport(root: Element) {
  const box = root.getAttribute('viewBox');
  const values = box === null ? undefined : new SvgNumbers(box).list();
  if (values && (values.length !== 4 || values[2] <= 0 || values[3] <= 0)) throw Error('Invalid SVG viewBox.');
  const [x, y, w, h] = values ?? [0, 0, 300, 150];
  const dimension = (axis: string, fallback: number) => {
    const value = root.getAttribute(axis);
    return values && value?.trim() === '100%' ? fallback : length(value, fallback);
  };
  const width = dimension('width', w), height = dimension('height', h);
  if (width <= 0 || height <= 0) throw Error('SVG dimensions must be positive.');
  const aspect = root.getAttribute('preserveAspectRatio')?.trim() || 'xMidYMid meet';
  const alignment = /^(none|x(Min|Mid|Max)Y(Min|Mid|Max))(?:\s+meet)?$/.exec(aspect);
  if (!alignment) throw Error('SVG viewport cropping is not supported.');
  const sx = values ? width / w : 1, sy = values ? height / h : 1;
  const scale = Math.min(sx, sy);
  const offset = (key: string) => key === 'Mid' ? 0.5 : key === 'Max' ? 1 : 0;
  const matrix: Matrix = alignment[1] === 'none' ? [sx, 0, 0, sy, -x * sx, -y * sy]
    : [scale, 0, 0, scale, (width - w * scale) * offset(alignment[2]) - x * scale,
      (height - h * scale) * offset(alignment[3]) - y * scale];
  return { width, height, matrix: values ? matrix : identity };
}

function geometry(element: Element): SvgSubpath[] {
  const n = (name: string) => length(element.getAttribute(name));
  switch (element.localName) {
    case 'path': return parseSvgPath(element.getAttribute('d') ?? '');
    case 'line': return [{ nodes: [{ x: n('x1'), y: n('y1') }, { x: n('x2'), y: n('y2') }], closed: false }];
    case 'polygon':
    case 'polyline': {
      const values = new SvgNumbers(element.getAttribute('points') ?? '').list();
      if (values.length % 2) throw Error('Invalid SVG point list.');
      if (values.length / 2 > MAX_SYMBOL_ARTWORK) throw Error('SVG points exceed the symbol artwork budget.');
      const nodes = [];
      for (let i = 0; i < values.length; i += 2) nodes.push({ x: values[i], y: values[i + 1] });
      return nodes.length >= 2 ? [{ nodes, closed: element.localName === 'polygon' }] : [];
    }
    case 'rect': {
      const x = n('x'), y = n('y'), width = n('width'), height = n('height');
      const rx = Math.min(width / 2, length(element.getAttribute('rx'), n('ry')));
      const ry = Math.min(height / 2, length(element.getAttribute('ry'), n('rx')));
      if (width < 0 || height < 0 || rx < 0 || ry < 0) throw Error('Invalid SVG rectangle dimensions.');
      if (!width || !height) return [];
      if (!rx || !ry) return [{ nodes: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }], closed: true }];
      const right = x + width, bottom = y + height, arc = `A${rx} ${ry} 0 0 1`;
      return parseSvgPath(`M${x + rx} ${y} H${right - rx} ${arc} ${right} ${y + ry} V${bottom - ry} ${arc} ${right - rx} ${bottom}
        H${x + rx} ${arc} ${x} ${bottom - ry} V${y + ry} ${arc} ${x + rx} ${y} Z`);
    }
    case 'circle':
    case 'ellipse': {
      const circle = element.localName === 'circle';
      const x = n('cx'), y = n('cy'), rx = n(circle ? 'r' : 'rx'), ry = n(circle ? 'r' : 'ry');
      if (rx < 0 || ry < 0) throw Error('Invalid SVG ellipse dimensions.');
      if (!rx || !ry) return [];
      return parseSvgPath(`M${x + rx} ${y} A${rx} ${ry} 0 0 1 ${x - rx} ${y} A${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`);
    }
    default: throw Error(`SVG element <${element.localName}> is not supported for editable import.`);
  }
}

function getPaint(element: Element, inherited: Paint) {
  const paint = { ...inherited };
  delete paint.opacity;
  for (const key of styles) {
    const value = element.getAttribute(key);
    if (value !== null && value.trim().toLowerCase() !== 'inherit') paint[key] = value.trim();
  }
  for (const key of unsupportedEffects) {
    if (element.hasAttribute(key) && element.getAttribute(key) !== 'none') throw Error(`Unsupported SVG effect: ${key}.`);
  }
  if (element.hasAttribute('stroke-miterlimit') && length(element.getAttribute('stroke-miterlimit')) !== 4)
    throw Error('Only the default SVG miter limit is supported.');
  for (const declaration of (element.getAttribute('style') ?? '').split(';')) {
    if (!declaration.trim()) continue;
    const i = declaration.indexOf(':');
    const key = declaration.slice(0, i).trim(), value = declaration.slice(i + 1).trim();
    if (i < 0 || !styles.has(key) || !value || /!important/i.test(value)) throw Error(`Unsupported SVG style: ${key || declaration}.`);
    if (value.toLowerCase() !== 'inherit') paint[key] = value;
  }
  return paint;
}

function opacity(value = '1') {
  const fraction = value.endsWith('%') ? length(value.slice(0, -1)) / 100 : length(value);
  return Math.max(0, Math.min(1, fraction));
}

function solidColor(canvas: CanvasRenderingContext2D, value: string) {
  // Canvas normalizes CSS named colors and RGB/HSL syntax without loading any resource.
  if (!CSS.supports('color', value) || /\b(?:var|env|attr|currentColor)\b/i.test(value)) throw Error(`Unsupported SVG paint: ${value}.`);
  canvas.fillStyle = '#000000';
  canvas.fillStyle = value;
  const normalized = canvas.fillStyle;
  if (/^#[0-9a-f]{6}$/.test(normalized)) return { color: normalized, alpha: 1 };
  const rgba = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(normalized);
  if (!rgba) throw Error(`Unsupported SVG color space: ${value}.`);
  return { color: '#' + rgba.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join(''), alpha: Number(rgba[4]) };
}

function vector(paths: SvgSubpath[], matrix: Matrix, paint: Pick<Vector, 'fill' | 'stroke' | 'strokeWidth' | 'fillEnabled' | 'opacity' | 'fillRule' | 'strokeCap' | 'strokeJoin'>): Vector {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const path of paths) for (const node of path.nodes) {
    for (const p of [node, node.in, node.out]) if (p) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  const local = ({ x, y }: BezierNode) => ({ x: x - minX, y: y - minY });
  const rings = paths.map(path => path.nodes.map(node => ({
    ...local(node), ...(node.in ? { in: local(node.in) } : {}), ...(node.out ? { out: local(node.out) } : {}),
  })));
  const origin = mapPoint(matrix, { x: minX, y: minY });
  return {
    id: id(), ...origin, width: maxX - minX, height: maxY - minY, rotation: 0,
    transform: [matrix[0], matrix[1], matrix[2], matrix[3]], points: [], drawingMode: 'object', ...paint,
    ...(rings.length === 1 ? { kind: 'bezier', nodes: rings[0], closed: paths[0].closed }
      : { kind: 'polygon', contours: rings, closed: true }),
  };
}

function paintedPaths(element: Element, matrix: Matrix, paint: Paint, canvas: CanvasRenderingContext2D) {
  const paths = geometry(element);
  if (!paths.length) return [];
  const color = (key: string, fallback: string) => {
    const value = paint[key] ?? fallback;
    return value.toLowerCase() === 'none' ? undefined : solidColor(canvas, value.toLowerCase() === 'currentcolor' ? paint.color ?? 'black' : value);
  };
  const fill = color('fill', 'black'), stroke = color('stroke', 'none');
  const width = length(paint['stroke-width'] ?? null, 1);
  const cap = paint['stroke-linecap'] ?? 'butt', join = paint['stroke-linejoin'] ?? 'miter';
  const fillRule = paint['fill-rule'] ?? 'nonzero';
  if (width < 0 || !['butt', 'square', 'round'].includes(cap) || !['miter', 'bevel', 'round'].includes(join) ||
      !['evenodd', 'nonzero'].includes(fillRule)) throw Error('Unsupported SVG fill or stroke settings.');
  const fillAlpha = (fill?.alpha ?? 0) * opacity(paint['fill-opacity']);
  const strokeAlpha = width ? (stroke?.alpha ?? 0) * opacity(paint['stroke-opacity']) : 0;
  const alpha = opacity(paint.opacity);
  const base = { fill: fill?.color ?? '#000000', stroke: stroke?.color ?? '#000000',
    fillRule: fillRule as Vector['fillRule'], strokeCap: cap as Vector['strokeCap'], strokeJoin: join as Vector['strokeJoin'] };
  const area = paths.filter(path => path.nodes.length >= 3 || path.nodes.some(node => node.in || node.out));
  if (!alpha) return [];
  if (fillAlpha && area.length > 1 && area.some(path => path.nodes.length < 3 || path.nodes.some(node => node.in || node.out)) && fillRule !== 'evenodd')
    throw Error('Curved SVG compound paths require the even-odd fill rule.');
  if (fillAlpha && area.length > 1 && area.some(path => path.nodes.length < 3))
    throw Error('An SVG compound contour needs at least three anchors.');
  if (paths.length === 1 && paths[0].closed && fillAlpha && strokeAlpha && fillAlpha === strokeAlpha)
    return [vector(paths, matrix, { ...base, fillEnabled: true, strokeWidth: width, opacity: alpha * fillAlpha })];
  const artwork: Vector[] = [];
  if (fillAlpha && area.length) artwork.push(vector(area.map(path => ({ ...path, closed: true })), matrix,
    { ...base, fillEnabled: true, strokeWidth: 0, opacity: alpha * fillAlpha }));
  if (strokeAlpha) for (const path of paths) artwork.push(vector([path], matrix,
    { ...base, fillEnabled: false, strokeWidth: width, opacity: alpha * strokeAlpha }));
  return artwork;
}

export async function decodeSvg(file: File): Promise<SymbolDefinition> {
  const text = await readSvg(file);
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text)) throw Error('SVG document types, entities and external stylesheets are unsupported.');
  const document = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root: Element = document.documentElement;
  if (root.localName !== 'svg' || (root.namespaceURI !== svgNamespace && root.namespaceURI !== null) ||
      document.getElementsByTagName('parsererror').length)
    throw Error('Choose a valid SVG document.');
  if (document.getElementsByTagNameNS('*', 'style').length) throw Error('SVG stylesheets are unsupported. Export the artwork with inline styles.');
  const { width, height, matrix } = viewport(root);
  const context = window.document.createElement('canvas').getContext('2d')!;
  const shapes: Vector[] = [];
  let artworkCount = 0;
  const pending = [{ element: root, matrix, paint: {} as Paint, groups: [] as string[] }];
  while (pending.length) {
    const parent = pending.pop()!, element = parent.element;
    if (element.namespaceURI !== root.namespaceURI) throw Error('Foreign SVG content is unsupported.');
    if (['title', 'desc', 'metadata', 'defs'].includes(element.localName)) continue;
    for (const attribute of element.attributes) {
      if (/^on/i.test(attribute.localName) || attribute.localName === 'href' || attribute.name === 'xml:base')
        throw Error('SVG event handlers and resource references are unsupported.');
    }
    const paint = getPaint(element, parent.paint);
    const local = transform(element.getAttribute('transform'));
    const current = element === root ? multiply(local, parent.matrix) : multiply(parent.matrix, local);
    if (paint.display === 'none') continue;
    if (element === root || element.localName === 'g') {
      if (opacity(paint.opacity) !== 1) throw Error('SVG group opacity is unsupported for editable import.');
      const groups = element === root ? parent.groups : [...parent.groups, id()];
      if (groups.length > 32) throw Error('SVG groups exceed the document nesting limit.');
      for (const child of [...element.children].reverse()) pending.push({ element: child, matrix: current, paint, groups });
    } else if (!['hidden', 'collapse'].includes(paint.visibility)) {
      if (element.children.length && [...element.children].some(child => !['title', 'desc', 'metadata'].includes(child.localName)))
        throw Error('Unsupported child element in SVG artwork.');
      for (const shape of paintedPaths(element, current, paint, context)) {
        artworkCount += 1 + (shape.nodes?.length ?? 0) + (shape.contours?.reduce((sum, ring) => sum + ring.length, 0) ?? 0);
        if (artworkCount > MAX_SYMBOL_ARTWORK) throw Error('SVG artwork exceeds the symbol artwork budget.');
        if (parent.groups.length) shape.groups = parent.groups;
        shapes.push(shape);
      }
    }
  }
  if (!shapes.length) throw Error('SVG has no supported visible artwork.');
  const name = file.name.replace(/\.svgz?$/i, '').trim().slice(0, 200) || 'SVG artwork';
  return { id: id(), name, width, height, shapes };
}
