import { validateProject, type Project } from '@splash/document';
import { validateLiveMotionData } from '../../../packages/document/src/live-motion';
import { createFrameReplay } from './frame-replay';

/** Pull selected video frames without buffering a range or resetting nested clocks. */
export function createVideoFrameReplay(
  project: Project,
  range: { start: number; end: number },
  scope: { signal: AbortSignal; timeoutMs: number; validate: () => void },
) {
  validateLiveMotionData(project);
  if (!project.layers.some(layer => layer.liveMotionSpans?.length))
    return createFrameReplay(project, scope);

  const source = structuredClone(validateProject(project));
  return import('./desktop-png').then(({ streamProjectCanvasFrames }) => {
    const { signal, validate } = scope;
    signal.throwIfAborted();
    validate();
    const frames = streamProjectCanvasFrames(source, range, 1, false, signal, validate);
    return {
      async seek(frame: number): Promise<ImageData> {
        signal.throwIfAborted();
        const next = await frames.next();
        if (next.done || next.value.frame !== frame) throw Error('Video frame order changed.');
        const { canvas, current } = next.value;
        current();
        const context = canvas.getContext('2d');
        if (!context) throw Error('Video frame canvas is unavailable.');
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        current();
        return pixels;
      },
      async dispose() {
        await frames.return(undefined);
      },
    };
  });
}
