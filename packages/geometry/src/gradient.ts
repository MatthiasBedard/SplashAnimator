import { clone, type Gradient } from '@splash/document';
export function editGradientStop(
  gradient: Gradient,
  index: number,
  patch: Partial<Gradient['stops'][number]>,
): Gradient {
  const next = clone(gradient);
  if (!next.stops[index]) throw new Error('Unknown gradient stop');
  if (patch.offset !== undefined && !Number.isFinite(patch.offset))
    throw new Error('Invalid gradient position');
  if (patch.color !== undefined && !/^#[0-9a-f]{6}$/i.test(patch.color))
    throw new Error('Invalid gradient color');
  if (patch.opacity !== undefined && !Number.isFinite(patch.opacity))
    throw new Error('Invalid gradient opacity');
  if (patch.opacity !== undefined)
    patch = { ...patch, opacity: Math.max(0, Math.min(1, patch.opacity)) };
  next.stops[index] = {
    ...next.stops[index],
    ...patch,
    offset:
      patch.offset === undefined
        ? next.stops[index].offset
        : Math.max(0, Math.min(1, patch.offset)),
  };
  next.stops.sort((a, b) => a.offset - b.offset);
  return next;
}
export function addGradientStop(gradient: Gradient): Gradient {
  const next = clone(gradient);
  if (next.stops.length >= 32) throw new Error('A gradient supports up to 32 stops');
  const bounds = [0, ...next.stops.map((s) => s.offset), 1];
  let start = 0,
    end = 0;
  for (let i = 1; i < bounds.length; i++)
    if (bounds[i] - bounds[i - 1] > end - start) {
      start = bounds[i - 1];
      end = bounds[i];
    }
  const offset = (start + end) / 2;
  const a = [...next.stops].reverse().find((s) => s.offset <= offset) ?? next.stops[0];
  const b = next.stops.find((s) => s.offset >= offset) ?? next.stops.at(-1)!;
  const t =
    a.offset === b.offset
      ? 0
      : Math.max(0, Math.min(1, (offset - a.offset) / (b.offset - a.offset)));
  const color =
    '#' +
    [1, 3, 5]
      .map((i) =>
        Math.round(
          parseInt(a.color.slice(i, i + 2), 16) * (1 - t) +
            parseInt(b.color.slice(i, i + 2), 16) * t,
        )
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  next.stops.push({
    offset,
    color,
    ...(a.opacity !== undefined || b.opacity !== undefined
      ? { opacity: (a.opacity ?? 1) * (1 - t) + (b.opacity ?? 1) * t }
      : {}),
  });
  next.stops.sort((a, b) => a.offset - b.offset);
  return next;
}
export function removeGradientStop(gradient: Gradient, index: number): Gradient {
  if (gradient.stops.length <= 2) throw new Error('A gradient needs at least two stops');
  if (!gradient.stops[index]) throw new Error('Unknown gradient stop');
  const next = clone(gradient);
  next.stops.splice(index, 1);
  return next;
}

/** Transform paint endpoints in local coordinates, independently of vector geometry. */
export function transformGradient(
  gradient: Gradient,
  x: number,
  y: number,
  degrees: number,
  scale: number,
): Gradient {
  if (![x, y, degrees, scale].every(Number.isFinite) || scale <= 0 || scale > 100)
    throw new Error('Invalid gradient transform');
  const next = clone(gradient),
    angle = (degrees * Math.PI) / 180;
  const dx = (gradient.to.x - gradient.from.x) * scale,
    dy = (gradient.to.y - gradient.from.y) * scale;
  next.from = { x: gradient.from.x + x, y: gradient.from.y + y };
  next.to = {
    x: next.from.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: next.from.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
  if (gradient.transform) {
    const [a, b, c, d] = gradient.transform,
      co = Math.cos(angle),
      si = Math.sin(angle);
    next.transform = [
      co * co * a - co * si * (b + c) + si * si * d,
      co * si * a + co * co * b - si * si * c - co * si * d,
      co * si * a - si * si * b + co * co * c - co * si * d,
      si * si * a + co * si * (b + c) + co * co * d,
    ];
    if (next.transform.some((v) => Math.abs(v) > 100))
      throw new Error('Gradient transform exceeds basis limits');
  }
  if ([next.from.x, next.from.y, next.to.x, next.to.y].some((v) => Math.abs(v) > 100000))
    throw new Error('Gradient transform exceeds coordinate limits');
  return next;
}

export function gradientPoint(g: Gradient, p: { x: number; y: number }, inverse = false) {
  const [a, b, c, d] = g.transform ?? [1, 0, 0, 1],
    x = p.x - g.from.x,
    y = p.y - g.from.y,
    det = a * d - b * c;
  return inverse
    ? { x: g.from.x + (d * x - c * y) / det, y: g.from.y + (a * y - b * x) / det }
    : { x: g.from.x + a * x + c * y, y: g.from.y + b * x + d * y };
}
export function shapeGradient(g: Gradient, aspect: number, skew: number): Gradient {
  if (
    !Number.isFinite(aspect) ||
    aspect < 0.01 ||
    aspect > 100 ||
    !Number.isFinite(skew) ||
    Math.abs(skew) > 80
  )
    throw new Error('Invalid gradient shape');
  return { ...clone(g), transform: [1, 0, Math.tan((skew * Math.PI) / 180), aspect] };
}

/** Preserve paint under local nonuniform geometry scaling. */
export function resizeGradient(g: Gradient, sx: number, sy: number): Gradient {
  if (![sx, sy].every(Number.isFinite) || sx === 0 || sy === 0)
    throw new Error('Gradient artwork needs nonzero dimensions');
  const next = clone(g),
    dx = g.to.x - g.from.x,
    dy = g.to.y - g.from.y;
  const length2 = dx * dx + dy * dy;
  // Similarity mapping the old endpoint vector to its scaled counterpart.
  // Both circular radial and linear gradients are invariant under this mapping.
  const u = length2 ? (sx * dx * dx + sy * dy * dy) / length2 : 1;
  const v = length2 ? ((sy - sx) * dx * dy) / length2 : 0;
  const divisor = u * u + v * v;
  const [a, b, c, d] = g.transform ?? [1, 0, 0, 1];
  next.transform = [
    (sx * (a * u - c * v)) / divisor,
    (sy * (b * u - d * v)) / divisor,
    (sx * (a * v + c * u)) / divisor,
    (sy * (b * v + d * u)) / divisor,
  ];
  const [na, nb, nc, nd] = next.transform;
  if (
    next.transform.some((n) => !Number.isFinite(n) || Math.abs(n) > 100) ||
    Math.abs(na * nd - nb * nc) < 1e-6
  )
    throw new Error('Resize exceeds gradient transform limits');
  next.from = { x: g.from.x * sx, y: g.from.y * sy };
  next.to = { x: g.to.x * sx, y: g.to.y * sy };
  if (
    [next.from.x, next.from.y, next.to.x, next.to.y].some(
      (n) => !Number.isFinite(n) || Math.abs(n) > 100000,
    )
  )
    throw new Error('Resize exceeds gradient coordinate limits');
  return next;
}

/** Secondary paint-axis handle; its two directions control ellipse height and skew. */
export function gradientAxis(g: Gradient) {
  const dx = g.to.x - g.from.x,
    dy = g.to.y - g.from.y;
  return gradientPoint(g, { x: g.from.x - dy, y: g.from.y + dx });
}
export function moveGradientAxis(g: Gradient, target: { x: number; y: number }): Gradient {
  const dx = g.to.x - g.from.x,
    dy = g.to.y - g.from.y,
    n = dx * dx + dy * dy;
  if (n < 1e-10) throw new Error('Set a gradient radius before editing its secondary axis');
  const p = gradientPoint(g, g.to),
    u = { x: p.x - g.from.x, y: p.y - g.from.y },
    v = { x: target.x - g.from.x, y: target.y - g.from.y };
  const transform: [number, number, number, number] = [
    (u.x * dx - v.x * dy) / n,
    (u.y * dx - v.y * dy) / n,
    (u.x * dy + v.x * dx) / n,
    (u.y * dy + v.y * dx) / n,
  ];
  if (
    transform.some((x) => !Number.isFinite(x) || Math.abs(x) > 100) ||
    Math.abs(transform[0] * transform[3] - transform[1] * transform[2]) < 1e-6
  )
    throw new Error('Gradient axis must remain nondegenerate and within transform limits');
  return { ...clone(g), transform };
}

export function gradientStopPoint(g: Gradient, index: number) {
  const t = g.stops[index].offset;
  return gradientPoint(g, {
    x: g.from.x + (g.to.x - g.from.x) * t,
    y: g.from.y + (g.to.y - g.from.y) * t,
  });
}
export function moveGradientStop(g: Gradient, index: number, point: { x: number; y: number }) {
  const p = gradientPoint(g, point, true),
    dx = g.to.x - g.from.x,
    dy = g.to.y - g.from.y,
    n = dx * dx + dy * dy;
  if (n < 1e-10) return clone(g);
  return editGradientStop(g, index, {
    offset: ((p.x - g.from.x) * dx + (p.y - g.from.y) * dy) / n,
  });
}
