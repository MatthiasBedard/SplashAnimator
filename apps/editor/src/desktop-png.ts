import { movieLayerView, symbolArtworks, validateProject, type Project } from '@splash/document';
import { createMovieTreeClock } from '../../../packages/animation/src/movie-tree-clock';
import { createStageOpacityView } from '../../../packages/animation/src/stage-opacity';
import { createUpButtonPlayback } from '../../../packages/animation/src/up-button-playback';
import { hasMaskChain } from '../../../packages/document/src/layer-masks';
import { validateLiveMotionData } from '../../../packages/document/src/live-motion';
import { captureDimensions } from '../../../packages/export-web/src';
import { resolveExportPaintAssets } from '../../../packages/export-web/src/paint-assets';
import { hasInstanceBlur } from '../../../packages/geometry/src/symbols';
import { CanvasStage } from '../../../packages/stage/src';
import { maskedButtonPose } from './masked-button-pose';
import { loadProjectFont } from './project-fonts';
import type { PNGFrameRange } from './export-png';

function* captureArtwork(source: Project) {
  const definitions = new Map(source.symbols?.map(definition => [definition.id, definition]));
  const visited = new Set<string>();
  const pending = source.layers.flatMap(layer => layer.keys.map(key => key.shapes));
  for (const artwork of pending) {
    for (const shape of artwork) {
      yield shape;
      const id = shape.symbolId;
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const definition = definitions.get(id);
      if (definition) pending.push(...symbolArtworks(definition));
    }
  }
}

export async function captureDesktopPNGSequence(
  snapshot: Project,
  range: PNGFrameRange,
  scale: number,
  transparent: boolean,
  signal: AbortSignal,
  validate: () => void,
  consume: (frame: number, png: Blob) => Promise<void>,
) {
  await captureProjectCanvasFrames(snapshot, range, scale, transparent, signal, validate, async (frame, canvas, current) => {
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(Error('Desktop PNG encoding failed.')), 'image/png'));
    current();
    await consume(frame, png);
  });
}

/** The owned canvas is available only during the awaited frame callback. */
export async function captureProjectCanvasFrames(
  snapshot: Project,
  range: PNGFrameRange,
  scale: number,
  transparent: boolean,
  signal: AbortSignal,
  validate: () => void,
  consume: (frame: number, canvas: HTMLCanvasElement, current: () => void) => Promise<void>,
) {
  for await (const { frame, canvas, current, wait } of streamProjectCanvasFrames(
    snapshot, range, scale, transparent, signal, validate,
  )) {
    await wait(consume(frame, canvas, current));
    current();
  }
}

/** One owned frame at a time. The consumer must close the iterator on early exit. */
export async function* streamProjectCanvasFrames(
  snapshot: Project,
  range: PNGFrameRange,
  scale: number,
  transparent: boolean,
  signal: AbortSignal,
  validate: () => void,
) {
  const active = () => {
    signal.throwIfAborted();
    validate();
    signal.throwIfAborted();
  };
  let stop!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
  void cancelled.catch(() => {});
  const wait = <T>(pending: Promise<T>) => Promise.race([pending, cancelled]);
  const faces: FontFace[] = [];
  const canvas = document.createElement('canvas');
  try {
    active();
    const original = validateProject(snapshot);
    validateLiveMotionData(original);
    const source = movieLayerView(original);
    const { start, end } = range;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 0 || end < start || end >= source.duration)
      throw Error('Invalid desktop frame range.');
    const size = captureDimensions(source.width, source.height, scale);
    const paint = resolveExportPaintAssets(source.assets, captureArtwork(source));
    const bitmaps = await wait(Promise.all(paint.bitmapAssets.map((asset) => {
      const image = new Image();
      image.src = asset.bitmap!.dataUrl!;
      return image.decode().then(() => [asset.id, image] as const);
    })));
    const fonts = await wait(Promise.all(paint.fonts.map(loadProjectFont)));
    active();
    for (const face of fonts) {
      document.fonts.add(face);
      faces.push(face);
    }
    await wait(document.fonts.ready);
    active();

    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw Error('Desktop frame canvas could not be allocated.');
    context.scale(size.width / source.width, size.height / source.height);
    const renderer = new CanvasStage(canvas, { transparent, images: new Map(bitmaps) });
    const clock = createMovieTreeClock();
    const opacity = createStageOpacityView(source);
    const up = source.symbols?.some((definition) => definition.buttonStates)
      ? createUpButtonPlayback(source) : undefined;
    const masked = hasMaskChain(source.layerMasks) || hasInstanceBlur(source) ||
      source.symbols?.some((definition) => definition.timeline?.layerMasks?.length);
    const spans = original.layers.flatMap(layer => layer.liveMotionSpans ?? []);
    const prepareLive = spans.some(span => span.start < end && span.end > start)
      ? (await wait(import('./live-png'))).prepareLivePNGFrame : undefined;

    // Prior exposures must be sampled even when only a later range is exported.
    for (let frame = 0; frame <= end; frame++) {
      active();
      const seconds = frame / source.fps;
      const prepared = frame >= start && prepareLive && spans.some(span => span.start < frame && frame < span.end)
        ? await wait(prepareLive(original, frame, scale, { signal, validate: active })) : undefined;
      prepared?.check();
      const frameOpacity = prepared ? createStageOpacityView(movieLayerView(prepared.project)) : opacity;
      // Geometry comes from the detached pose. Movie and Button Up ages still
      // belong to the original authored exposures, including the skipped frames.
      const frames = clock.sample(source, frame, seconds, frame);
      const pose = up?.(frame, frame, seconds, frames, clock.origins(), frameOpacity);
      if (frame >= start) {
        const view = pose?.project ?? frameOpacity(frame);
        const tracks = pose && masked
          ? maskedButtonPose(view, frame, frames, pose.snapshot.buttons, pose.stateFrames, null, null).tracks
          : undefined;
        const rendered = pose && !tracks ? pose.snapshot.render(null, null, pose.artwork, pose.stateFrames) : view;
        renderer.render({ ...rendered, assets: paint.bitmapAssets }, frame, frames, tracks);
        const current = () => { active(); prepared?.check(); };
        current();
        yield { frame, canvas, current, wait };
        current();
      }
      if (frame % 16 === 15) await wait(new Promise<void>((resolve) => setTimeout(resolve, 0)));
    }
    active();
  } finally {
    signal.removeEventListener('abort', stop);
    for (const face of faces) document.fonts.delete(face);
    canvas.width = canvas.height = 0;
  }
}
