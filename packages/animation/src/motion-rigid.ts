import { matrix } from '../../geometry/src/affine';
import type { Vector, Point } from '../../document/src';
import {
  motionRotationDelta,
  validateMotionRotation,
  type MotionRotation,
} from './motion-rotation';
export type RigidMember = {
  leader: number;
  x: number;
  y: number;
  delta: number;
  pivotX: number;
  pivotY: number;
  endScale: number;
  endScaleX: number;
  endScaleY: number;
  endShear: number;
  endShearY: number;
  endOneMinusCos: number;
  endSin: number;
};
/** Apply source document-axis scaling while retaining the artwork rotation field. */
export function scaleGroupBasis(
  shape: Vector,
  sx: number,
  sy: number,
  shear = 0,
  shearY = 0,
): [number, number, number, number] {
  const angle = (shape.rotation * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const xx = sx * c * c + sy * s * s + (shear + shearY) * c * s,
    xy = (sy - sx) * c * s + shear * c * c - shearY * s * s,
    yx = (sy - sx) * c * s - shear * s * s + shearY * c * c,
    yy = sx * s * s + sy * c * c - (shear + shearY) * c * s;
  const [a, b, d, e] = shape.transform ?? [1, 0, 0, 1];
  return [xx * a + xy * b, yx * a + yy * b, xx * d + xy * e, yx * d + yy * e];
}
/** Certify det((1-t)I+tH)>0 throughout the span, with a relative roundoff margin. */
function preservesGroupOrientation(sx: number, sy: number, hx: number, hy: number): boolean {
  if (![sx, sy, hx, hy].every(Number.isFinite)) return false;
  const scale = Math.max(1, Math.abs(sx), Math.abs(sy), Math.abs(hx), Math.abs(hy));
  const unit = 1 / scale, x = sx / scale, y = sy / scale;
  const diagonal = x * y, cross = (hx / scale) * (hy / scale);
  const a = unit * unit, b = unit * (x + y) / 2, c = diagonal - cross;
  const margin = 128 * Number.EPSILON * (a + Math.abs(b) + Math.abs(diagonal) + Math.abs(cross));
  if (Math.min(a, c) <= margin) return false;
  const curvature = a - 2*b + c;
  if (curvature > 0) {
    const t = (a - b) / curvature;
    if (t > 0 && t < 1) {
      const u = 1 - t;
      if (u*u*a + 2*u*t*b + t*t*c <= margin) return false;
    }
  }
  return true;
}
/** Disjoint groups at one nesting level, relative to their first artwork member. */
export function prepareRigidGroups(
  from: Vector[],
  to: Vector[],
  rotation: MotionRotation,
): (RigidMember | undefined)[] {
  validateMotionRotation(rotation);
  const depth = rotation.groupDepth ?? 0;
  const groups = new Map<string, number[]>();
  from.forEach((shape, i) => {
    // Include ancestry so reused subgroup names under different parents stay independent.
    const id = shape.groups?.[depth] ? JSON.stringify(shape.groups.slice(0, depth + 1)) : undefined;
    if (id) {
      const members = groups.get(id) ?? [];
      members.push(i);
      groups.set(id, members);
    }
  });
  const result: (RigidMember | undefined)[] = new Array(from.length);
  let count = 0;
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    count++;
    const leader = members[0],
      a = from[leader],
      b = to[leader];
    const delta = motionRotationDelta(a.rotation, b.rotation, rotation);
    const radians = ((delta % 360) * Math.PI) / 180,
      c = Math.cos(radians),
      s = Math.sin(radians);
    let pivotX = rotation.rigidPivot?.x ?? 0,
      pivotY = rotation.rigidPivot?.y ?? 0;
    if (rotation.savedGroupPivots) {
      if (!a.pivot || ![a.pivot.x, a.pivot.y].every(Number.isFinite))
        throw new Error('Each group leader requires a finite saved artwork pivot.');
      const basis = matrix(a);
      // Apply only the linear basis: avoid losing small offsets to distant origins.
      pivotX = basis[0] * a.pivot.x + basis[2] * a.pivot.y;
      pivotY = basis[1] * a.pivot.x + basis[3] * a.pivot.y;
      if (![pivotX, pivotY].every(Number.isFinite))
        throw new Error('Saved group pivot exceeds numeric limits.');
    }
    let endScale = 1;
    let combinedShear = false;
    let endShear = 0,
      endShearY = 0;
    let endScaleX = 1,
      endScaleY = 1;
    if (rotation.axisGroupScale) {
      const source = matrix(a),
        target = matrix({ ...a, transform: b.transform });
      const ratios = [0, 1].map((row) => {
        const k = Math.abs(source[row]) >= Math.abs(source[row + 2]) ? row : row + 2;
        return target[k] / source[k];
      });
      if (rotation.axisGroupShear) {
        const det = source[0] * source[3] - source[1] * source[2];
        ratios[0] = (target[0] * source[3] - target[2] * source[1]) / det;
        ratios[1] = (target[3] * source[0] - target[1] * source[2]) / det;
        endShear = (target[2] * source[0] - target[0] * source[2]) / det;
        if (!Number.isFinite(endShear)) throw new Error('Group shear exceeds numeric limits.');
        // Preserve the existing X-shear interpretation when it fits. Otherwise
        // try Y alone before resolving a shared two-axis shear.
        const expectedX = scaleGroupBasis(a, ratios[0], ratios[1], endShear);
        const localTarget = b.transform ?? [1, 0, 0, 1];
        const tolerance =
          64 * Number.EPSILON * Math.max(...expectedX.map(Math.abs), ...localTarget.map(Math.abs));
        if (expectedX.some((v, j) => !Number.isFinite(v) || Math.abs(v - localTarget[j]) > tolerance)) {
          endShearY = (target[1] * source[3] - target[3] * source[1]) / det;
          if (!Number.isFinite(endShearY)) throw new Error('Group shear exceeds numeric limits.');
          const expectedY = scaleGroupBasis(a, ratios[0], ratios[1], 0, endShearY);
          if (expectedY.every((v,j) => Number.isFinite(v) && Math.abs(v-localTarget[j]) <= tolerance)) {
            endShear = 0;
          } else {
            const diagonal = ratios[0] * ratios[1], cross = endShear * endShearY;
            const positiveAxes = ratios.every(v => v > 0);
            if (positiveAxes
              ? !Number.isFinite(diagonal-cross) || diagonal-cross <= 64 * Number.EPSILON * (Math.abs(diagonal)+Math.abs(cross))
              : !preservesGroupOrientation(ratios[0], ratios[1], endShear, endShearY))
              throw new Error('Two-axis group shear must preserve orientation without collapse throughout the span.');
            combinedShear = true;
          }
        }
      }
      if (ratios.some((v) => !Number.isFinite(v) || (!combinedShear && v <= 0)))
        throw new Error('Group axis scales must be finite and positive.');
      [endScaleX, endScaleY] = ratios;
    }
    if (rotation.uniformGroupScale) {
      const source = a.transform ?? [1, 0, 0, 1];
      const target = b.transform ?? [1, 0, 0, 1];
      let axis = 0;
      for (let j = 1; j < 4; j++) if (Math.abs(source[j]) > Math.abs(source[axis])) axis = j;
      endScale = target[axis] / source[axis];
      if (!Number.isFinite(endScale) || endScale <= 0)
        throw new Error('Group scale must be finite and positive.');
    }
    const endPivotX =
        endScale * (c * (pivotX * endScaleX + pivotY * endShear) - s * (pivotY * endScaleY + pivotX * endShearY)),
      endPivotY =
        endScale * (s * (pivotX * endScaleX + pivotY * endShear) + c * (pivotY * endScaleY + pivotX * endShearY));
    if (![a.x + pivotX, a.y + pivotY, b.x + endPivotX, b.y + endPivotY].every(Number.isFinite))
      throw new Error('Rigid pivot positions exceed numeric limits.');
    for (const i of members) {
      const x = from[i].x - a.x,
        y = from[i].y - a.y,
        tx = to[i].x - b.x,
        ty = to[i].y - b.y;
      if (rotation.uniformGroupScale) {
        const source = from[i].transform ?? [1, 0, 0, 1];
        const target = to[i].transform ?? [1, 0, 0, 1];
        if (
          source.some((v, j) => {
            const expected = v * endScale;
            return (
              !Number.isFinite(expected) ||
              !Number.isFinite(target[j]) ||
              Math.abs(target[j] - expected) >
                64 * Number.EPSILON * Math.max(Math.abs(target[j]), Math.abs(expected))
            );
          })
        )
          throw new Error(
            'Group endpoints must share one uniform positive scale without changing their local bases.',
          );
      }
      if (rotation.axisGroupScale) {
        const expected = scaleGroupBasis(from[i], endScaleX, endScaleY, endShear, endShearY);
        const target = to[i].transform ?? [1, 0, 0, 1];
        const tolerance =
          64 * Number.EPSILON * Math.max(...expected.map(Math.abs), ...target.map(Math.abs));
        if (
          expected.some(
            (v, j) =>
              !Number.isFinite(v) ||
              !Number.isFinite(target[j]) ||
              Math.abs(v - target[j]) > tolerance,
          )
        )
          throw new Error(
            'Group endpoints must share the same document-axis transform for every member basis.',
          );
      }
      const ex = endScale * (c * (x * endScaleX + y * endShear) - s * (y * endScaleY + x * endShearY)),
        ey = endScale * (s * (x * endScaleX + y * endShear) + c * (y * endScaleY + x * endShearY));
      const tolerance =
        1e-7 + 64 * Number.EPSILON * Math.max(Math.abs(x), Math.abs(y), Math.abs(tx), Math.abs(ty));
      if (
        ![x, y, tx, ty, ex, ey, tolerance].every(Number.isFinite) ||
        Math.abs(tx - ex) > tolerance ||
        Math.abs(ty - ey) > tolerance ||
        Math.abs(motionRotationDelta(from[i].rotation, to[i].rotation, rotation) - delta) > 1e-7
      )
        throw new Error(
          'Rigid group endpoints must preserve member offsets under one shared rotation.',
        );
      if (![x - pivotX, y - pivotY].every(Number.isFinite))
        throw new Error('Rigid pivot offsets exceed numeric limits.');
      result[i] = {
        leader,
        x,
        y,
        delta,
        pivotX,
        pivotY,
        endScale,
        endScaleX,
        endScaleY,
        endShear,
        endShearY,
        endOneMinusCos: 2 * Math.sin(radians / 2) ** 2,
        endSin: endScale * s,
      };
    }
  }
  if (!count)
    throw new Error(
      'Rigid group motion requires a group with at least two members at the chosen nesting level.',
    );
  return result;
}

