import type { BasicMotionSpan, Layer, Project, Vector } from '@splash/document';
import { projectSceneData } from '../../../packages/document/src/scenes';
import { hasVectorFill } from '../../../packages/geometry/src/merge';

export const SWATCH_KEY = 'splash-color-swatches-v1';
export const STARTER_SWATCHES = [
  'ffffff', 'eeeeee', 'cccccc', 'aaaaaa', '888888', '666666', '333333', '000000',
  'ffd6d6', 'ffe2be', 'fff5bb', 'dbf4bb', 'bcf3ed', 'cae6ff', 'ddd6ff', 'f9c9ea',
  'ff8585', 'ffb560', 'ffe46b', 'a3df71', '5bdcd0', '78bbff', 'a49afc', 'ef91d1',
  'f34246', 'f28126', 'f3c522', '64b634', '22aba2', '2389ed', '7562e8', 'da55b1',
  'be2431', 'b75014', 'ad830b', '3b821f', '117c76', '185bad', '4d38b7', 'a73583',
  '741a25', '743811', '64500b', '264e19', '144a49', '153669', '34266a', '652752',
].map(hex => `#${hex}`);

export type ColorTarget = { id: string; label: string; color: string; apply?: (color: string) => void };

export function normalizeSwatch(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return;
  const hex = raw.trim().replace(/^#/, '').toLowerCase();
  if (/^[\da-f]{6}$/.test(hex)) return `#${hex}`;
  if (/^[\da-f]{3}$/.test(hex)) return `#${[...hex].map(digit => digit.repeat(2)).join('')}`;
}

export function loadSwatches(storage: Pick<Storage, 'getItem'>): string[] {
  try {
    const saved: unknown = JSON.parse(storage.getItem(SWATCH_KEY) ?? 'null');
    if (Array.isArray(saved) && saved.every(color => normalizeSwatch(color)))
      return [...new Set(saved.map(color => normalizeSwatch(color)!))];
  } catch { /* Starter swatches remain available if storage is unavailable. */ }
  return [...STARTER_SWATCHES];
}

export function collectProjectSwatches(projects: readonly Project[]): string[] {
  const colors = new Set<string>();
  const seen = new Set<Layer>();
  const add = (value?: string) => { const color = normalizeSwatch(value); if (color) colors.add(color); };
  const shapes = (artwork: readonly Vector[]) => {
    for (const shape of artwork) {
      if (shape.kind !== 'symbol') {
        if ((shape.kind === 'text' || hasVectorFill(shape)) && !shape.gradient && !shape.bitmap) add(shape.fill);
        if (shape.strokeWidth && shape.kind !== 'brush') add(shape.stroke);
      }
      for (const stop of shape.gradient?.stops ?? []) add(stop.color);
      for (const run of shape.text?.runs ?? []) add(run.style.color);
      add(shape.tint?.color);
      add(shape.instanceTint?.color);
      add(shape.groupBlur?.tint?.color);
    }
  };
  const motion = (spans: readonly Pick<BasicMotionSpan, 'fillColorKeys' | 'strokeColorKeys' | 'gradientColorTracks'>[]) => {
    for (const span of spans) {
      for (const key of span.fillColorKeys ?? []) add(key.color);
      for (const key of span.strokeColorKeys ?? []) add(key.color);
      for (const track of span.gradientColorTracks ?? []) for (const key of track.keys) add(key.color);
    }
  };
  const layers = (tracks: readonly Layer[]) => {
    for (const track of tracks) {
      if (seen.has(track)) continue;
      seen.add(track);
      add(track.outlineColor);
      for (const key of track.keys) shapes(key.shapes);
      motion(track.liveMotionSpans ?? []);
      motion(track.motionSpans ?? []);
    }
  };
  for (const project of projects) {
    add(project.background);
    for (const scene of projectSceneData(project)) layers(scene.layers);
    for (const symbol of project.symbols ?? []) {
      add(symbol.baseLayer?.outlineColor);
      shapes(symbol.shapes);
      for (const key of symbol.timeline?.keys ?? []) shapes(key.shapes);
      layers(symbol.timeline?.layers ?? []);
      motion(symbol.timeline?.motionSpans ?? []);
    }
  }
  return [...colors];
}
