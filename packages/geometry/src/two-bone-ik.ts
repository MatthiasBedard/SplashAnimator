import { keyAt, MAX_PROJECT_DURATION, type Layer, type Point, type Vector } from '../../document/src';
import { validateBoneAttachment, validateBoneBinding } from '../../document/src/bone-binding';
import { mapPoint, matrix, transformedMatrix } from './affine';
import { attachBoneArtwork, moveAttachedArtwork, verifyAttachedArtwork, withoutBoneAttachment, type BoneSegment } from './bone-artwork';

type Bend = 1 | -1;
export type BoneEdit = { kind: 'bind'; rigId: string } | { kind: 'remove' } |
  { kind: 'pose'; target: Point; bend: Bend } | { kind: 'attach' } | { kind: 'detach' };
export type BoneSpanEdit = { kind: 'span'; start: number; end: number };
type Segment = BoneSegment;

const difference = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const magnitude = ({ x, y }: Point) => Math.hypot(x, y);
const near = (a: Point, b: Point) => magnitude(difference(a, b)) <=
  Number.EPSILON * 64 * Math.max(1, Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y));
const along = (root: Point, direction: Point, distance: number): Point =>
  ({ x: root.x + direction.x * distance, y: root.y + direction.y * distance });

function segment(shape: Vector, start: 0 | 1): Segment {
  if (shape.kind !== 'line' || shape.points.length !== 2 || shape.groups?.length)
    throw Error('Choose two ungrouped, two-point lines on an object layer.');
  const transform = matrix(shape);
  const root = mapPoint(transform, shape.points[start]);
  const tip = mapPoint(transform, shape.points[1 - start]);
  const length = magnitude(difference(tip, root));
  if (!Number.isFinite(length) || length === 0 || near(root, tip))
    throw Error('Each bone needs two distinct, finite endpoints.');
  return { root, tip, length };
}

function bind(upper: Vector, lower: Vector, rigId: string): [Vector, Vector] {
  if (upper.bone || lower.bone || upper.boneAttachment || lower.boneAttachment)
    throw Error('Remove the existing bone bindings first.');
  const a = segment(upper, 0), b = segment(lower, 0);
  const upperPoints = [a.root, a.tip], lowerPoints = [b.root, b.tip];
  const joints = ([0, 1] as const).flatMap(i =>
    ([0, 1] as const).filter(j => near(upperPoints[i], lowerPoints[j])).map(j => ({ i, j })));
  if (joints.length !== 1) throw Error('The two lines must share exactly one endpoint.');
  const { i, j } = joints[0];
  const first: Vector = { ...upper, bone: { rigId, role: 'upper', start: i === 0 ? 1 : 0, length: a.length } };
  const second: Vector = { ...lower, bone: { rigId, role: 'lower', start: j, length: b.length } };
  validateBoneBinding(first);
  validateBoneBinding(second);
  return [first, second];
}

function connected(upper: Vector, lower: Vector) {
  validateBoneBinding(upper);
  validateBoneBinding(lower);
  const a = upper.bone, b = lower.bone;
  if (!a || !b || a.rigId !== b.rigId || a.role !== 'upper' || b.role !== 'lower')
    throw Error('Select both members of the same two-bone rig.');
  const actualA = segment(upper, a.start), actualB = segment(lower, b.start);
  if (!near(actualA.tip, actualB.root) ||
      Math.abs(actualA.length - a.length) > Number.EPSILON * 128 * Math.max(a.length, magnitude(actualA.root)) ||
      Math.abs(actualB.length - b.length) > Number.EPSILON * 128 * Math.max(b.length, magnitude(actualB.root)))
    throw Error('The bound endpoints or lengths changed. Remove the bindings and rebind.');
  return { a: actualA, b: actualB, firstLength: a.length, secondLength: b.length };
}

function place(shape: Vector, from: Segment, root: Point, tip: Point) {
  if (near(from.root, root) && near(from.tip, tip)) return shape;
  const old = difference(from.tip, from.root), next = difference(tip, root);
  const length = magnitude(next);
  if (!Number.isFinite(length) || length === 0) throw Error('Bone pose exceeds supported precision.');
  const ux = old.x / from.length, uy = old.y / from.length;
  const vx = next.x / length, vy = next.y / length;
  const c = ux * vx + uy * vy, s = ux * vy - uy * vx;
  const m = transformedMatrix(shape, [c, s, -s, c,
    root.x - c * from.root.x + s * from.root.y, root.y - s * from.root.x - c * from.root.y]);
  return { ...shape, x: m[4], y: m[5], rotation: 0, transform: [m[0], m[1], m[2], m[3]] } as Vector;
}

