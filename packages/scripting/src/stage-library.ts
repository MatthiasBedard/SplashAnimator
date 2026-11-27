import type { Project } from '../../document/src';
import { validateLibraryOrganization } from '../../document/src/library';
import type { PlacementTransform } from './stage-transform';
import { linkedPreviewBitmaps, linkedPreviewTimelineSymbols } from './stage-spawn';

export type ScriptLibrarySource = Pick<Project, 'symbols' | 'libraryLinks' | 'libraryFolders' | 'libraryItems'> &
  Partial<Pick<Project, 'assets'>>;
type Identified = {link: string; id: string; name: string};
export type ScriptLibraryItem = Identified & (
  {kind: 'symbol'; width: number; height: number; defaultPlayback: 'loop'|'movie'; canSpawn: boolean; timed?: true} |
  {kind: 'bitmap'; width: number; height: number; canSpawn: boolean} |
  {kind: 'audio'; format: 'pcm16-wav'; sampleRate: number; channels: 1|2; frames: number}
);

/** Copy only admitted, script-visible metadata. Paths, bytes and vector data stay with the host. */
export function captureScriptLibrary(project: ScriptLibrarySource, spawnable: readonly string[], allowInstances = true): ScriptLibraryItem[] {
  if (!('libraryLinks' in project)) return [];
  validateLibraryOrganization(project);
  const symbols = new Map(project.symbols?.map(symbol => [symbol.id,symbol]));
  const assets = new Map(project.assets?.map(asset => [asset.id,asset]));
  const spawnIds = new Set(spawnable);
  const bitmapIds = new Set(allowInstances ? linkedPreviewBitmaps(project).map(asset=>asset.id) : []);
  const timelineIds = new Set(allowInstances ? linkedPreviewTimelineSymbols(project).map(symbol=>symbol.id) : []);
  const items: ScriptLibraryItem[] = [];
  for (const {name:link,id,kind} of project.libraryLinks ?? []) {
    if (kind === 'symbol') {
      const symbol = symbols.get(id);
      if (!symbol) continue;
      const {name,width,height,defaultPlayback='loop'} = symbol;
      const timed = timelineIds.has(id);
      items.push({link,id,kind,name,width,height,defaultPlayback,canSpawn:timed || defaultPlayback==='loop' && spawnIds.has(id),
        ...(timed?{timed:true}:{})});
      continue;
    }
    const asset = assets.get(id);
    if (kind === 'bitmap' && asset?.bitmap) {
      const {name,width,height} = asset.bitmap;
      items.push({link,id,kind,name,width,height,canSpawn:bitmapIds.has(id)});
    } else if (kind === 'audio' && asset?.audio) {
      const {name,format,sampleRate,channels,frames} = asset.audio;
      items.push({link,id,kind,name,format,sampleRate,channels,frames});
    }
  }
  return items.sort((a,b)=>a.link < b.link ? -1 : a.link > b.link ? 1 : 0);
}

/** Embedded in the worker. The resolved ID comes only from the captured link table. */
export function createScriptLibrary(
  items: readonly ScriptLibraryItem[],
  spawn: (name: string, symbolId: string, transform: PlacementTransform) => void,
  bitmap?: (name: string, assetId: string, transform: PlacementTransform) => void,
  timeline?: (name: string, symbolId: string, transform: PlacementTransform) => void,
) {
  const byLink = new Map(items.map(item => [item.link,Object.freeze({...item})]));
  function get(link: string) {
    if (typeof link !== 'string' || !link || link.length > 200) throw Error('Invalid library link name.');
    return byLink.get(link);
  }
  return Object.freeze({
    get,
    spawnGraphic(link: string, name: string, transform: PlacementTransform) {
      const entry = get(link);
      if (entry?.kind !== 'symbol' || !entry.canSpawn) throw Error('This library link cannot create a preview graphic.');
      if (entry.timed) {
        if (!timeline) throw Error('This library link cannot create a preview graphic.');
        timeline(name,entry.id,transform);
      } else spawn(name,entry.id,transform);
    },
    spawnBitmap(link: string, name: string, transform: PlacementTransform) {
      const entry = get(link);
      if (!bitmap || entry?.kind !== 'bitmap' || !entry.canSpawn)
        throw Error('This library link cannot create a preview bitmap.');
      bitmap(name,entry.id,transform);
    },
  });
}
