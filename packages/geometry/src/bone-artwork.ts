import type { Point, Vector } from '../../document/src';
import { validateBoneAttachment } from '../../document/src/bone-binding';
import { matrix, multiply, transformedMatrix, type Matrix } from './affine';

export type BoneSegment = { root: Point; tip: Point; length: number };

function boneFrames({ root, tip, length }: BoneSegment): [Matrix, Matrix] {
  const x = (tip.x - root.x) / length, y = (tip.y - root.y) / length;
  return [
    [x, y, -y, x, root.x, root.y],
    [x, -y, y, x, -x * root.x - y * root.y, y * root.x - x * root.y],
  ];
}

function validArtwork(shape: Vector) {
  if (shape.bone || shape.kind === 'symbol' || shape.groups?.length || shape.drawingMode === 'merge')
    throw Error('Choose ungrouped object artwork to attach to a bone.');
}

function artworkMatrix(shape: Vector, segment: BoneSegment) {
  const [a, b, c, d, x, y] = shape.boneAttachment!.local;
  return transformedMatrix({ ...shape, x, y, rotation: 0, transform: [a, b, c, d] }, boneFrames(segment)[0]);
}

export function attachBoneArtwork(shape: Vector, owner: Vector, segment: BoneSegment): Vector {
  validArtwork(shape);
  validateBoneAttachment(shape);
  if (shape.boneAttachment) throw Error('Detach the artwork before choosing another bone.');
  const local = multiply(boneFrames(segment)[1], matrix(shape));
  const result = { ...shape, boneAttachment: { rigId: owner.bone!.rigId, boneId: owner.id, local } };
  validateBoneAttachment(result);
  verifyAttachedArtwork(result, segment);
  return result;
}

export function verifyAttachedArtwork(shape: Vector, segment: BoneSegment) {
  validArtwork(shape);
  const original = matrix(shape), expected = artworkMatrix(shape, segment);
  const origin = Math.max(Math.abs(segment.root.x), Math.abs(segment.root.y));
  if (expected.some((n, i) => !Number.isFinite(original[i]) || Math.abs(n - original[i]) >
      Number.EPSILON * 256 * Math.max(1, Math.abs(n), Math.abs(original[i]), i >= 4 ? origin : 0)))
    throw Error('The attached artwork changed position. Detach and reattach it before posing.');
}

export function moveAttachedArtwork(shape: Vector, segment: BoneSegment): Vector {
  const [a, b, c, d, x, y] = artworkMatrix(shape, segment);
  return { ...shape, x, y, rotation: 0, transform: [a, b, c, d] };
}

export function withoutBoneAttachment(shape: Vector) {
  const detached = { ...shape };
  delete detached.boneAttachment;
  return detached;
}
