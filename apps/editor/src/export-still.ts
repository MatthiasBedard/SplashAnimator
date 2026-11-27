import { movieLayerView, validateProject, type Project } from '@splash/document';
import { createMovieTreeClock } from '../../../packages/animation/src/movie-tree-clock';
import { createStageOpacityView } from '../../../packages/animation/src/stage-opacity';
import { createUpButtonPlayback } from '../../../packages/animation/src/up-button-playback';
import { groupDrawingPaint } from '../../../packages/geometry/src/symbols';
import { encodeBmp, encodeTiff } from '../../../packages/export-web/src/still-raster';
import { encodeEps, encodeSvg } from '../../../packages/export-web/src/still-vector';
import { encodeRgbaGif } from '../../../packages/export-video/src/gif-rgba';
import { captureProjectCanvasFrames } from './desktop-png';
import { prepareLivePNGFrame } from './live-png';
import { maskedButtonPose } from './masked-button-pose';
import { stillFormats, type StillFormat } from './still-formats';

/** Evaluate the playhead against the original movie clocks, including frames before the still. */
async function vectorPose(project: Project, frame: number, signal: AbortSignal, check: () => void) {
  const source = movieLayerView(project);
  const live = project.layers.some((layer) =>
    layer.liveMotionSpans?.some((span) => span.start < frame && frame < span.end),
  );
  const prepared = live
    ? await prepareLivePNGFrame(project, frame, 1, { signal, validate: check })
    : undefined;
  const opacity = createStageOpacityView(prepared ? movieLayerView(prepared.project) : source);
  const clock = createMovieTreeClock();
  const up = source.symbols?.some((definition) => definition.buttonStates)
    ? createUpButtonPlayback(source)
    : undefined;
  let tracks: ReturnType<typeof maskedButtonPose>['tracks'] | undefined;
  let display = source;
  for (let index = 0; index <= frame; index++) {
    check();
    const seconds = index / source.fps;
    const clocks = clock.sample(source, index, seconds, index);
    const pose = up?.(index, index, seconds, clocks, clock.origins());
    if (index === frame) {
      display = opacity(frame);
      tracks = maskedButtonPose(
        display,
        frame,
        clocks,
        pose?.snapshot.buttons ?? [],
        pose?.stateFrames ?? new Map(),
        null,
        null,
      ).tracks;
    }
    if (index % 32 === 31) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  prepared?.check();
  check();
  return {
    display,
    tracks: display.layers.map((layer) => ({
      id: layer.id,
      visible: layer.visible,
      items: groupDrawingPaint(tracks?.get(layer.id)?.items ?? []),
    })),
  };
}

function encodeCanvas(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg'): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        if (blob?.type === type) resolve(blob);
        else reject(Error(`The browser could not encode ${type}.`));
      },
      type,
      0.92,
    ),
  );
}

export async function exportStill(
  project: Project,
  frame: number,
  format: StillFormat,
  transparent: boolean,
  signal: AbortSignal,
  validate: () => void,
) {
  const check = () => {
    signal.throwIfAborted();
    validate();
    signal.throwIfAborted();
  };
  check();
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= project.duration)
    throw Error('Invalid still frame.');
  const choice = stillFormats.find((candidate) => candidate.id === format);
  if (!choice) throw Error('Unknown still format.');
  const clear = choice.transparency && transparent;
  if (format === 'svg' || format === 'eps') {
    const { display, tracks } = await vectorPose(validateProject(project), frame, signal, check);
    if (format === 'eps')
      return new Blob([encodeEps(display, tracks, clear)], { type: 'application/postscript' });
    await document.fonts.ready;
    check();
    const measure = document.createElement('canvas').getContext('2d');
    if (!measure) throw Error('Could not measure SVG text.');
    return new Blob([encodeSvg(display, tracks, clear, measure)], { type: 'image/svg+xml' });
  }

  let result: Blob | undefined;
  await captureProjectCanvasFrames(
    project,
    { start: frame, end: frame },
    1,
    clear,
    signal,
    check,
    async (_frame, canvas, active) => {
      if (format === 'png' || format === 'jpg') {
        result = await encodeCanvas(canvas, format === 'png' ? 'image/png' : 'image/jpeg');
      } else {
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
        if (format === 'bmp') result = new Blob([encodeBmp(pixels)], { type: 'image/bmp' });
        else if (format === 'tiff')
          result = new Blob([encodeTiff(pixels, clear)], { type: 'image/tiff' });
        else {
          const color = [1, 3, 5].map((index) =>
            parseInt(project.background.slice(index, index + 2), 16),
          );
          const { bytes } = encodeRgbaGif({
            width: canvas.width,
            height: canvas.height,
            frames: [pixels.data],
            fps: 10,
            matte: [color[0], color[1], color[2]],
            transparent: clear,
            compression: 'dictionary',
          });
          result = new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
        }
      }
      active();
    },
  );
  if (!result) throw Error('No frame was rendered.');
  return result;
}
