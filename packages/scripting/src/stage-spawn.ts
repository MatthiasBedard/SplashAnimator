import type { Project } from '../../document/src';
import type { ScriptState } from './timeline';
import type { PlacementTransform } from './stage-transform';
import { captureSpawnArtwork, scriptGraphicsLayer, spawnedGraphicsKey, type SpawnPose, readSpawnedGraphics } from '../../animation/src/spawn-artwork';
export { linkedPreviewBitmaps, linkedPreviewTimelineSymbols, spawnableGraphics, readSpawnedGraphics, spawnedGraphicsKey, type SpawnedGraphic, type SpawnPose } from '../../animation/src/spawn-artwork';

export function createStageSpawns(
  state: ScriptState, key: string, allowed: ReadonlySet<string>, read: typeof readSpawnedGraphics,
  bitmaps?: ReadonlySet<string>,
  timelines?: ReadonlySet<string>,
  birth?: SpawnPose,
) {
  const current = () => read(state[key],allowed,bitmaps,timelines);
  function write(name: string, id: string, position: PlacementTransform, kind?: 'bitmap'|'timeline') {
    if (!position || typeof position !== 'object') throw Error('Invalid spawned graphic position.');
    const [x,y,rotation] = ['x','y','rotation'].map(field => Object.getOwnPropertyDescriptor(position,field)?.value);
    const entry = [name,id,x,y,rotation];
    if (kind) entry.push(kind);
    if (kind==='timeline') entry.push(birth?.tick,birth?.frame);
    state[key] = read([...current(),entry],allowed,bitmaps,timelines);
  }
  return {
    spawnGraphic(name: string, symbolId: string, position: PlacementTransform) {
      write(name,symbolId,position);
    },
    spawnBitmap(name: string, assetId: string, position: PlacementTransform) {
      write(name,assetId,position,'bitmap');
    },
    spawnTimeline(name: string, symbolId: string, position: PlacementTransform) {
      write(name,symbolId,position,'timeline');
    },
    getSpawned(name: string) {
      const item = current().find(([other]) => other === name);
      if (!item) return undefined;
      const [owned,id,x,y,rotation,kind] = item;
      return Object.freeze({name:owned,x,y,rotation,...(kind==='bitmap' ? {assetId:id,kind} : {symbolId:id})});
    },
    removeSpawned(name: string) {
      const items = current();
      const remaining = items.filter(([other]) => other !== name);
      if (items.length === remaining.length) throw Error('Removal requires a script-owned graphic.');
      if (remaining.length) state[key] = remaining;
      else delete state[key];
    },
  };
}

export function applyStageSpawns(project: Project, state?: ScriptState, pose?: SpawnPose): Project {
  const value = state?.[spawnedGraphicsKey];
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return project;
  const source = captureSpawnArtwork(project);
  const entries = source.read(value);
  const layer = scriptGraphicsLayer(project);
  layer.keys[0].shapes = entries.map((entry, i) => source.shape(entry, i, pose));
  return {...project,layers:[...project.layers,layer]};
}
