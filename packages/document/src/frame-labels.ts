export type FrameLabel = { frame: number; name: string };

export function readFrameLabels(owner?: object): unknown {
  const field = owner && Object.getOwnPropertyDescriptor(owner, 'frameLabels');
  if (field && (!field.enumerable || !('value' in field))) throw Error('Frame labels require original data.');
  return field?.value;
}

/** One label per frame and one exact, case-sensitive name per timeline. */
export function validateFrameLabels(value: unknown, duration: number): asserts value is FrameLabel[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > duration || Reflect.ownKeys(value).length !== value.length + 1)
    throw Error('Invalid timeline frame labels.');
  const names = new Set<string>();
  let previous = -1;
  for (let index = 0; index < value.length; index++) {
    const element = Object.getOwnPropertyDescriptor(value, String(index));
    const label = element && 'value' in element ? element.value : undefined;
    if (!element?.enumerable || !label || typeof label !== 'object' ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(label)) || Reflect.ownKeys(label).length !== 2)
      throw Error('Invalid frame label record.');
    const frame = Object.getOwnPropertyDescriptor(label, 'frame');
    const name = Object.getOwnPropertyDescriptor(label, 'name');
    if (!frame?.enumerable || !('value' in frame) || !name?.enumerable || !('value' in name) ||
        !Number.isSafeInteger(frame.value) || frame.value <= previous || frame.value >= duration ||
        typeof name.value !== 'string' || !name.value.length || name.value.length > 80 ||
        name.value.trim() !== name.value || /[\u0000-\u001f\u007f]/u.test(name.value))
      throw Error('Choose a valid frame and a label of 1–80 characters.');
    if (names.has(name.value)) throw Error('Frame label names must be unique in this timeline.');
    previous = frame.value;
    names.add(name.value);
  }
}

export function prepareFrameLabel(
  original: FrameLabel[] | undefined, duration: number, frame: number, name: string | null,
) {
  validateFrameLabels(original, duration);
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= duration)
    throw Error('Choose an existing frame for its label.');
  const next = (original ?? []).filter(label => label.frame !== frame).map(label => ({ ...label }));
  if (name !== null) {
    if (typeof name !== 'string') throw Error('Enter a frame label.');
    next.push({ frame, name: name.trim() });
  }
  next.sort((a, b) => a.frame - b.frame);
  validateFrameLabels(next, duration);
  return next.length ? next : undefined;
}