function pose(upper: Vector, lower: Vector, target: Point, bend: Bend): [Vector, Vector] {
  const { a, b, firstLength, secondLength } = connected(upper, lower);
  const { x, y } = target;
  if (!Number.isFinite(x) || !Number.isFinite(y))
    throw Error('Enter finite tip coordinates and a valid elbow side.');
  const offset = difference({ x, y }, a.root);
  const requested = magnitude(offset);
  if (!Number.isFinite(requested) || (bend !== 1 && bend !== -1))
    throw Error('Enter finite tip coordinates and a valid elbow side.');
  const limit = firstLength + secondLength;
  if (!Number.isFinite(limit)) throw Error('Bone lengths exceed supported precision.');
  const nearest = Math.abs(firstLength - secondLength);
  const distance = Math.min(limit, Math.max(nearest, requested));
  const old = difference(a.tip, a.root);
  const axis = requested === 0
    ? { x: old.x / a.length, y: old.y / a.length }
    : { x: offset.x / requested, y: offset.y / requested };
  const tip = along(a.root, axis, distance);
  let joint = along(a.root, axis, firstLength);
  if (distance === nearest && distance && firstLength < secondLength) {
    joint = along(a.root, axis, -firstLength);
  } else if (distance > nearest && distance < limit) {
    const u = firstLength / limit, v = secondLength / limit, d = distance / limit;
    const cos = Math.min(1, Math.max(-1, (d * d + (u - v) * (u + v)) / (2 * u * d)));
    const sin = bend * Math.sqrt((1 - cos) * (1 + cos));
    joint = along(a.root, { x: axis.x * cos - axis.y * sin, y: axis.y * cos + axis.x * sin }, firstLength);
  }
  const result: [Vector, Vector] = [place(upper, a, a.root, joint), place(lower, b, joint, tip)];
  const check = connected(...result);
  if (!near(check.a.root, a.root) || !near(check.a.tip, joint) || !near(check.b.tip, tip))
    throw Error('Bone pose exceeds supported precision.');
  return result;
}

function requireEditableRange(layer: Layer, start: number, end: number) {
  if (layer.locked || !layer.visible || layer.drawingMode !== 'object' ||
      layer.guideLayer || [...(layer.motionSpans ?? []), ...(layer.liveMotionSpans ?? [])]
        .some(span => span.start <= end && span.end >= start))
    throw Error('Bone edits require a visible, unlocked object layer outside a tween.');
}

function selectedArtwork(shapes: Vector[], ids: readonly string[]) {
  return ids.map(id => {
    const shape = shapes.find(item => item.id === id);
    if (!shape) throw Error('The selected bone artwork has changed.');
    validateBoneBinding(shape);
    validateBoneAttachment(shape);
    return shape;
  });
}

function attachmentEdit(shapes: Vector[], selection: Vector[], action: 'attach' | 'detach') {
  const artwork = selection.find(shape => !shape.bone);
  if (!artwork) throw Error('Select artwork to attach or detach.');
  if (action === 'detach') {
    if (!artwork.boneAttachment) throw Error('The selected artwork is not attached.');
    return shapes.map(shape => shape === artwork ? withoutBoneAttachment(shape) : shape);
  }
  const owner = selection.find(shape => shape.bone);
  if (selection.length !== 2 || !owner) throw Error('Select one bound bone and one piece of artwork.');
  const matches = shapes.filter(shape => {
    validateBoneBinding(shape);
    return shape.bone?.rigId === owner.bone!.rigId && shape.bone.role !== owner.bone!.role;
  });
  if (matches.length !== 1) throw Error('The selected bone needs exactly one connected partner.');
  const partner = matches[0];
  const upper = owner.bone!.role === 'upper';
  const rig = upper ? connected(owner, partner) : connected(partner, owner);
  const attached = attachBoneArtwork(artwork, owner, upper ? rig.a : rig.b);
  return shapes.map(shape => shape === artwork ? attached : shape);
}

