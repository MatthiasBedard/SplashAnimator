import {
  clone,
  id,
  symbolLayers,
  validateProject,
  type Project,
  type SymbolDefinition,
} from '../../document/src';
import {
  captureIsolatedSymbolFrameSources,
  type IsolatedSymbolFrameSourceState,
} from '../../document/src/symbol-frame-sources';
import { prepareScriptPreview } from './preview';
import { createScriptTimeline, type ScriptState, type ScriptTimelineConfig } from './timeline';
import type { ScriptFrameSource } from './session';

export interface SymbolArtworkPose {
  frame: number;
  tick: number;
}
export interface SymbolArtworkViewport {
  width: number;
  height: number;
}
export interface SymbolArtworkRequest {
  project: Project;
  poses: SymbolArtworkPose[];
  namespace: string;
  definitionId: string;
}
interface ArtworkOwner {
  prepare: (
    poses: readonly SymbolArtworkPose[],
    viewport?: SymbolArtworkViewport,
  ) => SymbolArtworkRequest;
  admit: () => void;
  subscribe: (cleanup: () => void) => () => void;
}
const artworkOwners = new WeakMap<object, ArtworkOwner>();
/** Private capture brand; copied public methods/snapshots cannot authorize a renderer. */
export function prepareSymbolProgramArtwork(
  program: object,
  poses: readonly SymbolArtworkPose[],
  viewport?: SymbolArtworkViewport,
): SymbolArtworkRequest {
  const owner = artworkOwners.get(program);
  if (!owner) throw new Error('A qualified symbol program capture is required.');
  return owner.prepare(poses, viewport);
}
export function admitSymbolProgramArtwork(program: object): void {
  const owner = artworkOwners.get(program);
  if (!owner) throw new Error('A qualified symbol program capture is required.');
  owner.admit();
}
export function subscribeSymbolProgramDisposal(program: object, cleanup: () => void): () => void {
  const owner = artworkOwners.get(program);
  if (!owner) throw new Error('A qualified symbol program capture is required.');
  return owner.subscribe(cleanup);
}

type Preview = NonNullable<Awaited<ReturnType<typeof prepareScriptPreview>>['preview']>;
export interface SymbolProgramSnapshot {
  scope: 'symbol-local';
  namespace: string;
  definitionId: string;
  selectedFrame: number;
  config: ScriptTimelineConfig;
  sources: ScriptFrameSource[];
  /** Presentation data only: every root/library frame body is omitted. */
  artwork: {
    definition: SymbolDefinition;
    symbols: SymbolDefinition[];
    assets: Project['assets'];
    libraryLinks?: Project['libraryLinks'];
    fps: number;
  };
}

/** Standalone selected-definition inspection, not nested instance dispatch.
 * Each capture starts a fresh checkpoint namespace; public snapshots never own it.
 * Original project, library, draft, frame, revision and caller context remain required. */
