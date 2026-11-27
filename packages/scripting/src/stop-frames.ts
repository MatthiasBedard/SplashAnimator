/** Parse an optional comma-separated list of one-based inspector stop frames.
 * Reject original entries before deduplication; never silently truncate a list.
 */
export function parseScriptStopFrames(text: string, duration: number): number[] {
  if (typeof text !== 'string' || text.length > 16000 ||
      !Number.isSafeInteger(duration) || duration < 1)
    throw new Error('Invalid stop-frame list.');
  if (!text.trim()) return [];
  const entries = text.split(',');
  if (entries.length > 999) throw new Error('Use at most 999 additional stop frames.');
  const frames = entries.map(entry => {
    const token = entry.trim();
    if (!/^[0-9]+$/.test(token))
      throw new Error('Additional stop frames must be whole frames separated by commas.');
    const frame = Number(token);
    if (!Number.isSafeInteger(frame) || frame < 1 || frame > duration)
      throw new Error('Additional stop frames must be within this timeline.');
    return frame - 1;
  });
  return [...new Set(frames)];
}