function rigAttachments(shapes: Vector[], upper: Vector, lower: Vector) {
  const { a, b } = connected(upper, lower);
  const results = new Set<Vector>();
  for (const shape of shapes) {
    validateBoneAttachment(shape);
    const binding = shape.boneAttachment;
    if (!binding || binding.rigId !== upper.bone!.rigId) continue;
    const owner = binding.boneId === upper.id ? a : binding.boneId === lower.id ? b : undefined;
    if (!owner) throw Error('An attached artwork item lost its bone. Detach and reattach it.');
    verifyAttachedArtwork(shape, owner);
    results.add(shape);
  }
  return results;
}

function posedArtwork(shapes: Vector[], upper: Vector, lower: Vector, a: Vector, b: Vector, attached: Set<Vector>) {
  const upperSegment = segment(a, a.bone!.start), lowerSegment = segment(b, b.bone!.start);
  return shapes.map(shape => shape === upper ? a : shape === lower ? b : attached.has(shape)
    ? moveAttachedArtwork(shape, shape.boneAttachment!.boneId === upper.id ? upperSegment : lowerSegment)
    : shape);
}

function writePoseKey(layer: Layer, key: Layer['keys'][number], frame: number, shapes: Vector[]) {
  const keys = [...layer.keys.filter(k => k.frame !== frame), { ...key, frame, shapes }]
    .sort((left, right) => left.frame - right.frame);
  return { ...layer, keys };
}

export function prepareTwoBoneKey(layer: Layer, frame: number, ids: readonly string[], action: BoneEdit): Layer {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= MAX_PROJECT_DURATION)
    throw Error('Choose a valid bone pose frame.');
  requireEditableRange(layer, frame, frame);
  const key = keyAt(layer, frame);
  if (!key || key.openMotionTween)
    throw Error('Select exactly two lines on an ordinary exposure.');
  if (action.kind === 'attach' || action.kind === 'detach')
    return writePoseKey(layer, key, frame, attachmentEdit(key.shapes, selectedArtwork(key.shapes, ids), action.kind));
  if (ids.length !== 2 || ids[0] === ids[1]) throw Error('Select exactly two bones.');
  let [first, second] = selectedArtwork(key.shapes, ids);
  if (action.kind === 'pose' && first.bone?.role === 'lower') [first, second] = [second, first];
  if (action.kind === 'pose') {
    const attached = rigAttachments(key.shapes, first, second);
    const [a, b] = pose(first, second, action.target, action.bend);
    if (a === first && b === second) return layer;
    return writePoseKey(layer, key, frame, posedArtwork(key.shapes, first, second, a, b, attached));
  }
  const unbind = (shape: Vector) => {
    if (!shape.bone) return shape;
    const out = { ...shape };
    delete out.bone;
    return out;
  };
  const [a, b] = action.kind === 'bind' ? bind(first, second, action.rigId) : [unbind(first), unbind(second)];
  if (a === first && b === second) return layer;
  const shapes = key.shapes.map(shape => {
    if (shape === first) return a;
    if (shape === second) return b;
    validateBoneAttachment(shape);
    const attachment = shape.boneAttachment;
    return action.kind === 'remove' && attachment &&
      [first, second].some(bone => bone.id === attachment.boneId && bone.bone?.rigId === attachment.rigId)
      ? withoutBoneAttachment(shape) : shape;
  });
  return writePoseKey(layer, key, frame, shapes);
}

function endpointPair(shapes: Vector[], ids: readonly string[]): [Vector, Vector] {
  const [first, second] = selectedArtwork(shapes, ids);
  if (ids.length !== 2 || !first.bone || !second.bone)
    throw Error('Both pose keys must include the selected bones.');
  return first.bone.role === 'upper' ? [first, second] : [second, first];
}

const localShape = (shape: Vector) =>
  JSON.stringify({ ...shape, x: 0, y: 0, rotation: 0, transform: undefined });

function verifyRigidEndpoint(start: Vector, end: Vector, from: Segment, to: Segment) {
  const expected = matrix(place(start, from, to.root, to.tip));
  const actual = matrix(end);
  if (localShape(start) !== localShape(end) || !near({ x: expected[0], y: expected[1] }, { x: actual[0], y: actual[1] }) ||
      !near({ x: expected[2], y: expected[3] }, { x: actual[2], y: actual[3] }) ||
      !near({ x: expected[4], y: expected[5] }, { x: actual[4], y: actual[5] }))
    throw Error('Bone endpoints must preserve the same bindings, local geometry and paint.');
}

