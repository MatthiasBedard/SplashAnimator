export type CubicMotionEase = { kind: 'cubic'; x1: number; y1: number; x2: number; y2: number };
export type MotionEase = 'linear' | 'in' | 'out' | 'in-out' | CubicMotionEase;
export function validateMotionEase(ease: MotionEase): void {
  if (typeof ease === 'object' && ease?.kind === 'cubic') {
    if (![ease.x1, ease.y1, ease.x2, ease.y2].every((v) => Number.isFinite(v) && v >= 0 && v <= 1))
      throw new Error('Custom motion easing controls must be between 0 and 1.');
  } else if (!['linear', 'in', 'out', 'in-out'].includes(ease as string))
    throw new Error('Choose a supported motion easing.');
}

/** Pure kernel shared with the offline renderer after source validation. */
export function evaluatedMotionProgress(t:number,ease:MotionEase):number {
  if (typeof ease === 'object' && ease?.kind === 'cubic') {
    const { x1, y1, x2, y2 } = ease;
    if (!Number.isFinite(t) || t < 0 || t > 1)
      throw new Error('Motion progress must be between 0 and 1.');
    if (t === 0 || t === 1 || (x1 === y1 && x2 === y2)) return t;
    const cubic = (u: number, a: number, b: number) =>
      3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
    // Solve time (x), then sample progress (y). Bisection also handles flat tangents.
    let low = 0,
      high = 1;
    for (let i = 0; i < 60; i++) {
      const u = (low + high) / 2;
      if (cubic(u, x1, x2) < t) low = u;
      else high = u;
    }
    return cubic((low + high) / 2, y1, y2);
  }
  if (ease === 'linear') return t;
  if (ease === 'in') return t * t;
  if (ease === 'out') return 1 - (1 - t) * (1 - t);
  if (ease === 'in-out') return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
  throw new Error('Choose a supported motion easing.');
}

/** One-shot optional property-channel request. Validate the detached controls before
 * a JSON clone can turn original nonfinite coordinates into null. */
export function captureOpacityEase(value:MotionEase|undefined):MotionEase|undefined{
 if(value===undefined)return undefined;
 const owned=typeof value==='object'&&value!==null?{kind:value.kind,x1:value.x1,y1:value.y1,x2:value.x2,y2:value.y2}:value;
 validateMotionEase(owned as MotionEase);
 return owned as MotionEase;
}

/** Paint progress is explicit and cannot enable color interpolation implicitly. */
export function capturePaintEase(value:MotionEase|undefined,paint:boolean):MotionEase|undefined{
 const result=captureOpacityEase(value);
 if(result!==undefined&&paint!==true)throw new Error('Independent paint easing requires paint interpolation.');
 return result;
}
