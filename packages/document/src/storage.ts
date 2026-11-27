import { id, migrateProject, safePath, type Project, type Layer, type Vector } from './index';
import { EMBEDDED_FONT_PAYLOAD_LIMIT } from './embedded-font';
import { projectScenes } from './scenes';
export type CommitReceipt = { warning: string | null };

/** Repository adapters write immutable parts first and publish a revision through commit. */
export interface DirectoryStore {
  read(path: string): Promise<string>;
  writeNew(path: string, content: string): Promise<void>;
  commit(path: string, content: string, expected: string | null): Promise<void | CommitReceipt>;
  exists(path: string): Promise<boolean>;
}
/** Binary WAV persistence is separate from JSON transport. Implementations must never
 * replace an existing destination, including on cancellation or failed writes. */
export interface AudioAssetStore {
  readAudio(path: string, signal?: AbortSignal): Promise<Uint8Array>;
  writeNewAudio(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void>;
}
export type Manifest = {
  format: 'splash-directory';
  schemaVersion:
    | 1
    | 2
    | 3
    | 4
    | 5
    | 6
    | 7
    | 8
    | 9
    | 10
    | 11
    | 12
    | 13
    | 14
    | 15
    | 16
    | 17
    | 18
    | 19
    | 20
    | 21
    | 22
    | 23
    | 24
    | 25
    | 26
    | 27
    | 28
    | 29
    | 30
    | 31
    | 32
    | 33
    | 34
    | 35
    | 36
    | 37
    | 38
    | 39
    | 40
    | 41
    | 42
    | 43
    | 44
    | 45
    | 46
    | 47
    | 48
    | 49
    | 50
    | 51
    | 52
    | 53
    | 54
    | 55
    | 56
    | 57
    | 58
    | 59
    | 60
    | 61;
  revision: string;
  savedAt: string;
  document: Omit<Project, 'layers' | 'schemaVersion' | 'scenes'> & {
    schemaVersion: Manifest['schemaVersion'];
  };
  scene: string;
  sceneCatalog?: string;
  timeline: string;
  vectors: string;
};
export type Loaded = { project: Project; manifest: string; missingAssets: string[] };

function manifestPath(autosave: boolean) {
  return autosave ? '.splash/autosaves/latest.json' : 'project.json';
}

async function writeVisualAssets(store: DirectoryStore, assets: Project['assets']) {
  for (const asset of assets) {
    const dataUrl = asset.bitmap?.dataUrl ?? asset.font?.dataUrl;
    if (!dataUrl) continue;

    const payload = JSON.stringify({ dataUrl });
    if (!(await store.exists(asset.path))) {
      await store.writeNew(asset.path, payload);
      continue;
    }
    // Asset paths can be shared by more than one saved revision.
    if ((await store.read(asset.path)) !== payload) {
      const kind = asset.font ? 'Font' : 'Bitmap';
      throw new Error(`${kind} asset conflict; original asset preserved.`);
    }
  }
}

function visualAssetMetadata(asset: Project['assets'][number]) {
  if (asset.bitmap) {
    const { name, width, height } = asset.bitmap;
    return { ...asset, bitmap: { name, width, height } };
  }
  if (asset.font) {
    const { name, family, bytes } = asset.font;
    return { ...asset, font: { name, family, bytes } };
  }
  return asset;
}

export async function saveProject(
  store: DirectoryStore,
  project: Project,
  expected: string | null,
  autosave = false,
): Promise<string> {
  return (await saveProjectWithReceipt(store, project, expected, autosave)).manifest;
}

export async function saveProjectWithReceipt(
  store: DirectoryStore,
  project: Project,
  expected: string | null,
  autosave = false,
): Promise<{ manifest: string; warning: string | null }> {
  const valid = migrateProject(project);
  const revision = id();
  if (valid.schemaVersion === 61 && !valid.scenes)
    throw Error('Schema 61 requires a scene catalog.');
  await writeVisualAssets(store, valid.assets);

  const { layers, scenes, ...document } = valid;
  document.assets = document.assets.map(visualAssetMetadata);
  const manifest: Manifest = {
    format: 'splash-directory',
    schemaVersion: valid.schemaVersion,
    revision,
    savedAt: new Date().toISOString(),
    document,
    scene: `scenes/main-${revision}.json`,
    ...(scenes ? { sceneCatalog: `scenes/catalog-${revision}.json` } : {}),
    timeline: `timelines/main-${revision}.json`,
    vectors: `vectors/${revision}.json`,
  };
  // The timeline owns timing and the vector table owns artwork for each exposure.
  const vectors: Record<string, Vector[]> = {};
  const timeline = layers.map((layer) => ({
    ...layer,
    keys: layer.keys.map((key) => {
      const ref = `${layer.id}:${key.frame}`;
      vectors[ref] = key.shapes;
      return {
        frame: key.frame,
        ref,
        ...(key.openMotionTween ? { openMotionTween: key.openMotionTween } : {}),
      };
    }),
  }));
  const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
  const { activeId, entries } = projectScenes(valid);
  await store.writeNew(
    manifest.scene,
    json({
      id: activeId,
      name: entries.find((entry) => entry.id === activeId)!.name,
      timeline: manifest.timeline,
    }),
  );
  if (manifest.sceneCatalog) await store.writeNew(manifest.sceneCatalog, json(scenes));
  await store.writeNew(manifest.timeline, json(timeline));
  await store.writeNew(manifest.vectors, json(vectors));
  const content = json(manifest);
  // A failed publication leaves the previous manifest pointing at its complete revision.
  const receipt = await store.commit(manifestPath(autosave), content, expected);
  return { manifest: content, warning: receipt?.warning ?? null };
}
function validateManifest(raw: string): Manifest {
  const m = JSON.parse(raw) as Manifest;
  if (
    m.format !== 'splash-directory' ||
    !Number.isInteger(m.schemaVersion) ||
    m.schemaVersion < 1 ||
    m.schemaVersion > 61 ||
    !m.document
  )
    throw new Error('Unsupported .spl manifest');
  if (m.schemaVersion < 47 && 'opacityBindings' in m.document)
    throw new Error('Root opacity bindings require schema 47.');
  if (m.document.schemaVersion === 59 && m.schemaVersion < 59)
    throw new Error('Schema 59 documents require a schema 59 manifest.');
  if (m.document.schemaVersion === 60 && m.schemaVersion !== 60)
    throw new Error('Schema 60 documents require a schema 60 manifest.');
  if (
    'scenes' in m.document ||
    (m.schemaVersion === 61) !== (m.document.schemaVersion === 61) ||
    (m.schemaVersion === 61 ? typeof m.sceneCatalog !== 'string' : 'sceneCatalog' in m)
  )
    throw Error('Invalid scene catalog reference.');
  // Versions 48–58 allow later manifests, but never an older manifest for the embedded document.
  const documentVersion = m.document.schemaVersion;
  if (
    Number.isInteger(documentVersion) &&
    documentVersion >= 48 &&
    documentVersion <= 58 &&
    m.schemaVersion < documentVersion
  )
    throw new Error(
      `Schema ${documentVersion} documents require a schema ${documentVersion} manifest.`,
    );
  return m;
}

export async function loadProject(store: DirectoryStore, autosave = false): Promise<Loaded> {
  const raw = await store.read(manifestPath(autosave));
  const m = validateManifest(raw);
  const scene = JSON.parse(await store.read(safePath(m.scene))) as {
    id: string;
    name: string;
    timeline: string;
  };
  if (scene.timeline !== m.timeline) throw new Error('Scene/timeline reference mismatch');
  const timeline = JSON.parse(await store.read(safePath(m.timeline))) as (Omit<Layer, 'keys'> & {
    keys: (Omit<Layer['keys'][number], 'shapes'> & { ref: string })[];
  })[];
  const vectors = JSON.parse(await store.read(safePath(m.vectors))) as Record<string, Vector[]>;
  const layers = timeline.map((l) => ({
    ...l,
    keys: l.keys.map((k) => ({
      frame: k.frame,
      shapes: vectors[k.ref],
      ...('openMotionTween' in k ? { openMotionTween: k.openMotionTween } : {}),
    })),
  }));
  const sceneCatalog =
    m.sceneCatalog === undefined
      ? {}
      : {
          scenes: JSON.parse(await store.read(safePath(m.sceneCatalog))),
        };
  const project = migrateProject({ ...m.document, layers, ...sceneCatalog });
  if (
    project.scenes &&
    (project.scenes.activeId !== scene.id ||
      project.scenes.entries.find((entry) => entry.id === scene.id)?.name !== scene.name)
  )
    throw Error('Open scene does not match its catalog.');
  const missingAssets: string[] = [];
  for (const asset of project.assets) {
    if (!(await store.exists(asset.path))) missingAssets.push(asset.path);
    else if (asset.bitmap || asset.font) {
      const visual = asset.bitmap ?? asset.font!;
      const type = asset.font ? 'Font' : 'Bitmap';
      const content = await store.read(asset.path);
      if (content.length > (asset.font ? EMBEDDED_FONT_PAYLOAD_LIMIT + 100 : 2800100))
        throw new Error(`${type} asset exceeds size limit.`);
      const payload = JSON.parse(content) as { dataUrl?: string };
      if (typeof payload.dataUrl !== 'string')
        throw new Error(`Invalid ${type.toLowerCase()} asset payload.`);
      visual.dataUrl = payload.dataUrl;
    }
  }
  return { project: migrateProject(project), manifest: raw, missingAssets };
}