/** Shared position evaluator for generated artwork and its authoring preview. */
export function rigidGroupPosition(
  a: Point, b: Point, member: RigidMember, t: number,
  pathPose?: Point & { tangentAngle?: number },
): Point {
  const angle = (((member.delta * t + (pathPose?.tangentAngle ?? 0)) % 360) * Math.PI) / 180;
  const scale = 1 - t + t * member.endScale;
  const c = scale * Math.cos(angle), s = scale * Math.sin(angle);
  const sx = 1 - t + t * member.endScaleX, sy = 1 - t + t * member.endScaleY;
  // Combine pivot coefficients before multiplying: distant cancelling pivots
  // must not erase a small translation or the group's relative member offsets.
  // The scale-only terms cancel algebraically. Use 2 sin²(angle/2)
  // for 1-cos(angle), which otherwise rounds to zero for small rotations.
  const coefficients = (axisScale: number, currentAxisScale: number) => {
    const endScale = member.endScale * axisScale;
    const currentScale = scale * currentAxisScale;
    const pc =
      currentScale * (2 * Math.sin(angle / 2) ** 2) - t * endScale * member.endOneMinusCos;
    let ps = t * member.endSin * axisScale - s * currentAxisScale;
    const theta = (member.delta * Math.PI) / 180;
    if (Math.abs(theta) < 1e-3 && !pathPose?.tangentAngle) {
      // t*sin(theta)-sin(t*theta) loses its cubic term when the
      // linear terms round identically. Factor the odd Taylor difference;
      // handle the scale contribution with the sine difference identity.
      const t2 = t * t,
        theta2 = theta * theta;
      const cubic =
        t *
        theta *
        theta2 *
        (t - 1) *
        (t + 1) *
        (1 / 6 - (theta2 * (1 + t2)) / 120 + (theta2 * theta2 * (1 + t2 + t2 * t2)) / 5040);
      ps =
        cubic +
        t *
          (endScale - 1) *
          2 *
          Math.cos(((1 + t) * theta) / 2) *
          Math.sin(((1 - t) * theta) / 2);
    }
    return [pc, ps];
  };
  const [pcX, psX] = coefficients(member.endScaleX, sx);
  const [pcY, psY] = coefficients(member.endScaleY, sy);
  // X/Y shear contributes t*h*(R(end)-R(now)) to the pivot Y/X column.
  // Difference identities retain small-angle terms before multiplying distant pivots.
  const endAngle = ((member.delta % 360) * Math.PI) / 180;
  const halfDifference = (endAngle - angle) / 2;
  const average = (endAngle + angle) / 2;
  const shearDifference = 2 * t * member.endShear * Math.sin(halfDifference);
  const shearYDifference = 2 * t * member.endShearY * Math.sin(halfDifference);
  const correctionX =
    (pcX - shearYDifference * Math.cos(average)) * member.pivotX +
    (-psY - shearDifference * Math.sin(average)) * member.pivotY;
  const correctionY =
    (psX - shearYDifference * Math.sin(average)) * member.pivotX +
    (pcY + shearDifference * Math.cos(average)) * member.pivotY;
  const x =
    (pathPose?.x ?? a.x * (1 - t) + b.x * t) +
    correctionX +
    c * (member.x * sx + member.y * t * member.endShear) -
    s * (member.y * sy + member.x * t * member.endShearY);
  const y =
    (pathPose?.y ?? a.y * (1 - t) + b.y * t) +
    correctionY +
    s * (member.x * sx + member.y * t * member.endShear) +
    c * (member.y * sy + member.x * t * member.endShearY);
  return { x, y };
}
