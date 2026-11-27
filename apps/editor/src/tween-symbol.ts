import { type Project, type Keyframe, type Vector } from '../../../packages/document/src';
import { convertToSymbol } from '../../../packages/geometry/src/symbols';
import { matrix, multiply, type Matrix } from '../../../packages/geometry/src/affine';
import { selectionTrajectoryStamp } from '../../../packages/animation/src/selection-trajectory';
import { setLibraryLink, suggestLibraryLink } from '../../../packages/document/src/library';

function fixed(shape: Vector) {
  const result = { ...shape };
  result.id = '';
  result.x = result.y = result.rotation = 0;
  delete result.transform;
  // Match the document converter's JSON storage semantics for absent optional
  // fields. Original finite values are validated before entering this helper.
  return JSON.stringify(result, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
}
function inverse(m: Matrix): Matrix {
  const [a, b, c, d, x, y] = m,
    det = a * d - b * c;
  if (!m.every(Number.isFinite) || !Number.isFinite(det) || Math.abs(det) < 1e-10)
    throw Error('Motion tween artwork needs an invertible transform.');
  return [d / det, -b / det, -c / det, a / det, (c * y - d * x) / det, (b * x - a * y) / det];
}
function sameMatrix(actual: Matrix, expected: Matrix) {
  return actual.every(
    (v, j) =>
      Number.isFinite(v) &&
      Math.abs(v - expected[j]) <=
        Number.EPSILON * 128 * Math.max(1, Math.abs(v), Math.abs(expected[j])),
  );
}
/** A common transform must reproduce EVERY endpoint member. Never replace a
 * differently painted/deformed endpoint with an approximation of the start. */
function sharedTransform(a: Vector[], b: Vector[]): Matrix {
  if (!a.length || a.length !== b.length || a.some((s, i) => fixed(s) !== fixed(b[i])))
    throw Error(
      'Motion tween endpoints must contain the same artwork. Use a shape tween for changing vector geometry or paint.',
    );
  const operation = multiply(matrix(b[0]), inverse(matrix(a[0])));
  for (let i = 0; i < a.length; i++) {
    const actual = multiply(operation, matrix(a[i])),
      expected = matrix(b[i]);
    if (!sameMatrix(actual, expected))
      throw Error(
        'Move the frame artwork together, or put independently moving objects on separate tween layers.',
      );
  }
  return operation;
}

/** Candidate-only mutation. The caller owns complete project/recipe admission. */
export function symbolizeTweenEndpoints(
  project: Project,
  layerId: string,
  a: Keyframe,
  b?: Keyframe,
) {
  if (
    a.shapes.length === 1 &&
    a.shapes[0].kind === 'symbol' &&
    (!b || (b.shapes.length === 1 && b.shapes[0].kind === 'symbol'))
  )
    return;
  if (a.shapes.some((s) => s.kind === 'symbol') || b?.shapes.some((s) => s.kind === 'symbol'))
    throw Error(
      'Use one existing symbol per motion tween, or separate mixed symbol artwork onto its own layer.',
    );
  const operation = b && sharedTransform(a.shapes, b.shapes),
    layer = project.layers.find((l) => l.id === layerId)!;
  const original = a.shapes.map((s) => ({ id: s.id, fixed: fixed(s), matrix: matrix(s) }));
  // A symbol needs object drawing; all original outside key artwork stays exact.
  layer.drawingMode = 'object';
  let index = 1;
  const names = new Set(project.symbols?.map((s) => s.name));
  while (names.has('Tween ' + index)) index++;
  const instance = convertToSymbol(
    project,
    layerId,
    a.frame,
    a.shapes.map((s) => s.id),
    'Tween ' + index,
  );
  const definition = project.symbols!.find((s) => s.id === instance.symbolId)!;
  if (
    definition.shapes.length !== original.length ||
    definition.shapes.some(
      (s, i) =>
        s.id !== original[i].id ||
        fixed(s) !== original[i].fixed ||
        !sameMatrix(multiply(matrix(instance), matrix(s)), original[i].matrix),
    )
  )
    throw Error('Converted symbol artwork changed.');
  setLibraryLink(
    project,
    'symbol',
    instance.symbolId!,
    suggestLibraryLink(project, 'Tween ' + index),
  );
  if (!b || !operation) return;
  const instanceStamp = selectionTrajectoryStamp(instance);
  const end = structuredClone(instance),
    m = multiply(operation, matrix(instance));
  if (
    selectionTrajectoryStamp(instance) !== instanceStamp ||
    selectionTrajectoryStamp(end) !== instanceStamp
  )
    throw Error('Converted symbol endpoint changed.');
  end.x = m[4];
  end.y = m[5];
  // Expose the common rotation in the authored rotation channel. The existing
  // sampler still owns affine-pose interpolation and determinant admission.
  const angle = m[0] * m[3] - m[1] * m[2] > 0 ? Math.atan2(m[1] - m[2], m[0] + m[3]) : 0;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  end.rotation = (angle * 180) / Math.PI;
  end.transform = [
    c * m[0] + s * m[1],
    -s * m[0] + c * m[1],
    c * m[2] + s * m[3],
    -s * m[2] + c * m[3],
  ];
  // Equal bases need no extra representation at the matching end key.
  if (
    end.transform.every((v, i) => v === (instance.transform ?? [1, 0, 0, 1])[i]) &&
    instance.rotation === 0
  )
    delete end.transform;
  b.shapes = [end];
}