function elbowSide(root: Point, joint: Point, tip: Point) {
  const direction = difference(tip, root), arm = difference(joint, root);
  const d = magnitude(direction), a = magnitude(arm);
  const cross = direction.x / d * (arm.y / a) - direction.y / d * (arm.x / a);
  return Math.abs(cross) <= Number.EPSILON * 128 ? 0 : cross < 0 ? -1 : 1;
}

function routeTouchesRoot(root: Point, from: Point, to: Point) {
  if (near(root, from) || near(root, to)) return true;
  const delta = difference(to, from), length = magnitude(delta);
  if (length === 0) return false;
  const axis = { x: delta.x / length, y: delta.y / length };
  const offset = difference(root, from);
  const distance = Math.min(length, Math.max(0, offset.x * axis.x + offset.y * axis.y));
  return near(root, along(from, axis, distance));
}

/** Generate editable poses from a linear target path without touching the authored keys. */
export function prepareTwoBoneSpan(layer: Layer, start: number, end: number, duration: number, ids: readonly string[]): Layer {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(duration) ||
      duration > MAX_PROJECT_DURATION ||
      start < 0 || end >= duration || end - start < 2)
    throw Error('Choose two pose keyframes with at least one frame between them.');
  requireEditableRange(layer, start, end);
  const from = layer.keys.find(key => key.frame === start);
  const to = layer.keys.find(key => key.frame === end);
  if (!from || !to || from.openMotionTween || to.openMotionTween)
    throw Error('Both pose endpoints must be ordinary authored keys.');
  if (layer.keys.some(key => key.frame > start && key.frame < end))
    throw Error('Remove intermediate keys before generating bone poses.');
  const [upper, lower] = endpointPair(from.shapes, ids);
  const [endUpper, endLower] = endpointPair(to.shapes, ids);
  const first = connected(upper, lower), last = connected(endUpper, endLower);
  if (!near(first.a.root, last.a.root))
    throw Error('Both pose keys must use the same root position.');
  const attached = rigAttachments(from.shapes, upper, lower);
  const endAttached = rigAttachments(to.shapes, endUpper, endLower);
  if (from.shapes.length !== attached.size + 2 || to.shapes.length !== endAttached.size + 2)
    throw Error('Both pose keys must contain only the two selected bones and their attachments.');
  verifyRigidEndpoint(upper, endUpper, first.a, last.a);
  verifyRigidEndpoint(lower, endLower, first.b, last.b);
  if (from.shapes.length !== to.shapes.length || from.shapes.some((shape, index) =>
    shape.id !== to.shapes[index].id || (attached.has(shape) && localShape(shape) !== localShape(to.shapes[index]))))
    throw Error('Both pose keys must preserve the artwork attachments, paint and stacking order.');
  if (routeTouchesRoot(first.a.root, first.b.tip, last.b.tip))
    throw Error('The tip path crosses the root and has no continuous elbow direction.');
  const startSide = elbowSide(first.a.root, first.a.tip, first.b.tip);
  const endSide = elbowSide(last.a.root, last.a.tip, last.b.tip);
  if (startSide && endSide && startSide !== endSide)
    throw Error('The endpoint poses use different elbow sides.');
  if (near(first.b.tip, last.b.tip)) return layer;
  const bend: Bend = startSide || endSide || 1;
  const keys = layer.keys.filter(key => key.frame <= start);
  let artworkBytes = 0;
  const encoder = attached.size ? new TextEncoder() : undefined;
  for (let frame = start + 1; frame < end; frame++) {
    const progress = (frame - start) / (end - start);
    const target = along(first.b.tip, difference(last.b.tip, first.b.tip), progress);
    const [a, b] = pose(upper, lower, target, bend);
    const shapes = posedArtwork(from.shapes, upper, lower, a, b, attached);
    if (encoder) {
      artworkBytes += encoder.encode(JSON.stringify(shapes)).byteLength;
      // Respect the existing browser directory write limit for this generated payload.
      if (artworkBytes > 32 * 1024 * 1024)
        throw Error('Generated bone artwork exceeds the browser write limit. Shorten the pose range.');
    }
    keys.push({ frame, shapes: structuredClone(shapes) });
  }
  return { ...layer, keys: keys.concat(layer.keys.filter(key => key.frame >= end)) };
}
