export type FrameComment = { frame: number; text: string };

export const MAX_FRAME_COMMENT_LENGTH = 2000;
const MAX_TIMELINE_COMMENT_LENGTH = 256 * 1024;

export function readFrameComments(owner?: object): unknown {
  const field = owner && Object.getOwnPropertyDescriptor(owner, 'frameComments');
  if (field && (!field.enumerable || !('value' in field))) throw Error('Frame comments require original data.');
  return field?.value;
}

function dataValue(owner: object, key: string): unknown {
  const field = Object.getOwnPropertyDescriptor(owner, key);
  if (!field?.enumerable || !('value' in field)) throw Error('Invalid frame comment record.');
  return field.value;
}

export function validateFrameComments(value: unknown, duration: number): asserts value is FrameComment[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > duration || Reflect.ownKeys(value).length !== value.length + 1)
    throw Error('Invalid timeline frame comments.');
  let previous = -1, length = 0;
  for (let index = 0; index < value.length; index++) {
    const comment = dataValue(value, String(index));
    if (!comment || typeof comment !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(comment)) ||
        Reflect.ownKeys(comment).length !== 2) throw Error('Invalid frame comment record.');
    const frame = dataValue(comment, 'frame'), text = dataValue(comment, 'text');
    if (typeof frame !== 'number' || !Number.isSafeInteger(frame) || frame <= previous || frame >= duration)
      throw Error('Choose an existing frame for its comment.');
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_FRAME_COMMENT_LENGTH ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))
      throw Error(`Enter a comment of up to ${MAX_FRAME_COMMENT_LENGTH} characters.`);
    length += text.length;
    if (length > MAX_TIMELINE_COMMENT_LENGTH) throw Error('Timeline frame comments exceed their text budget.');
    previous = frame;
  }
}

/** Comments belong to timeline positions, independent of layer exposure edits. */
export function prepareFrameComment(original: FrameComment[] | undefined, duration: number, frame: number, text: string | null) {
  validateFrameComments(original, duration);
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= duration)
    throw Error('Choose an existing frame for its comment.');
  const next = (original ?? []).filter(comment => comment.frame !== frame).map(({ frame, text }) => ({ frame, text }));
  if (text !== null) next.push({ frame, text });
  next.sort((a, b) => a.frame - b.frame);
  validateFrameComments(next, duration);
  return next.length ? next : undefined;
}
