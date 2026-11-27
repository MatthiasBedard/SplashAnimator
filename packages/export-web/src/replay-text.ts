import { captureDynamicTextValues } from '../../document/src/dynamic-text';

export type ReplayTextChange = { tick: number; values: Record<string, string> | null };
export const replayTextByteLimit = 64 * 1024 * 1024;

/** A detached, sparse transcript. Null restores authored text from that tick on. */
export function captureReplayTextChanges(input: unknown, lastTick: number): ReplayTextChange[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > lastTick + 1)
    throw Error('Invalid replay text transcript.');
  const result: ReplayTextChange[] = [];
  const encoder = new TextEncoder();
  let previous = -1;
  let bytes = 2;
  for (let i = 0; i < input.length; i++) {
    const raw = Object.getOwnPropertyDescriptor(input, i)?.value;
    const tick = raw && Object.getOwnPropertyDescriptor(raw, 'tick')?.value;
    const values = raw && Object.getOwnPropertyDescriptor(raw, 'values');
    if (!Number.isSafeInteger(tick) || tick < 0 || tick <= previous || tick > lastTick ||
        !values || !('value' in values) || values.value === undefined)
      throw Error('Invalid replay text change.');
    const change: ReplayTextChange = {
      tick,
      values: values.value === null ? null : captureDynamicTextValues(values.value) ?? null,
    };
    bytes += encoder.encode(JSON.stringify(change)).byteLength + (i === 0 ? 0 : 1);
    if (bytes > replayTextByteLimit) throw Error('Replay text exceeds the 64 MiB artwork limit.');
    result.push(change);
    previous = tick;
  }
  return result;
}