export function captureSymbolLocalProgram(read: () => IsolatedSymbolFrameSourceState, seed = 0) {
  const owner = captureIsolatedSymbolFrameSources(read);
  const source = owner.snapshot(),
    project = source.project;
  owner.assertCurrent();
  const definition = project.symbols!.find((symbol) => symbol.id === source.definition.id)!;
  const timeline = createScriptTimeline({
    duration: definition.timeline!.duration,
    fps: project.fps,
    seed,
    frameLabels: definition.timeline!.frameLabels,
  }).checkpoint();
  const config = { duration: timeline.duration, fps: timeline.fps, seed: timeline.seed,
    ...(timeline.frameLabels ? { frameLabels: timeline.frameLabels } : {}) };
  const namespace = JSON.stringify({
    version: 1,
    scope: 'symbol-local',
    captureId: id(),
    projectId: project.id,
    definitionId: definition.id,
    revision: source.revision,
  });
  const sources = clone(definition.timeline!.frameScripts ?? []);
  const strip = (definition: SymbolDefinition) => {
    const detached = clone(definition);
    if (detached.timeline) delete detached.timeline.frameScripts;
    return detached;
  };
  const snapshot: SymbolProgramSnapshot = {
    scope: 'symbol-local',
    namespace,
    definitionId: definition.id,
    selectedFrame: source.frame,
    config,
    sources,
    artwork: {
      definition: strip(definition),
      symbols: project.symbols!.map(strip),
      assets: clone(project.assets),
      ...(project.libraryLinks ? {libraryLinks:clone(project.libraryLinks)} : {}),
      fps: project.fps,
    },
  };
  owner.assertCurrent();
  let disposed = false,
    admitting = false,
    job: AbortController | undefined;
  const previews = new Set<Preview>(),
    cleanups = new Set<() => void>();
  let preparingArtwork = false;
  function admit() {
    if (disposed || admitting) throw new Error('Symbol program scope is disposed or reentered.');
    admitting = true;
    try {
      owner.assertCurrent();
    } finally {
      admitting = false;
    }
  }
  function prepareArtwork(
    poses: readonly SymbolArtworkPose[],
    viewport?: SymbolArtworkViewport,
  ): SymbolArtworkRequest {
    admit();
    if (preparingArtwork) throw new Error('Symbol artwork preparation reentered.');
    preparingArtwork = true;
    try {
      const length = Array.isArray(poses) ? poses.length : 0;
      if (length < 1 || length > 10001)
        throw new Error('Symbol presentation requires one to 10001 poses.');
      const trajectory: SymbolArtworkPose[] = [];
      for (let i = 0; i < length; i++) {
        const pose = poses[i];
        if (
          !pose ||
          typeof pose !== 'object' ||
          Array.isArray(pose) ||
          Reflect.ownKeys(pose).some((key) => key !== 'frame' && key !== 'tick')
        )
          throw new Error('Symbol artwork accepts frame/tick poses only; buttons remain Up.');
        const frame = pose.frame,
          tick = pose.tick;
        if (!Number.isSafeInteger(frame) || frame < 0 || frame >= config.duration || tick !== i)
          throw new Error('Symbol presentation must contain every local host tick from zero.');
        trajectory.push({ frame, tick });
      }
      if (poses.length !== length) throw new Error('Symbol presentation changed during capture.');
      if (trajectory[0].frame !== 0)
        throw new Error('Symbol presentation must start at local frame zero.');
      const width =
        viewport === undefined ? Math.ceil(snapshot.artwork.definition.width) : viewport.width;
      const height =
        viewport === undefined ? Math.ceil(snapshot.artwork.definition.height) : viewport.height;
      admit();
      // Existing document/raster dimensions apply to this explicit viewport only.
      // Authored geometry, pivots, paint and declared definition bounds stay exact.
      const carrier: Project = {
        schemaVersion: project.schemaVersion,
        id: project.id + ':symbol:' + definition.id,
        name: definition.name,
        width,
        height,
        fps: config.fps,
        duration: config.duration,
        background: project.background,
        layers: clone(symbolLayers(snapshot.artwork.definition)),
        symbols: clone(snapshot.artwork.symbols),
        assets: clone(snapshot.artwork.assets),
        ...(snapshot.artwork.libraryLinks ? {libraryLinks:clone(snapshot.artwork.libraryLinks)} : {}),
      };
      const candidate = validateProject(carrier);
      admit();
      return { project: candidate, poses: trajectory, namespace, definitionId: definition.id };
    } finally {
      preparingArtwork = false;
    }
  }
  const capture = Object.freeze({
    assertCurrent: admit,
    snapshot() {
      admit();
      const detached = clone(snapshot);
      admit();
      return detached;
    },
    async prepare(
      state: ScriptState = {},
      options: { signal?: AbortSignal; timeoutMs?: number; allowSound?: boolean; boundedEngine?: boolean } = {},
    ) {
      admit();
      if (job) throw new Error('Symbol program preparation is busy.');
      const controller = new AbortController();
      job = controller;
      let signal: AbortSignal | undefined,
        result: Awaited<ReturnType<typeof prepareScriptPreview>> | undefined;
      const abort = () => controller.abort(signal?.reason);
      try {
        const { signal: incoming, timeoutMs, allowSound=false, boundedEngine=false } = options;
        signal = incoming;
        signal?.throwIfAborted();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        admit();
        result = await prepareScriptPreview(config, sources, state, {
          signal: controller.signal,
          timeoutMs,
          namespace,
            artwork: {layers: symbolLayers(definition), symbols: project.symbols, assets:project.assets,
              libraryLinks:project.libraryLinks, layerMasks: definition.timeline?.layerMasks},
          stage: {width:definition.width,height:definition.height,layerCount:1+(definition.timeline?.layers?.length??0)},
          allowDirectButtons: true,
          allowSound,
          boundedEngine,
          validateSource: admit,
        });
        controller.signal.throwIfAborted();
        admit();
        if (!result.preview) return result;
        const preview = result.preview;
        previews.add(preview);
        const handle: Preview = Object.freeze({
          checkpoint: () => preview.checkpoint(),
          restore: (value) => preview.restore(value),
          run: (ticks, options) => preview.run(ticks, options),
          runWithPresentation: (ticks, options) => preview.runWithPresentation(ticks, options),
          retireButtonTargets: preview.retireButtonTargets,
          dispose() {
            preview.dispose();
            previews.delete(preview);
          },
        });
        return { diagnostics: result.diagnostics, preview: handle };
      } catch (error) {
        result?.preview?.dispose();
        throw error;
      } finally {
        signal?.removeEventListener('abort', abort);
        job = undefined;
      }
    },
    dispose() {
      disposed = true;
      job?.abort(new Error('Symbol program scope disposed.'));
      for (const preview of previews) preview.dispose();
      previews.clear();
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch {
          /* Continue releasing other capture-owned resources. */
        }
      }
      cleanups.clear();
      owner.dispose();
    },
  });
  artworkOwners.set(capture, {
    prepare: prepareArtwork,
    admit,
    subscribe(cleanup) {
      admit();
      if (typeof cleanup !== 'function') throw new Error('Invalid symbol artwork cleanup.');
      cleanups.add(cleanup);
      return () => {
        cleanups.delete(cleanup);
      };
    },
  });
  return capture;
}
