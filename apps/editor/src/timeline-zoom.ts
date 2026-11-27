export const DEFAULT_FRAME_WIDTH = 18;
const frameWidths = [8, 12, DEFAULT_FRAME_WIDTH, 24, 32, 48, 64];

export function timelineFrameMax(duration: number, width: number, cellWidth: number, limit: number) {
  const columns = Math.floor(width / cellWidth);
  return duration < columns ? 0 : Math.max(0, Math.min(duration, limit - columns));
}

/** Scroll positions are whole columns. Keep the pointed-at frame in the same
 * pointer column at the new scale, subject to the available scroll range. */
export function zoomTimeline(
  cellWidth: number, frameStart: number, x: number, deltaY: number,
  width: number, duration: number, limit: number,
) {
  const index = frameWidths.indexOf(cellWidth);
  const next = frameWidths[index - Math.sign(deltaY)];
  if (!next || !deltaY || width <= 0) return;
  const anchor = frameStart + Math.floor(x / cellWidth);
  return {
    cellWidth: next,
    frameStart: Math.max(0, Math.min(timelineFrameMax(duration, width, next, limit),
      anchor - Math.floor(x / next))),
  };
}
