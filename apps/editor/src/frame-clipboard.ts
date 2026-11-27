import { clone, id, newLayer, newProject, validateProject, type Keyframe, type Project } from '../../../packages/document/src';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import { copyLayerFrames, pasteLayerFrames } from '../../../packages/animation/src/timeline';
import { assertPortableArtwork, MAX_ARTWORK_CLIPBOARD_CHARS } from './artwork-clipboard';

const frameFormat = 'splash-frames-1';
type FrameTrack = { mode: 'object' | 'merge'; keys: Keyframe[] };
type PortableFrames = { format: typeof frameFormat; duration: number; tracks: FrameTrack[] };

function exactFields(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field)))
    throw Error('Unsupported field in Splash Frame JSON.');
}

function validateFrames(payload: PortableFrames) {
  exactFields(payload, ['format', 'duration', 'tracks']);
  if (payload.format !== frameFormat) throw Error('Clipboard text is not Splash Frame JSON version 1.');
  if (!Number.isSafeInteger(payload.duration) || payload.duration < 1 || payload.duration > 100000 ||
      !Array.isArray(payload.tracks) || !payload.tracks.length || payload.tracks.length > 1000)
    throw Error('Invalid Splash Frame JSON duration or tracks.');
  const scene = newProject();
  scene.duration = payload.duration;
  scene.layers = payload.tracks.map((track, index) => {
    exactFields(track, ['mode', 'keys']);
    if ((track.mode !== 'object' && track.mode !== 'merge') || !Array.isArray(track.keys) ||
        !track.keys.length || track.keys.length > payload.duration || track.keys[0]?.frame !== 0)
      throw Error('Invalid Splash Frame JSON track or exposure ordering.');
    for (const key of track.keys) {
      exactFields(key, ['frame', 'shapes']);
      assertPortableArtwork(key.shapes, true);
    }
    return { ...newLayer(`Track ${index + 1}`), drawingMode: track.mode, keys: track.keys };
  });
  validateProject(scene);
}

function frameTrack(project: Project, layerId: string) {
  const layer = project.layers.find(layer => layer.id === layerId);
  if (!layer || !layer.visible || layer.locked)
    throw Error('Choose existing, visible, unlocked timeline layers.');
  if (layer.motionSpans?.length || layer.liveMotionSpans?.length ||
      project.opacityBindings?.some(binding => binding.layerId === layerId) ||
      project.layerMasks?.some(mask => mask.maskLayerId === layerId || mask.layerIds.includes(layerId)))
    throw Error('Splash Frame JSON supports plain layers without tweens, masks or opacity bindings.');
  return layer;
}

export function encodeClipboardFrames(project: Project, layerIds: string[], start: number, end: number) {
  if (new Set(layerIds).size !== layerIds.length) throw Error('Select each timeline layer once.');
  validateLiveGraphicData(project);
  validateProject(project);
  const layers = layerIds.map(layerId => frameTrack(project, layerId));
  const block = copyLayerFrames(project, layerIds, start, end, false);
  const payload: PortableFrames = {
    format: frameFormat,
    duration: end - start + 1,
    tracks: block.tracks.map(({ clip }, index) => ({
      mode: layers[index].drawingMode ?? 'object',
      keys: clip.keys.map(({ frame, shapes }) => ({ frame, shapes })),
    })),
  };
  validateFrames(payload);
  const text = JSON.stringify(payload);
  if (text.length > MAX_ARTWORK_CLIPBOARD_CHARS) throw Error('Splash Frame JSON exceeds the clipboard size limit.');
  return text;
}

function readFrames(text: string): PortableFrames {
  if (text.length > MAX_ARTWORK_CLIPBOARD_CHARS) throw Error('Splash Frame JSON exceeds the clipboard size limit.');
  let value: PortableFrames;
  try { value = JSON.parse(text); }
  catch { throw Error('Copy valid Splash Frame JSON to the system clipboard.'); }
  validateFrames(value);
  return value;
}

export function prepareClipboardFramePaste(
  project: Project, at: number, destinationIds: readonly string[], text: string,
) {
  validateLiveGraphicData(project);
  validateProject(project);
  const frames = readFrames(text);
  if (destinationIds.length < frames.tracks.length)
    throw Error('Choose enough destination layers for the copied frame block.');
  const candidate = clone(project);
  const tracks = frames.tracks.map((track, index) => {
    const layer = frameTrack(candidate, destinationIds[index]);
    if ((layer.drawingMode ?? 'object') !== track.mode)
      throw Error('Splash Frame JSON requires matching source and destination drawing modes.');
    const shapes = new Map<string, string>(), groups = new Map<string, string>();
    const remap = (ids: Map<string, string>, current: string) => {
      if (!ids.has(current)) ids.set(current, id());
      return ids.get(current)!;
    };
    const keys = track.keys.map(key => ({
      frame: key.frame,
      shapes: key.shapes.map(shape => ({
        ...shape,
        id: remap(shapes, shape.id),
        ...(shape.groups && { groups: shape.groups.map(group => remap(groups, group)) }),
      })),
    }));
    return { layerId: layer.id, clip: { duration: frames.duration, keys } };
  });
  pasteLayerFrames(candidate, at, { projectId: candidate.id, tracks });
  validateLiveGraphicData(candidate);
  return validateProject(candidate);
}
