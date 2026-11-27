import { symbolArtworks, type Layer, type Project, type Vector } from '../../document/src';
import { libraryBitmapInstance } from '../../geometry/src/library-instance';

export const spawnedGraphicsKey = '$splashSpawnedGraphics';
type SpawnFields = [name: string, id: string, x: number, y: number, rotation: number];
export type SpawnedGraphic = SpawnFields | [...SpawnFields, 'bitmap'] | [...SpawnFields, 'timeline', number, number];
export type SpawnPose = {frame:number;tick:number};
export const replaySpawnByteLimit = 64 * 1024 * 1024;
export const replaySpawnSize = (entries: readonly SpawnedGraphic[]) =>
  new TextEncoder().encode(JSON.stringify(entries)).byteLength;

export function replaySpawnField(pose: object): unknown {
  const field=Object.getOwnPropertyDescriptor(pose,'spawnedGraphics');
  if(!field)return undefined;
  if(!('value' in field))throw Error('Invalid replay spawned artwork field.');
  return field.value;
}

export function linkedPreviewTimelineSymbols(project: Pick<Project,'libraryLinks'|'symbols'>) {
  const linked = new Set(project.libraryLinks?.filter(link=>link.kind==='symbol').map(link=>link.id));
  return (project.symbols ?? []).filter(definition => linked.has(definition.id) &&
    !!definition.timeline && !definition.buttonStates && !definition.timeline.layerMasks?.length &&
    symbolArtworks(definition).every(shapes=>shapes.every(shape=>shape.kind!=='symbol' && shape.kind!=='text')));
}

export function linkedPreviewBitmaps(project: Pick<Project,'libraryLinks'> & Partial<Pick<Project,'assets'>>) {
  const linked = new Set(project.libraryLinks?.filter(link=>link.kind==='bitmap').map(link=>link.id));
  return (project.assets ?? []).filter(asset=>linked.has(asset.id) && !!asset.bitmap?.dataUrl);
}

export function spawnableGraphics(project: Pick<Project, 'symbols'>) {
  return (project.symbols ?? []).filter(definition =>
    !definition.buttonStates && !definition.timeline && definition.baseLayer?.visible !== false &&
    definition.shapes.length > 0 &&
    definition.shapes.every(shape => shape.kind !== 'symbol' && shape.kind !== 'text'));
}

// Used both in the disposable worker and at the host publication boundary.
export function readSpawnedGraphics(value: unknown, allowed: ReadonlySet<string>, bitmaps?: ReadonlySet<string>, timelines?: ReadonlySet<string>): SpawnedGraphic[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128) throw Error('Script previews support up to 128 spawned graphics.');
  const names = new Set<string>();
  function data(array: unknown[], index: number): unknown {
    const field = Object.getOwnPropertyDescriptor(array,index);
    if (!field?.enumerable || !('value' in field)) throw Error('Invalid spawned graphic data.');
    return field.value;
  }
  return Array.from({length:value.length}, (_,i) => {
    const item = data(value,i);
    if (!Array.isArray(item) || ![5,6,8].includes(item.length)) throw Error('Invalid spawned graphic data.');
    const kind = item.length > 5 ? data(item,5) : undefined;
    if ((item.length === 6 && kind !== 'bitmap') || (item.length === 8 && kind !== 'timeline'))
      throw Error('Invalid spawned graphic kind.');
    const name = data(item,0), symbol = data(item,1), x = data(item,2), y = data(item,3), rotation = data(item,4);
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || names.has(name))
      throw Error('Spawned graphics need unique nonempty names.');
    if (typeof symbol !== 'string' || !(kind==='bitmap' ? bitmaps?.has(symbol) : kind==='timeline' ? timelines?.has(symbol) : allowed.has(symbol)))
      throw Error(kind==='bitmap' ? 'This bitmap is unavailable for scripted creation.' : 'This symbol is unavailable for scripted creation.');
    if (typeof x !== 'number' || typeof y !== 'number' || typeof rotation !== 'number' ||
        ![x,y,rotation].every(n => Number.isFinite(n) && Math.abs(n) <= 100000))
      throw Error('Spawned graphic position and rotation must be bounded finite numbers.');
    names.add(name);
    if (kind==='timeline') {
      const tick=data(item,6),frame=data(item,7);
      if (typeof tick!=='number' || typeof frame!=='number' || !Number.isSafeInteger(tick) || !Number.isSafeInteger(frame) || tick<0 || frame<0)
        throw Error('Invalid spawned symbol origin.');
      return [name,symbol,x,y,rotation,kind,tick,frame];
    }
    return kind==='bitmap' ? [name,symbol,x,y,rotation,kind] : [name,symbol,x,y,rotation];
  });
}

export function scriptGraphicsLayer(project: Pick<Project,'layers'>): Layer {
  if (project.layers.length >= 1000) throw Error('Scripted graphics exceed the document layer budget.');
  const taken = new Set(project.layers.map(layer => layer.id));
  let layerId = '@script-graphics';
  while (taken.has(layerId)) layerId += '-';
  return {id:layerId,name:'Script graphics',visible:true,locked:true,keys:[{frame:0,shapes:[]}]};
}

/** Captured library authority and the same materialization used by preview and replay. */
export function captureSpawnArtwork(project: Project) {
  const assets = new Map(spawnableGraphics(project).map(definition => [definition.id, definition]));
  const bitmaps = new Map(linkedPreviewBitmaps(project).map(asset=>[asset.id,asset]));
  const timelines = new Map(linkedPreviewTimelineSymbols(project).map(definition=>[definition.id,definition]));
  const allowed = new Set(assets.keys()), images = new Set(bitmaps.keys()), timed = new Set(timelines.keys());
  return {
    read: (value: unknown) => readSpawnedGraphics(value,allowed,images,timed),
    shape(entry: SpawnedGraphic, index: number, pose?: SpawnPose): Vector {
      const [name,symbolId,x,y,rotation,kind,tick,frame] = entry;
      if (kind === 'bitmap') return {...libraryBitmapInstance(bitmaps.get(symbolId)!,x,y,'spawn-'+index),rotation};
      const definition = (kind==='timeline' ? timelines : assets).get(symbolId)!;
      const {width,height} = definition;
      let symbolPlayback:Vector['symbolPlayback'];
      if (kind==='timeline') {
        if (!pose || pose.tick < tick! || !Number.isSafeInteger(pose.tick) ||
          !Number.isSafeInteger(pose.frame) || pose.frame<0 || pose.frame>=project.duration || frame!>=project.duration)
          throw Error('Invalid preview pose for a spawned timeline symbol.');
        const elapsed = definition.defaultPlayback==='movie' ? pose.tick-tick! : Math.max(0,pose.frame-frame!);
        // The sampled child pose belongs to the script lifetime, independent of the layer key.
        symbolPlayback={mode:'single',firstFrame:elapsed % definition.timeline!.duration};
      }
      return {id:'spawn-'+index,kind:'symbol',instanceName:name,symbolId,width,height,x,y,rotation,
        fill:'#000000',stroke:'#000000',strokeWidth:0,points:[],...(symbolPlayback?{symbolPlayback}:{})};
    },
  };
}
