import { id, validateProject, type Project, type Vector, type AudioClip, type Asset } from '../../document/src';
import { resolveLibraryLink } from '../../document/src/library';
import { symbolInstance } from './symbols';
/** Explicit host-code factory. The caller owns scene insertion and history. */
export function libraryInstance(project: Project, linkName: string, x: number, y: number): Vector {
  validateProject(project);
  if (!Number.isFinite(x) || !Number.isFinite(y))
    throw Error('Library placement requires finite document coordinates.');
  const item = resolveLibraryLink(project, linkName);
  if (item.kind === 'symbol') return symbolInstance(item.symbol, x, y);
  if (item.kind === 'audio')
    throw Error('Use libraryAudioClip to place an audio link on the timeline.');
  return libraryBitmapInstance(item.asset,x,y);
}

/** The detached instance uses the same image fitting as library insertion. */
export function libraryBitmapInstance(asset: Asset, x: number, y: number, placementId: string = id()): Vector {
  const bitmap = asset.bitmap;
  if (!bitmap || !Number.isFinite(x) || !Number.isFinite(y))
    throw Error('Bitmap placement requires bitmap metadata and finite coordinates.');
  return {
    id: placementId,
    kind: 'rectangle',
    x,
    y,
    width: bitmap.width,
    height: bitmap.height,
    rotation: 0,
    fill: '#ffffff',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    bitmap: { assetId: asset.id, x: 0, y: 0, width: bitmap.width, height: bitmap.height },
  };
}

/** Explicit host-code audio placement, without playback or filesystem writes. */
export function libraryAudioClip(
  project: Project,
  linkName: string,
  startFrame: number,
): AudioClip {
  validateProject(project);
  const item = resolveLibraryLink(project, linkName);
  if (item.kind !== 'audio') throw Error('Choose an audio library link.');
  if (!Number.isSafeInteger(startFrame) || startFrame < 0 || startFrame >= project.duration)
    throw Error('Choose an audio start frame inside the timeline.');
  return { id: id(), assetId: item.asset.id, startFrame, offsetSamples: 0, gain: 1 };
}
