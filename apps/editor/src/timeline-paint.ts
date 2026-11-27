import { createSubscriber } from 'svelte/reactivity';
import { type FrameComment, type FrameLabel, type Layer } from '../../../packages/document/src';
import { timelineHeldKey, timelineTweenCell, tweenCellKind } from './timeline-tween-cell';
import { DEFAULT_FRAME_WIDTH } from './timeline-zoom';
import { displayPixelRatio } from './display-pixel-ratio';
import { canvasTheme } from './canvas-theme';
const forcedColorsQuery = '(forced-colors: active)';
const subscribeForcedColors = createSubscriber(update => {
  const media = window.matchMedia(forcedColorsQuery);
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
});
export type TimelinePaint = {
  width: number;
  height: number;
  layers: (Layer & { folderRowId?: string })[];
  duration: number;
  frame: number;
  frameLabels?: readonly FrameLabel[];
  frameComments?: readonly FrameComment[];
  frameScripts?: readonly { frame: number }[];
  frameStart: number;
  cellWidth: number;
  layerId: string;
  start: number;
  end: number;
  selectedTracks: string[];
  blockSelected: boolean;
  multiTrack?: boolean;
  hideGeneratedKeyMarkers?: boolean;
  timelineDrag?: {
    block?: boolean;
    cross?: boolean;
    target?: string | null;
    layers: string[];
    targets?: string[];
    at: number;
    start: number;
    end: number;
  } | null;
  timelineContextCell?: { layerId: string; frame: number } | null;
};
/** Shared scene/definition timeline raster: dimensions, keys, tweens and playhead stay identical. */
export function paintTimeline(canvas: HTMLCanvasElement, model: TimelinePaint) {
  const {
    width,
    height,
    layers,
    duration,
    frame,
    frameLabels,
    frameComments,
    frameScripts,
    frameStart,
    cellWidth,
    layerId,
    start,
    end,
    selectedTracks,
    blockSelected,
    multiTrack = selectedTracks.length > 1,
    hideGeneratedKeyMarkers,
    timelineDrag,
    timelineContextCell,
  } = model;
  const c = canvas,
    dpr = displayPixelRatio();
  subscribeForcedColors();
  const forcedColors = window.matchMedia(forcedColorsQuery).matches;
  const colors = canvasTheme();
  c.width = Math.round(width * dpr);
  c.height = Math.round(height * dpr);
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.font = '10px system-ui';
  const count = Math.ceil(width / cellWidth);
  const commented = new Set(frameComments?.map(comment => comment.frame));
  const scripted = new Set(frameScripts?.map(script => script.frame));
  const artworkRow = layers.findIndex(layer => !layer.folderRowId);
  const numberBaseline = frameLabels?.length ? 13 : 16;
  const paintComment = (x: number, current = false) => {
    ctx.fillStyle = forcedColors && current ? 'HighlightText' : colors.timelineComment;
    ctx.fillRect(x + 2, 2, Math.min(10, cellWidth - 3), 3);
  };
  const inset = (value: number) => value * cellWidth / DEFAULT_FRAME_WIDTH;
  const tweenSpans = layers.map((layer) =>
    layer.folderRowId ? [] : [...(layer.liveMotionSpans ?? []), ...(layer.motionSpans ?? [])],
  );
  for (let i = 0; i < count; i++) {
    const f = i + frameStart,
      x = i * cellWidth;
    ctx.fillStyle = colors.timelineRulerBackground;
    ctx.fillRect(x, 0, cellWidth, 25);
    ctx.fillStyle = colors.timelineRulerText;
    if (f === 0 || (f + 1) % 5 === 0) ctx.fillText(String(f + 1), x + 2, numberBaseline);
    if (commented.has(f)) paintComment(x);
    layers.forEach((l, row) => {
      const y = 25 + row * 28;
      const held = f < duration && !l.folderRowId ? timelineHeldKey(l, f) : undefined;
      const tween = held && timelineTweenCell(l, f, held.frame)?.span;
      const openMotion = held?.shapes.length && held.openMotionTween;
      ctx.fillStyle =
        f >= duration
          ? colors.timelineOutside
          : tween
            ? tweenCellKind(tween) === 'shape'
              ? '#4ade80'
              : '#60a5fa'
            : openMotion
              ? '#60a5fa'
            : l.id === layerId
              ? f % 5 === 4
                ? colors.timelineActiveFifth
                : colors.timelineActiveRow
              : f % 5 === 4
                ? colors.timelineFifth
                : colors.timelineRow;
      ctx.fillRect(x, y, cellWidth - 1, 27);
      if (
        !l.folderRowId &&
        (l.id === layerId || (multiTrack && selectedTracks.includes(l.id))) &&
        (end > start || blockSelected) &&
        f >= start &&
        f <= end
      ) {
        if (tween || openMotion) {
          ctx.strokeStyle = colors.timelineOutline;
          ctx.strokeRect(x + 0.5, y + 0.5, cellWidth - 2, 26);
        } else {
          ctx.fillStyle = colors.timelineSelection;
          ctx.fillRect(x, y, cellWidth - 1, 27);
        }
      }
      if (
        timelineDrag &&
        (timelineDrag.block
          ? timelineDrag.targets?.includes(l.id)
          : timelineDrag.cross
            ? timelineDrag.target === l.id
            : timelineDrag.layers.includes(l.id)) &&
        f >= timelineDrag.at &&
        f <= timelineDrag.at + timelineDrag.end - timelineDrag.start
      ) {
        ctx.fillStyle = '#91632f';
        ctx.fillRect(x, y, cellWidth - 1, 27);
      }
      if (timelineContextCell?.layerId === l.id && timelineContextCell.frame === f) {
        ctx.strokeStyle = colors.timelineOutline;
        ctx.strokeRect(x + 0.5, y + 0.5, cellWidth - 2, 26);
      }
      if (f < duration && !l.folderRowId) {
        const generated = hideGeneratedKeyMarkers && tween && 'autoRefresh' in tween &&
          tween.autoRefresh && tween.start < f && f < tween.end;
        const key = held?.frame === f && !generated ? held : undefined;
        ctx.fillStyle = tween || openMotion ? '#000000' : l.visible ? colors.timelineKey : colors.timelineHiddenKey;
        if (key) {
          ctx.beginPath();
          ctx.arc(x + inset(8), y + 17, 3, 0, Math.PI * 2);
          if (key.shapes.length) ctx.fill();
          else {
            ctx.strokeStyle = colors.timelineEmptyKey;
            ctx.stroke();
          }
        } else if (!tween && held?.shapes.length) ctx.fillRect(x + inset(4), y + 19, inset(10), 1);
      }
    });
  }
  // One continuous arrow per authored span, clipped at the viewport rather than
  // inventing endpoints when its source or destination scrolls off screen.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 25, width, height - 25);
  ctx.clip();
  tweenSpans.forEach((spans, row) => {
    for (const span of spans) {
      const start = (span.start - frameStart) * cellWidth + inset(12),
        end = (span.end - frameStart) * cellWidth + inset(3),
        y = 25 + row * 28 + 17.5;
      ctx.strokeStyle = '#000000';
      ctx.fillStyle = '#000000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(start, y);
      ctx.lineTo(end, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(end, y);
      ctx.lineTo(end - 5, y - 4);
      ctx.lineTo(end - 5, y + 4);
      ctx.closePath();
      ctx.fill();
    }
  });
  ctx.restore();
  const x = (frame - frameStart) * cellWidth;
  ctx.fillStyle = forcedColors ? 'Highlight' : '#ff7d87';
  ctx.fillRect(x, 0, cellWidth, 23);
  const line = x + inset(8), lineHeight = Math.max(0, height - 23);
  ctx.fillRect(line - (forcedColors ? 1 : 0), 23, forcedColors ? 3 : 1, lineHeight);
  ctx.fillStyle = forcedColors ? 'HighlightText' : '#251a20';
  if (forcedColors) ctx.fillRect(line, 23, 1, lineHeight);
  ctx.fillText(String(frame + 1), x + 3, numberBaseline);
  if (commented.has(frame)) paintComment(x, true);
  if (frameLabels?.length) {
    // The ruler gives names their own lane above the row carrying the flag.
    const labelLayer = layers[artworkRow];
    const keys = labelLayer?.keys ?? [];
    let keyIndex = 0;
    ctx.fillStyle = colors.timelineLabel;
    ctx.strokeStyle = colors.timelineRulerBackground;
    ctx.lineWidth = 2;
    for (const [index, label] of frameLabels.entries()) {
      const left = (label.frame - frameStart) * cellWidth;
      if (left >= width) break;
      while (keyIndex < keys.length) {
        const at = keys[keyIndex].frame;
        if (at > label.frame) {
          const span = hideGeneratedKeyMarkers && timelineTweenCell(labelLayer, at, at)?.span;
          if (!(span && 'autoRefresh' in span && span.autoRefresh && span.start < at && at < span.end)) break;
        }
        keyIndex++;
      }
      const next = Math.min(keys[keyIndex]?.frame ?? Infinity, frameLabels[index + 1]?.frame ?? Infinity);
      const right = Math.min(width, (next - frameStart) * cellWidth);
      if (right <= 0) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(Math.max(0, left), 14, right - Math.max(0, left), 11);
      ctx.clip();
      ctx.strokeText(label.name, left + 2, 23);
      ctx.fillText(label.name, left + 2, 23);
      ctx.restore();
      if (left >= 0 && artworkRow !== -1) {
        const top = 45 + artworkRow * 28;
        ctx.fillRect(left + 1, top, 1, 6);
        ctx.beginPath();
        ctx.moveTo(left + 2, top);
        ctx.lineTo(left + 7, top + 2);
        ctx.lineTo(left + 2, top + 4);
        ctx.fill();
      }
    }
  }
  // Frame scripts belong to the timeline, so show one badge on the first artwork row.
  if (artworkRow === -1) return;
  const top = 27 + artworkRow * 28;
  ctx.font = 'bold 8px monospace';
  for (const at of scripted) {
    if (at < frameStart || at >= frameStart + count || at >= duration) continue;
    const left = (at - frameStart) * cellWidth + Math.floor((cellWidth - 8) / 2);
    ctx.fillStyle = '#164e63';
    ctx.fillRect(left, top, 7, 9);
    ctx.fillStyle = '#ecfeff';
    ctx.fillText('S', left + 1, top + 7);
  }
}
